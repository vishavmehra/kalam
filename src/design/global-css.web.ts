/**
 * Web-only global styles: theme CSS variables, focus-visible rings, press/hover feedback and
 * reduced motion. Applied at runtime so it works for both `single` and `static` web output.
 * Components opt in with `dataSet={{ kPress: '' }}` / `dataSet={{ kHover: 'surface' }}`.
 */
import type { KalamTheme } from './theme';

const STYLE_ID = 'kalam-global-css';

const CSS = `
html, body { background: var(--k-bg); color: var(--k-text); }
body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
::selection { background: var(--k-accent-soft); color: var(--k-text); }
*:focus { outline: none; }
*:focus-visible:not(input):not(textarea) { outline: 2px solid var(--k-focus) !important; outline-offset: 2px !important; }
[data-k-press] { transition: transform 160ms var(--k-ease-out), background-color 120ms ease, border-color 120ms ease, opacity 120ms ease; cursor: pointer; }
[data-k-press]:active { transform: scale(0.97); }
[data-k-press][aria-disabled="true"] { cursor: not-allowed; }
[data-k-press][aria-disabled="true"]:active { transform: none; }
@media (hover: hover) and (pointer: fine) {
  [data-k-hover="surface"]:hover { background-color: var(--k-hover) !important; }
  [data-k-hover="primary"]:hover { background-color: var(--k-primary-pressed) !important; }
  [data-k-hover="danger"]:hover { filter: brightness(0.92); }
  [data-k-hover="border"]:hover { border-color: var(--k-border-strong) !important; }
  [data-k-hover="link"]:hover { text-decoration-thickness: 2px; }
}
html.k-rm [data-k-press], html.k-rm [data-k-press]:active { transform: none !important; transition: background-color 120ms ease, opacity 120ms ease; }
html.k-rm *, html.k-rm *::before, html.k-rm *::after { scroll-behavior: auto !important; }
* { scrollbar-width: thin; scrollbar-color: var(--k-border-strong) transparent; }
[data-k-skip]:not(:focus) { clip-path: inset(50%) !important; width: 1px !important; height: 1px !important; min-height: 0 !important; padding: 0 !important; overflow: hidden !important; }
[role="main"]:focus { outline: none !important; }
`;

export function installGlobalCss(theme: KalamTheme, lang: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const c = theme.colors;
  const vars: Record<string, string> = {
    '--k-bg': c.background,
    '--k-text': c.text,
    '--k-focus': c.focusRing,
    '--k-hover': c.surfaceAlt,
    '--k-accent-soft': c.accentSoft,
    '--k-primary-pressed': c.primaryPressed,
    '--k-border-strong': c.borderStrong,
    '--k-ease-out': theme.motion.easeOutCss,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = theme.scheme;
  root.classList.toggle('k-rm', theme.reducedMotion);
  root.lang = lang;
  document.body.style.backgroundColor = c.background;

  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', c.background);
}
