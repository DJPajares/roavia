import {
  apiErrorResponseSchema,
  authSessionResponseSchema,
  destinationSearchResponseSchema,
  healthResponseSchema,
  profileResponseSchema,
  tripDeleteResponseSchema,
  tripListResponseSchema,
  tripResponseSchema,
  type ApiErrorCode,
  type AuthSessionResponse,
  type DestinationSearchQuery,
  type DestinationSearchResponse,
  type HealthResponse,
  type ProfileResponse,
  type ProfileUpdateInput,
  type TripDeleteInput,
  type TripDeleteResponse,
  type TripCreateInput,
  type TripListQuery,
  type TripListResponse,
  type TripResponse,
  type TripUpdateInput,
} from "@roavia/contracts";

export type {
  AuthSessionResponse,
  DestinationSearchQuery,
  DestinationSearchResponse,
  HealthResponse,
  Profile,
  ProfileResponse,
  ProfileUpdateInput,
  TripDeleteInput,
  TripDeleteResponse,
  TripCreateInput,
  TripListQuery,
  TripListResponse,
  TripResponse,
  TripUpdateInput,
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
  listTrips(query: TripListQuery): Promise<TripListResponse>;
  createTrip(input: TripCreateInput): Promise<TripResponse>;
  updateTrip(tripId: string, input: TripUpdateInput): Promise<TripResponse>;
  getTrip(tripId: string): Promise<TripResponse>;
  deleteTrip(tripId: string, input: TripDeleteInput): Promise<TripDeleteResponse>;
  getProfile(): Promise<ProfileResponse>;
  updateProfile(input: ProfileUpdateInput): Promise<ProfileResponse>;
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
  };
}
