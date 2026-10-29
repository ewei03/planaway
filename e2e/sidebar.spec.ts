import { expect, test } from "@playwright/test";
import { account, planTrip, register } from "./helpers";

test("collapse and restore the sidebar on desktop, remembered across reloads", async ({ page }) => {
  await register(page, account("Sidebar"));
  await planTrip(page);

  const newTrip = page.getByRole("button", { name: "+ New trip" });
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
