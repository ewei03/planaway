import { expect, type Page } from "@playwright/test";

let n = 0;

export interface Account {
  name: string;
  email: string;
  password: string;
}

export function account(name: string): Account {
  return { name, email: `${name.toLowerCase()}-${Date.now()}-${++n}@example.com`, password: "e2e password 123" };
}

/** Registers from the login page currently shown (or /login), and waits for the redirect. */
export async function register(page: Page, who: Account, { goto = true } = {}) {
  if (goto) await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function signIn(page: Page, who: Account) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
}

/** Starts a trip from the start screen and waits for the agent's turn to finish. */
export async function planTrip(page: Page, idea = "A food weekend in Kyoto for two") {
  await page.getByLabel("Your trip idea").fill(idea);
  await page.getByRole("button", { name: "Plan this trip" }).click();
  // The chat header takes the itinerary's title once the turn is saved. (On
  // phones the itinerary pane itself is hidden until opened.)
  await expect(page.getByRole("heading", { name: "Kyoto Food Weekend", level: 1 })).toBeVisible();
  await expect(page.getByText("Your trip is ready.")).toBeVisible();
}
