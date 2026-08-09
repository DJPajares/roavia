// @vitest-environment jsdom

import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, test } from "vitest";

import { AuthForm } from "../components/auth-form";

async function action() {
  return { message: "", status: "idle" as const };
}

describe("AuthForm", () => {
  test("provides labeled controls with no detectable accessibility violations", async () => {
    const rendered = render(
      createElement(AuthForm, { action, mode: "sign-in", nextPath: "/trips" }),
    );

    expect(screen.getByLabelText("Email address")).toHaveProperty("type", "email");
    expect(screen.getByLabelText("Password")).toHaveProperty("type", "password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
    expect(
      (
        await axe.run(rendered.container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
});
