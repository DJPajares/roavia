import {
  defaultProviderExecutionPolicy,
  type ProviderFallbackPolicy,
  type TravelDataClass,
  type TravelDataOperation,
} from "./contracts.js";
import { isCoordinates, type Coordinates } from "./maps.js";

export const launchDestinationCodes = [
  "bangkok",
  "new-york-city",
  "paris",
  "reykjavik",
  "singapore",
  "sydney",
  "tokyo",
] as const;

export type LaunchDestinationCode = (typeof launchDestinationCodes)[number];

export const launchCurrencies = ["AUD", "EUR", "ISK", "JPY", "SGD", "THB", "USD"] as const;
export type LaunchCurrency = (typeof launchCurrencies)[number];

export const openMeteoClimateModels = [
  "CMCC_CM2_VHR4",
  "EC_Earth3P_HR",
  "FGOALS_f3_H",
  "HiRAM_SIT_HR",
  "MPI_ESM1_2_XR",
  "MRI_AGCM3_2_S",
  "NICAM16_8S",
] as const;

export type OpenMeteoClimateModel = (typeof openMeteoClimateModels)[number];

export interface WeatherForecastInput {
  coordinates: Coordinates;
  endDate: string;
  startDate: string;
  timezone: string;
}

export interface WeatherForecastPoint {
  at: string;
  precipitationMillimeters: number | null;
  precipitationProbabilityPercent: number | null;
  relativeHumidityPercent: number | null;
  temperatureCelsius: number | null;
  ultravioletIndex: number | null;
  weatherCode: number | null;
  windSpeedKilometersPerHour: number | null;
}

export interface WeatherForecastValue {
  availability: "available" | "partial";
  coordinates: Coordinates;
  model: "best_match";
  period: { endsAt: string; startsAt: string };
  points: readonly WeatherForecastPoint[];
  timezone: string;
  units: {
    precipitation: "millimeter";
    precipitationProbability: "percent";
    relativeHumidity: "percent";
    temperature: "celsius";
    ultravioletIndex: "index";
    windSpeed: "kilometer_per_hour";
  };
}

export interface ClimateInput {
  coordinates: Coordinates;
  endDate: string;
  models: readonly OpenMeteoClimateModel[];
  startDate: string;
  timezone: string;
}

export interface ClimatePoint {
  date: string;
  maximumTemperatureCelsius: number | null;
  meanTemperatureCelsius: number | null;
  minimumTemperatureCelsius: number | null;
  precipitationMillimeters: number | null;
}

export interface ClimateSeries {
  model: OpenMeteoClimateModel;
  points: readonly ClimatePoint[];
}

export interface ClimateValue {
  availability: "available" | "partial";
  coordinates: Coordinates;
  kind: "model_projection";
  period: { endDate: string; startDate: string };
  series: readonly ClimateSeries[];
  timezone: string;
  units: { precipitation: "millimeter"; temperature: "celsius" };
  warning: string;
}

export type HolidayType = "local" | "national" | "observance" | "religious" | "unknown";

export interface HolidayInput {
  countryCode: string;
  locale?: string;
  subdivision?: string;
  year: number;
}

export interface HolidayRecord {
  date: string;
  description?: string;
  id?: string;
  name: string;
  status: "confirmed" | "provisional";
  types: readonly HolidayType[];
}

export interface HolidayValue {
  availability: "available" | "partial";
  countryCode: string;
  holidays: readonly HolidayRecord[];
  subdivision?: string;
  year: number;
}

export interface TravelAdvisoryInput {
  destination: LaunchDestinationCode;
  travelerCountryCode: string;
}

export interface TravelAdvisoryValue {
  authority: string;
  availability: "available" | "withdrawn";
  destination: LaunchDestinationCode;
  manualReviewRequired: true;
  officialUrl: string;
  summary: string;
  title: string;
  topicLinks: {
    entryRequirements: string;
    health: string;
    safetyAndSecurity: string;
  };
  travelerCountryCode: string;
  updatedAt: string;
}

