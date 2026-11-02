import { expect, test } from "@playwright/test";
import { account, planTrip, register } from "./helpers";

test("collapse and restore the sidebar on desktop, remembered across reloads", async ({ page }) => {
  await register(page, account("Sidebar"));
  await planTrip(page);

  const newTrip = page.getByRole("button", { name: "New trip", exact: true });
  await expect(newTrip).toBeVisible();
  await expect(page.getByRole("button", { name: "Show trips" })).toBeHidden();

  await page.getByRole("button", { name: "Hide trips" }).click();
  await expect(newTrip).toBeHidden();

  await page.reload();
  await expect(page.getByRole("button", { name: "Show trips" })).toBeVisible();
  await expect(newTrip).toBeHidden();

  await page.getByRole("button", { name: "Show trips" }).click();
  await expect(newTrip).toBeVisible();
  await expect(page.getByRole("button", { name: "Show trips" })).toBeHidden();
});

test("drag the divider to resize the chat and itinerary, remembered across reloads", async ({ page }) => {
  await register(page, account("Split"));
  await planTrip(page);

  const chat = page.locator(".chat");
  const handle = page.getByRole("separator", { name: "Resize chat and itinerary" });
  const before = (await chat.boundingBox())!.width;

  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const after = (await chat.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 100);

  await page.reload();
  await expect(handle).toBeVisible();
  expect(Math.abs((await chat.boundingBox())!.width - after)).toBeLessThan(5);

  await handle.dblclick();
  expect(Math.abs((await chat.boundingBox())!.width - before)).toBeLessThan(5);
});

test("rename a trip from its menu, and see when it was last updated in the sidebar", async ({ page }) => {
  await register(page, account("Rename"));
  await planTrip(page);

  const sidebar = page.locator(".sidebar");
  await expect(sidebar.getByText("Updated just now")).toBeVisible();
  const title = (await page.locator(".chat .trip-title").textContent())!;
  await sidebar.getByRole("button", { name: `Options for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const name = page.getByLabel("Trip name");
  await name.fill("Birthday trip");
  await page.getByRole("button", { name: "Rename" }).click();

  await expect(sidebar.getByRole("button", { name: /^Birthday trip/ })).toBeVisible();
  await expect(page.locator(".chat .trip-title")).toHaveText("Birthday trip");
});

test("hide the chat so the itinerary fills the width, remembered across reloads", async ({ page }) => {
  await register(page, account("HideChat"));
  await planTrip(page);

  const composer = page.getByPlaceholder(/Refine the plan/);
  const pane = page.locator(".itinerary-pane");
  const before = (await pane.boundingBox())!.width;
  await page.getByRole("button", { name: "Hide chat" }).click();
  await expect(composer).toBeHidden();
  expect((await pane.boundingBox())!.width).toBeGreaterThan(before + 200);
  await page.screenshot({ path: "C:/Users/enoch/AppData/Local/Temp/claude/E--Users-Enoch-Documents-PlanAway/49d044a6-5bd3-4720-923d-752ba3e695e9/scratchpad/chat-hidden.png" });

  // With the sidebar hidden too, both come back from the itinerary toolbar.
  await page.getByRole("button", { name: "Hide trips" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Show chat" })).toBeVisible();
  await expect(composer).toBeHidden();
  await page.screenshot({ path: "C:/Users/enoch/AppData/Local/Temp/claude/E--Users-Enoch-Documents-PlanAway/49d044a6-5bd3-4720-923d-752ba3e695e9/scratchpad/both-hidden.png" });
  await page.getByRole("button", { name: "Show trips" }).click();
  await expect(page.getByRole("button", { name: "New trip", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show chat" }).click();
  await expect(composer).toBeVisible();
  await expect(page.getByRole("button", { name: "Show chat" })).toBeHidden();
});
