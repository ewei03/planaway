import { expect, test } from "@playwright/test";
import { account, planTrip, register } from "./helpers";

// Runs in the "mobile" project (Pixel 7 viewport): the sidebar and the
// itinerary pane become toggled panels.
test("navigate between chat, itinerary, and sidebar on a phone", async ({ page }) => {
  await register(page, account("Mobile"));
  await planTrip(page);

  await page.getByRole("button", { name: "Show itinerary" }).click();
  await expect(page.getByRole("heading", { name: "Day by day" })).toBeInViewport();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.getByPlaceholder(/Refine the plan/)).toBeInViewport();

  await page.getByRole("button", { name: "Show trips" }).click();
  await expect(page.getByRole("button", { name: "+ New trip" })).toBeInViewport();
  await page.getByRole("button", { name: "Hide trips" }).click();
  await expect(page.getByRole("button", { name: "+ New trip" })).not.toBeInViewport();
  await page.getByRole("button", { name: "Show trips" }).click();
  await expect(page.getByRole("button", { name: "+ New trip" })).toBeInViewport();

  // No horizontal scrolling.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
