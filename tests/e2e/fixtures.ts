/**
 * Shared Playwright fixtures and journey helpers for the Kalam end-to-end suite.
 * Selectors use roles, labels and visible text (the design system exposes real roles and accessible names).
 */
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

export const CALCULATOR_PROMPT = 'Make a calculator with addition, subtraction, multiplication and division';
export const EXPENSE_PROMPT = 'Simple expense tracker in rupees';
/** Needs a big model: not a template match, so it can only be built online. */
export const CLOUD_PROMPT = 'multi-role CRM with approvals and dashboards';

/** Uncaught page exceptions and failed first-party requests are collected for every test. */
export interface Diagnostics {
  pageErrors: string[];
  consoleErrors: string[];
  /** Requests to anything other than the app's own origin (Firebase, Google, AI providers). */
  externalRequests: string[];
}

export const test = base.extend<{ diagnostics: Diagnostics }>({
  diagnostics: [
    async ({ page, baseURL }, use) => {
      const d: Diagnostics = { pageErrors: [], consoleErrors: [], externalRequests: [] };
      const origin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin;
      page.on('pageerror', (e) => d.pageErrors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') d.consoleErrors.push(m.text());
      });
      page.on('request', (r) => {
        const url = r.url();
        if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) d.externalRequests.push(url);
      });
      await use(d);
      // An uncaught exception in the app is always a bug, whichever journey hit it.
      expect(d.pageErrors, 'uncaught page errors').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** First run: land on onboarding, press Continue, end on the empty App Shelf. */
export async function completeOnboarding(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('Draw the app you need');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your shelf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nothing on your shelf yet' })).toBeVisible();
}

/** Resolves once the production service worker controls the page and has precached the app shell. */
export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state ?? 'none'), {
      message: 'service worker should take control of the page',
      timeout: 30_000,
    })
    .toBe('activated');
  // The install step precaches every file before activating; confirm the cache really holds the shell + a bundle.
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const kalam = keys.find((k) => k.startsWith('kalam-'));
    if (!kalam) return { cache: null, urls: [] as string[] };
    const cache = await caches.open(kalam);
    return { cache: kalam, urls: (await cache.keys()).map((r) => new URL(r.url).pathname) };
  });
  expect(cached.cache, 'precache name').toMatch(/^kalam-/);
  expect(cached.urls).toContain('/index.html');
  expect(cached.urls.some((u) => u.endsWith('.js'))).toBe(true);
}

/** Opens the Create workspace via the shell navigation (no full page load, so it also works offline). */
export async function openCreate(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Kalam' }).getByRole('link', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole('textbox', { name: 'Describe the app you want to create' })).toBeVisible();
}

/** Types a description into the Create workspace and presses "Create app". */
export async function describeAndCreate(page: Page, prompt: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Describe the app you want to create' });
  await box.fill(prompt);
  await expect(box).toHaveValue(prompt);
  await page.getByRole('button', { name: 'Create app' }).click();
}

/** Waits for the Review screen and returns once the understanding summary is on screen. */
export async function waitForReview(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/create\/review$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Here is what Kalam understood' })).toBeVisible();
}

/** Create → review → Save to Shelf → the running app. Returns the saved app id. */
export async function createAndSave(page: Page, prompt: string): Promise<string> {
  await openCreate(page);
  await describeAndCreate(page, prompt);
  await waitForReview(page);
  await page.getByRole('button', { name: 'Save to Shelf' }).first().click();
  await expect(page).toHaveURL(/\/app\/[^/]+$/, { timeout: 15_000 });
  const id = new URL(page.url()).pathname.split('/').pop() ?? '';
  expect(id).not.toBe('');
  return decodeURIComponent(id);
}

/** Types into a runtime form field (number / text input) of the app currently on screen. */
export async function fillField(page: Page, label: string | RegExp, value: string): Promise<void> {
  const field = page.getByRole('textbox', { name: label });
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

export async function goOffline(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
}
