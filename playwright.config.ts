import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the PRODUCTION web build (`npm run build:web:e2e` → dist/, including the
 * service worker). That build has no Firebase config, so the sign-in gate stays open (a real build asks every
 * visitor to sign in). It is served by tests/e2e/serve.mjs, which sends the same security headers as Firebase Hosting
 * (firebase.json), so a Content Security Policy block would show up here exactly as it would in production.
 * They use Playwright's bundled Chromium, which has no Gemini Nano: on-device behaviour is not covered here, only the
 * deterministic and offline paths.
 *
 * Projects (docs/13 §12.2):
 *   chromium  current desktop Chrome at 1440 x 900. Runs every spec.
 *   narrow    a 1024 x 700 laptop window. Runs the specs tagged @core.
 *   mobile    a Pixel 7 sized phone with touch. Runs the specs tagged @core.
 *   no-nano   Chrome with no on-device model (the Prompt API removed). Runs the specs tagged @nano.
 * Tags are part of the test title, so `--grep @a11y` picks the accessibility scans in every project.
 *
 * Environment: E2E_PORT (default 4173) and E2E_DIST (default dist) say where the build is served from.
 * E2E_CSP_DIST (default dist-csp) is the build with a placeholder Firebase and reCAPTCHA config that
 * 12-csp-production.spec.ts serves itself; that spec skips when the folder is missing.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './tests/e2e/.artifacts/test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/.artifacts/report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Real PWA behaviour: service workers must be allowed (the default) and no state may leak between tests.
    serviceWorkers: 'allow',
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    { name: 'chromium', use: desktop },
    { name: 'narrow', use: { ...desktop, viewport: { width: 1024, height: 700 } }, grep: /@core/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], locale: 'en-US', timezoneId: 'Asia/Kolkata' }, grep: /@core/ },
    { name: 'no-nano', use: desktop, grep: /@nano/ },
  ],
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/manifest.webmanifest`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
  },
});
