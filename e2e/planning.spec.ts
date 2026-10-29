import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { account, planTrip, register } from "./helpers";

test.beforeEach(async ({ page }) => {
  await register(page, account("Planner"));
});

test("plan a trip with the agent and see the itinerary", async ({ page }) => {
  await planTrip(page);

  // Chat: the user's message and the agent's streamed reply.
  await expect(page.getByText("A food weekend in Kyoto for two")).toBeVisible();
  await expect(page.locator(".msg.assistant strong", { hasText: "Kyoto" })).toBeVisible();

  // Itinerary pane.
  await expect(page.getByRole("heading", { name: "Flights" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nishiki Market" })).toHaveAttribute("href", "https://example.com/nishiki");
  await expect(page.locator(".act-name", { hasText: "Todai-ji" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Todai-ji" })).toHaveCount(0);

  // The trip takes the itinerary's title and shows up in the sidebar.
  await expect(page.getByRole("heading", { name: "Kyoto Food Weekend", level: 1 })).toBeVisible();
  await expect(page.locator(".trip-list button.active")).toContainText("Kyoto, Nara");

  // It's saved: a reload shows the same trip.
  await expect(page).toHaveURL(/\?trip=[0-9a-f-]{36}/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Kyoto Food Weekend", level: 2 })).toBeVisible();
  await expect(page.getByText("Your trip is ready.")).toBeVisible();
});

test("a failed agent turn shows an error and saves nothing", async ({ page }) => {
  await page.getByLabel("Your trip idea").fill("FAIL please");
  await page.getByRole("button", { name: "Plan this trip" }).click();
  await expect(page.locator(".msg.error")).toContainText("Anthropic API error 400");
  await expect(page.getByText(/No itinerary yet/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("FAIL please")).toHaveCount(0);
});

test("rename, save a version, and export", async ({ page }) => {
  await planTrip(page);

  await page.getByRole("heading", { name: "Kyoto Food Weekend", level: 1 }).click();
  await page.getByLabel("Trip name").fill("Spring in Kyoto");
  await page.getByLabel("Trip name").press("Enter");
  await expect(page.getByRole("heading", { name: "Spring in Kyoto", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("First draft");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.getByRole("status")).toHaveText('Saved "First draft"');
  await expect(page.getByLabel("Itinerary version").locator("option", { hasText: "First draft" })).toHaveCount(1);

  for (const [item, file] of [
    ["Spreadsheet (.csv)", "kyoto-food-weekend.csv"],
    ["Calendar (.ics)", "kyoto-food-weekend.ics"],
  ] as const) {
    await page.getByRole("button", { name: "Export ▾" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: item }).click();
    const d = await download;
    expect(d.suggestedFilename()).toBe(file);
    const text = await readFile(await d.path(), "utf8");
    expect(text).toContain(file.endsWith(".csv") ? "Nishiki Market" : "BEGIN:VCALENDAR");
  }
});

test("comment on an item, reply, and resolve", async ({ page }) => {
  await planTrip(page);

  await page.getByRole("button", { name: "Comment on Day 1 · Nishiki Market" }).click();
  const panel = page.getByRole("complementary", { name: "Comments" });
  await panel.getByPlaceholder(/Too pricey/).fill("Can we go in the morning?");
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(panel.getByText("Can we go in the morning?")).toBeVisible();
  await expect(page.getByRole("button", { name: "1 comments on Day 1 · Nishiki Market" })).toBeVisible();

  await panel.getByRole("button", { name: "Reply" }).click();
  await panel.getByPlaceholder("Reply…").fill("Markets open at 9");
  await panel.getByRole("button", { name: "Reply" }).last().click();
  await expect(panel.getByText("Markets open at 9")).toBeVisible();

  await panel.getByRole("button", { name: "Resolve" }).click();
  await expect(panel.getByRole("button", { name: "Reopen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Comment on Day 1 · Nishiki Market" })).toBeVisible();
});

test("delete a trip", async ({ page }) => {
  await planTrip(page);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status")).toHaveText("Trip deleted");
  await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
  await expect(page.locator(".trip-list")).toContainText("No trips yet.");
});
