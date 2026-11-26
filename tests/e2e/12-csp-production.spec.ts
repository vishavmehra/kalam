/**
 * The Content Security Policy in a real production build with reCAPTCHA and Firebase (docs/04 §18.7, docs/11 §14;
 * checklist D04-054, D11-044). The static header test (tests/unit/csp-privacy.test.ts) proves what the policy SAYS;
 * this proves what it DOES to a browser that loads the real app with Firebase and App Check switched on.
 *
 * The build is made by `E2E_FIREBASE=placeholder E2E_DIST=dist-csp node scripts/build-web-e2e.mjs`: a placeholder
 * Firebase project and a placeholder reCAPTCHA Enterprise key, so nothing here is a real project or a real key. It is
 * served with the exact headers of Firebase Hosting (firebase.json). The test reaches the real Google reCAPTCHA
 * servers, which need the internet, so it is skipped (not passed) when they cannot be reached.
 *
 * Google's own reCAPTCHA frame prints a "report-only" message about its own policy. That is Google's, not ours, so
 * only messages about an enforced policy count.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startStaticServer, type StaticServer } from './fixtures';

const DIST = join(process.cwd(), process.env.E2E_CSP_DIST ?? 'dist-csp');

async function googleReachable(): Promise<boolean> {
  try {
    const r = await fetch('https://www.gstatic.com/recaptcha/api2/logo_48.png', { signal: AbortSignal.timeout(5_000) });
    return r.ok;
  } catch {
    return false;
  }
}

test.describe('Content Security Policy in a production build with Firebase and reCAPTCHA', () => {
  test.skip(!existsSync(join(DIST, 'index.html')), `no build in ${DIST}: run E2E_FIREBASE=placeholder E2E_DIST=dist-csp node scripts/build-web-e2e.mjs`);
  let server: StaticServer;
  test.beforeAll(async () => {
    if (existsSync(join(DIST, 'index.html'))) server = await startStaticServer(DIST);
  });
  test.afterAll(async () => { await server?.close(); });

  test('nothing the app needs is blocked: scripts, workers, fonts, images, reCAPTCHA, and the Firebase sign-in call', async ({ page }) => {
    test.skip(!(await googleReachable()), 'The Google reCAPTCHA servers cannot be reached from here, so the reCAPTCHA part cannot be checked.');
    const blocked: string[] = [];
    const policyMessages: string[] = [];
    const external = new Set<string>();
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text()) && !/report-only/i.test(m.text())) policyMessages.push(m.text().slice(0, 300));
    });
    page.on('requestfailed', (r) => { if (/BLOCKED_BY_CSP/i.test(r.failure()?.errorText ?? '')) blocked.push(r.url()); });
    page.on('request', (r) => { if (!r.url().startsWith(server.url) && /^https:/.test(r.url())) external.add(new URL(r.url()).origin + new URL(r.url()).pathname.split('/').slice(0, 3).join('/')); });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${server.url}/`);
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('Draw the app you need');

    // The hero is a WebGL canvas, the headings use webfonts and the page registers a service worker: all under the policy.
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? 'none'), { timeout: 30_000 }).toBe('activated');
    await expect.poll(() => page.evaluate(() => document.fonts.size), { timeout: 15_000 }).toBeGreaterThan(0);

    // reCAPTCHA Enterprise (App Check) is loaded from Google as the policy allows: the script, its runtime and its frame.
    await expect.poll(() => [...external].some((u) => u.includes('www.google.com/recaptcha')), { timeout: 30_000, message: 'the reCAPTCHA script is requested' }).toBe(true);
    await expect.poll(() => [...external].some((u) => u.includes('www.gstatic.com/recaptcha')), { timeout: 30_000, message: 'the reCAPTCHA runtime is requested' }).toBe(true);

    // Signing in calls Firebase Auth. With a placeholder key Google answers with an error, but the request must be
    // allowed by connect-src: a blocked request would never reach Google at all.
    const signIn = page.waitForRequest((r) => r.url().includes('identitytoolkit.googleapis.com'), { timeout: 30_000 });
    await page.getByRole('button', { name: 'Sign in' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Sign in to Kalam' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('textbox', { name: 'Email' }).fill('someone@example.com');
    await sheet.getByRole('textbox', { name: 'Password' }).fill('a-long-test-passphrase');
    await sheet.getByRole('button', { name: 'Sign in with email' }).click();
    await signIn;
    await expect(sheet.getByRole('alert').or(sheet.getByText(/did not work|do not match|not set up|offline/i)).first()).toBeVisible({ timeout: 30_000 });

    expect(blocked, 'requests the policy blocked').toEqual([]);
    expect(policyMessages, 'enforced policy violations').toEqual([]);
    expect(errors, 'uncaught page errors').toEqual([]);
  });

  test('the headers that reach the browser are the ones in firebase.json, and the page cannot be framed or sniffed', async ({ request }) => {
    const res = await request.get(`${server.url}/`);
    const h = res.headers();
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toContain("object-src 'none'");
    expect(h['content-security-policy']).not.toMatch(/unsafe-eval|script-src[^;]*'unsafe-inline'/);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('geolocation=()');
  });
});
