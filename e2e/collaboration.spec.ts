import { expect, test, type Page } from "@playwright/test";
import { account, planTrip, register } from "./helpers";

/** As the owner: create a group with a trip in it and return a viewer invite link. */
async function setUpGroup(page: Page) {
  await page.getByRole("button", { name: "+ New group" }).click();
  await page.getByLabel("Group name").fill("Ski crew");
  await page.getByRole("button", { name: "Create group" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Ski crew" })).toBeVisible();
  await dialog.getByLabel("Invite role").selectOption("viewer");
  await dialog.getByRole("button", { name: "Create invite link" }).click();
  const link = await dialog.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/invite\/[\w-]+$/);
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "New trip in Ski crew" }).click();
  await expect(page.getByLabel("Plan in")).toHaveValue(/.+/);
  await expect(page.getByLabel("Plan in").locator("option:checked")).toHaveText(/Ski crew/);
  await planTrip(page);
  return link;
}

test("invite a viewer, who comments; the agent addresses the comment", async ({ page, browser }) => {
  await register(page, account("Owner"));
  const link = await setUpGroup(page);

  // The viewer follows the link, signs up on the way, and joins.
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(link);
  await expect(viewer).toHaveURL(/\/login\?callbackUrl=%2Finvite%2F/);
  await register(viewer, account("Viewer"), { goto: false });
  await expect(viewer.getByRole("heading", { name: "Join Ski crew" })).toBeVisible();
  await expect(viewer.getByText(/invited as a viewer/)).toBeVisible();
  await viewer.getByRole("button", { name: "Join Ski crew" }).click();

  // Viewers see the trip read-only, but can comment.
  await viewer.getByRole("button", { name: /Kyoto Food Weekend/ }).click();
  await expect(viewer.getByText(/You have view access/)).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(viewer.getByText("A food weekend in Kyoto for two")).toBeVisible();
  await viewer.getByRole("button", { name: "Comment on Day 1 · Pontocho dinner" }).click();
  const viewerPanel = viewer.getByRole("complementary", { name: "Comments" });
  await viewerPanel.getByPlaceholder(/Too pricey/).fill("Can we eat earlier?");
  await viewerPanel.getByRole("button", { name: "Comment", exact: true }).click();

  // The owner's tab picks it up by polling.
  await expect(page.getByRole("button", { name: "1 comments on Day 1 · Pontocho dinner" })).toBeVisible();
  await page.getByRole("button", { name: "💬 1" }).click();
  const panel = page.getByRole("complementary", { name: "Comments" });
  await expect(panel.getByText("Can we eat earlier?")).toBeVisible();
  await panel.getByRole("button", { name: /Ask PlanAway to address open comments/ }).click();

  // The agent replies in the thread and resolves it.
  await expect(page.getByText("Updated the plan from your comments.")).toBeVisible();
  await panel.getByRole("button", { name: /Resolved \(1\)/ }).click();
  await expect(panel.getByText("Moved it earlier in the day.")).toBeVisible();
  await expect(panel.getByText("✨ PlanAway")).toBeVisible();

  // ...and the viewer sees the reply too.
  await viewerPanel.getByRole("button", { name: "← All comments" }).click();
  await viewerPanel.getByRole("button", { name: /Resolved \(1\)/ }).click();
  await expect(viewerPanel.getByText("Moved it earlier in the day.")).toBeVisible();

  await viewerContext.close();
});

test("an invalid invite link explains itself", async ({ page }) => {
  await register(page, account("Stranger"));
  await page.goto("/invite/not-a-real-token");
  await expect(page.getByRole("heading", { name: "Invite not valid" })).toBeVisible();
});

test("outsiders can't open a group's trip by URL", async ({ page, browser }) => {
  await register(page, account("Owner"));
  await planTrip(page);
  const tripUrl = page.url();

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await register(other, account("Outsider"));
  await other.goto(tripUrl);
  await expect(other.locator(".toast")).toHaveText("Trip not found");
  await expect(other.getByRole("heading", { name: "Where to next?" })).toBeVisible();
  await otherContext.close();
});
