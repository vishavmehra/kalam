import { CALCULATOR_PROMPT, completeOnboarding, createAndSave, describeAndCreate, expect, fillField, openCreate, test, waitForReview } from './fixtures';

/** Stat blocks expose "<label>: <value>" as their accessible name. */
const stat = (page: import('@playwright/test').Page, label: RegExp) => page.getByLabel(label);

test.describe('b. calculator from a template', () => {
  test('create → progress → Template route → preview works → Save → app computes correctly', async ({ page }) => {
    await completeOnboarding(page);
    await openCreate(page);

    await describeAndCreate(page, CALCULATOR_PROMPT);
    await waitForReview(page);

    // Honest route: a deterministic template, no AI involved.
    const overview = page.getByRole('heading', { name: 'Overview' }).locator('..').locator('..');
    await expect(overview.getByText('Template', { exact: true })).toBeVisible();
    await expect(page.getByText('Built from a template on this device')).toBeVisible();

    // The preview runs the real runtime with in-memory data.
    await expect(page.getByText('Preview. Records added here are not saved.')).toBeVisible();
    await fillField(page, /First number \(a\)/, '12');
    await fillField(page, /Second number \(b\)/, '4');
    await expect(stat(page, /^Sum \(a \+ b\): 16$/)).toBeVisible();

    await page.getByRole('button', { name: 'Save to Shelf' }).first().click();
    await expect(page).toHaveURL(/\/app\/[^/]+$/, { timeout: 15_000 });

    // The saved app, run for real.
    await expect(page.getByRole('heading', { name: 'Calculator' }).first()).toBeVisible();
    await fillField(page, /First number \(a\)/, '12');
    await fillField(page, /Second number \(b\)/, '4');
    await expect(stat(page, /^Sum \(a \+ b\): 16$/)).toBeVisible();
    await expect(stat(page, /^Difference \(a . b\): 8$/)).toBeVisible();
    await expect(stat(page, /^Product \(a . b\): 48$/)).toBeVisible();
    await expect(stat(page, /^Quotient \(a . b\): 3$/)).toBeVisible();

    // Division by zero is handled, not an error.
    await fillField(page, /Second number \(b\)/, '0');
    await expect(stat(page, /^Quotient \(a . b\): Not defined$/)).toBeVisible();

    // Clear resets the form.
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByRole('textbox', { name: /First number \(a\)/ })).toHaveValue('');
  });
});
