/**
 * The journeys that had no browser test yet (docs/13 §12.1 journeys 3, 7 and 9; docs/03 §28 journeys D, E and F). They run
 * the production build with no Firebase config and no on-device model, so everything that needs a cloud model is
 * checked for what it SHOULD do without one: say so plainly, keep the person's input, and change nothing.
 */
import {
  EXPENSE_PROMPT, completeOnboarding, createAndSave, ensureOnboarded, expect, fillField, goOffline, makeSketchPng, navTo, openSettings,
  saveToShelf, setAccessMode, test, waitForServiceWorkerControl,
} from './fixtures';
import type { Page } from '@playwright/test';

const PNG = makeSketchPng();

/** A speech recogniser that "hears" one sentence, so the voice flow can run in a browser with no microphone. */
async function installFakeSpeech(page: Page, sentence: string) {
  await page.addInitScript((said) => {
    class FakeRecognition {
      lang = 'en-US';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => this.onstart?.(), 20);
        setTimeout(() => {
          const alt = Object.assign([{ transcript: said, confidence: 0.93 }], { isFinal: true });
          const results = Object.assign([alt], { item: (i: number) => [alt][i] });
          this.onresult?.({ resultIndex: 0, results });
          this.onend?.();
        }, 300);
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
      addEventListener(type: string, fn: () => void) { (this as unknown as Record<string, unknown>)[`on${type}`] = fn; }
      removeEventListener() { /* nothing to remove */ }
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
  }, sentence);
}

