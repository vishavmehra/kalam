/**
 * Visual App Studio (docs/14 §4, docs/00 §24.1, docs/03 §17.2). Wraps the running app preview. When
 * `active`, a layer on top lets the person pick a part, drag it to reorder, drop it on a screen chip
 * to move it there, drag its corner to resize, tap it again to rename it in place, and use the panel
 * for everything else. Parts are found from measured bounds (never from a model), every change comes
 * back from core/edit/direct already validated, and nothing is saved here: `onChange` hands the host a
 * draft change, so the host's Keep, Discard and Undo apply as for any other edit.
 * ponytail: no auto-scroll while dragging; reach a part off screen with Scroll mode or Move up / down.
 */
import { Hand, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import {
  moveComponentTo, renameComponentLabel, resizeComponent, sizeOf, staysOnScreen, type DirectResult, type StyleSize,
} from '@/core/edit/direct';
import { findPart } from '@/core/edit/visual-edit';
import { LIMITS, STYLE_SIZES, type KalamSpec } from '@/core/spec/schema';
import { IconButton, Text, useKalamTheme, useReducedMotion, useToast, withAlpha } from '@/design';
import { useT } from '@/i18n/react';
import type { Rect } from '@/features/editing/overlay/geometry';
import { shownScreen, visibleParts } from '@/features/editing/overlay/parts';
import { ComponentBoundsProvider, createBoundsRegistry, type BoundsRect, type ComponentBoundsRegistry, type MeasurableNode } from '@/runtime/layout';
import { FAIL_KEY, NOUN_KEY, SIZE_KEY, summaryOf } from './copy';
import { Inspector } from './Inspector';
import { dropTargetAt, exceedsSlop, nameOf, nounOf, slotLine, sizeFromDrag, type DropTarget } from './model';

export interface VisualStudioProps {
  /** The spec being edited: the saved version, or the host's pending draft. */
  spec: KalamSpec;
  /** Layer on or off. Off: the app renders untouched and costs nothing extra. */
  active: boolean;
  /** Renders the running app for a spec. */
  renderApp(spec: KalamSpec): ReactNode;
  /** A validated change. The host keeps it as a draft (with undo), it is not saved yet. */
  onChange(spec: KalamSpec, summary: string): void;
  onClose(): void;
  /** Lets a "moved to another screen" notice offer Undo. */
  onUndo?(): void;
  /** Does this collection hold saved entries? Unknown counts as yes, so a field's type is never changed blind. */
  hasEntries?(collection: string): boolean;
}

const EMPTY: ReadonlyMap<string, BoundsRect> = new Map();
const OUTSET = 4;
const HANDLE = 44;
const CHIP_TOP = 8;
const CHIP_LEFT = 8;

export function VisualStudio({ spec, active, renderApp, ...layer }: VisualStudioProps) {
  const registry = useMemo(() => createBoundsRegistry(), []);
  // The layer redraws on every drag step; the app below only when the spec or the host changes it.
  const app = useMemo(() => renderApp(spec), [renderApp, spec]);
  // Scroll mode lets the person move the app itself instead of picking parts. It ends with the studio.
  const [scroll, setScroll] = useState(false);
  useEffect(() => {
    if (!active) setScroll(false);
  }, [active]);
  return (
    <View style={styles.root}>
      {/* The tools sit in their own bar above the app, so nothing floats over the part being arranged. */}
      {active ? <StudioBar scroll={scroll} onScroll={setScroll} onClose={layer.onClose} /> : null}
      <View style={styles.root}>
        <ComponentBoundsProvider registry={registry} tracking={active}>{app}</ComponentBoundsProvider>
        {active ? <StudioLayer spec={spec} registry={registry} scroll={scroll} {...layer} /> : null}
      </View>
    </View>
  );
}

/** What to do (one line) and the two tools: Scroll mode and Done. Left-handed mode puts the tools on the left. */
function StudioBar({ scroll, onScroll, onClose }: { scroll: boolean; onScroll: (next: boolean) => void; onClose: () => void }) {
  const k = useKalamTheme();
  const t = useT(k.uiLanguage);
  const reduced = useReducedMotion();
  const tools = (
    <View accessibilityRole="toolbar" aria-label={t('visualStudio.toolbar')} style={{ flexDirection: 'row', gap: k.space[1] }}>
      <IconButton icon={Hand} label={t('visualStudio.scroll')} selected={scroll} onPress={() => onScroll(!scroll)} />
      <IconButton icon={X} label={t('visualStudio.stop')} onPress={onClose} />
    </View>
  );
  const hint = (
    <View accessibilityLiveRegion="polite" style={{ flex: 1, paddingHorizontal: k.space[2] }}>
      <Text variant="caption" tone="secondary">{t(scroll ? 'visualStudio.hint.scroll' : 'visualStudio.hint.select')}</Text>
    </View>
  );
  const left = k.accessModes.leftHanded;
  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(160)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: k.space[2], paddingHorizontal: k.space[2], minHeight: k.touchTarget + 8,
        backgroundColor: k.colors.surface, borderBottomWidth: 1, borderBottomColor: k.colors.border,
      }}
    >
      {left ? tools : hint}
      {left ? hint : tools}
    </Animated.View>
  );
}

