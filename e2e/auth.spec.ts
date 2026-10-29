import { expect, test } from "@playwright/test";
import { account, register, signIn, signOut } from "./helpers";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("register, sign out, and sign back in", async ({ page }) => {
  const maya = account("Maya");
  await register(page, maya);
  await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
  await expect(page.locator(".user-name")).toHaveText("Maya");

  await signOut(page);
  await expect(page).toHaveURL(/\/login/);

  await signIn(page, maya);
  await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
});

test("wrong password shows an error", async ({ page }) => {
  const sam = account("Sam");
  await register(page, sam);
  await signOut(page);
  await page.getByLabel("Email").fill(sam.email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".form-error")).toHaveText("Wrong email or password.");
});

test("duplicate registration is refused", async ({ page }) => {
  const lee = account("Lee");
  await register(page, lee);
  await signOut(page);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("Lee again");
  await page.getByLabel("Email").fill(lee.email);
  await page.getByLabel("Password").fill(lee.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator(".form-error")).toContainText("already exists");
});

test("the login page won't redirect off-site after sign-in", async ({ page }) => {
  const kai = account("Kai");
  await register(page, kai);
  await signOut(page);
  await page.goto("/login?callbackUrl=//evil.example.com");
  await page.getByLabel("Email").fill(kai.email);
  await page.getByLabel("Password").fill(kai.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
});
