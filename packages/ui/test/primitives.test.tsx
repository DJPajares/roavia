// @vitest-environment jsdom
import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Button, ExperienceState, TrustNotice } from "../src/index.js";

describe("Roavia shared primitives", () => {
  test("provides accessible names and status semantics", () => {
    render(
      <>
        <Button>Continue planning</Button>
        <ExperienceState
          detail="Reconnect to refresh your trip."
          state="offline"
          title="You are offline"
        />
        <TrustNotice>Live travel details always show their source and freshness.</TrustNotice>
      </>,
    );

    expect(screen.getByRole("button", { name: "Continue planning" })).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("You are offline");
    expect(screen.getByText("Trust note")).toBeDefined();
  });

  test("has no detectable accessibility violations", async () => {
    const { container } = render(
      <ExperienceState
        detail="Reconnect to refresh your trip."
        state="offline"
        title="You are offline"
      />,
    );

    const result = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(result.violations).toHaveLength(0);
  });
});
