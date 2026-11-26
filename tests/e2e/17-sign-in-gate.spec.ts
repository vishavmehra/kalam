/**
 * The required sign-in. A build with no Firebase config is not gated, so this only runs against a configured build
 * with a test account: set KALAM_TEST_EMAIL and KALAM_TEST_PASSWORD (and E2E_SIGN_IN=1 for a build with the Firebase
 * config). Without them the spec is skipped, never passed.
 */
import { expect, test } from '@playwright/test';

const email = process.env.KALAM_TEST_EMAIL;
const password = process.env.KALAM_TEST_PASSWORD;

test.describe('sign-in gate', () => {
  test.skip(!email || !password || !process.env.E2E_SIGN_IN, 'KALAM_TEST_EMAIL, KALAM_TEST_PASSWORD and E2E_SIGN_IN are not set');

  test('the app waits behind the sign-in, then opens with a test account', async ({ page }) => {
    await page.goto('/create');
    await expect(page.getByTestId('sign-in-gate')).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Email').fill(email ?? '');
    await page.getByLabel('Password').fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await expect(page.getByTestId('sign-in-gate')).toBeHidden({ timeout: 30_000 });
  });
});