export type OfficialSourceCategory =
  "closure" | "emergency" | "event" | "holiday" | "visa" | "weather_alert";

export interface OfficialSourceInput {
  category: OfficialSourceCategory;
  destination: LaunchDestinationCode;
}

export interface OfficialSourceLink {
  authority: string;
  category: OfficialSourceCategory;
  locale: string;
  reviewedAt: string;
  title: string;
  url: string;
}

export interface OfficialSourceValue {
  availability: "available";
  category: OfficialSourceCategory;
  destination: LaunchDestinationCode;
  links: readonly OfficialSourceLink[];
}

export interface CurrencyRateInput {
  baseCurrency: LaunchCurrency;
  quoteCurrencies: readonly LaunchCurrency[];
}

export interface CurrencyReferenceRate {
  quoteCurrency: LaunchCurrency;
  rate: string;
}

export interface CurrencyRateValue {
  asOf: string;
  availability: "available" | "stale";
  baseCurrency: LaunchCurrency;
  kind: "planning_estimate";
  rates: readonly CurrencyReferenceRate[];
  warning: string;
}

export interface CurrencyEstimate {
  amountMinor: number;
  currency: LaunchCurrency;
  estimate: true;
  rounding: "half_up";
}

const launchDestinationSet = new Set<string>(launchDestinationCodes);
const launchCurrencySet = new Set<string>(launchCurrencies);
const climateModelSet = new Set<string>(openMeteoClimateModels);
const holidayTypes = new Set<string>(["local", "national", "observance", "religious", "unknown"]);
const officialSourceCategories = new Set<string>([
  "closure",
  "emergency",
  "event",
  "holiday",
  "visa",
  "weather_alert",
]);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const timezonePattern = /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/;
const countryCodePattern = /^[A-Z]{2}$/;
const localePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const subdivisionPattern = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function dateSpanDays(startDate: string, endDate: string) {
  return (
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 + 1
  );
}

function isPeriod(startDate: unknown, endDate: unknown, maximumDays: number) {
  return (
    isIsoDate(startDate) &&
    isIsoDate(endDate) &&
    Date.parse(endDate) >= Date.parse(startDate) &&
    dateSpanDays(startDate, endDate) <= maximumDays
  );
}

export function isLaunchDestinationCode(value: unknown): value is LaunchDestinationCode {
  return typeof value === "string" && launchDestinationSet.has(value);
}

export function isLaunchCurrency(value: unknown): value is LaunchCurrency {
  return typeof value === "string" && launchCurrencySet.has(value);
}

export function isWeatherForecastInput(value: unknown): value is WeatherForecastInput {
  if (!isRecord(value)) return false;
  return (
    isCoordinates(value.coordinates) &&
    isPeriod(value.startDate, value.endDate, 16) &&
    typeof value.timezone === "string" &&
    timezonePattern.test(value.timezone)
  );
}

function isWeatherPoint(value: unknown): value is WeatherForecastPoint {
  if (!isRecord(value)) return false;
  return (
    isTimestamp(value.at) &&
    isFiniteOrNull(value.precipitationMillimeters) &&
    isFiniteOrNull(value.precipitationProbabilityPercent) &&
    isFiniteOrNull(value.relativeHumidityPercent) &&
    isFiniteOrNull(value.temperatureCelsius) &&
    isFiniteOrNull(value.ultravioletIndex) &&
    isFiniteOrNull(value.weatherCode) &&
    isFiniteOrNull(value.windSpeedKilometersPerHour) &&
    (value.precipitationProbabilityPercent === null ||
      (value.precipitationProbabilityPercent >= 0 &&
        value.precipitationProbabilityPercent <= 100)) &&
    (value.relativeHumidityPercent === null ||
      (value.relativeHumidityPercent >= 0 && value.relativeHumidityPercent <= 100)) &&
    (value.precipitationMillimeters === null || value.precipitationMillimeters >= 0) &&
    (value.windSpeedKilometersPerHour === null || value.windSpeedKilometersPerHour >= 0) &&
    (value.ultravioletIndex === null || value.ultravioletIndex >= 0) &&
    (value.weatherCode === null || Number.isInteger(value.weatherCode))
  );
}

