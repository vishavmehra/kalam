import { completeOnboarding, expect, navTo, test } from './fixtures';

test.describe('f. settings', () => {
  test('switching AI mode to offline-only persists across a reload @core', async ({ page }) => {
    await completeOnboarding(page);
    await navTo(page, 'Settings');
    await expect(page).toHaveURL(/\/settings$/);

    const group = page.getByRole('radiogroup', { name: 'When Kalam builds or edits an app' });
    const hybrid = group.getByRole('radio', { name: 'Hybrid' });
    const offlineOnly = group.getByRole('radio', { name: 'Offline only' });
    await expect(hybrid).toBeChecked();
    await expect(page.getByText('Kalam tries templates and on-device AI first')).toBeVisible();

    await offlineOnly.click();
    await expect(offlineOnly).toBeChecked();
    await expect(hybrid).not.toBeChecked();
    await expect(page.getByText('Kalam never goes online.')).toBeVisible();
    // Cloud switches are forced off and cannot be toggled while offline-only (the row is dimmed and ignores a press).
    const cloud = page.getByRole('switch', { name: /Use cloud AI when needed/ });
    await expect(cloud).toHaveAttribute('aria-checked', 'false');
    await cloud.click({ force: true });
    await expect(cloud).toHaveAttribute('aria-checked', 'false');

    await page.reload();
    await expect(page).toHaveURL(/\/settings$/);
    const reloaded = page.getByRole('radiogroup', { name: 'When Kalam builds or edits an app' });
    await expect(reloaded.getByRole('radio', { name: 'Offline only' })).toBeChecked();
    await expect(reloaded.getByRole('radio', { name: 'Hybrid' })).not.toBeChecked();
    await expect(page.getByText('Kalam never goes online.')).toBeVisible();

    // And back again, to prove the control is a real toggle and not a one-way latch.
    await reloaded.getByRole('radio', { name: 'Hybrid' }).click();
    await page.reload();
    await expect(page.getByRole('radiogroup', { name: 'When Kalam builds or edits an app' }).getByRole('radio', { name: 'Hybrid' })).toBeChecked();
  });
});
