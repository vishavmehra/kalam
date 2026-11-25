import { completeOnboarding, expect, test } from './fixtures';

test.describe('f. settings', () => {
  test('switching AI mode to offline-only persists across a reload', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('navigation', { name: 'Kalam' }).getByRole('link', { name: 'Settings' }).click();
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
    // Cloud switches are forced off and cannot be toggled while offline-only.
    await expect(page.getByRole('switch', { name: /Use cloud AI when needed/ })).toBeDisabled();

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