export function isWeatherForecastValue(value: unknown): value is WeatherForecastValue {
  if (!isRecord(value) || !isRecord(value.period) || !isRecord(value.units)) return false;
  return (
    (value.availability === "available" || value.availability === "partial") &&
    isCoordinates(value.coordinates) &&
    value.model === "best_match" &&
    isTimestamp(value.period.startsAt) &&
    isTimestamp(value.period.endsAt) &&
    Date.parse(value.period.endsAt as string) >= Date.parse(value.period.startsAt as string) &&
    Array.isArray(value.points) &&
    value.points.length > 0 &&
    value.points.every(isWeatherPoint) &&
    typeof value.timezone === "string" &&
    timezonePattern.test(value.timezone) &&
    value.units.temperature === "celsius" &&
    value.units.precipitation === "millimeter" &&
    value.units.precipitationProbability === "percent" &&
    value.units.relativeHumidity === "percent" &&
    value.units.windSpeed === "kilometer_per_hour" &&
    value.units.ultravioletIndex === "index"
  );
}

export function isClimateInput(value: unknown): value is ClimateInput {
  if (!isRecord(value)) return false;
  return (
    isCoordinates(value.coordinates) &&
    isPeriod(value.startDate, value.endDate, 40 * 366) &&
    (value.startDate as string) >= "1950-01-01" &&
    (value.endDate as string) <= "2050-01-01" &&
    Array.isArray(value.models) &&
    value.models.length >= 2 &&
    value.models.length <= openMeteoClimateModels.length &&
    new Set(value.models).size === value.models.length &&
    value.models.every((model) => typeof model === "string" && climateModelSet.has(model)) &&
    typeof value.timezone === "string" &&
    timezonePattern.test(value.timezone)
  );
}

function isClimatePoint(value: unknown): value is ClimatePoint {
  if (!isRecord(value)) return false;
  return (
    isIsoDate(value.date) &&
    isFiniteOrNull(value.maximumTemperatureCelsius) &&
    isFiniteOrNull(value.meanTemperatureCelsius) &&
    isFiniteOrNull(value.minimumTemperatureCelsius) &&
    isFiniteOrNull(value.precipitationMillimeters) &&
    (value.precipitationMillimeters === null || value.precipitationMillimeters >= 0)
  );
}

export function isClimateValue(value: unknown): value is ClimateValue {
  if (!isRecord(value) || !isRecord(value.period) || !isRecord(value.units)) return false;
  return (
    (value.availability === "available" || value.availability === "partial") &&
    isCoordinates(value.coordinates) &&
    value.kind === "model_projection" &&
    isIsoDate(value.period.startDate) &&
    isIsoDate(value.period.endDate) &&
    Array.isArray(value.series) &&
    value.series.length >= 2 &&
    value.series.every(
      (series) =>
        isRecord(series) &&
        typeof series.model === "string" &&
        climateModelSet.has(series.model) &&
        Array.isArray(series.points) &&
        series.points.length > 0 &&
        series.points.every(isClimatePoint),
    ) &&
    typeof value.timezone === "string" &&
    timezonePattern.test(value.timezone) &&
    value.units.precipitation === "millimeter" &&
    value.units.temperature === "celsius" &&
    typeof value.warning === "string" &&
    value.warning.length > 0
  );
}

export function isHolidayInput(value: unknown): value is HolidayInput {
  if (!isRecord(value)) return false;
  return (
    typeof value.countryCode === "string" &&
    countryCodePattern.test(value.countryCode) &&
    Number.isInteger(value.year) &&
    (value.year as number) >= 1970 &&
    (value.year as number) <= 2049 &&
    (value.locale === undefined ||
      (typeof value.locale === "string" && localePattern.test(value.locale))) &&
    (value.subdivision === undefined ||
      (typeof value.subdivision === "string" && subdivisionPattern.test(value.subdivision)))
  );
}

