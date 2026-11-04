import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

/** Must match OUTBOX_DIR in playwright.config.ts. */
const OUTBOX_DIR = ".e2e-outbox";

let n = 0;

export interface Account {
  name: string;
  email: string;
  password: string;
}

export function account(name: string): Account {
  return { name, email: `${name.toLowerCase()}-${Date.now()}-${++n}@example.com`, password: "e2e password 123" };
}

/** The newest email the app sent to `to`, waiting for it to arrive. */
export async function lastEmail(to: string, { subject }: { subject?: RegExp } = {}): Promise<{ subject: string; text: string; action: { url: string } | null }> {
  let found: { subject: string; text: string; to: string; action: { url: string } | null } | undefined;
  await expect
    .poll(
      async () => {
        const names = (await readdir(OUTBOX_DIR).catch(() => [] as string[])).sort();
        const emails = await Promise.all(names.map(async (n) => JSON.parse(await readFile(path.join(OUTBOX_DIR, n), "utf8"))));
        found = emails.filter((e) => e.to === to && (!subject || subject.test(e.subject))).at(-1);
        return Boolean(found);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}

/** Opens the link in the confirmation email, the way a mail app would, without leaving the current page. */
export async function confirmEmail(page: Page, who: Account) {
  const email = await lastEmail(who.email, { subject: /Confirm your email/ });
  const res = await page.request.get(email.action!.url);
  expect(res.ok()).toBe(true);
}

/**
 * Registers from the login page currently shown (or /login), and waits for the redirect.
 * Confirms the email address too, unless `confirm` is false, reloading the home page so it opens up.
 */
export async function register(page: Page, who: Account, { goto = true, confirm = true } = {}) {
  if (goto) await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill(who.name);
  await page.getByLabel("Date of birth").fill("1990-04-12");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (!confirm) return;
  await confirmEmail(page, who);
  if (new URL(page.url()).pathname === "/") await page.reload();
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
  await waitForHydration(page, "#email");
}

/** Waits until React has hydrated the element, so typing into it isn't wiped by hydration. */
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el !== null && Object.keys(el).some((k) => k.startsWith("__react"));
  }, selector);
}

/** Starts a trip from the start screen and waits for the agent's turn to finish. */
export async function planTrip(page: Page, idea = "A food weekend in Kyoto for two") {
  // The start screen is server-rendered; wait until React has hydrated it, or
  // the click submits the form natively. (Matters right after a cold start.)
  await waitForHydration(page, "#idea-text");
  await page.getByLabel("Your trip idea").fill(idea);
  await page.getByRole("button", { name: "Plan my trip" }).click();
  // The chat header takes the itinerary's title once the turn is saved. (On
  // phones the itinerary pane itself is hidden until opened.)
  // Generous: the first run after a fresh build compiles the routes on demand.
  await expect(page.getByRole("heading", { name: "Kyoto Food Weekend", level: 1 })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Your trip is ready.")).toBeVisible();
}
