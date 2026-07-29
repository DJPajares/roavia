import {
  type HolidayInput,
  type HolidayRecord,
  type HolidayType,
  type HolidayValue,
  isHolidayInput,
} from "../practical.js";
import {
  type ProviderAdapterResult,
  type ProviderRequestContext,
  type ProviderSource,
  type ProviderUsage,
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

const provider = "calendarific";
const docsUrl = "https://calendarific.com/api-documentation";
const termsUrl = "https://calendarific.com/terms";
const launchRegions = new Set(["AU", "FR", "IS", "JP", "SG", "TH", "US"]);

export interface CalendarificAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  clock?: () => Date;
  fetch?: ProviderFetch;
}

function invalidRequest<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_request",
    "Holiday request did not satisfy the normalized input contract.",
    false,
  );
}

function invalidResponse<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_response",
    "Holiday provider response could not be normalized.",
    true,
  );
}

function source(input: HolidayInput, retrievedAt: string, expiresAt: string): ProviderSource {
  return {
    attributionText:
      "Holiday data supplied by Calendarific; verify changed dates with the authority.",
    expiresAt,
    license: "Calendarific commercial terms; caching and redistribution rights require approval",
    licenseUrl: termsUrl,
    locale: input.locale,
    offlineUseAllowed: false,
    provider,
    quality: {
      warnings: [
        "Aggregator dates are provisional until checked against the applicable official authority.",
      ],
    },
    redistributionAllowed: false,
    region: input.subdivision ?? input.countryCode,
    retrievedAt,
    sourceKind: "licensed_provider",
    sourceUrl: docsUrl,
    title: "Calendarific holiday calendar",
    trustTier: "tier_3",
    validFrom: `${input.year}-01-01T00:00:00Z`,
    validUntil: `${input.year + 1}-01-01T00:00:00Z`,
  };
}

function holidayType(value: unknown): HolidayType {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (
    normalized.includes("national") ||
    normalized.includes("public") ||
    normalized.includes("bank")
  ) {
    return "national";
  }
  if (
    normalized.includes("local") ||
    normalized.includes("regional") ||
    normalized.includes("state")
  ) {
    return "local";
  }
  if (
    normalized.includes("religious") ||
    normalized.includes("buddh") ||
    normalized.includes("christ") ||
    normalized.includes("hindu") ||
    normalized.includes("muslim")
  ) {
    return "religious";
  }
  if (normalized.includes("observance") || normalized.includes("season")) return "observance";
  return "unknown";
}

function normalizedHoliday(value: unknown): HolidayRecord | undefined {
  if (!isRecord(value) || !isRecord(value.date)) return undefined;
  const date = value.date.iso;
  if (
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    value.name.length > 200 ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Array.isArray(value.type)
  ) {
    return undefined;
  }
  const types = [...new Set(value.type.map(holidayType))];
  return {
    date,
    description: typeof value.description === "string" ? value.description : undefined,
    id: typeof value.uuid === "string" && value.uuid.length > 0 ? value.uuid : undefined,
    name: value.name,
    status: "provisional",
    types: types.length > 0 ? types : ["unknown"],
  };
}

function normalizeBody(body: unknown, input: HolidayInput): HolidayValue | undefined {
  if (
    !isRecord(body) ||
    !isRecord(body.meta) ||
    body.meta.code !== 200 ||
    !isRecord(body.response) ||
    !Array.isArray(body.response.holidays)
  ) {
    return undefined;
  }
  const holidays = body.response.holidays.map(normalizedHoliday);
  if (holidays.some((holiday) => holiday === undefined)) return undefined;
  const normalized = holidays as HolidayRecord[];
  return {
    availability: normalized.some((holiday) => holiday.types.includes("unknown"))
      ? "partial"
      : "available",
    countryCode: input.countryCode,
    holidays: normalized.toSorted((left, right) =>
      left.date === right.date
        ? left.name.localeCompare(right.name)
        : left.date.localeCompare(right.date),
    ),
    subdivision: input.subdivision,
    year: input.year,
  };
}

function finiteHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function usage(headers: Headers): ProviderUsage {
  return {
    costUnitName: "request",
    costUnits: 1,
    quotaLimit: finiteHeader(headers, "x-ratelimit-limit"),
    quotaRemaining: finiteHeader(headers, "x-ratelimit-remaining"),
    requests: 1,
  };
}

async function calendarificError(
  response: Response,
  operation: string,
  now: Date,
): Promise<ProviderAdapterResult<HolidayValue>> {
  if (response.status === 422) {
    const body = await jsonBody(response.clone());
    const meta = isRecord(body) && isRecord(body.meta) ? body.meta : undefined;
    if (meta?.error_code === 603) {
      return providerError(
        provider,
        operation,
        "license_restricted",
        "Holiday provider subscription does not permit the requested operation.",
        false,
        { providerCode: "603" },
      );
    }
    if (meta?.error_code === 601) {
      return providerError(
        provider,
        operation,
        "unauthorized",
        "Holiday provider rejected the server credential.",
        false,
        { providerCode: "601" },
      );
    }
  }
  return providerHttpFailure({
    label: "Holiday provider",
    now,
    operation,
    provider,
    response,
  });
}

export class CalendarificHolidayAdapter implements TravelDataAdapter<HolidayInput, HolidayValue> {
  readonly dataClass = "holiday" as const;
  readonly operation = "calendar.holidays";
  readonly provider = provider;
  readonly #baseUrl: string;
  readonly #clock: () => Date;
  readonly #fetch: ProviderFetch;
  #apiKey: string;

  constructor(options: CalendarificAdapterOptions) {
    this.#apiKey = requiredSecret(options.apiKey, "Calendarific API key");
    this.#baseUrl = normalizedProviderBaseUrl(
      options.baseUrl ?? "https://calendarific.com/api/v2",
      "Calendarific",
    );
    this.#clock = options.clock ?? (() => new Date());
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  supports(context: Pick<ProviderRequestContext, "region">) {
    return context.region === undefined || launchRegions.has(context.region.toUpperCase());
  }

  async execute(
    input: HolidayInput,
    context: ProviderRequestContext,
  ): Promise<ProviderAdapterResult<HolidayValue>> {
    if (!isHolidayInput(input)) return invalidRequest(this.operation);
    const url = new URL("/api/v2/holidays", this.#baseUrl);
    url.searchParams.set("api_key", this.#apiKey);
    url.searchParams.set("country", input.countryCode);
    url.searchParams.set("year", String(input.year));
    url.searchParams.set("uuid", "true");
    if (input.subdivision) url.searchParams.set("location", input.subdivision.toLowerCase());
    if (input.locale) url.searchParams.set("language", input.locale.slice(0, 2));

    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: "application/json" },
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      return networkUnavailable({ label: "Holiday provider", operation: this.operation, provider });
    }
    const now = this.#clock();
    if (!response.ok) return calendarificError(response, this.operation, now);
    const value = normalizeBody(await jsonBody(response), input);
    if (!value) return invalidResponse(this.operation);
    const retrievedAt = now.toISOString();
    return {
      operation: this.operation,
      provider,
      sources: [
        source(input, retrievedAt, new Date(now.getTime() + 24 * 60 * 60_000).toISOString()),
      ],
      status: "success",
      usage: usage(response.headers),
      value,
      warnings: [
        "Holiday dates must be checked against the applicable official authority before display or offline use.",
      ],
    };
  }
}