function isHolidayRecord(value: unknown): value is HolidayRecord {
  if (!isRecord(value)) return false;
  return (
    isIsoDate(value.date) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 200 &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.id === undefined || (typeof value.id === "string" && value.id.length > 0)) &&
    (value.status === "confirmed" || value.status === "provisional") &&
    Array.isArray(value.types) &&
    value.types.length > 0 &&
    value.types.every((type) => typeof type === "string" && holidayTypes.has(type))
  );
}

export function isHolidayValue(value: unknown): value is HolidayValue {
  if (!isRecord(value)) return false;
  return (
    (value.availability === "available" || value.availability === "partial") &&
    typeof value.countryCode === "string" &&
    countryCodePattern.test(value.countryCode) &&
    Number.isInteger(value.year) &&
    (value.subdivision === undefined ||
      (typeof value.subdivision === "string" && subdivisionPattern.test(value.subdivision))) &&
    Array.isArray(value.holidays) &&
    value.holidays.every(isHolidayRecord)
  );
}

export function isTravelAdvisoryInput(value: unknown): value is TravelAdvisoryInput {
  if (!isRecord(value)) return false;
  return (
    isLaunchDestinationCode(value.destination) &&
    typeof value.travelerCountryCode === "string" &&
    countryCodePattern.test(value.travelerCountryCode)
  );
}

export function isTravelAdvisoryValue(value: unknown): value is TravelAdvisoryValue {
  if (!isRecord(value) || !isRecord(value.topicLinks)) return false;
  return (
    typeof value.authority === "string" &&
    (value.availability === "available" || value.availability === "withdrawn") &&
    isLaunchDestinationCode(value.destination) &&
    value.manualReviewRequired === true &&
    isHttpUrl(value.officialUrl) &&
    typeof value.summary === "string" &&
    value.summary.length > 0 &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    isHttpUrl(value.topicLinks.entryRequirements) &&
    isHttpUrl(value.topicLinks.health) &&
    isHttpUrl(value.topicLinks.safetyAndSecurity) &&
    typeof value.travelerCountryCode === "string" &&
    countryCodePattern.test(value.travelerCountryCode) &&
    isTimestamp(value.updatedAt)
  );
}

export function isOfficialSourceInput(value: unknown): value is OfficialSourceInput {
  if (!isRecord(value)) return false;
  return (
    typeof value.category === "string" &&
    officialSourceCategories.has(value.category) &&
    isLaunchDestinationCode(value.destination)
  );
}

function isOfficialSourceLink(value: unknown): value is OfficialSourceLink {
  if (!isRecord(value)) return false;
  return (
    typeof value.authority === "string" &&
    value.authority.length > 0 &&
    typeof value.category === "string" &&
    officialSourceCategories.has(value.category) &&
    typeof value.locale === "string" &&
    localePattern.test(value.locale) &&
    isIsoDate(value.reviewedAt) &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    isHttpUrl(value.url)
  );
}

export function isOfficialSourceValue(value: unknown): value is OfficialSourceValue {
  if (!isRecord(value)) return false;
  return (
    value.availability === "available" &&
    typeof value.category === "string" &&
    officialSourceCategories.has(value.category) &&
    isLaunchDestinationCode(value.destination) &&
    Array.isArray(value.links) &&
    value.links.length > 0 &&
    value.links.every(isOfficialSourceLink) &&
    value.links.every((link) => link.category === value.category)
  );
}

export function isCurrencyRateInput(value: unknown): value is CurrencyRateInput {
  if (!isRecord(value)) return false;
  return (
    isLaunchCurrency(value.baseCurrency) &&
    Array.isArray(value.quoteCurrencies) &&
    value.quoteCurrencies.length > 0 &&
    value.quoteCurrencies.length <= launchCurrencies.length &&
    new Set(value.quoteCurrencies).size === value.quoteCurrencies.length &&
    value.quoteCurrencies.every(isLaunchCurrency)
  );
}