type LayerProps = Pick<VisualStudioProps, 'spec' | 'onChange' | 'onClose' | 'onUndo' | 'hasEntries'> & { registry: ComponentBoundsRegistry; scroll: boolean };

function StudioLayer({ spec, registry, scroll, onChange, onUndo, hasEntries }: LayerProps) {
  const k = useKalamTheme();
  const t = useT(k.uiLanguage);
  const reduced = useReducedMotion();
  const toast = useToast();
  const originRef = useRef<ComponentRef<typeof View>>(null);
  const chips = useRef(new Map<string, Rect>());

  const [rects, setRects] = useState<ReadonlyMap<string, BoundsRect>>(EMPTY);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [more, setMore] = useState(false);
  const [moving, setMoving] = useState<{ dx: number; dy: number } | null>(null);
  const [liveSize, setLiveSize] = useState<StyleSize | null>(null);

  // ── Measuring: the layer exists only while it is on ────────────────────────
  const measure = useCallback(async () => {
    const node: MeasurableNode | null = originRef.current;
    if (node) setRects(await registry.measure(node));
  }, [registry]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        void measure();
      });
    };
    const off = registry.subscribe(schedule);
    schedule();
    return () => {
      off();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [registry, measure]);

  // Scrolling the app moves its parts without a layout event: measure again when Scroll mode ends.
  useEffect(() => {
    if (scroll) {
      setSelected(null);
      setRenaming(false);
    } else void measure();
  }, [scroll, measure]);

  const screen = useMemo(() => shownScreen(spec, rects), [spec, rects]);
  const parts = useMemo(() => visibleParts(screen, rects, area.height), [screen, rects, area.height]);
  const sel = selected ? findPart(spec, selected) : undefined;
  const selRect = selected && parts.some((p) => p.id === selected) ? rects.get(selected) : undefined;

  // A part that is gone (undo, a move to another screen) or off this screen is no longer selected.
  useEffect(() => {
    if (selected && (!sel || (screen && sel.screen.id !== screen.id))) {
      setSelected(null);
      setRenaming(false);
    }
  }, [selected, sel, screen]);

  // ── Changes ────────────────────────────────────────────────────────────────
  const apply = useCallback(
    (r: DirectResult) => {
      if (!r.ok) {
        if (r.reason !== 'same') toast.show({ message: t(FAIL_KEY[r.reason]), tone: 'danger' });
        return;
      }
      const summary = summaryOf(t, r);
      onChange(r.spec, summary);
      if (r.kind === 'movedToScreen') {
        setSelected(null);
        setRenaming(false);
        toast.show({ message: summary, tone: 'success', ...(onUndo ? { action: { label: t('common.undo'), onPress: onUndo } } : {}) });
      } else if (r.kind === 'duplicated') setSelected(r.component);
    },
    [onChange, onUndo, t, toast],
  );

  const dropAt = (dx: number, dy: number): DropTarget | undefined => {
    if (!selected || !selRect) return undefined;
    const at = { x: selRect.x + selRect.width / 2 + dx, y: selRect.y + selRect.height / 2 + dy };
    return dropTargetAt(at, parts, selected, [...chips.current].map(([s, rect]) => ({ screen: s, rect })));
  };
  const endMove = (dx: number, dy: number) => {
    const target = dropAt(dx, dy);
    setMoving(null);
    if (!selected || !sel || !target) return;
    if (target.kind === 'slot') apply(moveComponentTo(spec, selected, { screen: sel.screen.id, before: target.before }));
    else if (target.kind === 'screen') apply(moveComponentTo(spec, selected, { screen: target.screen, before: null }));
  };
  const endResize = (size: StyleSize) => {
    setLiveSize(null);
    if (selected) apply(resizeComponent(spec, selected, size));
  };
  const rename = (text: string) => {
    setRenaming(false);
    if (selected && text.trim()) apply(renameComponentLabel(spec, selected, text));
  };

  const target = moving ? dropAt(moving.dx, moving.dy) : undefined;
  const line = target?.kind === 'slot' && selected ? slotLine(parts, target.before, selected) : undefined;
  const others = sel ? spec.screens.filter((s) => s.id !== sel.screen.id) : [];
  const canCrossScreens = !!sel && !staysOnScreen(spec, sel.component) && others.length > 0;
  const hasLabel = !!sel && 'label' in sel.component && typeof sel.component.label === 'string';
  const fade = (ms: number) => (reduced ? undefined : FadeIn.duration(ms));

  return (
    <View
      ref={originRef}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) => {
        setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
        registry.invalidate();
      }}
    >
      {!scroll
        ? parts.map((p) => {
            const c = findPart(spec, p.id)?.component;
            if (!c) return null;
            const on = p.id === selected;
            const name = nameOf(c);
            const noun = t(NOUN_KEY[nounOf(c)]);
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={name ? `${noun}: ${name}` : noun}
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setSelected(p.id);
                  setRenaming(false);
                }}
                style={[
                  styles.abs,
                  { left: p.rect.x - OUTSET, top: p.rect.y - OUTSET, width: p.rect.width + OUTSET * 2, height: p.rect.height + OUTSET * 2 },
                  !on && { borderWidth: 1, borderStyle: 'dashed', borderColor: withAlpha(k.colors.primary, 0.4), borderRadius: k.radius.md },
                ]}
              />
            );
          })
        : null}

      {!scroll && sel && selRect && !renaming ? (
        <SelectionBox
          rect={selRect}
          tag={nameOf(sel.component) || t(NOUN_KEY[nounOf(sel.component)])}
          offset={moving}
          size={sizeOf(sel.component)}
          live={liveSize}
          liveText={liveSize ? t(SIZE_KEY[liveSize]) : undefined}
          handleLabel={t('visualStudio.size.handle')}
          sizeText={t(SIZE_KEY[liveSize ?? sizeOf(sel.component)])}
          fade={fade}
          onTap={() => hasLabel && setRenaming(true)}
          onMove={(dx, dy) => setMoving({ dx, dy })}
          onMoveEnd={endMove}
          onCancel={() => { setMoving(null); setLiveSize(null); }}
          onResize={setLiveSize}
          onResizeEnd={endResize}
        />
      ) : null}

      {line ? <View pointerEvents="none" style={[styles.abs, { left: line.x, top: line.y, width: line.width, height: 3, borderRadius: 2, backgroundColor: k.colors.primary }]} /> : null}

      {renaming && sel && selRect ? (
        <InlineName
          rect={selRect}
          initial={'label' in sel.component && typeof sel.component.label === 'string' ? sel.component.label : ''}
          label={t('visualStudio.nameLabel')}
          onDone={rename}
          onCancel={() => setRenaming(false)}
        />
      ) : null}

      {moving && canCrossScreens ? (
        <View pointerEvents="none" style={[styles.chips, { top: CHIP_TOP, left: CHIP_LEFT, right: 64, gap: k.space[2] }]}>
          <Text variant="caption" weight="medium" style={{ width: '100%' }}>{t('visualStudio.dropOnScreen')}</Text>
          {others.map((s) => {
            const hot = target?.kind === 'screen' && target.screen === s.id;
            return (
              <View
                key={s.id}
                onLayout={(e) => {
                  const l = e.nativeEvent.layout;
                  chips.current.set(s.id, { x: CHIP_LEFT + l.x, y: CHIP_TOP + l.y, width: l.width, height: l.height });
                }}
                style={{
                  minHeight: 36, paddingHorizontal: k.space[3], justifyContent: 'center', borderRadius: k.radius.press, borderWidth: 1,
                  borderColor: hot ? k.colors.primary : k.colors.borderStrong,
                  backgroundColor: hot ? k.colors.primary : k.colors.surfaceElevated,
                }}
              >
                <Text variant="bodySmall" weight="medium" tone={hot ? 'onPrimary' : undefined} numberOfLines={1}>{s.title}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {sel && selected && !scroll && !moving ? (
        <Animated.View entering={fade(160)} style={[styles.abs, { left: k.space[2], right: k.space[2], bottom: k.space[2] }]}>
          <Inspector
            spec={spec}
            id={selected}
            expanded={more}
            onExpanded={setMore}
            onResult={apply}
            onRename={() => hasLabel && setRenaming(true)}
            onClose={() => { setSelected(null); setRenaming(false); }}
            hasEntries={hasEntries}
            liveSize={liveSize}
            maxHeight={Math.max(180, area.height * 0.6)}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

// ─── The selected part: drag it, drag its corner ──────────────────────────────
interface SelectionBoxProps {
  rect: BoundsRect;
  tag: string;
  /** How far the part is dragged right now. */
  offset: { dx: number; dy: number } | null;
  size: StyleSize;
  live: StyleSize | null;
  liveText?: string;
  handleLabel: string;
  sizeText: string;
  fade(ms: number): ReturnType<typeof FadeIn.duration> | undefined;
  onTap(): void;
  onMove(dx: number, dy: number): void;
  onMoveEnd(dx: number, dy: number): void;
  onCancel(): void;
  onResize(size: StyleSize): void;
  onResizeEnd(size: StyleSize): void;
}

function SelectionBox(props: SelectionBoxProps) {
  const { rect, tag, offset, live, liveText, handleLabel, sizeText, fade } = props;
  const { colors, radius, space } = useKalamTheme();
  // The responders are made once; they read the newest props through this ref.
  const cb = useRef(props);
  cb.current = props;
  const dragged = useRef(false);
  const startSize = useRef<StyleSize>(props.size);

  const body = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => {
          if (dragged.current || exceedsSlop(g.dx, g.dy)) {
            dragged.current = true;
            cb.current.onMove(g.dx, g.dy);
          }
        },
        onPanResponderRelease: (_e, g) => {
          if (dragged.current) cb.current.onMoveEnd(g.dx, g.dy);
          else cb.current.onTap();
          dragged.current = false;
        },
        onPanResponderTerminate: () => {
          dragged.current = false;
          cb.current.onCancel();
        },
      }),
    [],
  );

  const corner = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startSize.current = cb.current.size;
        },
        // Outward (right and down) is bigger. One step every SIZE_STEP px; nothing is saved until the finger lifts.
        onPanResponderMove: (_e, g) => cb.current.onResize(sizeFromDrag(startSize.current, (g.dx + g.dy) / 2)),
        onPanResponderRelease: (_e, g) => cb.current.onResizeEnd(sizeFromDrag(startSize.current, (g.dx + g.dy) / 2)),
        onPanResponderTerminate: () => cb.current.onCancel(),
      }),
    [],
  );

  // Screen readers step the size with increment and decrement instead of dragging.
  const step = (dir: 1 | -1) => {
    const i = STYLE_SIZES.indexOf(props.size) + dir;
    const next = STYLE_SIZES[i];
    if (next) props.onResizeEnd(next);
  };

  const box = { left: rect.x - OUTSET, top: rect.y - OUTSET, width: rect.width + OUTSET * 2, height: rect.height + OUTSET * 2 };
  return (
    <Animated.View
      entering={fade(120)}
      {...body.panHandlers}
      style={[
        styles.abs, box,
        {
          borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: withAlpha(colors.primary, offset ? 0.16 : 0.08),
          zIndex: 5, transform: offset ? [{ translateX: offset.dx }, { translateY: offset.dy }] : [],
        },
      ]}
    >
      <View
        pointerEvents="none"
        style={[styles.tag, { backgroundColor: colors.primary, top: box.top >= 28 ? -28 : 4, left: -2, borderRadius: radius.md }]}
      >
        <Text variant="caption" tone="onPrimary" numberOfLines={1}>{tag}</Text>
      </View>
      <View
        {...corner.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={handleLabel}
        accessibilityValue={{ text: sizeText }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        style={{ position: 'absolute', right: -HANDLE / 2, bottom: -HANDLE / 2, width: HANDLE, height: HANDLE, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.surface, backgroundColor: colors.primary }} />
      </View>
      {live ? (
        <View pointerEvents="none" style={[styles.tag, { right: space[2], bottom: space[2], backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md }]}>
          <Text variant="caption" weight="semibold" numberOfLines={1}>{liveText}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

// ─── Rename in place ──────────────────────────────────────────────────────────
function InlineName({ rect, initial, label, onDone, onCancel }: {
  rect: BoundsRect; initial: string; label: string; onDone(text: string): void; onCancel(): void;
}) {
  const { colors, radius, space, touchTarget } = useKalamTheme();
  const [text, setText] = useState(initial);
  const finished = useRef(false);
  const finish = (commit: boolean) => {
    if (finished.current) return; // Enter is followed by a blur
    finished.current = true;
    if (commit) onDone(text);
    else onCancel();
  };
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      autoFocus
      selectTextOnFocus
      accessibilityLabel={label}
      maxLength={LIMITS.labelLength}
      returnKeyType="done"
      onSubmitEditing={() => finish(true)}
      onBlur={() => finish(true)}
      onKeyPress={(e) => {
        if (e.nativeEvent.key === 'Escape') finish(false);
      }}
      style={{
        position: 'absolute', left: rect.x, top: rect.y, width: Math.max(rect.width, 160), minHeight: Math.max(rect.height, touchTarget), zIndex: 6,
        paddingHorizontal: space[3], borderRadius: radius.md, borderWidth: 2, borderColor: colors.focusRing, fontSize: 16,
        backgroundColor: colors.surface, color: colors.text,
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  abs: { position: 'absolute' },
  chips: { position: 'absolute', flexDirection: 'row', flexWrap: 'wrap' },
  tag: { position: 'absolute', height: 24, maxWidth: 220, paddingHorizontal: 8, justifyContent: 'center' },
});
