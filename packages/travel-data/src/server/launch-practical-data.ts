import type { OfficialSourceCategory } from "../practical.js";
import { CalendarificHolidayAdapter } from "./calendarific.js";
import { EcbCurrencyAdapter } from "./ecb.js";
import { GovUkTravelAdvisoryAdapter } from "./govuk.js";
import { OfficialSourceRegistryAdapter } from "./official-registry.js";
import { OpenMeteoClimateAdapter, OpenMeteoForecastAdapter } from "./open-meteo.js";
import type { ProviderFetch } from "./provider-http.js";

const officialCategories = [
  "closure",
  "emergency",
  "event",
  "holiday",
  "visa",
  "weather_alert",
] as const satisfies readonly OfficialSourceCategory[];

export interface LaunchPracticalDataEnvironment {
  ADVISORY_PROVIDER?: string;
  CURRENCY_PROVIDER?: string;
  HOLIDAY_API_KEY?: string;
  HOLIDAY_PROVIDER?: string;
  WEATHER_API_KEY?: string;
  WEATHER_PROVIDER?: string;
}

export interface LaunchPracticalDataConfig {
  advisory: { provider: "govuk" };
  currency: { provider: "ecb" };
  holiday: { apiKey: string; provider: "calendarific" };
  weather: { apiKey: string; provider: "open-meteo" };
}

export interface LaunchPracticalDataProviderBundle {
  advisory: GovUkTravelAdvisoryAdapter;
  climate: OpenMeteoClimateAdapter;
  currency: EcbCurrencyAdapter;
  holiday: CalendarificHolidayAdapter;
  officialSources: Record<OfficialSourceCategory, OfficialSourceRegistryAdapter>;
  weather: OpenMeteoForecastAdapter;
}

export interface LaunchPracticalDataProviderOptions {
  calendarificBaseUrl?: string;
  clock?: () => Date;
  ecbBaseUrl?: string;
  fetch?: ProviderFetch;
  govUkBaseUrl?: string;
  openMeteoClimateBaseUrl?: string;
  openMeteoForecastBaseUrl?: string;
}

function selectedProvider(value: string | undefined, expected: string, variable: string) {
  if (value?.trim().toLowerCase() !== expected) {
    throw new Error(`${variable} must be set to the approved launch provider: ${expected}.`);
  }
}

function requiredKey(value: string | undefined, variable: string) {
  if (!value || value.trim().length < 8 || /\s/.test(value)) {
    throw new Error(`${variable} must contain a non-empty server-side provider credential.`);
  }
  return value;
}

export function readLaunchPracticalDataConfig(
  environment: LaunchPracticalDataEnvironment,
): LaunchPracticalDataConfig {
  selectedProvider(environment.WEATHER_PROVIDER, "open-meteo", "WEATHER_PROVIDER");
  selectedProvider(environment.HOLIDAY_PROVIDER, "calendarific", "HOLIDAY_PROVIDER");
  selectedProvider(environment.ADVISORY_PROVIDER, "govuk", "ADVISORY_PROVIDER");
  selectedProvider(environment.CURRENCY_PROVIDER, "ecb", "CURRENCY_PROVIDER");
  return {
    advisory: { provider: "govuk" },
    currency: { provider: "ecb" },
    holiday: {
      apiKey: requiredKey(environment.HOLIDAY_API_KEY, "HOLIDAY_API_KEY"),
      provider: "calendarific",
    },
    weather: {
      apiKey: requiredKey(environment.WEATHER_API_KEY, "WEATHER_API_KEY"),
      provider: "open-meteo",
    },
  };
}

export function createLaunchPracticalDataProviderBundle(
  config: LaunchPracticalDataConfig,
  options: LaunchPracticalDataProviderOptions = {},
): LaunchPracticalDataProviderBundle {
  if (
    config.weather.provider !== "open-meteo" ||
    config.holiday.provider !== "calendarific" ||
    config.advisory.provider !== "govuk" ||
    config.currency.provider !== "ecb"
  ) {
    throw new Error("Unsupported launch practical-data provider configuration.");
  }
  const common = { clock: options.clock, fetch: options.fetch };
  const openMeteo = {
    ...common,
    apiKey: config.weather.apiKey,
    climateBaseUrl: options.openMeteoClimateBaseUrl,
    forecastBaseUrl: options.openMeteoForecastBaseUrl,
  };
  return {
    advisory: new GovUkTravelAdvisoryAdapter({ ...common, baseUrl: options.govUkBaseUrl }),
    climate: new OpenMeteoClimateAdapter(openMeteo),
    currency: new EcbCurrencyAdapter({ ...common, baseUrl: options.ecbBaseUrl }),
    holiday: new CalendarificHolidayAdapter({
      ...common,
      apiKey: config.holiday.apiKey,
      baseUrl: options.calendarificBaseUrl,
    }),
    officialSources: Object.fromEntries(
      officialCategories.map((category) => [
        category,
        new OfficialSourceRegistryAdapter({ category, clock: options.clock }),
      ]),
    ) as Record<OfficialSourceCategory, OfficialSourceRegistryAdapter>,
    weather: new OpenMeteoForecastAdapter(openMeteo),
  };
}