export function isCurrencyRateValue(value: unknown): value is CurrencyRateValue {
  if (!isRecord(value)) return false;
  return (
    isIsoDate(value.asOf) &&
    (value.availability === "available" || value.availability === "stale") &&
    isLaunchCurrency(value.baseCurrency) &&
    value.kind === "planning_estimate" &&
    Array.isArray(value.rates) &&
    value.rates.length > 0 &&
    new Set(value.rates.map((rate) => (isRecord(rate) ? rate.quoteCurrency : undefined))).size ===
      value.rates.length &&
    value.rates.every(
      (rate) =>
        isRecord(rate) &&
        isLaunchCurrency(rate.quoteCurrency) &&
        typeof rate.rate === "string" &&
        decimalPattern.test(rate.rate) &&
        Number(rate.rate) > 0,
    ) &&
    typeof value.warning === "string" &&
    value.warning.length > 0
  );
}

const launchExecutionPolicy = {
  ...defaultProviderExecutionPolicy,
  circuitBreaker: { failureThreshold: 3, openForMs: 30_000 },
  retry: { ...defaultProviderExecutionPolicy.retry, maxAttempts: 2, maxDelayMs: 2_000 },
  timeoutMs: 5_000,
};

export const weatherForecastOperation: TravelDataOperation<
  WeatherForecastInput,
  WeatherForecastValue
> = {
  cacheKey: (input) => input,
  cachePolicy: {
    dataClass: "weather_forecast",
    freshForMs: 30 * 60_000,
    key: "weather.forecast.launch",
    mode: "ephemeral",
    staleWhileRevalidateForMs: 90 * 60_000,
    version: 1,
  },
  canCache: (result) =>
    result.sources.every(
      (source) => source.provider === "open-meteo" && source.redistributionAllowed,
    ),
  dataClass: "weather_forecast",
  executionPolicy: launchExecutionPolicy,
  name: "weather.forecast",
  validateValue: isWeatherForecastValue,
};

export const climateOperation: TravelDataOperation<ClimateInput, ClimateValue> = {
  cacheKey: (input) => input,
  cachePolicy: {
    dataClass: "climate",
    freshForMs: 30 * 24 * 60 * 60_000,
    key: "climate.projection.launch",
    mode: "durable",
    staleWhileRevalidateForMs: 60 * 24 * 60 * 60_000,
    version: 1,
  },
  canCache: (result) =>
    result.sources.every(
      (source) => source.provider === "open-meteo" && source.redistributionAllowed,
    ),
  dataClass: "climate",
  executionPolicy: { ...launchExecutionPolicy, timeoutMs: 15_000 },
  name: "weather.climate",
  validateValue: isClimateValue,
};

export function createHolidayOperation(
  fallback?: ProviderFallbackPolicy<HolidayValue>,
): TravelDataOperation<HolidayInput, HolidayValue> {
  return {
    cacheKey: (input) => input,
    cachePolicy: {
      dataClass: "holiday",
      freshForMs: 24 * 60 * 60_000,
      key: "calendar.holidays.launch",
      mode: "none",
      staleWhileRevalidateForMs: 0,
      version: 1,
    },
    canCache: () => false,
    dataClass: "holiday",
    executionPolicy: launchExecutionPolicy,
    fallback,
    name: "calendar.holidays",
    validateValue: isHolidayValue,
  };
}

export const travelAdvisoryOperation: TravelDataOperation<
  TravelAdvisoryInput,
  TravelAdvisoryValue
