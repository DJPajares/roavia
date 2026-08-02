import {
  type ClimateInput,
  type ClimatePoint,
  type ClimateSeries,
  type ClimateValue,
  type OpenMeteoClimateModel,
  type WeatherForecastInput,
  type WeatherForecastPoint,
  type WeatherForecastValue,
  isClimateInput,
  isWeatherForecastInput,
} from "../practical.js";
import { isCoordinates } from "../maps.js";
import {
  type ProviderAdapterResult,
  type ProviderRequestContext,
  type ProviderSource,
  type TravelDataAdapter,
  providerError,
} from "../contracts.js";
import {
  type ProviderFetch,
  isRecord,
  jsonBody,
  networkUnavailable,
  normalizedProviderBaseUrl,
  providerHttpFailure,
  requiredSecret,
} from "./provider-http.js";

const provider = "open-meteo";
const forecastDocsUrl = "https://open-meteo.com/en/docs";
const climateDocsUrl = "https://open-meteo.com/en/docs/climate-api";
const licenseUrl = "https://creativecommons.org/licenses/by/4.0/";
const launchRegions = new Set(["AU", "FR", "IS", "JP", "SG", "TH", "US"]);
const forecastVariables = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "uv_index",
] as const;
const climateVariables = [
  "temperature_2m_mean",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
] as const;

interface OpenMeteoOptions {
  apiKey: string;
  clock?: () => Date;
  fetch?: ProviderFetch;
}

export interface OpenMeteoAdapterOptions extends OpenMeteoOptions {
  climateBaseUrl?: string;
  forecastBaseUrl?: string;
}

function invalidRequest<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_request",
    "Weather request did not satisfy the normalized input contract.",
    false,
  );
}

function invalidResponse<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_response",
    "Weather provider response could not be normalized.",
    true,
  );
}

function source(input: {
  docsUrl: string;
  expiresAt: string;
  retrievedAt: string;
  title: string;
  validFrom: string;
  validUntil: string;
}): ProviderSource {
  return {
    attributionText: "Weather data by Open-Meteo.com",
    expiresAt: input.expiresAt,
    license: "CC BY 4.0 data through the Open-Meteo commercial service",
    licenseUrl,
    offlineUseAllowed: true,
    provider,
    quality: {
      warnings: [
        "Model output is an estimate and does not replace an official severe-weather authority.",
      ],
    },
    redistributionAllowed: true,
    retrievedAt: input.retrievedAt,
    sourceKind: "licensed_provider",
    sourceUrl: input.docsUrl,
    title: input.title,
    trustTier: "tier_3",
    validFrom: input.validFrom,
    validUntil: input.validUntil,
  };
}

function numericArray(value: unknown, length: number): value is Array<number | null> {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => item === null || (typeof item === "number" && Number.isFinite(item)))
  );
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")
  );
}

function responseCoordinates(body: Record<string, unknown>) {
  const coordinates = { latitude: body.latitude, longitude: body.longitude };
  return isCoordinates(coordinates) ? coordinates : undefined;
}

function normalizeForecastBody(
  body: unknown,
  input: WeatherForecastInput,
): WeatherForecastValue | undefined {
  if (!isRecord(body) || !isRecord(body.hourly) || !isRecord(body.hourly_units)) return undefined;
  const coordinates = responseCoordinates(body);
  const times = body.hourly.time;
  if (
    !coordinates ||
    body.timezone !== input.timezone ||
    !stringArray(times) ||
    !times.every((time) => Number.isFinite(Date.parse(time))) ||
    body.hourly_units.time !== "iso8601" ||
    body.hourly_units.temperature_2m !== "°C" ||
    body.hourly_units.relative_humidity_2m !== "%" ||
    body.hourly_units.precipitation_probability !== "%" ||
    body.hourly_units.precipitation !== "mm" ||
    body.hourly_units.weather_code !== "wmo code" ||
    body.hourly_units.wind_speed_10m !== "km/h" ||
    body.hourly_units.uv_index !== ""
  ) {
    return undefined;
  }
  const count = times.length;
  const temperatures = body.hourly.temperature_2m;
  const humidities = body.hourly.relative_humidity_2m;
  const precipitationProbabilities = body.hourly.precipitation_probability;
  const precipitation = body.hourly.precipitation;
  const weatherCodes = body.hourly.weather_code;
  const windSpeeds = body.hourly.wind_speed_10m;
  const ultravioletIndexes = body.hourly.uv_index;
  if (
    !numericArray(temperatures, count) ||
    !numericArray(humidities, count) ||
    !numericArray(precipitationProbabilities, count) ||
    !numericArray(precipitation, count) ||
    !numericArray(weatherCodes, count) ||
    !numericArray(windSpeeds, count) ||
    !numericArray(ultravioletIndexes, count)
  ) {
    return undefined;
  }
  const points: WeatherForecastPoint[] = times.map((at, index) => ({
    at,
    precipitationMillimeters: precipitation[index]!,
    precipitationProbabilityPercent: precipitationProbabilities[index]!,
    relativeHumidityPercent: humidities[index]!,
    temperatureCelsius: temperatures[index]!,
    ultravioletIndex: ultravioletIndexes[index]!,
    weatherCode: weatherCodes[index]!,
    windSpeedKilometersPerHour: windSpeeds[index]!,
  }));
  const partial = points.some((point) =>
    Object.entries(point).some(([key, value]) => key !== "at" && value === null),
  );
  return {
    availability: partial ? "partial" : "available",
    coordinates,
    model: "best_match",
    period: { endsAt: times.at(-1)!, startsAt: times[0]! },
    points,
    timezone: input.timezone,
    units: {
      precipitation: "millimeter",
      precipitationProbability: "percent",
      relativeHumidity: "percent",
      temperature: "celsius",
      ultravioletIndex: "index",
      windSpeed: "kilometer_per_hour",
    },
  };
}

