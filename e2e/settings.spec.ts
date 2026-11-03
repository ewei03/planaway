import { expect, test } from "@playwright/test";
import { account, register, waitForHydration } from "./helpers";

test("change your name, theme, and trip defaults in settings", async ({ page }) => {
  await register(page, account("Settler"));
  await page.getByRole("link", { name: /Settler/ }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await waitForHydration(page, "#settings-name");

  await page.getByLabel("Name").fill("Sam Settler");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  // The theme applies at once and sticks across reloads.
  await page.getByText("Dark", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  // Starting point suggests airports by code, and places as you type.
  await page.getByLabel("Starting point").pressSequentially("SFO");
  await page.getByRole("option", { name: /San Francisco International Airport \(SFO\)/ }).click();
  await expect(page.getByLabel("Starting point")).toHaveValue("San Francisco International Airport (SFO), San Francisco, United States");
  await page.getByLabel("Travelers").fill("3");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Defaults saved.")).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("Name")).toHaveValue("Sam Settler");

  // Back in the app, the new name shows and Plan it for me starts from the defaults.
  await page.getByRole("link", { name: "Back to trips" }).click();
  await expect(page.locator(".sidebar .user-name")).toHaveText("Sam Settler");
  await waitForHydration(page, "#idea-text");
  await page.getByRole("tab", { name: "Plan it for me" }).click();
  await expect(page.getByLabel("Leaving from")).toHaveValue("San Francisco International Airport (SFO), San Francisco, United States");
  await expect(page.getByLabel("Travelers")).toHaveValue("3");
});
