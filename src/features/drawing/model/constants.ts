/**
 * Drawing Studio constants and design-token backed colours. The model never hardcodes a colour:
 * pen inks, paper tints and stamp wireframes all come from `src/design/tokens` (pure TypeScript,
 * safe to import under Vitest). Colours stored in a document are data chosen by the user.
 */
import { withAlpha } from '@/design/color';
import { palette } from '@/design/tokens';

/** Each page is one app screen; phone-like proportions (docs/08 §11.1). */
export const PAGE_WIDTH = 400;
export const PAGE_HEIGHT = 800;
export const MAX_PAGES = 8;
/** Most objects one page may hold (docs/08 §17.2). Keeps hit tests, history and exports bounded. */
export const PAGE_OBJECT_CAP = 500;
/** Current drawing document format (docs/08 §13). 1 = original, 2 = z-order, flags, backgrounds, images. */
export const DRAWING_SCHEMA_VERSION = 2;

/** Semantic hints a person can tag an object with (docs/08 §15.5). The compiler treats them as user intent. */
export const HINTS = ['header', 'nav', 'total', 'list_item'] as const;
export type DrawingHint = (typeof HINTS)[number];
export const HINT_LABELS: Record<DrawingHint, string> = {
  header: 'Header',
  nav: 'Navigation',
  total: 'Total',
  list_item: 'List item',
};

export type PageBackground = 'plain' | 'grid' | 'dots';
export const PAGE_BACKGROUNDS: ReadonlyArray<{ id: PageBackground; label: string }> = [
  { id: 'plain', label: 'Plain' },
  { id: 'grid', label: 'Grid' },
  { id: 'dots', label: 'Dots' },
];

/** Paper tints offered for a page. The first is the default. */
export const PAGE_COLORS: ReadonlyArray<{ value: string; name: string }> = [
  { value: palette.neutral[0], name: 'White' },
  { value: palette.brand.paper, name: 'Paper' },
  { value: palette.brand.marigoldSoft, name: 'Marigold' },
  { value: palette.brand.inkSoft, name: 'Ink' },
  { value: palette.semantic.successSoft, name: 'Green' },
  { value: palette.semantic.infoSoft, name: 'Sky' },
  { value: palette.semantic.dangerSoft, name: 'Rose' },
];
export const DEFAULT_PAGE_COLOR = palette.neutral[0];

/** Pen and shape colours. Same ink-on-paper look in light and dark shells (the page is always paper). */
export const INK_COLORS: ReadonlyArray<{ value: string; name: string }> = [
  { value: palette.brand.inkText, name: 'Ink' },
  { value: palette.brand.ink, name: 'Blue ink' },
  { value: palette.semantic.info, name: 'Sky' },
  { value: palette.semantic.success, name: 'Green' },
  { value: palette.semantic.danger, name: 'Red' },
  { value: palette.brand.marigold, name: 'Marigold' },
  { value: palette.neutral[500], name: 'Grey' },
];

/** Stamp wireframes are always ink on paper so exports read well for people and vision models. */
export const STAMP_COLORS = {
  ink: palette.brand.inkText,
  soft: palette.brand.inkSoft,
  muted: palette.neutral[500],
  primary: palette.brand.ink,
  onPrimary: palette.neutral[0],
  field: palette.neutral[0],
  placeholder: palette.neutral[100],
} as const;

/** Selection chrome on the canvas. */
export const SELECTION_COLORS = {
  line: palette.brand.ink,
  locked: palette.neutral[500],
  handleFill: palette.neutral[0],
  marqueeFill: withAlpha(palette.brand.ink, 0.12),
} as const;

export const GRID_STEP = 20;
