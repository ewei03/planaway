import { expect, test } from "@playwright/test";
import { account, enterCode, lastEmail, register, signIn, signOut, waitForHydration } from "./helpers";

test("a new account enters the emailed code before it's let in", async ({ page }) => {
  const who = account("Confirm");
  await register(page, who, { confirm: false });
  // Still on the sign-up page, asking for the code.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(who.email)).toBeVisible();

  // A wrong code is refused.
  await page.getByLabel("Confirmation code").fill("000000");
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  const first = await lastEmail(who.email, { subject: /Confirm your email/ });
  if (first.code !== "000000") await expect(page.locator(".form-error")).toContainText("isn't right");

  // A new email replaces the first; the newest code works.
  await page.getByRole("button", { name: "Send a new code" }).click();
  await expect(page.getByRole("status")).toContainText("Sent a new code");
  await expect.poll(async () => (await lastEmail(who.email, { subject: /Confirm your email/ })).text).not.toBe(first.text);
  const email = await lastEmail(who.email, { subject: /Confirm your email/ });
  expect(email.text).toContain("PlanAway is operated by Test Operator.");
  expect(email.code).toMatch(/^\d{6}$/);

  await enterCode(page, who);
  await expect(page).toHaveURL("/");
  await expect(page.getByLabel("Your trip idea")).toBeVisible();
});

test("signing in before confirming asks for a code first", async ({ page }) => {
  const who = account("Later");
  await register(page, who, { confirm: false });
  await page.goto("/login");
  await waitForHydration(page, "#email");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.locator(".settings-status")).toHaveCount(0);
  await expect(page).toHaveURL(/\/login/);

  await enterCode(page, who);
  await expect(page.getByLabel("Your trip idea")).toBeVisible();
});

test("forgot password: a link by email sets a new one", async ({ page }) => {
  const who = account("Forgot");
  await register(page, who);
  await signOut(page);

  await page.getByRole("link", { name: "Forgot password?" }).click();
  await waitForHydration(page, "#reset-email");
  await page.getByLabel("Email").fill(who.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const email = await lastEmail(who.email, { subject: /Reset your PlanAway password/ });
  await page.goto(email.action!.url);
  await waitForHydration(page, "#new-password");
  await page.getByLabel("New password", { exact: true }).fill("a brand new password");
  await page.getByLabel("Confirm new password").fill("a brand new password");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText("Your password has been changed. Sign in with your new password.")).toBeVisible();

  await signIn(page, { ...who, password: "a brand new password" });
  await expect(page.getByLabel("Your trip idea")).toBeVisible();

  // The link works once.
  await page.goto(email.action!.url);
  await waitForHydration(page, "#new-password");
  await page.getByLabel("New password", { exact: true }).fill("another new password");
  await page.getByLabel("Confirm new password").fill("another new password");
  await page.getByRole("button", { name: "Set new password" }).click();
  // (Next's route announcer is an alert too.)
  await expect(page.locator(".form-error")).toContainText("expired or was already used");
});

test("changing your email asks to confirm the new address", async ({ page }) => {
  const who = account("Mover");
  await register(page, who);
  await page.goto("/settings");
  await waitForHydration(page, "#settings-email");
  const moved = `moved-${who.email}`;
  const profile = page.getByRole("region", { name: "Profile" });
  await profile.getByLabel("Email").fill(moved);
  await profile.getByLabel("Current password").fill(who.password);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText(`We sent a code to ${moved}`)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Not confirmed yet/)).toBeVisible();

  const notice = await lastEmail(who.email, { subject: /email address was changed/ });
  expect(notice.text).toContain(moved);
  await waitForHydration(page, "#verify-code");
  await enterCode(page, { ...who, email: moved });
  await expect(page.getByText(/Not confirmed yet/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/Not confirmed yet/)).toHaveCount(0);
});

test("the contact form reaches the team, signed in or not", async ({ page }) => {
  await page.goto("/contact");
  await waitForHydration(page, "#contact-name");
  await page.getByLabel("Name").fill("Visitor");
  await page.getByLabel("Email").fill("visitor@example.com");
  await page.getByLabel("Topic").selectOption("Ideas and feedback");
  await page.getByLabel("Message").fill("Could PlanAway suggest packing lists?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("status")).toContainText("We’ll reply to visitor@example.com");

  const email = await lastEmail("help@planaway.test", { subject: /Ideas and feedback from Visitor/ });
  expect(email.text).toContain("Could PlanAway suggest packing lists?");
});

test("download your data from settings", async ({ page }) => {
  const who = account("Exporter");
  await register(page, who);
  await page.goto("/settings");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download my data" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^planaway-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await (await import("node:fs/promises")).readFile((await file.path())!, "utf8"));
  expect(data.account).toMatchObject({ name: "Exporter", email: who.email });
});
