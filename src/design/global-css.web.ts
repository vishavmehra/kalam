/**
 * Web-only global styles (DIRECTION §2.4): theme CSS variables, the sindoor focus ring, haldi selection,
 * royal caret, quiet scrollbars, the fixed paper grain, press travel and hover tints, and reduced motion.
 * Applied at runtime so it works for both `single` and `static` web output.
 * Components opt in with `dataSet={{ kPress: '' }}` / `dataSet={{ kHover: 'surface' }}`.
 * The development build's Fast Refresh badge (a dark square fixed at the bottom left) sat on the Shelf tab on
 * phones, so it is hidden; production builds never have it.
 */
import type { KalamTheme } from './theme';

const STYLE_ID = 'kalam-global-css';

// Fractal-noise paper grain: one fixed layer that never scrolls, so it costs one composite.
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .2 0 0 0 0 .22 0 0 0 0 .35 0 0 0 1.1 -.2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const CSS = `
html, body { background: var(--k-bg); color: var(--k-text); }
html { scrollbar-color: var(--k-border-strong) var(--k-bg); -webkit-text-size-adjust: 100%; }
body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; caret-color: var(--k-royal); -webkit-tap-highlight-color: transparent; }
body::after { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; opacity: var(--k-grain-opacity); mix-blend-mode: var(--k-grain-blend); background-image: ${GRAIN}; }
html.k-hc body::after { display: none; }
::selection { background: var(--k-haldi); color: #12172E; }
input, textarea { caret-color: var(--k-royal); }
*:focus { outline: none; }
*:focus-visible:not(input):not(textarea) { outline: 2.5px solid var(--k-focus) !important; outline-offset: 3px !important; }
[data-k-field]:focus-within { outline: 2.5px solid var(--k-focus) !important; outline-offset: 3px !important; }
[role="heading"] { text-wrap: balance; }
[data-k-press] { transition: transform 160ms var(--k-ease-out), background-color 150ms ease, border-color 150ms ease, box-shadow 160ms var(--k-ease-out), opacity 150ms ease; cursor: pointer; touch-action: manipulation; }
[data-k-press]:active { transform: translateY(1px); }
[data-k-press="scale"]:active { transform: scale(0.97); }
[data-k-press][aria-disabled="true"] { cursor: not-allowed; }
[data-k-press][aria-disabled="true"]:active { transform: none; }
[data-k-sink]:active { box-shadow: inset 0 2px 0 rgb(0 0 0 / .18) !important; }
@media (hover: hover) and (pointer: fine) {
  [data-k-hover="surface"]:hover { background-color: var(--k-hover) !important; }
  [data-k-hover="primary"]:hover { background-color: var(--k-primary-pressed) !important; }
  [data-k-hover="action"]:hover { background-color: var(--k-action-pressed) !important; }
  [data-k-hover="danger"]:hover { filter: brightness(0.95); }
  [data-k-hover="border"]:hover { border-color: var(--k-border-strong) !important; }
  [data-k-hover="ring"]:hover { box-shadow: inset 0 0 0 1.25px var(--k-border-strong) !important; }
  [data-k-hover="link"]:hover { text-decoration-line: underline; text-decoration-color: var(--k-focus); }
  [data-k-hover="lift"]:hover { transform: translateY(-8px); }
}
html.k-rm [data-k-press], html.k-rm [data-k-press]:active, html.k-rm [data-k-hover="lift"]:hover { transform: none !important; transition: background-color 120ms ease, opacity 120ms ease; }
html.k-rm *, html.k-rm *::before, html.k-rm *::after { scroll-behavior: auto !important; animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
* { scrollbar-width: thin; scrollbar-color: var(--k-border-strong) transparent; }
[data-k-skip]:not(:focus) { clip-path: inset(50%) !important; width: 1px !important; height: 1px !important; min-height: 0 !important; padding: 0 !important; overflow: hidden !important; }
[role="main"]:focus { outline: none !important; }
.__expo_fast_refresh { display: none !important; }
`;

export function installGlobalCss(theme: KalamTheme, lang: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const c = theme.colors;
  const dark = theme.scheme === 'dark';
  const vars: Record<string, string> = {
    '--k-bg': c.background,
    '--k-text': c.text,
    '--k-focus': c.focusRing,
    '--k-hover': c.surfaceAlt,
    '--k-haldi': c.accent,
    '--k-royal': c.primary,
    '--k-primary-pressed': c.primaryPressed,
    '--k-action-pressed': c.actionBgPressed,
    '--k-border-strong': c.borderStrong,
    '--k-ease-out': theme.motion.easeOutCss,
    '--k-grain-opacity': dark ? '0.05' : '0.07',
    '--k-grain-blend': dark ? 'screen' : 'multiply',
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = theme.scheme;
  root.classList.toggle('k-rm', theme.reducedMotion);
  root.classList.toggle('k-hc', theme.accessModes.highContrast);
  root.lang = lang;
  document.body.style.backgroundColor = c.background;

  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== CSS) el.textContent = CSS;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', c.background);
}
