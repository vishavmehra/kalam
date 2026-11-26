/**
 * Automated accessibility scans (docs/13 §14.3, checklist D13-008, D01-039, D16-042, D10-052). axe-core runs on every
 * main screen in light and dark, with the access modes on, and on a generated app. A scan finds a subset of problems and
 * is not proof of accessibility, so 09-keyboard.spec.ts drives the keyboard and 10-modes-languages.spec.ts drives the
 * modes and the ten languages.
 *
 * Serious and critical findings fail the run. Moderate and minor ones are attached to the report and printed, not blocking.
 * KNOWN (below) lists findings that are known and owned by someone else.
 */
import {
  CALCULATOR_PROMPT, axeScan, blocking, completeOnboarding, ensureOnboarded, expect, navTo, openSettings, setAccessMode, test,
  type AxeFinding,
} from './fixtures';

/**
 * Findings that are known and owned by someone else, by axe rule id. `node` limits an entry to the elements it is about,
 * so a new element with the same problem still fails. A rule that is not listed fails the run. The last test below fails
 * when an entry no longer appears anywhere, so the list cannot go stale: delete the entry in the change that fixes it.
 */
const KNOWN: Record<string, { reason: string; node: RegExp }> = {
  'label-content-name-mismatch': {
    reason:
      'Links and cards whose aria-label does not contain their visible text (WCAG 2.5.3): the shell brand link, the shelf example cards and the template cards. Owner: shell, shelf, templates and drawing studio.',
    node: /^(a|button|div\[aria-label=|\.css-[\w-]+:nth-child\(\d+\) > button)/,
  },
  'aria-required-children': {
    reason: 'The drawing studio has an element with a list-like role that holds no matching children while the page is empty. Owner: drawing studio.',
    node: /^\.r-[\w-]+$/,
  },
  'color-contrast': {
    reason:
      'A disabled Build app button is not marked disabled in the page (Pressable replaces aria-disabled with its own disabled prop, which Button and IconButton never pass), so its dimmed text is measured. Owner: src/design.',
    node: /create-app|button\[data-k-hover="none"\]/,
  },
};

const SCREENS: Array<{ name: string; path: string }> = [
  { name: 'onboarding', path: '/onboarding' },
  { name: 'shelf', path: '/' },
  { name: 'create', path: '/create' },
  { name: 'templates', path: '/templates' },
  { name: 'settings', path: '/settings' },
  { name: 'bazaar', path: '/bazaar' },
  { name: 'activity', path: '/activity' },
  { name: 'account', path: '/account' },
];

const seen = new Set<string>();

/** Scans the screen as it is and fails on any serious or critical finding that is not in KNOWN. Returns every finding. */
async function scan(page: import('@playwright/test').Page, testInfo: import('@playwright/test').TestInfo, label: string): Promise<AxeFinding[]> {
  // Let the screen settle: fonts, the entrance animation and the first data read.
  // Earlier screens stay in the page, hidden, so look only at what is showing.
  await expect(page.locator('h1, h2, h3, h4, [role=heading], canvas').filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(900);
  const findings = await axeScan(page);
  for (const f of findings) seen.add(f.id);
  if (findings.length) {
    const text = findings.map((f) => `${f.impact} ${f.id} x${f.nodes} (${f.help}) e.g. ${f.sample}`).join('\n');
    await testInfo.attach(`axe: ${label}`, { body: text, contentType: 'text/plain' });
  }
  const unexpected = blocking(findings).filter((f) => !KNOWN[f.id] || f.targets.some((t) => !KNOWN[f.id]!.node.test(t)));
  // Soft, so one run lists the findings of every screen instead of stopping at the first.
  expect.soft(unexpected.map((f) => ({ id: f.id, targets: f.targets.slice(0, 6) })), `serious or critical accessibility findings on ${label}`).toEqual([]);
  return findings;
}

test.describe('axe accessibility scans', { tag: ['@a11y'] }, () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`every main screen has no serious or critical findings in ${scheme} @core`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await ensureOnboarded(page);
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await scan(page, testInfo, `${screen.name} · ${scheme}`);
      }
    });
  }

  test('Large and High contrast modes keep the screens clean', async ({ page }, testInfo) => {
    await ensureOnboarded(page);
    await openSettings(page);
    await setAccessMode(page, 'Large', true);
    await setAccessMode(page, 'High contrast', true);
    for (const screen of SCREENS.filter((s) => ['/', '/create', '/settings'].includes(s.path))) {
      await page.goto(screen.path);
      await scan(page, testInfo, `${screen.name} · large and high contrast`);
    }
  });

  test('a generated app, its review and its editor have no serious or critical findings @core', async ({ page }, testInfo) => {
    await completeOnboarding(page);
    await navTo(page, 'Make');
    await page.getByRole('textbox', { name: 'Describe the app you want to create' }).fill(CALCULATOR_PROMPT);
    await page.getByTestId('create-app').first().click();
    await expect(page).toHaveURL(/\/create\/review$/, { timeout: 30_000 });
    await scan(page, testInfo, 'review · light');
    await page.getByRole('button', { name: 'Save to Shelf' }).first().click();
    await expect(page).toHaveURL(/\/app\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Calculator' }).first()).toBeVisible();
    await scan(page, testInfo, 'app · light');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await scan(page, testInfo, 'edit · light');
  });

  test('the drawing studio has no serious or critical findings', async ({ page }, testInfo) => {
    await ensureOnboarded(page);
    await navTo(page, 'Make');
    await page.getByRole('tab', { name: 'Draw' }).click();
    await page.getByRole('button', { name: 'Open Drawing Studio' }).click();
    await expect(page).toHaveURL(/\/create\/draw/);
    await expect(page.getByRole('img', { name: /^Drawing canvas/ })).toBeVisible();
    await scan(page, testInfo, 'drawing studio · light');
  });
  test('the list of known findings is not stale', async ({ page }, testInfo) => {
    await ensureOnboarded(page);
    const ids = new Set<string>();
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      for (const f of await scan(page, testInfo, `${screen.name} · stale check`)) ids.add(f.id);
    }
    const stale = Object.keys(KNOWN).filter((id) => !ids.has(id));
    expect(stale, 'known findings that no longer appear on any screen: remove them from KNOWN').toEqual([]);
  });
});
