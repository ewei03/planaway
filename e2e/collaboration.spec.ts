import { expect, test, type Page } from "@playwright/test";
import { account, planTrip, register } from "./helpers";

/**
 * As the owner: plan two trips, and share the first one (renamed "Spring in
 * Kyoto") through a view-only link. Returns the link.
 */
async function shareOneTrip(page: Page) {
  await planTrip(page);
  await page.getByRole("heading", { name: "Kyoto Food Weekend", level: 1 }).click();
  await page.getByLabel("Trip name").fill("Spring in Kyoto");
  await page.getByLabel("Trip name").press("Enter");
  await expect(page.getByRole("heading", { name: "Spring in Kyoto", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Options for Spring in Kyoto" }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Share “Spring in Kyoto”" })).toBeVisible();
  await dialog.getByLabel("Invite role").selectOption("viewer");
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = await dialog.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/invite\/[\w-]{32}$/);
  await dialog.getByRole("button", { name: "Close" }).click();

  // A second trip that is not shared.
  await page.getByRole("button", { name: "+ New trip" }).click();
  await planTrip(page);
  return link;
}

test("share one trip with a viewer, who comments; the agent addresses the comment", async ({ page, browser }) => {
  await register(page, account("Owner"));
  const link = await shareOneTrip(page);

  // The viewer opens the link signed out and sees the trip before joining.
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(link);
  await expect(viewer.getByRole("heading", { name: "Spring in Kyoto" })).toBeVisible();
  await expect(viewer.getByText("Owner invited you to a trip")).toBeVisible();
  await expect(viewer.getByText(/As a viewer, you can see the itinerary/)).toBeVisible();

  // Joining takes an account and an explicit click.
  await viewer.getByRole("link", { name: "Sign in to join" }).click();
  await expect(viewer).toHaveURL(/\/login\?callbackUrl=%2Finvite%2F/);
  await register(viewer, account("Viewer"), { goto: false });
  await viewer.getByRole("button", { name: "Join trip" }).click();
  await expect(viewer.getByRole("heading", { name: "Spring in Kyoto", level: 1 })).toBeVisible();

  // Access is to that one trip only.
  await expect(viewer.getByRole("heading", { name: "Shared with you" })).toBeVisible();
  await expect(viewer.locator(".sidebar")).not.toContainText("Kyoto Food Weekend");

  // Viewers see the trip read-only, but can comment.
  await expect(viewer.getByText(/You have view access/)).toBeVisible();
  await expect(viewer.getByText(/Shared by Owner · viewer/)).toBeVisible();
  await viewer.getByRole("button", { name: "Options for Spring in Kyoto" }).click();
  for (const item of ["Share…", "Save version…", "Delete trip…"]) {
    await expect(viewer.getByRole("menuitem", { name: item })).toHaveCount(0);
  }
  await expect(viewer.getByRole("menuitem", { name: "Leave trip…" })).toBeVisible();
  await viewer.keyboard.press("Escape");
  await expect(viewer.getByText("A food weekend in Kyoto for two")).toBeVisible();
  await viewer.getByRole("button", { name: "Comment on Day 1 · Pontocho dinner" }).click();
  const viewerPanel = viewer.getByRole("complementary", { name: "Comments" });
  await viewerPanel.getByPlaceholder(/Too pricey/).fill("Can we eat earlier?");
  await viewerPanel.getByRole("button", { name: "Comment", exact: true }).click();

  // The owner's tab picks it up by polling.
  await page.getByRole("button", { name: /^Spring in Kyoto/ }).click();
  // Each sees the other in the toolbar while both have the trip open.
  await expect(page.getByRole("group", { name: "Also viewing: Viewer" })).toBeVisible();
  await expect(viewer.getByRole("group", { name: "Also viewing: Owner" })).toBeVisible();
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
