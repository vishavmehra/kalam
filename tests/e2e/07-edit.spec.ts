import { CALCULATOR_PROMPT, completeOnboarding, createAndSave, expect, test } from './fixtures';

test.describe('h. editing a saved app', () => {
  test('"make the primary colour green" is a deterministic change; keeping it adds version 2', async ({ page }) => {
    await completeOnboarding(page);
    await createAndSave(page, CALCULATOR_PROMPT);

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/[^/]+\/edit$/);
    await expect(page.getByRole('heading', { name: 'Edit Calculator' })).toBeVisible();
    await expect(page.getByText('Version 1', { exact: true }).first()).toBeVisible();

    await page.getByRole('textbox', { name: 'Describe a change' }).fill('make the primary colour green');
    await page.getByRole('button', { name: 'Preview change' }).click();

    // A proposed change worked out by ordinary app logic (the Template route), not by any model.
    await expect(page.getByRole('heading', { name: 'Proposed change' })).toBeVisible();
    await expect(page.getByText('Set the primary colour to #2E7D32')).toBeVisible();
    await expect(page.getByText('Changed the main colour from blue to green')).toBeVisible();
    await expect(page.getByText('Nothing is saved until you keep it.', { exact: false })).toBeVisible();

    // The preview shows the change, but nothing is saved yet: History holds only the first version.
    const versions = page.getByRole('listitem').filter({ hasText: /No\. \d+/ });
    await page.getByRole('radio', { name: 'History' }).click();
    await expect(versions).toHaveCount(1);

    await page.getByRole('button', { name: 'Keep change' }).click();

    // Version history now lists both versions, the new one current, and the old one can be restored.
    await expect(versions).toHaveCount(2);
    await expect(versions.filter({ hasText: 'No. 02' }).getByText('Current', { exact: true })).toBeVisible();
    await expect(versions.filter({ hasText: 'No. 01' }).getByRole('button', { name: /Restore/ })).toBeVisible();
  });
});
