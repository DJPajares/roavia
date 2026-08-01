import {
  apiErrorResponseSchema,
  assistantActionMutationResponseSchema,
  assistantQueryResponseSchema,
  authSessionResponseSchema,
  destinationSearchResponseSchema,
  destinationDetailResponseSchema,
  healthResponseSchema,
  itineraryGenerationQueuedResponseSchema,
  itineraryGenerationCancelledResponseSchema,
  itineraryGenerationStatusResponseSchema,
  offlinePackageMutationResponseSchema,
  offlinePackageResponseSchema,
  profileResponseSchema,
  shareLinkCreateResponseSchema,
  shareLinkListResponseSchema,
  shareLinkRevokeResponseSchema,
  sharedTripResponseSchema,
  tripDeleteResponseSchema,
  tripDestinationMutationResponseSchema,
  tripIntentExtractionResponseSchema,
  tripChildDeleteResponseSchema,
  tripItemMutationResponseSchema,
  tripListResponseSchema,
  tripResponseSchema,
  type ApiErrorCode,
  type AssistantActionMutationResponse,
  type AssistantQueryInput,
  type AssistantQueryResponse,
  type AuthSessionResponse,
  type DestinationSearchQuery,
  type DestinationSearchResponse,
  type DestinationDetailResponse,
  type HealthResponse,
  type ItineraryGenerationQueuedResponse,
  type ItineraryGenerationCancelInput,
  type ItineraryGenerationCancelledResponse,
  type ItineraryGenerationRequestInput,
  type ItineraryGenerationStatusResponse,
  type OfflinePackageMutationResponse,
  type OfflinePackageResponse,
  type ProfileResponse,
  type ProfileUpdateInput,
  type ShareLinkCreateInput,
  type ShareLinkCreateResponse,
  type ShareLinkListResponse,
  type ShareLinkRevokeResponse,
  type SharedTripResponse,
  type TripDeleteInput,
  type TripDeleteResponse,
  type TripChildDeleteInput,
  type TripChildDeleteResponse,
  type TripCreateInput,
  type TripDestinationCreateInput,
  type TripIntentExtractionInput,
  type TripIntentExtractionResponse,
  type TripListQuery,
  type TripListResponse,
  type TripResponse,
  type TripItemCreateInput,
  type TripItemMutationResponse,
  type TripItemUpdateInput,
  type TripUpdateInput,
} from "@roavia/contracts";

export type {
  AuthSessionResponse,
  DestinationSearchQuery,
  DestinationSearchResponse,
  DestinationDetailResponse,
  HealthResponse,
  ItineraryGenerationQueuedResponse,
  ItineraryGenerationCancelInput,
  ItineraryGenerationCancelledResponse,
  ItineraryGenerationRequestInput,
  ItineraryGenerationStatusResponse,
  OfflinePackageMutationResponse,
  OfflinePackageResponse,
  Profile,
  ProfileResponse,
  ProfileUpdateInput,
  ShareLink,
  ShareLinkCreateInput,
  ShareLinkCreateResponse,
  ShareLinkListResponse,
  ShareLinkRevokeResponse,
  SharedTrip,
  SharedTripResponse,
  TripDeleteInput,
  TripDeleteResponse,
  TripChildDeleteInput,
  TripChildDeleteResponse,
  TripCreateInput,
  TripDestinationCreateInput,
  TripIntentExtractionInput,
  TripIntentExtractionResponse,
  TripListQuery,
  TripListResponse,
  TripResponse,
  TripItemCreateInput,
  TripItemMutationResponse,
  TripItemUpdateInput,
  TripUpdateInput,
  AssistantActionMutationResponse,
  AssistantQueryInput,
  AssistantQueryResponse,
} from "@roavia/contracts";

