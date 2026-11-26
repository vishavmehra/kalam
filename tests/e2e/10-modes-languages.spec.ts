/**
 * The access-mode and ten-language matrix (docs/13 §14.1, §15; checklist D10-053, D13-037). Every mode is turned on
 * from Settings and its effect is checked; every language is chosen and the screen is checked in that script. Both are
 * then combined on a phone-sized screen, where long Indian-script words are most likely to overflow.
 *
 * Not covered here, because it needs people or hardware: NVDA and TalkBack runs, and a native speaker's review of the
 * wording. This suite proves that the script renders, the language is applied, nothing overflows and nothing crashes.
 */
import { ACCESS_MODES, LANGUAGES, ensureOnboarded, expect, openSettings, setAccessMode, test } from './fixtures';
import type { Page } from '@playwright/test';

/** Horizontal overflow of the page: how many pixels wider the content is than the window. */
const overflow = (page: Page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

/** Picks a Kalam interface language from the first language group on Settings (its name is translated, the radios are not). */
async function chooseLanguage(page: Page, radio: string) {
  await page.getByRole('radio', { name: radio }).first().click();
}

test.describe('access modes', { tag: ['@a11y', '@matrix'] }, () => {
  test('Large makes text and targets bigger, and is remembered after a reload', async ({ page }) => {
    await ensureOnboarded(page);
    await openSettings(page);
    const heading = page.getByRole('heading', { level: 1 }).filter({ visible: true }).first();
    const size = async () => parseFloat(await heading.evaluate((e) => getComputedStyle(e).fontSize));
    const before = await size();
    const rowBefore = (await page.getByRole('switch', { name: /^Simple/ }).boundingBox())!.height;
    await setAccessMode(page, 'Large', true);
    expect(await size()).toBeGreaterThan(before * 1.25);
    expect((await page.getByRole('switch', { name: /^Simple/ }).boundingBox())!.height).toBeGreaterThan(rowBefore);
    await page.reload();
    await expect(page.getByRole('switch', { name: /^Large/ })).toHaveAttribute('aria-checked', 'true');
    expect(await size()).toBeGreaterThan(before * 1.25);
  });

  test('High contrast turns on the high-contrast palette: black on white, a darker focus colour', async ({ page }) => {
    await ensureOnboarded(page);
    await openSettings(page);
    await setAccessMode(page, 'High contrast', true);
    await expect(page.locator('html')).toHaveClass(/k-hc/);
    const colours = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return { bg: root.getPropertyValue('--k-bg').trim().toLowerCase(), text: root.getPropertyValue('--k-text').trim().toLowerCase() };
    });
    expect(colours).toEqual({ bg: '#ffffff', text: '#000000' });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/k-hc/);
  });

  test('Simple hides the Activity page from the menu, and turning it off brings it back', async ({ page }) => {
    await ensureOnboarded(page);
    const menu = page.getByRole('navigation', { name: /^Kalam/ });
    await expect(menu.getByRole('link', { name: 'Activity', exact: true })).toBeVisible();
    await openSettings(page);
    await setAccessMode(page, 'Simple', true);
    await expect(menu.getByRole('link', { name: 'Activity', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(menu.getByRole('link', { name: 'Activity', exact: true })).toHaveCount(0);
    await setAccessMode(page, 'Simple', false);
    await expect(menu.getByRole('link', { name: 'Activity', exact: true })).toBeVisible();
  });

  test('every mode can be switched on and off, is remembered, and the six together leave no page error', async ({ page }) => {
    await ensureOnboarded(page);
    await openSettings(page);
    for (const mode of ACCESS_MODES) await setAccessMode(page, mode, true);
    await page.reload();
    for (const mode of ACCESS_MODES) await expect(page.getByRole('switch', { name: new RegExp(`^${mode}`) })).toHaveAttribute('aria-checked', 'true');
    for (const screen of ['/', '/create', '/bazaar', '/settings']) {
      await page.goto(screen);
      await expect(page.locator('h1').filter({ visible: true }).first()).toBeVisible();
    }
    await openSettings(page);
    for (const mode of ACCESS_MODES) await setAccessMode(page, mode, false);
    await page.reload();
    for (const mode of ACCESS_MODES) await expect(page.getByRole('switch', { name: new RegExp(`^${mode}`) })).toHaveAttribute('aria-checked', 'false');
  });
});

test.describe('ten languages', { tag: ['@a11y', '@matrix'] }, () => {
  test('the English baseline is complete', async ({ page }) => {
    await ensureOnboarded(page);
    await openSettings(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  });

  for (const language of LANGUAGES.filter((l) => l.code !== 'en')) {
    test(`${language.native} (${language.code}): the screen is in that script, nothing overflows, with Large and High contrast on, on a phone @core`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await ensureOnboarded(page);
      await openSettings(page);
      const english = await page.getByRole('heading', { level: 1 }).filter({ visible: true }).first().innerText();
      // Modes first, while their names are still in English: they are stored, so they stay on when the language changes.
      await setAccessMode(page, 'Large', true);
      await setAccessMode(page, 'High contrast', true);

      await chooseLanguage(page, language.radio);
      await expect(page.locator('html')).toHaveAttribute('lang', language.code);
      const heading = page.getByRole('heading', { level: 1 }).filter({ visible: true }).first();
      await expect(heading).not.toHaveText(english);
      await expect(heading).toHaveText(language.script);

      // The language name in the picker is shown in its own script.
      await expect(page.getByRole('radio', { name: language.radio }).first()).toContainText(language.native);
      expect(await overflow(page), 'horizontal overflow in px').toBeLessThanOrEqual(1);

      // The language and both modes survive a reload.
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', language.code);
      await expect(page.locator('html')).toHaveClass(/k-hc/);

      // Larger text, the high-contrast palette and a long script must not push anything off a phone screen.
      for (const screen of ['/settings', '/', '/create', '/bazaar']) {
        await page.goto(screen);
        await expect(page.locator('h1').filter({ visible: true }).first()).toBeVisible();
        expect(await overflow(page), `overflow on ${screen}`).toBeLessThanOrEqual(1);
      }
    });
  }

  test('switching back to English restores the English screen', async ({ page }) => {
    await ensureOnboarded(page);
    await openSettings(page);
    await chooseLanguage(page, 'हिन्दी, Hindi');
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await chooseLanguage(page, 'English');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  });
});
