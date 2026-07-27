import { describe, expect, it } from "vitest";

describe("contracts workspace", () => {
  it("runs package tests through the shared Vitest baseline", () => {
    expect("@roavia/contracts").toMatch(/^@roavia\//);
  });
});
