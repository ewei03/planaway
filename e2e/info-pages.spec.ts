import { expect, test } from "@playwright/test";

test("the footer pages open without signing in, and link to each other", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Help" }).click();
  await expect(page.getByRole("heading", { name: "Help", level: 1 })).toBeVisible();

  // Answers start closed and open on click.
  await page.getByRole("link", { name: "Planning together" }).click();
  await page.getByText("How do I share a trip?").click();
  await expect(page.getByText(/create an invite link and send it/)).toBeVisible();

  await page.getByRole("link", { name: "Get in touch" }).click();
  await expect(page.getByRole("heading", { name: "Contact", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "help@planaway.test" })).toHaveAttribute("href", "mailto:help@planaway.test");
  await expect(page.getByRole("link", { name: "Email us" }).first()).toHaveAttribute("href", /^mailto:help@planaway\.test\?subject=PlanAway%3A%20Bug%20report$/);

  for (const [link, heading] of [["Privacy", "Privacy"], ["Terms", "Terms of use"]]) {
    await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "help@planaway.test" }).first()).toBeVisible();
  }

  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { name: "About PlanAway", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Plan a trip" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/help");
  await page.getByRole("link", { name: "PlanAway" }).first().click();
  await expect(page).toHaveURL(/\/login/);
});