function climateKey(variable: (typeof climateVariables)[number], model: OpenMeteoClimateModel) {
  return `${variable}_${model}`;
}

function climateSeries(
  daily: Record<string, unknown>,
  units: Record<string, unknown>,
  dates: readonly string[],
  model: OpenMeteoClimateModel,
): ClimateSeries | undefined {
  const meanKey = climateKey("temperature_2m_mean", model);
  const maximumKey = climateKey("temperature_2m_max", model);
  const minimumKey = climateKey("temperature_2m_min", model);
  const precipitationKey = climateKey("precipitation_sum", model);
  if (
    units[meanKey] !== "°C" ||
    units[maximumKey] !== "°C" ||
    units[minimumKey] !== "°C" ||
    units[precipitationKey] !== "mm" ||
    !numericArray(daily[meanKey], dates.length) ||
    !numericArray(daily[maximumKey], dates.length) ||
    !numericArray(daily[minimumKey], dates.length) ||
    !numericArray(daily[precipitationKey], dates.length)
  ) {
    return undefined;
  }
  const mean = daily[meanKey];
  const maximum = daily[maximumKey];
  const minimum = daily[minimumKey];
  const precipitation = daily[precipitationKey];
  const points: ClimatePoint[] = dates.map((date, index) => ({
    date,
    maximumTemperatureCelsius: maximum[index]!,
    meanTemperatureCelsius: mean[index]!,
    minimumTemperatureCelsius: minimum[index]!,
    precipitationMillimeters: precipitation[index]!,
  }));
  return { model, points };
}

function normalizeClimateBody(body: unknown, input: ClimateInput): ClimateValue | undefined {
  if (!isRecord(body) || !isRecord(body.daily) || !isRecord(body.daily_units)) return undefined;
  const daily = body.daily;
  const dailyUnits = body.daily_units;
  const coordinates = responseCoordinates(body);
  const dates = daily.time;
  if (
    !coordinates ||
    body.timezone !== input.timezone ||
    !stringArray(dates) ||
    !dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)) ||
    dailyUnits.time !== "iso8601"
  ) {
    return undefined;
  }
  const series = input.models.map((model) => climateSeries(daily, dailyUnits, dates, model));
  if (series.some((item) => item === undefined)) return undefined;
  const normalized = series as ClimateSeries[];
  const partial = normalized.some((item) =>
    item.points.some((point) =>
      Object.entries(point).some(([key, value]) => key !== "date" && value === null),
    ),
  );
  return {
    availability: partial ? "partial" : "available",
    coordinates,
    kind: "model_projection",
    period: { endDate: dates.at(-1)!, startDate: dates[0]! },
    series: normalized,
    timezone: input.timezone,
    units: { precipitation: "millimeter", temperature: "celsius" },
    warning:
      "Climate series are bias-corrected model projections, not observations or a forecast; compare models and retain uncertainty.",
  };
}

abstract class OpenMeteoHttpAdapter {
  protected readonly clock: () => Date;
  protected readonly fetch: ProviderFetch;
  readonly provider = provider;
  #apiKey: string;

