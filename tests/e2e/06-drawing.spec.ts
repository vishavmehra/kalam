import { completeOnboarding, expect, openCreate, test } from './fixtures';

test.describe('g. Drawing Studio', () => {
  test('draw a stroke and place a Button stamp, then use the drawing in Create', async ({ page }) => {
    await completeOnboarding(page);
    await openCreate(page);

    await page.getByRole('radio', { name: /^Draw/ }).first().click();
    await page.getByRole('button', { name: 'Open Drawing Studio' }).click();
    await expect(page).toHaveURL(/\/create\/draw/);

    const canvas = page.getByRole('img', { name: /^Drawing canvas/ });
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    expect(box.width).toBeGreaterThan(300);

    // Nothing drawn yet: "Use this drawing" refuses with guidance.
    await page.getByRole('button', { name: 'Use this drawing' }).click();
    await expect(page.getByText('Draw something or place a component first.')).toBeVisible();
    await expect(page).toHaveURL(/\/create\/draw/);

    // A freehand pen stroke.
    await page.getByRole('button', { name: 'Pen (P)' }).click();
    const x0 = box.x + box.width * 0.3;
    const y0 = box.y + box.height * 0.3;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) await page.mouse.move(x0 + i * 14, y0 + Math.sin(i / 2) * 22, { steps: 2 });
    await page.mouse.up();

    // A Button stamp: pick the stamp, then tap the page to place it.
    await page.getByRole('button', { name: 'Component stamps' }).click();
    await page.getByRole('radiogroup', { name: 'Component stamp' }).getByRole('radio', { name: 'Button' }).click();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.7);

    // The canvas holds real content now (not just a blank white page).
    const distinctColours = await canvas.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
      return seen.size;
    });
    expect(distinctColours, 'distinct colours sampled from the canvas').toBeGreaterThan(2);

    await page.getByRole('button', { name: 'Use this drawing' }).click();

    // Back on Create with the drawing attached.
    await expect(page).toHaveURL(/\/create$/, { timeout: 20_000 });
    await expect(page.getByRole('radio', { name: 'Draw, has input' })).toBeChecked();
    await expect(page.getByText(/1 screen · 1 component$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Detach drawing' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue drawing' })).toBeVisible();
    // A drawing alone is a valid input: Create is enabled.
    await expect(page.getByRole('button', { name: 'Create app' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /1 screen sketch/ })).toBeVisible();
  });
});