> = {
  cacheKey: (input) => input,
  cachePolicy: {
    dataClass: "advisory",
    freshForMs: 60 * 60_000,
    key: "advisory.official.launch",
    mode: "ephemeral",
    staleWhileRevalidateForMs: 5 * 60 * 60_000,
    version: 1,
  },
  canCache: (result) =>
    result.sources.every(
      (source) => source.sourceKind === "official_authority" && source.trustTier === "tier_1",
    ),
  dataClass: "advisory",
  executionPolicy: launchExecutionPolicy,
  name: "advisory.official",
  validateValue: isTravelAdvisoryValue,
};

function officialSourceDataClass(category: OfficialSourceCategory): TravelDataClass {
  return category;
}

export function createOfficialSourceOperation(
  category: OfficialSourceCategory,
): TravelDataOperation<OfficialSourceInput, OfficialSourceValue> {
  const dataClass = officialSourceDataClass(category);
  return {
    cacheKey: (input) => input,
    cachePolicy: {
      dataClass,
      freshForMs: category === "holiday" ? 24 * 60 * 60_000 : 60 * 60_000,
      key: `official.${category}.launch`,
      mode: "durable",
      staleWhileRevalidateForMs: category === "holiday" ? 29 * 24 * 60 * 60_000 : 5 * 60 * 60_000,
      version: 1,
    },
    canCache: (result) =>
      result.sources.every(
        (source) => source.sourceKind === "official_authority" && source.trustTier === "tier_1",
      ),
    dataClass,
    executionPolicy: launchExecutionPolicy,
    name: `official.${category}`,
    validateValue: isOfficialSourceValue,
  };
}

export const currencyRateOperation: TravelDataOperation<CurrencyRateInput, CurrencyRateValue> = {
  cacheKey: (input) => input,
  cachePolicy: {
    dataClass: "currency",
    freshForMs: 24 * 60 * 60_000,
    key: "currency.reference.launch",
    mode: "durable",
    staleWhileRevalidateForMs: 24 * 60 * 60_000,
    version: 1,
  },
  canCache: (result) =>
    result.value.availability === "available" &&
    result.sources.every((source) => source.provider === "ecb" && source.redistributionAllowed),
  dataClass: "currency",
  executionPolicy: launchExecutionPolicy,
  name: "currency.reference",
  validateValue: isCurrencyRateValue,
};

function decimalFraction(value: string) {
  if (!decimalPattern.test(value) || Number(value) <= 0) {
    throw new TypeError("Currency rates must be positive decimal strings.");
  }
  const [whole, fraction = ""] = value.split(".");
  return {
    denominator: 10n ** BigInt(fraction.length),
    numerator: BigInt(`${whole}${fraction}`),
  };
}

function roundedDivide(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / 2n) / denominator;
}

export function divideCurrencyRates(quotePerEuro: string, basePerEuro: string) {
  const quote = decimalFraction(quotePerEuro);
  const base = decimalFraction(basePerEuro);
  const numerator = quote.numerator * base.denominator;
  const denominator = quote.denominator * base.numerator;
  const scale = 10n ** 12n;
  const scaled = roundedDivide(numerator * scale, denominator);
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(12, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

const currencyMinorScales: Record<LaunchCurrency, bigint> = {
  AUD: 100n,
  EUR: 100n,
  ISK: 1n,
  JPY: 1n,
  SGD: 100n,
  THB: 100n,
  USD: 100n,
};

export function convertCurrencyEstimate(input: {
  amountMinor: number;
  baseCurrency: LaunchCurrency;
  quoteCurrency: LaunchCurrency;
  rate: string;
}): CurrencyEstimate {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) {
    throw new TypeError("Currency estimate amounts must be non-negative safe integers.");
  }
  const rate = decimalFraction(input.rate);
  const numerator =
    BigInt(input.amountMinor) * rate.numerator * currencyMinorScales[input.quoteCurrency];
  const denominator = rate.denominator * currencyMinorScales[input.baseCurrency];
  const converted = roundedDivide(numerator, denominator);
  if (converted > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Converted currency estimate exceeds the safe integer range.");
  }
  return {
    amountMinor: Number(converted),
    currency: input.quoteCurrency,
    estimate: true,
    rounding: "half_up",
  };
}
