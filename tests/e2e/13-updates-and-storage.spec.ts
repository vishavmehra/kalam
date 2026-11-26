/**
 * A new release while someone is typing, a full disk, and a tab closed in the middle of a save (docs/09 §23.4 to 23.5,
 * docs/13 §11.2; checklist D04-048, D09-048, D13-031). These are the failures an offline-first app is judged on.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test as plain } from '@playwright/test';
import {
  CALCULATOR_PROMPT, EXPENSE_PROMPT, completeOnboarding, createAndSave, describeAndCreate, expect, goOffline, openCreate, startStaticServer,
  test, waitForReview, waitForServiceWorkerControl, type StaticServer,
} from './fixtures';

const SOURCE_DIST = join(process.cwd(), process.env.E2E_DIST ?? 'dist');

plain.describe('service worker update', () => {
  let dir: string;
  let server: StaticServer;

  plain.beforeAll(async () => {
    // A private copy of the build, so "deploying" a new release (changing sw.js) cannot disturb the other tests.
    dir = mkdtempSync(join(tmpdir(), 'kalam-sw-'));
    cpSync(SOURCE_DIST, dir, { recursive: true });
    server = await startStaticServer(dir);
  });
  plain.afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  plain('a new release waits for the person; applying it keeps the typed description and every saved app', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: server.url, locale: 'en-US', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await completeOnboarding(page);
    await waitForServiceWorkerControl(page);
    await createAndSave(page, EXPENSE_PROMPT);
    await page.goto('/create');
    const box = page.getByRole('textbox', { name: 'Describe the app you want to create' });
    const draft = 'A tailoring order book with customer name, measurements and delivery date';
    await box.fill(draft);
    await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true; });
    const oldCaches = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('kalam-')));
    expect(oldCaches).toHaveLength(1);

    // "Deploy" a new release: the worker file changes, as it does with every build (its cache name comes from the build).
    const swPath = join(dir, 'sw.js');
    writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const CACHE = "[^"]*"/, 'const CACHE = "kalam-release-two"'));
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });

    // The page is told, and nothing changes under the person's hands: same document, same words, old worker in charge.
    await expect(page.getByText('A new version of Kalam is ready')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes('kalam-release-two')), { timeout: 30_000 }).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    await expect(box).toHaveValue(draft);
    expect(await page.evaluate(async () => (await caches.keys()).includes(await (async () => 'kalam-release-two')()))).toBe(true);
    expect(await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('kalam-')).length), 'both caches until the update is applied').toBe(2);

    // Applying the update reloads once. The apps and the typed description come through it.
    const reloaded = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Update', exact: true }).click();
    await reloaded;
    await expect(page.getByRole('textbox', { name: 'Describe the app you want to create' })).toHaveValue(draft, { timeout: 30_000 });
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBeUndefined();
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('kalam-'))), { timeout: 30_000 }).toEqual(['kalam-release-two']);

    // The new release works with no network, and the saved app is still on the shelf.
    await goOffline(context, page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Expenses\. / })).toBeVisible({ timeout: 30_000 });
    expect(errors, 'uncaught page errors').toEqual([]);
    await context.close();
  });
});

test.describe('storage failures', () => {
  test('a full disk is reported in words, keeps the work, and the next try succeeds', async ({ page }) => {
    await completeOnboarding(page);
    await openCreate(page);
    await describeAndCreate(page, CALCULATOR_PROMPT);
    await waitForReview(page);

    // The browser refuses every write, as it does when the disk is full.
    await page.evaluate(() => {
      const w = window as unknown as { __diskFull: boolean };
      w.__diskFull = true;
      for (const method of ['put', 'add'] as const) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
          if (w.__diskFull) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          return original.apply(this, args);
        } as typeof original;
      }
    });
    await page.getByRole('button', { name: 'Save to Shelf' }).first().click();

    // Still on the review with everything in place; the person is told what happened.
    await expect(page).toHaveURL(/\/create\/review$/);
    // The message is in a live region, so a screen reader announces it too.
    const message = 'The app could not be saved. Your preview is still here. Try again.';
    await expect(page.locator('[aria-live], [role=status], [role=alert]').filter({ hasText: message }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('textbox', { name: 'App name' })).toHaveValue('Calculator');

    // Space comes back: the same button saves the same app. Nothing was half-written in between.
    await page.evaluate(() => { (window as unknown as { __diskFull: boolean }).__diskFull = false; });
    await page.getByRole('button', { name: 'Save to Shelf' }).first().click();
    await expect(page).toHaveURL(/\/app\/[^/]+$/, { timeout: 15_000 });
    await page.goto('/');
    await expect(page.getByText('1 app on this device')).toBeVisible({ timeout: 30_000 });
  });

  test('closing the tab in the middle of a save leaves no half-saved app, and the next session works', async ({ page, context }) => {
    await completeOnboarding(page);
    await page.close();

    // Three attempts with the tab closed at different moments of the save.
    for (const delay of [0, 60, 200]) {
      const tab = await context.newPage();
      await tab.goto('/create');
      await tab.getByRole('textbox', { name: 'Describe the app you want to create' }).fill(CALCULATOR_PROMPT);
      await tab.getByTestId('create-app').first().click();
      await expect(tab).toHaveURL(/\/create\/review$/, { timeout: 30_000 });
      await tab.getByRole('button', { name: 'Save to Shelf' }).first().click();
      await tab.waitForTimeout(delay);
      await tab.close({ runBeforeUnload: false });

      const next: Page = await context.newPage();
      await next.goto('/');
      await expect(next.getByRole('heading', { name: 'Your shelf', exact: true })).toBeVisible({ timeout: 30_000 });
      // Either the whole app is there or none of it: any app on the shelf opens and runs.
      const cards = next.getByRole('button', { name: /^Calculator\. / });
      const count = await cards.count();
      expect(count, `calculators on the shelf after closing at ${delay} ms`).toBeLessThanOrEqual(1 + [0, 60, 200].indexOf(delay));
      if (count > 0) {
        await cards.first().click();
        await expect(next.getByRole('heading', { name: 'Calculator' }).first()).toBeVisible();
      }
      await next.close();
    }

    // The next session is not blocked by a stale lock or a half-open database: a fresh app saves and opens normally.
    const final = await context.newPage();
    await final.goto('/');
    await createAndSave(final, EXPENSE_PROMPT);
    await expect(final.getByRole('heading', { name: 'Expenses' }).first()).toBeVisible();
  });
});
