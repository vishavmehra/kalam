/**
 * Chrome with no on-device model (docs/13 §12.2; checklist D13-034, D17-013). The `no-nano` project removes the Prompt API
 * before any page script runs. The promise is that Kalam still works: templates build, Settings says honestly what the
 * browser can and cannot do, and nothing pretends a local model ran.
 */
import { CALCULATOR_PROMPT, completeOnboarding, createAndSave, ensureOnboarded, expect, fillField, openSettings, removeOnDeviceAi, test } from './fixtures';

test.describe('without on-device AI', { tag: ['@nano'] }, () => {
  // Every project runs this file; the model is removed here so the result is the same in all of them.
  test.beforeEach(async ({ page }) => { await removeOnDeviceAi(page); });

  test('the browser really has no on-device model, and Settings says so without claiming one is ready', async ({ page }) => {
    await ensureOnboarded(page);
    const apis = await page.evaluate(() => ({ languageModel: typeof (window as unknown as { LanguageModel?: unknown }).LanguageModel }));
    expect(apis.languageModel).toBe('undefined');

    await openSettings(page);
    const section = page.getByRole('heading', { name: 'On-device AI', level: 2 });
    await expect(section).toBeVisible();
    // The status line never says ready, and the page offers to prepare it instead of failing.
    await expect(page.getByText(/On-device AI (ready|available)/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prepare on-device AI' })).toBeVisible();
    await expect(page.getByText(/not downloaded|not available|unavailable|not supported/i).filter({ visible: true }).first()).toBeVisible();
  });

  test('a calculator is still built, from a template, and the review says no model was used', async ({ page }) => {
    await completeOnboarding(page);
    await createAndSave(page, CALCULATOR_PROMPT);
    await fillField(page, /First number \(a\)/, '9');
    await fillField(page, /Second number \(b\)/, '3');
    await expect(page.getByLabel(/^Quotient \(a . b\): 3$/)).toBeVisible();
  });

  test('the shelf shows the on-device status as a link to Settings, not as a ready model', async ({ page }) => {
    await ensureOnboarded(page);
    const status = page.getByRole('link', { name: /On-device AI .*Open settings/i });
    await expect(status).toBeVisible();
    await expect(status).not.toContainText(/ready/i);
  });
});
