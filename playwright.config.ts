import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the PRODUCTION web build (`npm run build:web` → dist/, including the
 * service worker), served by tests/e2e/serve.mjs. They use Playwright's bundled Chromium, which has no
 * Gemini Nano: on-device behaviour is not covered here, only the deterministic and offline paths.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/manifest.webmanifest`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
  },
});
