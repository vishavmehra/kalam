/**
 * Screen layout (KalamSpec 1.1 groups): turns a screen's flat component list plus its optional
 * `layout` into what to draw. Pure. Components keep their order; a group appears where its first
 * visible member would have been. Hidden components never show, empty groups are dropped.
 */
import type { KalamComponent, KalamLayoutNode, KalamScreen } from '@/core/spec/schema';
import { LIMITS } from '@/core/spec/schema';

export type LayoutItem =
  | { kind: 'component'; component: KalamComponent }
  | { kind: 'group'; key: string; node: Omit<KalamLayoutNode, 'children'>; items: LayoutItem[] };

/** Every component id inside a node, at any depth (bounded by the validated depth). */
function idsIn(node: KalamLayoutNode, out: string[] = [], depth = 1): string[] {
  if (depth > LIMITS.layoutDepth) return out;
  for (const child of node.children) {
    if (typeof child === 'string') out.push(child);
    else idsIn(child, out, depth + 1);
  }
  return out;
}

function buildGroup(node: KalamLayoutNode, byId: ReadonlyMap<string, KalamComponent>, key: string, depth: number): LayoutItem | undefined {
  if (depth > LIMITS.layoutDepth) return undefined;
  const items: LayoutItem[] = [];
  node.children.forEach((child, i) => {
    if (typeof child !== 'string') {
      const sub = buildGroup(child, byId, `${key}.${i}`, depth + 1);
      if (sub) items.push(sub);
      return;
    }
    const component = byId.get(child);
    if (component) items.push({ kind: 'component', component });
  });
  if (!items.length) return undefined;
  const { children: _children, ...rest } = node;
  return { kind: 'group', key, node: rest, items };
}

/**
 * `visible` is the screen's children after Access Mode filtering (visibleChildren). Without a layout,
 * consecutive stats still share a row, exactly as the 1.0 runtime drew them.
 */
export function arrangeScreen(screen: KalamScreen, visible: readonly KalamComponent[]): LayoutItem[] {
  const byId = new Map(visible.map((c) => [c.id, c] as const));
  const owner = new Map<string, number>();
  screen.layout?.forEach((node, i) => {
    for (const id of idsIn(node)) if (!owner.has(id)) owner.set(id, i);
  });
  const out: LayoutItem[] = [];
  const emitted = new Set<number>();
  let stats: KalamComponent[] = [];
  const flushStats = () => {
    if (stats.length) {
      out.push({ kind: 'group', key: `stats_${stats[0].id}`, node: { type: 'row' }, items: stats.map((component) => ({ kind: 'component', component })) });
    }
    stats = [];
  };
  for (const c of visible) {
    const root = owner.get(c.id);
    if (root === undefined) {
      if (c.type === 'stat') {
        stats.push(c);
        continue;
      }
      flushStats();
      out.push({ kind: 'component', component: c });
      continue;
    }
    flushStats();
    if (emitted.has(root)) continue;
    emitted.add(root);
    const group = buildGroup((screen.layout as KalamLayoutNode[])[root], byId, `layout_${root}`, 1);
    if (group) out.push(group);
  }
  flushStats();
  return out;
}

/** Narrowest a grid cell may get before the grid drops a column (scaled by the text size). */
export const MIN_GRID_CELL = 160;

/**
 * Columns a grid really uses at `width`, and the width of one cell. A 4 column grid on a phone, or
 * in Large mode, falls back to fewer columns instead of squeezing inputs and charts. Before the
 * first measure (`width` 0) it keeps the asked-for columns.
 */
export function gridColumns(width: number, columns: number, fontScale: number, gap: number): { columns: number; cell?: number } {
  if (width <= 0) return { columns };
  const min = MIN_GRID_CELL * fontScale;
  const fit = Math.max(1, Math.min(columns, Math.floor((width + gap) / (min + gap))));
  return { columns: fit, cell: Math.floor((width - gap * (fit - 1)) / fit) };
}
