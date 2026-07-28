import { apiErrorResponseSchema, healthResponseSchema } from "@roavia/contracts";
import { describe, expect, it } from "vitest";

describe("shared API contracts", () => {
  it("validates the versioned health response", () => {
    const response = healthResponseSchema.parse({
      data: {
        service: "api",
        status: "ok",
        version: "v1",
      },
      meta: {
        requestId: "b3bb5b6d-5e99-410a-9e99-d297dd387263",
      },
    });

    expect(response.data.status).toBe("ok");
  });

  it("rejects malformed error envelopes", () => {
    expect(() =>
      apiErrorResponseSchema.parse({
        error: {
          code: "not_found",
          message: "Route not found.",
          requestId: "not-a-uuid",
        },
      }),
    ).toThrow("Invalid UUID");
  });
});
