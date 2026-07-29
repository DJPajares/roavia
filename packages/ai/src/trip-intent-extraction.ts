import {
  destinationSearchQuerySchema,
  tripIntentExtractionSchema,
  type DestinationSearchResponse,
  type TripIntentExtraction,
  type TripIntentExtractionInput,
  type TripIntentIssue,
} from "@roavia/contracts";

import type { AiGatewayErrorCode } from "./contracts.js";
import { AiGateway } from "./gateway.js";
import type { TripIntentOutputV1 } from "./schemas.js";

const PROMPT_VERSION = "trip-intent-v1";

export type DestinationResolver = (
  query: ReturnType<typeof destinationSearchQuerySchema.parse>,
) => Promise<DestinationSearchResponse["data"]>;

export class TripIntentExtractionError extends Error {
  readonly code: AiGatewayErrorCode;
  readonly retryable: boolean;

  constructor(code: AiGatewayErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "TripIntentExtractionError";
    this.code = code;
    this.retryable = retryable;
  }
}

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase("en");
}

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function blockingIssue(code: string, field: string, message: string): TripIntentIssue {
  return { code, field, message, severity: "blocking" };
}

function systemPrompt(input: TripIntentExtractionInput, currentDate: string) {
  return `You extract editable trip-planning intent for Roavia. Today is ${currentDate} in ${input.timeZone}. Interpret relative dates using that date. Use locale ${input.locale}. Never invent a detail. Put every inference in assumptions. Use null or an empty array when the traveler omitted something. Keep contradictory facts as provided so validation can flag them. Put requests that cannot be represented as trip planning preferences in unsupportedRequests. Budget amountMinor is the full-trip amount in the stated currency's minor unit. Return only the required structured output.`;
}

function localDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const value = new Map(parts.map((part) => [part.type, part.value]));
  return `${value.get("year")}-${value.get("month")}-${value.get("day")}`;
}

export class TripIntentExtractionService {
  private readonly clock: () => Date;
  private readonly destinationResolver: DestinationResolver;
  private readonly gateway: AiGateway;

  constructor(
    gateway: AiGateway,
    destinationResolver: DestinationResolver,
    options: { clock?: () => Date } = {},
  ) {
    this.gateway = gateway;
    this.destinationResolver = destinationResolver;
    this.clock = options.clock ?? (() => new Date());
  }

  async extract(
    input: TripIntentExtractionInput,
    context: { requestId?: string; signal?: AbortSignal } = {},
  ): Promise<TripIntentExtraction> {
    const result = await this.gateway.generateTripIntent({
      prompt: input.prompt,
      promptVersion: PROMPT_VERSION,
      requestId: context.requestId,
      signal: context.signal,
      system: systemPrompt(input, localDate(this.clock(), input.timeZone)),
    });
    if (result.status === "error") {
      throw new TripIntentExtractionError(
        result.error.code,
        result.error.message,
        result.error.retryable,
      );
    }
    return this.ground(result.output);
  }

  private async ground(output: TripIntentOutputV1): Promise<TripIntentExtraction> {
    const issues: TripIntentIssue[] = [];
    const destinations = await Promise.all(
      unique(output.destinations).map(async (query) => {
        try {
          const result = await this.destinationResolver(
            destinationSearchQuerySchema.parse({
              limit: 5,
              page: 1,
              query,
              types: ["country", "region", "city", "district"],
            }),
          );
          const candidates = result.results.slice(0, 5);
          const exact = candidates.find((candidate) => {
            const names = [candidate.canonicalName, ...Object.values(candidate.localizedNames)];
            return names.some((name) => normalizedName(name) === normalizedName(query));
          });
          const selectedPlaceId = exact?.id ?? (candidates.length === 1 ? candidates[0]!.id : null);
          if (candidates.length === 0) {
            issues.push(
              blockingIssue(
                "destination_not_found",
                "destinations",
                `We could not match “${query}” to a supported destination.`,
              ),
            );
          } else if (!selectedPlaceId) {
            issues.push(
              blockingIssue(
                "destination_ambiguous",
                "destinations",
                `Choose which “${query}” you meant before generation.`,
              ),
            );
          }
          return { candidates, query, selectedPlaceId };
        } catch {
          issues.push(
            blockingIssue(
              "destination_lookup_failed",
              "destinations",
              `Destination matching for “${query}” is temporarily unavailable.`,
            ),
          );
          return { candidates: [], query, selectedPlaceId: null };
        }
      }),
    );

    if (destinations.length === 0) {
      issues.push(
        blockingIssue("destination_required", "destinations", "Add at least one destination."),
      );
    }
    if (!output.title) {
      issues.push(blockingIssue("title_required", "title", "Add a name for this trip."));
    }
    if (!output.startDate) {
      issues.push(blockingIssue("start_date_required", "startDate", "Add a start date."));
    }
    if (!output.endDate) {
      issues.push(blockingIssue("end_date_required", "endDate", "Add an end date."));
    }
    if (output.startDate && output.endDate && output.endDate < output.startDate) {
      issues.push(
        blockingIssue(
          "date_order_invalid",
          "endDate",
          "The end date is before the start date. Check the dates from your request.",
        ),
      );
    }
    if (!output.travelers) {
      issues.push(blockingIssue("travelers_required", "travelers", "Confirm who is traveling."));
    }
    if (!output.budget) {
      issues.push(blockingIssue("budget_required", "budget", "Choose a budget style."));
    }

    for (const request of output.unsupportedRequests) {
      issues.push(
        blockingIssue(
          "unsupported_request",
          "prompt",
          `This request is not supported by the trip planner: ${request}`,
        ),
      );
    }

    const assumptions = [...output.assumptions];
    if (!output.travelers) {
      assumptions.push({
        field: "travelers",
        summary: "One adult is shown as an editable starting point because travelers were omitted.",
      });
    }
    if (!output.budget) {
      assumptions.push({
        field: "budget",
        summary: "Midrange USD is shown as an editable starting point because budget was omitted.",
      });
    }
    if (!output.pace) {
      assumptions.push({
        field: "pace",
        summary: "A balanced pace is shown as an editable starting point because pace was omitted.",
      });
    }

    const extraction = {
      assumptions,
      intent: {
        budget: output.budget,
        constraints: {
          accessibility: unique(output.constraints.accessibility),
          dietary: unique(output.constraints.dietary),
          mustAvoid: unique(output.constraints.mustAvoid),
          mustDo: unique(output.constraints.mustDo),
        },
        dateFlexibility: output.dateFlexibility,
        destinations,
        endDate: output.endDate,
        interests: unique(output.interests),
        pace: output.pace,
        startDate: output.startDate,
        title: output.title,
        travelers: output.travelers,
      },
      issues,
      status:
        output.unsupportedRequests.length > 0
          ? ("unsupported" as const)
          : issues.length > 0 || assumptions.length > 0
            ? ("needs_review" as const)
            : ("ready" as const),
    };
    return tripIntentExtractionSchema.parse(extraction);
  }
}
