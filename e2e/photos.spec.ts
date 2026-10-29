import { expect, test } from "@playwright/test";
import { account, planTrip, register } from "./helpers";

// Places, photos, and the map style come from the mock server (see
// playwright.config.ts). It finds everything except "dinner" places.

test.beforeEach(async ({ page }) => {
  await register(page, account("Maps"));
  await planTrip(page);
});

test("the itinerary shows destination photos and thumbnails, with credits", async ({ page }) => {
  const hero = page.locator(".hero");
  await expect(hero.getByRole("button", { name: "Photos of Kyoto" })).toBeVisible();
  await expect(hero.getByRole("button", { name: "Photos of Nara" })).toBeVisible();
  await expect(hero.getByRole("link", { name: "Photo: Mock Photographer, CC BY 4.0" }).first()).toHaveAttribute(
    "href",
    /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/,
  );
  const loaded = await hero.locator("img").first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);

  // Thumbnails open a viewer that links to OpenStreetMap.
  await page.getByRole("button", { name: "Photos of Nishiki Market" }).click();
  const viewer = page.getByRole("dialog", { name: "Photos of Nishiki Market" });
  await expect(viewer.getByRole("img")).toBeVisible();
  await expect(viewer.getByRole("link", { name: /Open in OpenStreetMap/ })).toHaveAttribute("href", /openstreetmap\.org\/node\//);
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("button", { name: "Photos of Gion Ryokan" })).toBeVisible();

  // A place the search can't find just has no photo.
  await expect(page.getByRole("button", { name: "Photos of Pontocho dinner" })).toHaveCount(0);
});

test("the route map shows numbered stops, stays, and flights", async ({ page }) => {
  const map = page.locator(".trip-map");
  await expect(map.locator(".maplibregl-canvas")).toBeVisible();
  // Nishiki Market (day 1) and Todai-ji (day 2); Pontocho dinner wasn't found.
  await expect(map.locator(".map-pin")).toHaveText(["🛏", "✈", "✈", "1", "1"], { useInnerText: true, timeout: 20_000 });

  // Pins are named and keyboard-operable (and here, mock places overlap, so a click could hit another pin).
  await map.getByRole("button", { name: "Stay: Gion Ryokan" }).press("Enter");
  await expect(map.locator(".maplibregl-popup")).toContainText("Gion Ryokan");
  await expect(map.getByRole("button", { name: "Day 1, stop 1: Nishiki Market" })).toBeVisible();
  await expect(map.getByRole("button", { name: "Airport: SFO" })).toBeVisible();
  await expect(map.locator(".maplibregl-popup").getByRole("link", { name: /Open in OpenStreetMap/ })).toBeVisible();

  // One day at a time.
  await map.getByRole("button", { name: "Day 2", exact: true }).click();
  await expect(map.locator(".map-pin")).toHaveText(["🛏", "1"], { useInnerText: true });
  await map.getByRole("button", { name: "All days", exact: true }).click();
  await expect(map.locator(".map-pin")).toHaveCount(5);
});
