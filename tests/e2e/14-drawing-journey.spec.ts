/**
 * Journey 4 in full (docs/13 §12.1, docs/08 §20; checklist D08-053): open the Drawing Studio, draw a screen with shapes and
 * text, undo and redo, add a second page, export it, let the studio save on its own, come back, and use the drawing to
 * build. Building from a drawing needs the cloud (sketch understanding), so the last step checks what happens when
 * there is none: Kalam asks first, says what goes where, and fails in words without losing the drawing.
 */
import type { Locator, Page } from '@playwright/test';
import { completeOnboarding, expect, navTo, test } from './fixtures';

/** How many objects the studio says are on the canvas. It is in the canvas's accessible name: "... 3 objects. ...". */
async function objectCount(canvas: Locator): Promise<number> {
  const label = (await canvas.getAttribute('aria-label')) ?? '';
  return Number(/(\d+) objects?/.exec(label)?.[1] ?? NaN);
}

async function drag(page: Page, canvas: Locator, from: [number, number], to: [number, number]) {
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), { steps: 4 });
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 });
  await page.mouse.up();
}

test.describe('journey 4: drawing creation, from a blank page to the build', () => {
  test('shapes, text, undo and redo, a second page, export, autosave and "use this drawing"', async ({ page, diagnostics }) => {
    await completeOnboarding(page);
    await navTo(page, 'Make');
    await page.getByRole('tab', { name: 'Draw' }).click();
    await page.getByRole('button', { name: 'Open Drawing Studio' }).click();
    await expect(page).toHaveURL(/\/create\/draw/);
    const canvas = page.getByRole('img', { name: /^Drawing canvas/ });
    await expect(canvas).toBeVisible();
    expect(await objectCount(canvas)).toBe(0);

    // Name the drawing.
    const name = page.getByRole('textbox', { name: 'Drawing name' });
    await name.fill('Fee book');

    // Shapes: a box for the form, a circle, a line.
    await page.getByRole('button', { name: 'Rectangle (R)' }).click();
    await drag(page, canvas, [0.15, 0.2], [0.6, 0.45]);
    await expect.poll(() => objectCount(canvas)).toBe(1);
    await page.getByRole('button', { name: 'Ellipse (O)' }).click();
    await drag(page, canvas, [0.65, 0.2], [0.85, 0.4]);
    await expect.poll(() => objectCount(canvas)).toBe(2);
    await page.getByRole('button', { name: 'Line (L)' }).click();
    await drag(page, canvas, [0.15, 0.6], [0.85, 0.6]);
    await expect.poll(() => objectCount(canvas)).toBe(3);

    // Text: pick the Text tool, tap the page and type a label.
    await page.getByRole('button', { name: 'Text (T)' }).click();
    const box = (await canvas.boundingBox())!;
    // Labels go on the screen itself, which is the middle of the canvas: a tap outside it does nothing.
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.75);
    await page.keyboard.type('Customer name');
    // Picking another tool finishes the label (Escape would cancel it).
    await page.getByRole('button', { name: /^Select and move/ }).click();
    await expect.poll(() => objectCount(canvas)).toBe(4);

    // Undo and redo with the buttons and with the keys.
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(() => objectCount(canvas)).toBe(3);
    await page.getByRole('button', { name: /^Redo/ }).click();
    await expect.poll(() => objectCount(canvas)).toBe(4);
    await page.keyboard.press('Control+z');
    await expect.poll(() => objectCount(canvas)).toBe(3);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => objectCount(canvas)).toBe(4);

    // A second page, with its own objects.
    await page.getByRole('button', { name: 'Add screen' }).click();
    await expect(page.getByRole('tab', { name: /^Screen 2 of 2/ })).toHaveAttribute('aria-selected', 'true');
    expect(await objectCount(canvas)).toBe(0);
    await page.getByRole('button', { name: 'Rectangle (R)' }).click();
    await drag(page, canvas, [0.2, 0.25], [0.8, 0.5]);
    await expect.poll(() => objectCount(canvas)).toBe(1);
    await page.getByRole('tab', { name: /^Screen 1 of 2/ }).click();
    await expect.poll(() => objectCount(canvas)).toBe(4);

    // Export: the dialog offers PNG, SVG and PDF, and each one is a real file with the right signature.
    const { readFileSync } = await import('node:fs');
    const exportAs = async (type: 'PNG picture' | 'SVG shapes' | 'PDF document', button: string) => {
      await page.getByRole('button', { name: 'Export screen as PNG' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export' });
      await dialog.getByRole('radio', { name: type }).click();
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: button }).click();
      const file = await download;
      const bytes = readFileSync((await file.path())!);
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      return { name: file.suggestedFilename(), bytes };
    };
    const png = await exportAs('PNG picture', 'Save PNG');
    expect(png.name).toMatch(/\.png$/i);
    expect(png.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.bytes.length).toBeGreaterThan(1_000);
    const svg = await exportAs('SVG shapes', 'Save SVG');
    expect(svg.name).toMatch(/\.svg$/i);
    expect(svg.bytes.toString('utf8')).toMatch(/<svg[\s>]/);
    const pdf = await exportAs('PDF document', 'Save PDF');
    expect(pdf.name).toMatch(/\.pdf$/i);
    expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Save and hand the drawing to Create. Reopening it from there goes by the drawing's id, and a full reload of that
    // address brings back exactly what was autosaved: the name, both screens and every object.
    await page.getByRole('button', { name: /^Save now/ }).click();
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Use this drawing' }).click();
    await expect(page).toHaveURL(/\/create$/, { timeout: 20_000 });
    await expect(page.getByRole('tab', { name: 'Draw, has input' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Continue drawing' }).click();
    await expect(page).toHaveURL(/\/create\/draw\?id=/);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Drawing name' })).toHaveValue('Fee book', { timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /^Screen 2 of 2/ })).toBeVisible();
    await page.getByRole('tab', { name: /^Screen 1 of 2/ }).click();
    await expect.poll(() => objectCount(page.getByRole('img', { name: /^Drawing canvas/ }))).toBe(4);

    // Use it again and build. Building from a sketch needs the cloud: Kalam asks first, and "Not now" sends nothing.
    await page.getByRole('button', { name: 'Use this drawing' }).click();
    await expect(page).toHaveURL(/\/create$/, { timeout: 20_000 });
    await expect(page.getByText(/2 screens/).first()).toBeAttached();
    diagnostics.externalRequests.length = 0;
    await page.getByTestId('create-app').first().click();
    const consent = page.getByRole('dialog', { name: 'This app needs Gemini in the cloud' });
    await expect(consent).toBeVisible();
    await expect(consent).toContainText('drawing as pictures');
    await consent.getByRole('button', { name: 'Not now' }).click();
    expect(diagnostics.externalRequests, 'nothing was sent').toEqual([]);

    // The drawing is still attached, and the studio still opens it.
    await expect(page.getByRole('button', { name: 'Continue drawing' })).toBeVisible();
  });
});
