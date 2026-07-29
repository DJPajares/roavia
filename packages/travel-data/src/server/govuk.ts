import {
  type LaunchDestinationCode,
  type TravelAdvisoryInput,
  type TravelAdvisoryValue,
  isTravelAdvisoryInput,
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
  isRecord,
  jsonBody,
  networkUnavailable,
  normalizedProviderBaseUrl,
  providerHttpFailure,
} from "./provider-http.js";

const provider = "govuk-content-api";
const apiDocsUrl = "https://content-api.publishing.service.gov.uk/reference.html";
const licenseUrl = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
const authority = "UK Foreign, Commonwealth & Development Office";
const destinationPaths: Record<LaunchDestinationCode, string> = {
  bangkok: "thailand",
  "new-york-city": "usa",
  paris: "france",
  reykjavik: "iceland",
  singapore: "singapore",
  sydney: "australia",
  tokyo: "japan",
};

export interface GovUkTravelAdvisoryAdapterOptions {
  baseUrl?: string;
  clock?: () => Date;
  fetch?: ProviderFetch;
}

function invalidRequest<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_request",
    "Advisory request did not satisfy the normalized input contract.",
    false,
  );
}

function invalidResponse<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_response",
    "Official advisory response could not be normalized.",
    true,
  );
}

function normalizedBody(
  body: unknown,
  input: TravelAdvisoryInput,
): { providerRecordId?: string; value: TravelAdvisoryValue } | undefined {
  if (!isRecord(body)) return undefined;
  const expectedPath = `/foreign-travel-advice/${destinationPaths[input.destination]}`;
  if (
    body.base_path !== expectedPath ||
    typeof body.title !== "string" ||
    body.title.length === 0 ||
    typeof body.description !== "string" ||
    body.description.length === 0 ||
    typeof body.public_updated_at !== "string" ||
    !Number.isFinite(Date.parse(body.public_updated_at))
  ) {
    return undefined;
  }
  const officialUrl = `https://www.gov.uk${expectedPath}`;
  return {
    providerRecordId:
      typeof body.content_id === "string" && body.content_id.length > 0
        ? body.content_id
        : undefined,
    value: {
      authority,
      availability: body.withdrawn_notice === undefined ? "available" : "withdrawn",
      destination: input.destination,
      manualReviewRequired: true,
      officialUrl,
      summary: body.description,
      title: body.title,
      topicLinks: {
        entryRequirements: `${officialUrl}/entry-requirements`,
        health: `${officialUrl}/health`,
        safetyAndSecurity: `${officialUrl}/safety-and-security`,
      },
      travelerCountryCode: "GB",
      updatedAt: body.public_updated_at,
    },
  };
}

function source(input: {
  expiresAt: string;
  providerRecordId?: string;
  retrievedAt: string;
  value: TravelAdvisoryValue;
}): ProviderSource {
  return {
    attributionText:
      "Contains public sector information licensed under the Open Government Licence v3.0.",
    expiresAt: input.expiresAt,
    license: "Open Government Licence v3.0",
    licenseUrl,
    locale: "en-GB",
    offlineUseAllowed: false,
    provider,
    providerRecordId: input.providerRecordId,
    publishedAt: input.value.updatedAt,
    quality: {
      warnings: [
        "This official advisory is for travelers using UK guidance and must not be generalized to another nationality or residency.",
      ],
    },
    redistributionAllowed: true,
    retrievedAt: input.retrievedAt,
    sourceKind: "official_authority",
    sourceUrl: input.value.officialUrl,
    title: input.value.title,
    trustTier: "tier_1",
    validFrom: input.value.updatedAt,
    validUntil: input.expiresAt,
  };
}

export class GovUkTravelAdvisoryAdapter implements TravelDataAdapter<
  TravelAdvisoryInput,
  TravelAdvisoryValue
> {
  readonly dataClass = "advisory" as const;
  readonly operation = "advisory.official";
  readonly provider = provider;
  readonly #baseUrl: string;
  readonly #clock: () => Date;
  readonly #fetch: ProviderFetch;

  constructor(options: GovUkTravelAdvisoryAdapterOptions = {}) {
    this.#baseUrl = normalizedProviderBaseUrl(
      options.baseUrl ?? "https://www.gov.uk/api/content",
      "GOV.UK Content API",
    );
    this.#clock = options.clock ?? (() => new Date());
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  supports(context: Pick<ProviderRequestContext, "locale">) {
    return context.locale === undefined || context.locale.toLowerCase().startsWith("en");
  }

  async execute(
    input: TravelAdvisoryInput,
    context: ProviderRequestContext,
  ): Promise<ProviderAdapterResult<TravelAdvisoryValue>> {
    if (!isTravelAdvisoryInput(input)) return invalidRequest(this.operation);
    if (input.travelerCountryCode !== "GB") {
      return {
        error: {
          code: "unsupported_coverage",
          message:
            "The configured official advisory source only applies to travelers using UK guidance.",
          retryable: false,
        },
        operation: this.operation,
        provider,
        reason: "unsupported_coverage",
        status: "unavailable",
      };
    }
    const path = destinationPaths[input.destination];
    const url = new URL(`${this.#baseUrl}/foreign-travel-advice/${path}`);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: "application/json" },
        redirect: "follow",
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      return networkUnavailable({
        label: "Official advisory provider",
        operation: this.operation,
        provider,
      });
    }
    const now = this.#clock();
    if (!response.ok) {
      return providerHttpFailure({
        label: "Official advisory provider",
        now,
        operation: this.operation,
        provider,
        response,
      });
    }
    const normalized = normalizedBody(await jsonBody(response), input);
    if (!normalized) return invalidResponse(this.operation);
    const retrievedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 6 * 60 * 60_000).toISOString();
    return {
      operation: this.operation,
      provider,
      sources: [
        source({
          expiresAt,
          providerRecordId: normalized.providerRecordId,
          retrievedAt,
          value: normalized.value,
        }),
      ],
      status: "success",
      usage: { costUnitName: "request", costUnits: 1, requests: 1 },
      value: normalized.value,
      warnings: [
        "Use the official links and check the latest authority guidance before making a high-stakes travel decision.",
      ],
    };
  }
}

export const govUkContentApiDocumentationUrl = apiDocsUrl;
