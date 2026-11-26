/**
 * Shared Playwright fixtures and journey helpers for the Kalam end-to-end suite.
 * Selectors use roles, labels and visible text (the design system exposes real roles and accessible names).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
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
  /**
   * Console errors Chrome prints when the Content Security Policy blocks something. The test server sends the same
   * headers as Firebase Hosting (firebase.json), so a block here would be a block in production.
   */
  cspViolations: string[];
}

/**
 * Removes the browser's on-device model APIs before any page script runs, so the page sees Chrome with no Gemini Nano.
 * (Playwright's bundled Chromium exposes the Prompt API but has no model; this makes the absence complete.)
 */
export async function removeOnDeviceAi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const name of ['LanguageModel', 'ai', 'Summarizer', 'Writer', 'Rewriter', 'Translator', 'LanguageDetector']) {
      try {
        Object.defineProperty(window, name, { value: undefined, configurable: true });
      } catch {
        /* a global that cannot be redefined is already absent for our purposes */
      }
    }
  });
}

export const test = base.extend<{ diagnostics: Diagnostics; withoutOnDeviceAi: void }>({
  // The no-nano project is Chrome with no on-device model: the Prompt API globals are removed before any page script runs.
  withoutOnDeviceAi: [
    async ({ page }, use, testInfo) => {
      if (testInfo.project.name === 'no-nano') await removeOnDeviceAi(page);
      await use();
    },
    { auto: true },
  ],
  diagnostics: [
    async ({ page, baseURL }, use) => {
      const d: Diagnostics = { pageErrors: [], consoleErrors: [], externalRequests: [], cspViolations: [] };
      const origin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin;
      page.on('pageerror', (e) => d.pageErrors.push(e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        d.consoleErrors.push(m.text());
        // A "report-only" message is about another site's policy (Google's reCAPTCHA frame), not ours.
        if (/Content Security Policy|violates the following/i.test(m.text()) && !/report-only/i.test(m.text())) d.cspViolations.push(m.text().slice(0, 300));
      });
      page.on('request', (r) => {
        const url = r.url();
        if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) d.externalRequests.push(url);
      });
      await use(d);
      // An uncaught exception in the app is always a bug, whichever journey hit it.
      expect(d.pageErrors, 'uncaught page errors').toEqual([]);
      // So is a request the Content Security Policy refused.
      expect(d.cspViolations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/**
 * First run: land on onboarding, press "Make your first app" (it saves the language and opens Create), then go
 * back to `/` and end on the empty App Shelf.
 */
export async function completeOnboarding(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('Draw the app you need');
  await page.getByTestId('onboarding-continue').click();
  await expect(page).toHaveURL(/\/create$/);
  await page.goto('/');
  // A full load: the first paint can take longer than one assertion on a cold server.
  await expect(page.getByRole('heading', { name: 'Your shelf', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('shelf-empty-make')).toBeVisible();
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

/** The shell navigation ("Kalam menu"): Shelf, Make, Bazaar, Activity, Settings. A client-side move, so it also works offline. */
export async function navTo(page: Page, name: 'Shelf' | 'Make' | 'Bazaar' | 'Activity' | 'Settings'): Promise<void> {
  await page.getByRole('navigation', { name: /^Kalam/ }).getByRole('link', { name, exact: true }).click();
}

/** Opens the Create workspace via the shell navigation (no full page load, so it also works offline). */
export async function openCreate(page: Page): Promise<void> {
  await navTo(page, 'Make');
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole('textbox', { name: 'Describe the app you want to create' })).toBeVisible();
}

/** Types a description into the Create workspace and presses "Build app". */
export async function describeAndCreate(page: Page, prompt: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Describe the app you want to create' });
  await box.fill(prompt);
  await expect(box).toHaveValue(prompt);
  await page.getByTestId('create-app').first().click();
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

/** The ten Kalam languages, with the name shown in the language picker (docs/10 §3). */
export const LANGUAGES = [
  { code: 'en', native: 'English', radio: 'English', script: /[A-Za-z]/ },
  { code: 'hi', native: 'हिन्दी', radio: 'हिन्दी, Hindi', script: /[\u0900-\u097F]/ },
  { code: 'gu', native: 'ગુજરાતી', radio: 'ગુજરાતી, Gujarati', script: /[\u0A80-\u0AFF]/ },
  { code: 'mr', native: 'मराठी', radio: 'मराठी, Marathi', script: /[\u0900-\u097F]/ },
  { code: 'bn', native: 'বাংলা', radio: 'বাংলা, Bengali', script: /[\u0980-\u09FF]/ },
  { code: 'ta', native: 'தமிழ்', radio: 'தமிழ், Tamil', script: /[\u0B80-\u0BFF]/ },
  { code: 'te', native: 'తెలుగు', radio: 'తెలుగు, Telugu', script: /[\u0C00-\u0C7F]/ },
  { code: 'kn', native: 'ಕನ್ನಡ', radio: 'ಕನ್ನಡ, Kannada', script: /[\u0C80-\u0CFF]/ },
  { code: 'ml', native: 'മലയാളം', radio: 'മലയാളം, Malayalam', script: /[\u0D00-\u0D7F]/ },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', radio: 'ਪੰਜਾਬੀ, Punjabi', script: /[\u0A00-\u0A7F]/ },
] as const;

/** The six access modes in Settings, by their switch names. */
export const ACCESS_MODES = ['Large', 'High contrast', 'Simple', 'Read aloud', 'Left-handed', 'Voice only'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

/** Finishes onboarding (when it is showing) and ends on the Shelf. Safe to call on any first page. */
export async function ensureOnboarded(page: Page): Promise<void> {
  const shelf = page.getByRole('heading', { name: 'Your shelf', exact: true });
  const where = async () => (/\/onboarding$/.test(page.url()) ? 'onboarding' : (await shelf.count()) > 0 ? 'shelf' : 'loading');
  await page.goto('/');
  // The first visit redirects "/" to onboarding after the app starts, so wait for one of the two to appear.
  await expect.poll(where, { timeout: 30_000 }).not.toBe('loading');
  if ((await where()) === 'onboarding') {
    await page.getByTestId('onboarding-continue').click();
    await expect(page).toHaveURL(/\/create$/);
    await page.goto('/');
  }
  await expect(shelf).toBeVisible({ timeout: 30_000 });
}

/** Opens Settings through the navigation and waits for it. */
export async function openSettings(page: Page): Promise<void> {
  await navTo(page, 'Settings');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Access modes' })).toBeVisible();
}

/** Turns one access mode on or off from Settings (the switch is a real role=switch). */
export async function setAccessMode(page: Page, mode: AccessMode, on: boolean): Promise<void> {
  const toggle = page.getByRole('switch', { name: new RegExp(`^${mode}`) });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
}

/** Chooses the Kalam interface language in Settings. */
export async function setKalamLanguage(page: Page, radio: string): Promise<void> {
  const group = page.getByRole('radiogroup', { name: /Kalam language|कलम|Kalam/ }).first();
  await group.getByRole('radio', { name: radio }).click();
}

export interface AxeFinding { id: string; impact: string; help: string; nodes: number; sample: string; /** The selector of every node that failed. */ targets: string[] }

/**
 * Runs axe-core (WCAG 2.0 and 2.1 A and AA rules, plus the best-practice rules) on the page as it is now.
 * Returns what it found. Automated checks are not proof of accessibility (docs/13 §14.3), so the rest of the suite
 * also drives the keyboard and the access modes.
 */
export async function axeScan(page: Page, opts: { exclude?: string[] } = {}): Promise<AxeFinding[]> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']);
  for (const selector of opts.exclude ?? []) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? 'minor',
    help: v.help,
    nodes: v.nodes.length,
    sample: v.nodes[0]?.target.join(' ').slice(0, 120) ?? '',
    targets: v.nodes.map((n) => n.target.join(' ')),
  }));
}

/** Findings that fail a build: serious and critical impact. Moderate and minor ones are reported, not blocking. */
export const blocking = (findings: AxeFinding[]) => findings.filter((f) => f.impact === 'serious' || f.impact === 'critical');

/**
 * A real PNG made in memory: white paper with a few dark lines, like a quick sketch. Big enough to be accepted as a
 * photo (a 1 x 1 image is refused as unusable).
 */
export function makeSketchPng(width = 800, height = 600): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const onLine = Math.abs(y - height * 0.3) < 3 || Math.abs(y - height * 0.6) < 3 || Math.abs(x - width * 0.2) < 3 || Math.abs(x - width * 0.8) < 3;
      if (onLine) row.fill(30, 1 + x * 3, 4 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface StaticServer { url: string; close: () => Promise<void> }

/**
 * Serves a build folder with the Firebase Hosting headers, on a free port, by running serve.mjs as a child process (the
 * same server the Playwright webServer uses). For specs that need a second build or a build they change, such as the
 * service worker update and the Content Security Policy check.
 */
export async function startStaticServer(dist: string): Promise<StaticServer> {
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address() as { port: number };
      probe.close(() => resolve(free));
    });
  });
  const child = spawn(process.execPath, [join(__dirname, 'serve.mjs'), dist, String(port)], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/manifest.webmanifest`)).ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`The test server for ${dist} did not start`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { url, close: () => new Promise((resolve) => { child.once('exit', () => resolve()); child.kill(); }) };
}
