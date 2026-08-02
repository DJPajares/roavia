import { apiErrorResponseSchema, healthResponseSchema, httpsUrlSchema } from "@roavia/contracts";
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

  it("accepts only HTTPS outbound links", () => {
    expect(httpsUrlSchema.parse("https://official.example.test/source")).toBe(
      "https://official.example.test/source",
    );
    expect(() => httpsUrlSchema.parse("http://official.example.test/source")).toThrow(/HTTPS/);
    expect(() => httpsUrlSchema.parse("javascript:alert(1)")).toThrow(/HTTPS/);
    expect(() => httpsUrlSchema.parse("https://user:password@official.example.test")).toThrow(
      /credentials/,
    );
  });
});
