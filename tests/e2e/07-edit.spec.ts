import { CALCULATOR_PROMPT, completeOnboarding, createAndSave, expect, test } from './fixtures';

test.describe('h. editing a saved app', () => {
  test('"make the primary colour green" is a deterministic change; keeping it adds version 2', async ({ page }) => {
    await completeOnboarding(page);
    await createAndSave(page, CALCULATOR_PROMPT);

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/app\/[^/]+\/edit$/);
    await expect(page.getByText('Edit Calculator')).toBeVisible();
    await expect(page.getByText('Version 1', { exact: true }).first()).toBeVisible();

    await page.getByRole('textbox', { name: 'Describe a change' }).fill('make the primary colour green');
    await page.getByRole('button', { name: 'Preview change' }).click();

    // A proposed change, computed by ordinary app logic, not by any model.
    const proposed = page.getByText('Proposed change').locator('../..');
    await expect(proposed).toBeVisible();
    await expect(proposed.getByText('Deterministic', { exact: true })).toBeVisible();
    await expect(proposed.getByText('Nothing is saved until you keep it.', { exact: false })).toBeVisible();

    // Nothing is saved until accepted: only one version exists so far.
    await page.getByRole('radio', { name: 'History' }).click();
    await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(1);

    await page.getByRole('button', { name: 'Keep change' }).click();
    await expect(page.getByText('Saved as version 2')).toBeVisible();

    // Version history now lists both versions, the new one current.
    const items = page.getByRole('list').getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.filter({ hasText: 'Version 2' }).getByText('Current', { exact: true })).toBeVisible();
    await expect(items.filter({ hasText: 'Version 1' }).getByRole('button', { name: 'Restore' })).toBeVisible();
  });
});
