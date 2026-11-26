/**
 * Keyboard, focus and screen-reader semantics (docs/13 §14.2, checklist D13-037). Everything here is done with the
 * keyboard only: no mouse click, except where a test says it opens a dialog first.
 *
 * A test that is marked `test.fail` documents a real defect in the app that someone else owns. It passes while the
 * defect is there and turns red the moment the defect is fixed, which is the cue to delete the marker.
 */
import type { Page } from '@playwright/test';
import { completeOnboarding, ensureOnboarded, expect, openSettings, test } from './fixtures';

/** A short description of whatever has focus: role or tag, then its accessible name or text. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return 'body';
    const name = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return `${e.getAttribute('role') || e.tagName.toLowerCase()}: ${name}`;
  });

test.describe('keyboard and focus', { tag: ['@a11y'] }, () => {
  test('the first Tab stop is the skip link, and it shows itself when focused @core', async ({ page }) => {
    await ensureOnboarded(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box, 'the focused skip link is on screen').not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });

  test('Enter on the skip link moves focus into the main content', async ({ page }) => {
    // Known defect (shell): Enter leaves focus on the skip link, and the next Tab goes back to the header.
    test.fail(true, 'The skip link does not move focus to the main content. Owner: AppShell.');
    await ensureOnboarded(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('main') || document.activeElement?.tagName === 'MAIN'), { timeout: 3_000 })
      .toBe(true);
  });

  test('Tab order follows the reading order: skip link, brand, theme, then the menu from Shelf to Settings', async ({ page }) => {
    await ensureOnboarded(page);
    const order: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      await page.keyboard.press('Tab');
      order.push(await focused(page));
    }
    const names = order.map((o) => o.replace(/^[^:]+: /, ''));
    expect(names[0]).toBe('Skip to main content');
    expect(names[1]).toContain('Kalam');
    // The menu links appear in their visual order, with nothing in between that is not a control.
    const menu = ['Shelf', 'Make', 'Bazaar', 'Activity', 'Settings'];
    const positions = menu.map((m) => names.findIndex((n) => n === m || n.startsWith(`${m} `)));
    expect(positions.every((p) => p >= 0), `menu links found in ${JSON.stringify(names)}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('every Tab stop on Settings has a visible focus ring', async ({ page }) => {
    await ensureOnboarded(page);
    await openSettings(page);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    const missing: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e || e === document.body) return { ok: true, name: 'body' };
        const cs = getComputedStyle(e);
        const outlined = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
        const shadow = cs.boxShadow !== 'none' && /rgb/.test(cs.boxShadow);
        return { ok: outlined || shadow, name: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40) };
      });
      if (!ring.ok) missing.push(ring.name);
    }
    expect(missing, 'focused controls with no visible ring').toEqual([]);
  });

  test('tabs move with the arrow keys and Enter selects', async ({ page }) => {
    await ensureOnboarded(page);
    await page.goto('/create');
    await page.getByRole('tab', { name: 'Type' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Photo or sketch' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'Photo or sketch' })).toHaveAttribute('aria-selected', 'true');
  });

  test('a switch toggles with Enter', async ({ page }) => {
    await ensureOnboarded(page);
    await openSettings(page);
    const large = page.getByRole('switch', { name: /^Large/ });
    await large.focus();
    await page.keyboard.press('Enter');
    // Turning a mode on first shows how it looks ("Try Large first"); both its buttons work from the keyboard.
    const sheet = page.getByTestId('access-preview-sheet');
    await expect(sheet).toBeVisible();
    await expect(large).toHaveAttribute('aria-checked', 'false');
    await sheet.getByRole('button', { name: 'Turn on' }).focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeHidden();
    await expect(large).toHaveAttribute('aria-checked', 'true');
    // Turning it off needs no preview.
    await large.focus();
    await page.keyboard.press('Enter');
    await expect(large).toHaveAttribute('aria-checked', 'false');
  });

  test('a switch also toggles with Space, as the ARIA switch pattern says', async ({ page }) => {
    test.fail(true, 'Space does nothing on a switch (only Enter works). Owner: src/design SwitchRow.');
    await ensureOnboarded(page);
    await openSettings(page);
    const large = page.getByRole('switch', { name: /^Large/ });
    await large.focus();
    await page.keyboard.press('Space');
    await expect(large).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });
  });

  test('a dialog keeps focus inside, closes with Escape and gives focus back', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });
    const opener = page.getByRole('button', { name: 'Make Kalam easier to use' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toBeVisible();

    // Focus must stay inside the dialog however many times Tab is pressed.
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
      expect(inside, `Tab ${i + 1} left the dialog`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('Create can be finished with the keyboard alone, and the field says what is wrong', async ({ page }) => {
    await completeOnboarding(page);
    await page.goto('/create');
    const box = page.getByRole('textbox', { name: 'Describe the app you want to create' });
    await box.focus();
    await page.keyboard.type('Make a calculator with addition, subtraction, multiplication and division');

    let reached = false;
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'create-app');
    }
    expect(reached, 'Tab reaches the Build app button').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/create\/review$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Here is what Kalam understood' })).toBeVisible();

    // On the review screen every action is a real button reachable by Tab.
    const save = page.getByRole('button', { name: 'Save to Shelf' }).first();
    await save.focus();
    await page.keyboard.press('Enter');
    // Saving shows "<name> is on your shelf": its two buttons are reachable by keyboard too, and Enter opens the app.
    await expect(page.getByTestId('saved-slip')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('open-saved-app').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/[^/]+$/, { timeout: 15_000 });
  });

  test('an empty request is refused in words, not silently', async ({ page }) => {
    await completeOnboarding(page);
    await page.goto('/create');
    const build = page.getByTestId('create-app').first();
    await build.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/create$/);
    // Either the button is dimmed and the page explains why, or an alert says what to do. Silence is the failure.
    const hint = page.getByText(/Type your idea|Describe|Add something/i).first();
    await expect(hint).toBeVisible();
  });
});