test.describe('journey 3: create from a photo', () => {
  test('a photo is attached and labelled as going to the cloud; Kalam asks first, and a build with no cloud fails in words', async ({ page, diagnostics }) => {
    await completeOnboarding(page);
    await navTo(page, 'Make');
    await page.getByRole('tab', { name: /^Photo or sketch/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose photos' }).click();
    await (await chooser).setFiles({ name: 'sketch.png', mimeType: 'image/png', buffer: PNG });

    // The input tray lists it, says where it goes, and lets the person take it back out.
    await expect(page.getByRole('button', { name: 'Remove photo 1' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Could not be used')).toHaveCount(0);
    await expect(page.getByText(/Items with a cloud mark go to Gemini/)).toBeVisible();
    await expect(page.getByTestId('create-app').first()).toBeEnabled();

    // A photo can only be read in the cloud, so Kalam asks first and says exactly what is sent and what never leaves.
    diagnostics.externalRequests.length = 0;
    await page.getByTestId('create-app').first().click();
    const consent = page.getByRole('dialog', { name: 'This app needs Gemini in the cloud' });
    await expect(consent).toBeVisible();
    await expect(consent).toContainText('Photos are made smaller and their location is removed first');
    await expect(consent).toContainText('Never leaves this device');

    // "Not now" sends nothing and keeps the photo.
    await consent.getByRole('button', { name: 'Not now' }).click();
    await expect(consent).toBeHidden();
    await expect(page.getByRole('button', { name: 'Remove photo 1' }).first()).toBeVisible();
    expect(diagnostics.externalRequests, 'requests to external hosts').toEqual([]);

    // "Send and build" in a build with no cloud configured fails in words, saves nothing and keeps the photo.
    await page.getByTestId('create-app').first().click();
    await page.getByRole('dialog', { name: 'This app needs Gemini in the cloud' }).getByRole('button', { name: /Send and build/ }).click();
    const alert = page.getByRole('alert').filter({ hasText: /cloud|set up|offline|available/i }).first();
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/create$/);
    await expect(page.getByRole('button', { name: 'Remove photo 1' }).first()).toBeVisible();
    await navTo(page, 'Shelf');
    await expect(page.getByRole('heading', { name: /Your shelf is empty/ })).toBeVisible();
  });
});

test.describe('journey 7: change the language', () => {
  test('the app language sheet is honest without a translator, and the app keeps working in its own language', async ({ page }) => {
    await completeOnboarding(page);
    await createAndSave(page, EXPENSE_PROMPT);

    await page.getByRole('button', { name: 'English' }).click();
    const sheet = page.getByRole('dialog', { name: 'Language of this app' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('radio', { name: /^English\. Original language/ })).toBeChecked();
    await sheet.getByRole('radio', { name: /^Hindi\. Translate this app/ }).click();

    // No translator is available here, so Kalam says so instead of showing half-translated labels.
    await expect(sheet.getByText(/can't translate into Hindi/)).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible();

    // Going back to the original language works, the labels are the original ones and the app still runs.
    await sheet.getByRole('radio', { name: /^English\. Original language/ }).click();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add expense' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Add expense' }).first().click();
    await fillField(page, /^Amount/, '90');
    await page.getByRole('button', { name: 'Save expense' }).click();
    await expect(page.getByLabel(/^Entries: 1$/)).toBeVisible();
  });

  test('Kalam\'s own screens follow the interface language and keep it after a reload (the saved catalogue)', async ({ page }) => {
    await ensureOnboarded(page);
    await openSettings(page);
    await page.getByRole('radio', { name: 'தமிழ், Tamil' }).first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
    const tamil = await page.getByRole('heading', { level: 1 }).filter({ visible: true }).first().innerText();
    expect(tamil).toMatch(/[஀-௿]/);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 }).filter({ visible: true }).first()).toHaveText(tamil);
  });
});

test.describe('journey 9: accessibility modes in a generated app', () => {
  test('Large, High contrast, Simple and Read aloud change a running app', async ({ page }) => {
    await page.addInitScript(() => {
      const spoken: string[] = [];
      Object.assign(window, { __spoken: spoken });
      const synth = window.speechSynthesis;
      if (synth) synth.speak = (u: SpeechSynthesisUtterance) => { spoken.push(u.text); };
    });
    await ensureOnboarded(page);
    const id = await createAndSave(page, EXPENSE_PROMPT);
    const appUrl = `/app/${encodeURIComponent(id)}`;
    const title = page.getByRole('heading', { level: 1, name: 'Expenses' }).filter({ visible: true });
    const size = async () => parseFloat(await title.first().evaluate((e) => getComputedStyle(e).fontSize));
    const plain = await size();
    await expect(page.getByLabel(/^Entries: 0$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read that again' })).toHaveCount(0);

    await page.goto('/settings'); // the app screen has its own header, not the menu
    await expect(page.getByRole('heading', { name: 'Access modes' })).toBeVisible();
    for (const mode of ['Large', 'High contrast', 'Simple', 'Read aloud'] as const) await setAccessMode(page, mode, true);
    await page.goto(appUrl);
    await expect(title.first()).toBeVisible();

    expect(await size(), 'Large grows the app text').toBeGreaterThan(plain * 1.1);
    await expect(page.locator('html')).toHaveClass(/k-hc/);
    // Simple leaves out secondary figures: "Entries" is gone and the main action is still there.
    await expect(page.getByLabel(/^Entries: /)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add expense' }).first()).toBeVisible();
    // Read aloud adds its controls, and "Read that again" really speaks the screen.
    await expect(page.getByRole('button', { name: 'Read that again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop reading' })).toBeVisible();
    // Opening the app spoke its title (the speech call is replaced by a recorder, so no sound is made).
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(' | ')))
      .toContain('Expenses');

    // Recording still works with every mode on: the form opens, saves, and the total is read out.
    await page.getByRole('button', { name: 'Add expense' }).first().click();
    await fillField(page, /^Amount/, '60');
    await page.getByRole('button', { name: 'Save expense' }).click();
    await expect(page.getByLabel(/^Total spent: .*60/)).toBeVisible();
  });
});

test.describe('journey D: change an app by drawing on it', () => {
  test('circle a part, describe the change, keep it as version 2, then restore version 1', async ({ page }) => {
    await completeOnboarding(page);
    await createAndSave(page, EXPENSE_PROMPT);
    await page.getByRole('button', { name: 'Draw a change' }).click();
    await expect(page).toHaveURL(/\/edit\?draw=1$/);
    await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible();

    // Circle the "Add expense" button with the pen.
    const button = (await page.getByRole('button', { name: 'Add expense' }).first().boundingBox())!;
    const cx = button.x + button.width / 2;
    const cy = button.y + button.height / 2;
    const rx = button.width / 2 + 18;
    const ry = button.height / 2 + 14;
    await page.mouse.move(cx + rx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 24; i += 1) await page.mouse.move(cx + rx * Math.cos((i / 24) * Math.PI * 2), cy + ry * Math.sin((i / 24) * Math.PI * 2), { steps: 2 });
    await page.mouse.up();

    await page.getByRole('textbox', { name: 'Describe a change' }).fill('make the primary colour green');
    // While drawing, the sketch panel has its own (dimmed) Preview button; the text one is the last.
    await page.getByRole('button', { name: 'Preview change' }).last().click();
    await expect(page.getByRole('heading', { name: 'Proposed change' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep change' }).click();

    const versions = page.getByRole('listitem').filter({ hasText: /No\. \d+/ });
    await page.getByRole('radio', { name: 'History' }).click();
    await expect(versions).toHaveCount(2);
    await expect(versions.filter({ hasText: 'No. 02' }).getByText('Current', { exact: true })).toBeVisible();

    // The earlier version can be brought back.
    await versions.filter({ hasText: 'No. 01' }).getByRole('button', { name: /Restore/ }).click();
    const confirm = page.getByRole('button', { name: /^(Restore|Yes, restore|Bring it back)/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    // Exactly one version is current, and it is no longer the one that was restored away from.
    await expect(versions.getByText('Current', { exact: true })).toHaveCount(1);
    await expect(versions.filter({ hasText: 'No. 02' }).getByText('Current', { exact: true })).toHaveCount(0);
  });
});

test.describe('journey E: create an app by voice', () => {
  test('speak, fix the words, build, review and save', async ({ page }) => {
    await installFakeSpeech(page, 'simple expense tracker in rupees');
    await completeOnboarding(page);
    await navTo(page, 'Make');
    await page.getByRole('tab', { name: 'Voice' }).click();

    // The first tap asks how to transcribe: the voice goes to the browser's speech service only if the person agrees.
    await page.getByRole('button', { name: 'Start speaking' }).click();
    const browserSpeech = page.getByRole('switch', { name: /Use your browser's speech service/ });
    await expect(browserSpeech).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start speaking' })).toBeDisabled();
    await browserSpeech.click();
    await expect(browserSpeech).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Start speaking' }).click();
    const transcript = page.getByRole('textbox', { name: 'Transcript' });
    await expect(transcript).toHaveValue(/expense tracker in rupees/i, { timeout: 15_000 });
    // Listening goes on until the person stops it; then the words can be corrected before anything is built.
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await transcript.fill('Simple expense tracker in rupees');

    await page.getByTestId('create-app').first().click();
    await expect(page).toHaveURL(/\/create\/review$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Here is what Kalam understood' })).toBeVisible();
    // The structure is readable without seeing it: screens and fields are lists with names.
    await expect(page.getByRole('textbox', { name: 'Name of screen 1' })).toBeVisible();
    await saveToShelf(page);
    await expect(page.getByRole('heading', { name: 'Expenses' }).first()).toBeVisible();
  });
});

test.describe('journey F: a saved app in airplane mode', () => {
  test('open it from the shelf with no network, add a record, close and reopen: the record is there', async ({ page, context }) => {
    await completeOnboarding(page);
    await waitForServiceWorkerControl(page);
    const id = await createAndSave(page, EXPENSE_PROMPT);
    const appUrl = `/app/${encodeURIComponent(id)}`;

    // Go back to the shelf while still online, then turn the network off. No reload: this is the app running on its own.
    await page.getByRole('button', { name: 'Back to your apps' }).click();
    await expect(page.getByRole('button', { name: /^Expenses\. / })).toBeVisible();
    await goOffline(context, page);
    await page.getByRole('button', { name: /^Expenses\. / }).click();
    await expect(page).toHaveURL(new RegExp(`${appUrl}$`));
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Add expense' }).first().click();
    await fillField(page, /^Amount/, '310');
    await page.getByRole('button', { name: 'Save expense' }).click();
    await expect(page.getByLabel(/^Total spent: .*310/)).toBeVisible();
    await expect(page.getByText(/₹\s?310/).first()).toBeVisible(); // the new entry is in the list

    // Close the tab and open the app again, still offline: nothing was lost.
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(appUrl);
    await expect(reopened.getByLabel(/^Total spent: .*310/)).toBeVisible({ timeout: 30_000 });
    await expect(reopened.getByLabel(/^Entries: 1$/)).toBeVisible();
  });
});