export interface ApiClientOptions {
  baseUrl: string;
  accessToken?: () => Promise<string | null> | string | null;
  fetch?: typeof fetch;
  requestId?: () => string;
}

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly requestId: string;
  readonly status: number;

  constructor(options: { code: ApiErrorCode; message: string; requestId: string; status: number }) {
    super(options.message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

export interface RoaviaApiClient {
  health(): Promise<HealthResponse>;
  session(): Promise<AuthSessionResponse>;
  searchDestinations(query: DestinationSearchQuery): Promise<DestinationSearchResponse>;
  getDestination(placeId: string): Promise<DestinationDetailResponse>;
  listTrips(query: TripListQuery): Promise<TripListResponse>;
  createTrip(input: TripCreateInput): Promise<TripResponse>;
  updateTrip(tripId: string, input: TripUpdateInput): Promise<TripResponse>;
  getTrip(tripId: string): Promise<TripResponse>;
  deleteTrip(tripId: string, input: TripDeleteInput): Promise<TripDeleteResponse>;
  generateTrip(
    tripId: string,
    input: ItineraryGenerationRequestInput,
  ): Promise<ItineraryGenerationQueuedResponse>;
  regenerateTrip(
    tripId: string,
    input: ItineraryGenerationRequestInput,
  ): Promise<ItineraryGenerationQueuedResponse>;
  getTripGeneration(tripId: string): Promise<ItineraryGenerationStatusResponse>;
  cancelTripGeneration(
    tripId: string,
    input: ItineraryGenerationCancelInput,
  ): Promise<ItineraryGenerationCancelledResponse>;
  createOfflinePackage(
    tripId: string,
    options?: { signal?: AbortSignal },
  ): Promise<OfflinePackageMutationResponse>;
  getOfflinePackage(tripId: string): Promise<OfflinePackageResponse>;
  extractTripIntent(input: TripIntentExtractionInput): Promise<TripIntentExtractionResponse>;
  createTripDestination(
    tripId: string,
    input: TripDestinationCreateInput,
  ): Promise<import("@roavia/contracts").TripDestinationMutationResponse>;
  listShareLinks(tripId: string): Promise<ShareLinkListResponse>;
  createShareLink(tripId: string, input: ShareLinkCreateInput): Promise<ShareLinkCreateResponse>;
  revokeShareLink(tripId: string, shareLinkId: string): Promise<ShareLinkRevokeResponse>;
  getSharedTrip(token: string): Promise<SharedTripResponse>;
  createTripItem(tripId: string, input: TripItemCreateInput): Promise<TripItemMutationResponse>;
  updateTripItem(
    tripId: string,
    itemId: string,
    input: TripItemUpdateInput,
  ): Promise<TripItemMutationResponse>;
  deleteTripItem(
    tripId: string,
    itemId: string,
    input: TripChildDeleteInput,
  ): Promise<TripChildDeleteResponse>;
  getProfile(): Promise<ProfileResponse>;
  updateProfile(input: ProfileUpdateInput): Promise<ProfileResponse>;
  askAssistant(input: AssistantQueryInput): Promise<AssistantQueryResponse>;
  confirmAssistantAction(actionId: string): Promise<AssistantActionMutationResponse>;
  cancelAssistantAction(actionId: string): Promise<AssistantActionMutationResponse>;
}

export function createRoaviaApiClient(options: ApiClientOptions): RoaviaApiClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const createRequestId = options.requestId ?? (() => crypto.randomUUID());

  async function request<T>(
    path: string,
    schema: { parse(value: unknown): T },
    requestOptions: {
      authenticated?: boolean;
      body?: unknown;
      method?: "DELETE" | "GET" | "PATCH" | "POST";
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const requestId = createRequestId();
    const accessToken = requestOptions.authenticated ? await options.accessToken?.() : null;
    const response = await fetchImplementation(`${baseUrl}${path}`, {
      headers: {
        accept: "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(requestOptions.body === undefined ? {} : { "content-type": "application/json" }),
        "x-request-id": requestId,
      },
      method: requestOptions.method ?? "GET",
      signal: requestOptions.signal,
      ...(requestOptions.body === undefined ? {} : { body: JSON.stringify(requestOptions.body) }),
    });
    const body: unknown = await response.json();

    if (!response.ok) {
      const parsedError = apiErrorResponseSchema.safeParse(body);
      if (parsedError.success) {
        throw new ApiClientError({
          code: parsedError.data.error.code,
          message: parsedError.data.error.message,
          requestId: parsedError.data.error.requestId,
          status: response.status,
        });
      }

      throw new ApiClientError({
        code: "internal_error",
        message: "The API returned an invalid error response.",
        requestId,
        status: response.status,
      });
    }

    return schema.parse(body);
  }

  return {
    async health(): Promise<HealthResponse> {
      return request("/health", healthResponseSchema);
    },
    async session(): Promise<AuthSessionResponse> {
      return request("/auth/session", authSessionResponseSchema, { authenticated: true });
    },
    async searchDestinations(query: DestinationSearchQuery): Promise<DestinationSearchResponse> {
      const params = new URLSearchParams({
        q: query.query,
        page: String(query.page),
        limit: String(query.limit),
      });

      if (query.country) {
        params.set("country", query.country);
      }
      if (query.regionId) {
        params.set("regionId", query.regionId);
      }
      for (const type of query.types) {
        params.append("type", type);
      }

      return request(`/destinations/search?${params.toString()}`, destinationSearchResponseSchema);
    },
    async getDestination(placeId: string): Promise<DestinationDetailResponse> {
      return request(
        `/destinations/${encodeURIComponent(placeId)}`,
        destinationDetailResponseSchema,
      );
    },
    async listTrips(query: TripListQuery): Promise<TripListResponse> {
      const params = new URLSearchParams({ limit: String(query.limit) });
      if (query.cursor) {
        params.set("cursor", query.cursor);
      }
      if (query.status) {
        params.set("status", query.status);
      }
      return request(`/trips?${params.toString()}`, tripListResponseSchema, {
        authenticated: true,
      });
    },
    async createTrip(input) {
      return request("/trips", tripResponseSchema, {
        authenticated: true,
        body: input,
        method: "POST",
      });
    },
    async updateTrip(tripId, input) {
      return request(`/trips/${encodeURIComponent(tripId)}`, tripResponseSchema, {
        authenticated: true,
        body: input,
        method: "PATCH",
      });
    },
    async getTrip(tripId) {
      return request(`/trips/${encodeURIComponent(tripId)}`, tripResponseSchema, {
        authenticated: true,
      });
    },
    async deleteTrip(tripId, input) {
      return request(`/trips/${encodeURIComponent(tripId)}`, tripDeleteResponseSchema, {
        authenticated: true,
        body: input,
        method: "DELETE",
      });
    },
    async generateTrip(tripId, input) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/generate`,
        itineraryGenerationQueuedResponseSchema,
        { authenticated: true, body: input, method: "POST" },
      );
    },
    async regenerateTrip(tripId, input) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/regenerate`,
        itineraryGenerationQueuedResponseSchema,
        { authenticated: true, body: input, method: "POST" },
      );
    },
    async getTripGeneration(tripId) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/generation`,
        itineraryGenerationStatusResponseSchema,
        { authenticated: true },
      );
    },
    async cancelTripGeneration(tripId, input) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/generation/cancel`,
        itineraryGenerationCancelledResponseSchema,
        { authenticated: true, body: input, method: "POST" },
      );
    },
    async createOfflinePackage(tripId, callOptions) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/offline-package`,
        offlinePackageMutationResponseSchema,
        { authenticated: true, method: "POST", signal: callOptions?.signal },
      );
    },
    async getOfflinePackage(tripId) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/offline-package`,
        offlinePackageResponseSchema,
        { authenticated: true },
      );
    },
    async extractTripIntent(input) {
      return request("/planner/extract", tripIntentExtractionResponseSchema, {
        authenticated: true,
        body: input,
        method: "POST",
      });
    },
    async createTripDestination(tripId, input) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/destinations`,
        tripDestinationMutationResponseSchema,
        { authenticated: true, body: input, method: "POST" },
      );
    },
    async listShareLinks(tripId) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/share-links`,
        shareLinkListResponseSchema,
        { authenticated: true },
      );
    },
    async createShareLink(tripId, input) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/share-links`,
        shareLinkCreateResponseSchema,
        { authenticated: true, body: input, method: "POST" },
      );
    },
    async revokeShareLink(tripId, shareLinkId) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/share-links/${encodeURIComponent(shareLinkId)}`,
        shareLinkRevokeResponseSchema,
        { authenticated: true, method: "DELETE" },
      );
    },
    async getSharedTrip(token) {
      return request(`/shared-trips/${encodeURIComponent(token)}`, sharedTripResponseSchema);
    },
    async createTripItem(tripId, input) {
      return request(`/trips/${encodeURIComponent(tripId)}/items`, tripItemMutationResponseSchema, {
        authenticated: true,
        body: input,
        method: "POST",
      });
    },
    async updateTripItem(tripId, itemId, input) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}`,
        tripItemMutationResponseSchema,
        { authenticated: true, body: input, method: "PATCH" },
      );
    },
    async deleteTripItem(tripId, itemId, input) {
      return request(
        `/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}`,
        tripChildDeleteResponseSchema,
        { authenticated: true, body: input, method: "DELETE" },
      );
    },
    async getProfile(): Promise<ProfileResponse> {
      return request("/me", profileResponseSchema, { authenticated: true });
    },
    async updateProfile(input: ProfileUpdateInput): Promise<ProfileResponse> {
      return request("/me/preferences", profileResponseSchema, {
        authenticated: true,
        body: input,
        method: "PATCH",
      });
    },
    async askAssistant(input) {
      return request("/assistant/query", assistantQueryResponseSchema, {
        authenticated: true,
        body: input,
        method: "POST",
      });
    },
    async confirmAssistantAction(actionId) {
      return request(
        `/assistant/actions/${encodeURIComponent(actionId)}/confirm`,
        assistantActionMutationResponseSchema,
        { authenticated: true, method: "POST" },
      );
    },
    async cancelAssistantAction(actionId) {
      return request(
        `/assistant/actions/${encodeURIComponent(actionId)}/cancel`,
        assistantActionMutationResponseSchema,
        { authenticated: true, method: "POST" },
      );
    },
  };
}
