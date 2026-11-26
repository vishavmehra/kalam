import { completeOnboarding, expect, test } from './fixtures';

test.describe('a. first run', () => {
  test('onboarding → Make your first app → Create, then the empty App Shelf @core', async ({ page }) => {
    await completeOnboarding(page);

    // Empty shelf: honest empty state with the way forward, and no app cards.
    await expect(page.getByTestId('shelf-empty-make')).toBeVisible();
    await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: /^Kalam/ }).getByRole('link', { name: 'Shelf' })).toHaveAttribute('aria-current', 'page');
  });

  test('onboarding is skipped on the next visit once completed @core', async ({ page }) => {
    await completeOnboarding(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your shelf', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/onboarding/);
  });
});
