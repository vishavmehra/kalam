import { completeOnboarding, expect, test } from './fixtures';

test.describe('a. first run', () => {
  test('onboarding → Continue → empty App Shelf', async ({ page }) => {
    await completeOnboarding(page);

    // Empty shelf: honest empty state with the way forward, and no app cards.
    await expect(page.getByRole('button', { name: 'Create your first app' })).toBeVisible();
    await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Kalam' }).getByRole('link', { name: 'Shelf' })).toHaveAttribute('aria-current', 'page');
  });

  test('onboarding is skipped on the next visit once completed', async ({ page }) => {
    await completeOnboarding(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your shelf' })).toBeVisible();
    await expect(page).not.toHaveURL(/onboarding/);
  });
});
