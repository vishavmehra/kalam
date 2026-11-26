/**
 * Draws a screen arranged by arrangeScreen (engine/v11/layout.ts): rows, grids and cards, styled
 * from the app's own resolved theme. Containers are never focusable themselves; a card title is a
 * header so screen readers can jump between sections.
 */
import { Fragment, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import type { KalamComponent } from '@/core/spec/schema';
import type { RuntimeTheme } from '../../engine/theme';
import { componentTheme, frameLayout, gridColumns, type LayoutItem } from '../../engine/v11';
import { font } from '../kit';

export interface LayoutViewProps {
  items: readonly LayoutItem[];
  t: RuntimeTheme;
  /** The runtime's own component renderer (KalamRuntime `render`). */
  render(c: KalamComponent): ReactNode;
}

/** Wraps a component that asks for an alignment or the full width; otherwise renders it bare. */
export function StyleFrame({ c, children }: { c: KalamComponent; children: ReactNode }) {
  const frame = frameLayout(c.style);
  return frame ? <View style={frame}>{children}</View> : <>{children}</>;
}

function Group({ item, t, render }: { item: Extract<LayoutItem, { kind: 'group' }>; t: RuntimeTheme; render: LayoutViewProps['render'] }) {
  const { node } = item;
  const gt = componentTheme(t, node.style);
  const gap = t.space * 0.75;
  // A grid measures itself and drops columns when cells would get narrower than MIN_GRID_CELL.
  const [width, setWidth] = useState(0);
  const grid = node.type === 'grid' ? gridColumns(width, node.columns ?? 2, t.fontScale, gap) : undefined;
  const kids = item.items.map((child) => {
    const key = child.kind === 'group' ? child.key : child.component.id;
    // A 1.0 stat sizes itself along a row (flexBasis + flexGrow), so it always sits in a row-direction box.
    const stat = child.kind === 'component' && child.component.type === 'stat';
    const inner = child.kind === 'group'
      ? <Group item={child} t={t} render={render} />
      : stat ? render(child.component) : <StyleFrame c={child.component}>{render(child.component)}</StyleFrame>;
    if (node.type === 'card') return stat ? <View key={key} style={styles.statBox}>{inner}</View> : <Fragment key={key}>{inner}</Fragment>;
    // Rows share the width and wrap when the text is large. Grid cells keep one width, so a short
    // last row never stretches across the screen.
    const cell: ViewStyle = grid
      ? grid.cell !== undefined
        ? { width: grid.cell, flexGrow: 0, flexShrink: 0 }
        : { flexBasis: `${Math.floor(100 / grid.columns) - 4}%` as `${number}%`, flexGrow: 0, flexShrink: 1, minWidth: 0 }
      : { flexGrow: 1, flexShrink: 1, flexBasis: Math.round((stat ? 150 : 140) * t.fontScale), minWidth: 0 };
    return (
      <View key={key} style={[cell, stat && styles.statBox]}>
        {inner}
      </View>
    );
  });
  if (node.type === 'card') {
    return (
      <View
        style={[
          styles.card,
          { gap, padding: t.space, borderRadius: t.radius, backgroundColor: gt.colors.surface, borderColor: gt.colors.border, borderWidth: Math.max(1, gt.borderWidth) },
        ]}
      >
        {node.title ? (
          <Text accessibilityRole="header" style={[font(gt, 17, '600', 1.3), { color: gt.colors.text }]}>{node.title}</Text>
        ) : null}
        {kids}
      </View>
    );
  }
  return (
    <View onLayout={grid ? (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width)) : undefined} style={[styles.wrap, { gap }]}>
      {kids}
    </View>
  );
}

export function LayoutView({ items, t, render }: LayoutViewProps) {
  return (
    <>
      {items.map((item) =>
        item.kind === 'group' ? (
          <Group key={item.key} item={item} t={t} render={render} />
        ) : (
          <Fragment key={item.component.id}>
            <StyleFrame c={item.component}>{render(item.component)}</StyleFrame>
          </Fragment>
        ),
      )}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  card: { alignSelf: 'stretch' },
  statBox: { flexDirection: 'row' },
});
