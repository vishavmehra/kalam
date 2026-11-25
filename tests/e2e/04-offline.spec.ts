import {
  CLOUD_PROMPT, EXPENSE_PROMPT, completeOnboarding, createAndSave, describeAndCreate, expect, fillField, goOffline,
  openCreate, test, waitForServiceWorkerControl,
} from './fixtures';

test.describe('d–e. offline', () => {
  test('d. a saved app opens, works and keeps its data with the network off', async ({ page, context }) => {
    await completeOnboarding(page);
    await waitForServiceWorkerControl(page);
    const id = await createAndSave(page, EXPENSE_PROMPT);
    const appUrl = new RegExp(`/app/${encodeURIComponent(id)}$`);
    await expect(page.getByLabel(/^Entries: 0$/)).toBeVisible();

    await goOffline(context, page);
    await page.reload();

    // Rendered from the service-worker cache + IndexedDB with no network at all.
    await expect(page.getByRole('heading', { name: 'Expenses' }).first()).toBeVisible();
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    // Add a record offline.
    await page.getByRole('button', { name: 'Add expense' }).click();
    await fillField(page, /^Amount/, '175');
    await page.getByRole('button', { name: 'Save expense' }).click();
    await expect(page.getByLabel(/^Total spent: .*175/)).toBeVisible();
    await expect(page.getByLabel(/^Entries: 1$/)).toBeVisible();

    // Still offline after a reload: the record was really persisted.
    await page.reload();
    await expect(page).toHaveURL(appUrl);
    await expect(page.getByLabel(/^Total spent: .*175/)).toBeVisible();
    await expect(page.getByLabel(/^Entries: 1$/)).toBeVisible();

    // Back online: the app and the record are unchanged.
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByLabel(/^Total spent: .*175/)).toBeVisible();
  });

  test('d2. a brand-new template app can also be built offline (deterministic, no cloud)', async ({ page, context }) => {
    await completeOnboarding(page);
    await waitForServiceWorkerControl(page);
    await goOffline(context, page);

    const id = await createAndSave(page, EXPENSE_PROMPT);
    expect(id).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Expenses' }).first()).toBeVisible();
  });

  test('e. a cloud-needed request offline fails honestly, keeps the input and saves nothing', async ({ page, context, diagnostics }) => {
    await completeOnboarding(page);
    await waitForServiceWorkerControl(page);
    await goOffline(context, page);
    diagnostics.externalRequests.length = 0;

    await openCreate(page);
    await describeAndCreate(page, CLOUD_PROMPT);

    // Honest failure copy; never a raw provider error and never a half-built app.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert.getByRole('heading', { name: 'This app needs the cloud to build' })).toBeVisible();
    await expect(alert).toContainText('You are offline');
    await expect(alert).toContainText('Your input is kept');
    await expect(page).toHaveURL(/\/create$/);

    // The input survives the failure and Create is available again.
    await expect(page.getByRole('textbox', { name: 'Describe the app you want to create' })).toHaveValue(CLOUD_PROMPT);
    await expect(page.getByRole('button', { name: 'Create app' })).toBeEnabled();

    // No cloud request was even attempted while offline.
    expect(diagnostics.externalRequests, 'requests to external hosts').toEqual([]);

    // Nothing was saved: the shelf is still empty.
    await page.getByRole('navigation', { name: 'Kalam' }).getByRole('link', { name: 'Shelf' }).click();
    await expect(page.getByRole('heading', { name: 'Nothing on your shelf yet' })).toBeVisible();
  });
});
