import {
  type CurrencyRateInput,
  type CurrencyRateValue,
  type LaunchCurrency,
  divideCurrencyRates,
  isCurrencyRateInput,
} from "../practical.js";
import {
  type ProviderAdapterResult,
  type ProviderRequestContext,
  type ProviderSource,
  type TravelDataAdapter,
  providerError,
} from "../contracts.js";
import {
  type ProviderFetch,
  networkUnavailable,
  normalizedProviderBaseUrl,
  providerHttpFailure,
} from "./provider-http.js";

const provider = "ecb";
const docsUrl = "https://data.ecb.europa.eu/help/api/overview";
const ratesUrl =
  "https://data.ecb.europa.eu/key-figures/ecb-interest-rates-and-exchange-rates/exchange-rates";
const reuseUrl = "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html";
const informationalWarning =
  "ECB reference rates are dated planning estimates for information only, not transaction, card, cash, merchant, or settlement rates.";

export interface EcbCurrencyAdapterOptions {
  baseUrl?: string;
  clock?: () => Date;
  fetch?: ProviderFetch;
}

function invalidRequest<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_request",
    "Currency request did not satisfy the normalized input contract.",
    false,
  );
}

function invalidResponse<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_response",
    "Currency provider response could not be normalized.",
    true,
  );
}

function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) return undefined;
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function csvRecords(value: string) {
  const rows = parseCsv(value);
  if (!rows || rows.length < 2) return undefined;
  const headers = rows[0]!;
  if (new Set(headers).size !== headers.length) return undefined;
  return rows
    .slice(1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function addBusinessDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  let remaining = days;
  while (remaining > 0) {
    value.setUTCDate(value.getUTCDate() + 1);
    const weekday = value.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  value.setUTCDate(value.getUTCDate() + 1);
  return value;
}

function normalizedRates(body: string, input: CurrencyRateInput, now: Date) {
  const records = csvRecords(body);
  if (!records || records.length === 0) return undefined;
  const requested = new Set<LaunchCurrency>([input.baseCurrency, ...input.quoteCurrencies]);
  requested.delete("EUR");
  const perEuro = new Map<LaunchCurrency, { asOf: string; rate: string }>([
    ["EUR", { asOf: "", rate: "1" }],
  ]);
  for (const record of records) {
    const currency = record.CURRENCY;
    const rate = record.OBS_VALUE;
    const asOf = record.TIME_PERIOD;
    if (
      record.FREQ !== "D" ||
      record.CURRENCY_DENOM !== "EUR" ||
      record.EXR_TYPE !== "SP00" ||
      record.EXR_SUFFIX !== "A" ||
      !requested.has(currency as LaunchCurrency) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? "") ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate ?? "") ||
      Number(rate) <= 0
    ) {
      continue;
    }
    perEuro.set(currency as LaunchCurrency, { asOf: asOf!, rate: rate! });
  }
  if ([...requested].some((currency) => !perEuro.has(currency))) return undefined;
  const dates = new Set(
    [...perEuro.entries()]
      .filter(([currency]) => currency !== "EUR")
      .map(([, value]) => value.asOf),
  );
  if (dates.size !== 1) return undefined;
  const asOf = [...dates][0];
  if (!asOf) return undefined;
  perEuro.set("EUR", { asOf, rate: "1" });
  const base = perEuro.get(input.baseCurrency)!;
  const staleAfter = addBusinessDays(asOf, 2);
  const value: CurrencyRateValue = {
    asOf,
    availability: now.getTime() >= staleAfter.getTime() ? "stale" : "available",
    baseCurrency: input.baseCurrency,
    kind: "planning_estimate",
    rates: input.quoteCurrencies.map((quoteCurrency) => ({
      quoteCurrency,
      rate:
        quoteCurrency === input.baseCurrency
          ? "1"
          : divideCurrencyRates(perEuro.get(quoteCurrency)!.rate, base.rate),
    })),
    warning: informationalWarning,
  };
  return { staleAfter, value };
}

function source(retrievedAt: string, asOf: string, staleAfter: Date, now: Date): ProviderSource {
  return {
    attributionText: "Source: European Central Bank euro foreign exchange reference rates",
    expiresAt: staleAfter.getTime() > now.getTime() ? staleAfter.toISOString() : undefined,
    license: "ECB data reuse terms",
    licenseUrl: reuseUrl,
    offlineUseAllowed: true,
    provider,
    publishedAt: `${asOf}T15:00:00Z`,
    quality: {
      warnings: [informationalWarning],
    },
    redistributionAllowed: true,
    retrievedAt,
    sourceKind: "official_authority",
    sourceUrl: ratesUrl,
    title: "ECB euro foreign exchange reference rates",
    trustTier: "tier_1",
    validFrom: `${asOf}T00:00:00Z`,
    validUntil: staleAfter.toISOString(),
  };
}

export class EcbCurrencyAdapter implements TravelDataAdapter<CurrencyRateInput, CurrencyRateValue> {
  readonly dataClass = "currency" as const;
  readonly operation = "currency.reference";
  readonly provider = provider;
  readonly #baseUrl: string;
  readonly #clock: () => Date;
  readonly #fetch: ProviderFetch;

  constructor(options: EcbCurrencyAdapterOptions = {}) {
    this.#baseUrl = normalizedProviderBaseUrl(
      options.baseUrl ?? "https://data-api.ecb.europa.eu/service/data/EXR",
      "ECB data API",
      ["data-api.ecb.europa.eu"],
    );
    this.#clock = options.clock ?? (() => new Date());
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async execute(
    input: CurrencyRateInput,
    context: ProviderRequestContext,
  ): Promise<ProviderAdapterResult<CurrencyRateValue>> {
    if (!isCurrencyRateInput(input)) return invalidRequest(this.operation);
    const currencies = [...new Set([input.baseCurrency, ...input.quoteCurrencies])]
      .filter((currency) => currency !== "EUR")
      .toSorted();
    if (currencies.length === 0) currencies.push("USD");
    const url = new URL(`${this.#baseUrl}/D.${currencies.join("+")}.EUR.SP00.A`);
    url.searchParams.set("lastNObservations", "1");
    url.searchParams.set("format", "csvdata");

    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: "application/vnd.ecb.data+csv;version=1.0.0" },
        redirect: "error",
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      return networkUnavailable({ label: "ECB data API", operation: this.operation, provider });
    }
    const now = this.#clock();
    if (!response.ok) {
      return providerHttpFailure({
        label: "ECB data API",
        now,
        operation: this.operation,
        provider,
        response,
      });
    }
    let body: string;
    try {
      body = await response.text();
    } catch {
      return invalidResponse(this.operation);
    }
    const normalized = normalizedRates(body, input, now);
    if (!normalized) return invalidResponse(this.operation);
    const retrievedAt = now.toISOString();
    return {
      operation: this.operation,
      provider,
      sources: [source(retrievedAt, normalized.value.asOf, normalized.staleAfter, now)],
      status: "success",
      usage: { costUnitName: "request", costUnits: 1, requests: 1 },
      value: normalized.value,
      warnings:
        normalized.value.availability === "stale"
          ? ["The latest common ECB rate set is older than the two-business-day freshness limit."]
          : [informationalWarning],
    };
  }
}

export const ecbCurrencyDocumentationUrl = docsUrl;
