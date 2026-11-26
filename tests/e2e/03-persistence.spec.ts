import { CALCULATOR_PROMPT, EXPENSE_PROMPT, completeOnboarding, createAndSave, expect, fillField, test } from './fixtures';

test.describe('c. persistence', () => {
  test('reload keeps the app on the shelf and its records intact @core', async ({ page }) => {
    await completeOnboarding(page);
    const calcId = await createAndSave(page, CALCULATOR_PROMPT);
    expect(calcId).toBeTruthy();

    // Back to the shelf: the app card is there.
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Calculator\. / })).toBeVisible();
    await expect(page.getByText('1 app on this device')).toBeVisible();

    // A second app with real records, so "data intact" means stored records, not just the spec.
    const expenseId = await createAndSave(page, EXPENSE_PROMPT);
    const expenseUrl = `/app/${encodeURIComponent(expenseId)}`;

    await page.getByRole('button', { name: 'Add expense' }).first().click();
    await fillField(page, /^Amount/, '250');
    await page.getByRole('button', { name: 'Save expense' }).click();
    await expect(page.getByLabel(/^Total spent: .*250/)).toBeVisible();
    await expect(page.getByLabel(/^Entries: 1$/)).toBeVisible();

    // Full reload of the page the user was on.
    await page.reload();
    await expect(page.getByLabel(/^Total spent: .*250/)).toBeVisible();
    await expect(page.getByLabel(/^Entries: 1$/)).toBeVisible();

    // And of the shelf: both apps still listed.
    await page.goto('/');
    await expect(page.getByText('2 apps on this device')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Calculator\. / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Expenses\. / })).toBeVisible();

    // Re-opening the expense app from the shelf shows the same stored record.
    await page.getByRole('button', { name: /^Expenses\. / }).click();
    await expect(page).toHaveURL(new RegExp(`${expenseUrl}$`));
    await expect(page.getByLabel(/^Total spent: .*250/)).toBeVisible();
  });
});
