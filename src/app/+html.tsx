import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Web document shell. NOTE: Expo uses this file for `web.output: "static"`; with the current
 * `"single"` output the runtime equivalents are applied by ThemeProvider (global-css.web.ts) and
 * scripts/build-pwa.mjs (manifest). Runs in Node at build time only.
 *
 * CSP: same-origin code only (no unsafe-eval); Firebase / Google APIs for AI Logic + App Check,
 * reCAPTCHA for App Check attestation. 'unsafe-inline' styles are required by react-native-web.
 */
const DEV = process.env.NODE_ENV !== 'production';

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://apis.google.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  `connect-src 'self' https://*.googleapis.com https://*.cloudfunctions.net https://*.run.app https://www.google.com${DEV ? ' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*' : ''}`,
  'frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/',
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const BOOT_CSS = `
html, body, #root { height: 100%; }
body { margin: 0; background-color: #FAF7F2; color: #1C1917; overflow: hidden; }
@media (prefers-color-scheme: dark) { body { background-color: #121110; color: #F5F1EA; } }
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <meta name="theme-color" content="#FAF7F2" />
        <meta name="description" content="Kalam: draw the app you need. Own it forever." />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <title>Kalam</title>
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: BOOT_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
