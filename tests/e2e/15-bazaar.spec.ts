/**
 * Kalam Bazaar in the browser build (docs/12 §22.4; checklist D12-032, journey 10). The browser-test build has no Firebase,
 * so these tests prove what a person sees when Bazaar is not set up: plain words, a way back, no network calls, and no
 * crash on any Bazaar page. The real round trip (publish, browse, preview, buy, install, and that private records do not
 * travel) runs against the Auth, Firestore and Functions emulators with the real client code in
 * tests/emulator/bazaar.emulator.test.ts, because a browser cannot reach a Firebase project from this build.
 */
import { ensureOnboarded, expect, navTo, test } from './fixtures';

test.describe('journey 10: Bazaar when it is not set up', () => {
  test('the home page says so in words and sends nothing anywhere', async ({ page, diagnostics }) => {
    await ensureOnboarded(page);
    diagnostics.externalRequests.length = 0;
    await navTo(page, 'Bazaar');
    await expect(page).toHaveURL(/\/bazaar$/);
    await expect(page.getByRole('heading', { name: 'Kalam Bazaar', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Kalam Bazaar is not set up in this build', level: 2 })).toBeVisible();
    await expect(page.getByText('Your own apps work the same.')).toBeVisible();
    for (const name of ['My library', 'Creator Studio', 'Share an app']) await expect(page.getByRole('button', { name })).toBeVisible();
    expect(diagnostics.externalRequests, 'requests to external hosts').toEqual([]);
  });

  test('every Bazaar page opens, explains itself and leads back, with no crash', async ({ page }) => {
    await ensureOnboarded(page);
    const pages: Array<{ path: string; heading: RegExp | string }> = [
      { path: '/bazaar/library', heading: 'My library' },
      { path: '/bazaar/mine', heading: /Creator Studio|My listings|Your listings|not available|not set up/i },
      { path: '/bazaar/wallet', heading: 'This page is not available in this build' },
      { path: '/bazaar/publish', heading: 'Share an app' },
    ];
    for (const { path, heading } of pages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading }).filter({ visible: true }).first(), path).toBeVisible({ timeout: 30_000 });
      // A way back to Bazaar is always on the page.
      await expect(page.getByRole('button', { name: /Kalam Bazaar|Browse Kalam Bazaar/ }).filter({ visible: true }).first(), `${path} leads back`).toBeVisible();
    }
  });

  test('the library is empty with a way forward, and "Share an app" explains what stays on the device', async ({ page }) => {
    await ensureOnboarded(page);
    await page.goto('/bazaar/library');
    await expect(page.getByRole('heading', { name: 'Nothing added from Kalam Bazaar yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Browse Kalam Bazaar' }).click();
    await expect(page).toHaveURL(/\/bazaar$/);

    await page.getByRole('button', { name: 'Share an app' }).click();
    await expect(page).toHaveURL(/\/bazaar\/publish$/);
    await expect(page.getByText('Only the app design is shared. The entries you saved in it stay on this device.')).toBeVisible();
    await expect(page.getByText('Sharing needs Firebase to be configured.', { exact: true })).toBeVisible();
  });
});