  constructor(options: OpenMeteoOptions) {
    this.#apiKey = requiredSecret(options.apiKey, "Open-Meteo API key");
    this.clock = options.clock ?? (() => new Date());
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  protected authorize(url: URL) {
    url.searchParams.set("apikey", this.#apiKey);
    return url;
  }

  supports(context: Pick<ProviderRequestContext, "region">) {
    return context.region === undefined || launchRegions.has(context.region.toUpperCase());
  }
}

export class OpenMeteoForecastAdapter
  extends OpenMeteoHttpAdapter
  implements TravelDataAdapter<WeatherForecastInput, WeatherForecastValue>
{
  readonly dataClass = "weather_forecast" as const;
  readonly operation = "weather.forecast";
  readonly #baseUrl: string;

  constructor(options: OpenMeteoAdapterOptions) {
    super(options);
    this.#baseUrl = normalizedProviderBaseUrl(
      options.forecastBaseUrl ?? "https://customer-api.open-meteo.com",
      "Open-Meteo forecast",
      ["customer-api.open-meteo.com"],
    );
  }

  async execute(
    input: WeatherForecastInput,
    context: ProviderRequestContext,
  ): Promise<ProviderAdapterResult<WeatherForecastValue>> {
    if (!isWeatherForecastInput(input)) return invalidRequest(this.operation);
    const url = this.authorize(new URL("/v1/forecast", this.#baseUrl));
    url.searchParams.set("latitude", String(input.coordinates.latitude));
    url.searchParams.set("longitude", String(input.coordinates.longitude));
    url.searchParams.set("start_date", input.startDate);
    url.searchParams.set("end_date", input.endDate);
    url.searchParams.set("hourly", forecastVariables.join(","));
    url.searchParams.set("temperature_unit", "celsius");
    url.searchParams.set("wind_speed_unit", "kmh");
    url.searchParams.set("precipitation_unit", "mm");
    url.searchParams.set("timezone", input.timezone);

    let response: Response;
    try {
      response = await this.fetch(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      return networkUnavailable({ label: "Weather provider", operation: this.operation, provider });
    }
    const now = this.clock();
    if (!response.ok) {
      return providerHttpFailure({
        label: "Weather provider",
        now,
        operation: this.operation,
        provider,
        response,
      });
    }
    const value = normalizeForecastBody(await jsonBody(response), input);
    if (!value) return invalidResponse(this.operation);
    const retrievedAt = now.toISOString();
    return {
      operation: this.operation,
      provider,
      sources: [
        source({
          docsUrl: forecastDocsUrl,
          expiresAt: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
          retrievedAt,
          title: "Open-Meteo forecast model output",
          validFrom: `${input.startDate}T00:00:00Z`,
          validUntil: new Date(
            Date.parse(`${input.endDate}T00:00:00Z`) + 24 * 60 * 60_000,
          ).toISOString(),
        }),
      ],
      status: "success",
      usage: { costUnitName: "request", costUnits: 1, requests: 1 },
      value,
      warnings:
        value.availability === "partial"
          ? ["One or more requested weather values were unavailable from the selected model."]
          : undefined,
    };
  }
}

export class OpenMeteoClimateAdapter
  extends OpenMeteoHttpAdapter
  implements TravelDataAdapter<ClimateInput, ClimateValue>
{
  readonly dataClass = "climate" as const;
  readonly operation = "weather.climate";
  readonly #baseUrl: string;

  constructor(options: OpenMeteoAdapterOptions) {
    super(options);
    this.#baseUrl = normalizedProviderBaseUrl(
      options.climateBaseUrl ?? "https://customer-climate-api.open-meteo.com",
      "Open-Meteo climate",
      ["customer-climate-api.open-meteo.com"],
    );
  }

  async execute(
    input: ClimateInput,
    context: ProviderRequestContext,
  ): Promise<ProviderAdapterResult<ClimateValue>> {
    if (!isClimateInput(input)) return invalidRequest(this.operation);
    const url = this.authorize(new URL("/v1/climate", this.#baseUrl));
    url.searchParams.set("latitude", String(input.coordinates.latitude));
    url.searchParams.set("longitude", String(input.coordinates.longitude));
    url.searchParams.set("start_date", input.startDate);
    url.searchParams.set("end_date", input.endDate);
    url.searchParams.set("models", input.models.join(","));
    url.searchParams.set("daily", climateVariables.join(","));
    url.searchParams.set("temperature_unit", "celsius");
    url.searchParams.set("wind_speed_unit", "kmh");
    url.searchParams.set("precipitation_unit", "mm");
    url.searchParams.set("timezone", input.timezone);

    let response: Response;
    try {
      response = await this.fetch(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      return networkUnavailable({ label: "Climate provider", operation: this.operation, provider });
    }
    const now = this.clock();
    if (!response.ok) {
      return providerHttpFailure({
        label: "Climate provider",
        now,
        operation: this.operation,
        provider,
        response,
      });
    }
    const value = normalizeClimateBody(await jsonBody(response), input);
    if (!value) return invalidResponse(this.operation);
    const retrievedAt = now.toISOString();
    return {
      operation: this.operation,
      provider,
      sources: [
        source({
          docsUrl: climateDocsUrl,
          expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000).toISOString(),
          retrievedAt,
          title: "Open-Meteo CMIP6 climate model output",
          validFrom: `${input.startDate}T00:00:00Z`,
          validUntil: new Date(
            Date.parse(`${input.endDate}T00:00:00Z`) + 24 * 60 * 60_000,
          ).toISOString(),
        }),
      ],
      status: "success",
      usage: {
        costUnitName: "location-model-day",
        costUnits:
          input.models.length *
          ((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000 + 1),
        requests: 1,
      },
      value,
      warnings: [value.warning],
    };
  }
}
