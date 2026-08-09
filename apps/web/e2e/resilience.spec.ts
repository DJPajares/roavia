import { expect, test, type Page } from "@playwright/test";

import { installApiFixture, placeId, shareToken, tripId } from "./api-fixture";

async function createAccount(page: Page, suffix: string) {
  await page.goto("/auth/sign-up");
  await page.getByLabel("Email address").fill(`journey-${suffix}@roavia.test`);
  await page.getByLabel("Password").fill("browser-fixture-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByRole("heading", { name: "Plans you can pick back up." })).toBeVisible();
}

test("recovers a generated trip through editing, sharing, and offline access", async ({ page }) => {
  const fixture = await installApiFixture(page);
  await createAccount(page, "critical");

  await page.goto("/plan");
  await page
    .getByLabel("Trip request")
    .fill("Plan a balanced Kyoto trip with vegetarian food, local markets, and step-free routes.");
  await page.getByRole("button", { name: "Review trip details" }).click();
  await expect(
    page.getByRole("heading", { name: "Correct what Roavia understood." }),
  ).toBeVisible();

  fixture.failGeneration = true;
  await page.getByRole("button", { name: "Generate itinerary" }).click();
  await expect(page.getByRole("heading", { name: "Your draft is safe." })).toBeVisible();
  await expect(
    page.getByText(/saved trip is available, but the itinerary is incomplete/i),
  ).toBeVisible();

  await page.getByRole("button", { name: "Retry generation" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));
  await expect(page.getByRole("heading", { name: "Kyoto recovery journey" })).toBeVisible();

  fixture.failNextOptimisticSave = true;
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Place or item name").fill("Morning market");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/attempted change was not applied/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Morning walk" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit itinerary item" })).toBeVisible();
  await expect(page.getByLabel("Place or item name")).toHaveValue("Morning market");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Morning market" })).toBeVisible();

  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText(/Read-only link created/)).toBeVisible();
  await expect(page.getByLabel("New link — shown once")).toHaveValue(
    new RegExp(`/shared/${shareToken}$`),
  );

  fixture.delayOfflineDownload = true;
  await page.getByRole("button", { name: "Download for offline" }).click();
  await page.getByRole("button", { name: "Cancel download" }).click();
  await expect(page.getByText("Download cancelled. No partial package was saved.")).toBeVisible();
  fixture.delayOfflineDownload = false;
  await page.getByRole("button", { name: "Retry download" }).click();
  await expect(page.getByText(/Offline package saved/)).toBeVisible();

  await page.goto("/offline");
  await expect(
    page.getByRole("heading", { name: "Journeys ready beyond the signal." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kyoto recovery journey" })).toBeVisible();

  await page.goto(`/shared/${shareToken}`);
  await expect(page.getByRole("heading", { name: "Kyoto recovery journey" })).toBeVisible();
  await expect(page.getByText(/Some saved place or route context is stale/)).toBeVisible();
  await expect(
    page.getByText(/Private workspace|SGD 5,000|journey-critical@roavia.test/i),
  ).toHaveCount(0);
  expect(fixture.protectedRequestsWithoutAuth).toBe(0);
});

test("keeps requests actionable across quota and destination-provider failures", async ({
  page,
}) => {
  const fixture = await installApiFixture(page);
  await createAccount(page, "recovery");

  await page.goto("/plan");
  const prompt =
    "Plan a balanced Kyoto trip with vegetarian food, local markets, and step-free routes.";
  await page.getByLabel("Trip request").fill(prompt);
  fixture.plannerFailure = "quota";
  await page.getByRole("button", { name: "Review trip details" }).click();
  await expect(
    page.getByText("Planning capacity is busy. Retry with the same request."),
  ).toBeVisible();
  await expect(page.getByLabel("Trip request")).toHaveValue(prompt);
  await page.getByRole("button", { name: "Review trip details" }).click();
  await expect(
    page.getByRole("heading", { name: "Correct what Roavia understood." }),
  ).toBeVisible();

  fixture.destinationUnavailable = true;
  await page.goto(`/destinations/${placeId}`);
  await expect(
    page.getByRole("heading", { name: "We could not open this destination" }),
  ).toBeVisible();
  fixture.destinationUnavailable = false;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Kyoto", exact: true })).toBeVisible();
  await expect(page.getByText("May be out of date", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compare the tradeoffs" })).toBeVisible();
  await expect(page.getByText("Needs refresh", { exact: true })).toBeVisible();

  await page.goto("/assistant");
  await page.getByLabel("Your question").fill("What should I confirm before departure?");
  await page.getByRole("button", { name: "Ask Roavia" }).click();
  await expect(page.getByRole("heading", { name: "Roavia’s answer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Official destination guide" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm: Save an opening-hours reminder" }).click();
  await expect(
    page.getByText("The confirmed change was applied through your trip controls."),
  ).toBeVisible();
  expect(fixture.protectedRequestsWithoutAuth).toBe(0);
});
