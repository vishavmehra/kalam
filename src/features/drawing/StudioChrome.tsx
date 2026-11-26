/**
 * Drawing Studio chrome (docs/08 §3, docs/02 §11.4): tool palette, properties, save status, history
 * and zoom. Every control reads/writes the studio store; the canvas stays separate. Selection
 * controls live in SelectionPanel.tsx and the screen manager in PageStrip.tsx.
 */
import {
  Brush, Circle, Component, Eraser, Highlighter, ImagePlus, Keyboard, Maximize, Minus, MousePointer2, MoveUpRight, Pen, Redo2, Square,
  Type, Undo2, ZoomIn, ZoomOut, type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Button, Chip, IconButton, Text, TextField, Tooltip, fontFamily, useKalamTheme, useRovingFocus, webData } from '@/design';
import { STAMPS, type StampComponent } from './model';
import { SelectionPanel } from './SelectionPanel';
import {
  canRedoStudio, canUndoStudio, COLOR_NAMES, COLORS, SIZES, TOOL_LABELS, type SaveStatus, type StudioState, type Tool,
} from './studio-store';
import { ColourDot } from './ColourDot';
import { useAddPhoto } from './use-add-photo';
import { t as gt } from '@/i18n/active';
import { toolLabel } from './studio-text';

export { PageStrip } from './PageStrip';
type Store = StoreApi<StudioState>;

export const TOOLS: ReadonlyArray<{ id: Tool; label: string; icon: LucideIcon; key?: string }> = [
  { id: 'select', label: TOOL_LABELS.select, icon: MousePointer2, key: 'V' },
  { id: 'pen', label: TOOL_LABELS.pen, icon: Pen, key: 'P' },
  { id: 'marker', label: TOOL_LABELS.marker, icon: Brush, key: 'M' },
  { id: 'highlighter', label: TOOL_LABELS.highlighter, icon: Highlighter, key: 'H' },
  { id: 'eraser', label: TOOL_LABELS.eraser, icon: Eraser, key: 'E' },
  { id: 'rect', label: TOOL_LABELS.rect, icon: Square, key: 'R' },
  { id: 'ellipse', label: TOOL_LABELS.ellipse, icon: Circle, key: 'O' },
  { id: 'line', label: TOOL_LABELS.line, icon: Minus, key: 'L' },
  { id: 'arrow', label: TOOL_LABELS.arrow, icon: MoveUpRight, key: 'A' },
  { id: 'text', label: TOOL_LABELS.text, icon: Type, key: 'T' },
  { id: 'stamp', label: TOOL_LABELS.stamp, icon: Component },
];
const SIZE_KEYS = ['studio.sizeFine', 'studio.sizeMedium', 'studio.sizeBold', 'studio.sizeHeavy'] as const;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function ToolPalette({ store, direction }: { store: Store; direction: 'column' | 'row' }) {
  const tool = useStore(store, (s) => s.tool);
  const { space } = useKalamTheme();
  const buttons = TOOLS.map((t) => {
    const label = t.key ? `${toolLabel(t.id)} (${t.key})` : toolLabel(t.id);
    return (
      <Tooltip key={t.id} label={label} placement={direction === 'column' ? 'bottom' : 'top'}>
        <IconButton icon={t.icon} label={label} selected={tool === t.id} onPress={() => store.getState().setTool(t.id)} />
      </Tooltip>
    );
  });
  if (direction === 'column') {
    return <View role="toolbar" aria-label={gt('studio.toolsLabel')} style={{ gap: space[1], alignItems: 'center' }}>{buttons}</View>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} role="toolbar" aria-label={gt('studio.toolsLabel')} contentContainerStyle={{ gap: space[1], paddingHorizontal: space[1] }}>
      {buttons}
    </ScrollView>
  );
}

function Swatch({ value, name, selected, onPress, rovingProps }: { value: string; name: string; selected: boolean; onPress: () => void; rovingProps?: object }) {
  const { touchTarget } = useKalamTheme();
  return (
    <Pressable
      role="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
      onPress={onPress}
      {...rovingProps}
      {...webData({ kPress: '' })}
      style={{ width: touchTarget - 4, height: touchTarget - 4, alignItems: 'center', justifyContent: 'center' }}
    >
      <ColourDot value={value} selected={selected} />
    </Pressable>
  );
}

function Swatches({ store }: { store: Store }) {
  const { space } = useKalamTheme();
  const color = useStore(store, (s) => s.color);
  const recent = useStore(store, (s) => s.recentColors);
  // Arrow keys move through the colours and choose one (a radio group on the web); Tab leaves the group.
  const all = [...COLORS, ...recent];
  const roving = useRovingFocus({ count: all.length, orientation: 'both', current: Math.max(0, all.indexOf(color)), onMove: (i) => store.getState().setColor(all[i]!) });
  return (
    <View style={{ gap: space[2] }}>
      <View role="radiogroup" aria-label={gt('studio.colour')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
        {COLORS.map((c, i) => (
          <Swatch key={c} value={c} name={COLOR_NAMES[c] ?? c} selected={c === color} onPress={() => store.getState().setColor(c)} rovingProps={roving.itemProps(i)} />
        ))}
        {recent.map((c, i) => (
          <Swatch key={c} value={c} name={gt('studio.recentColour', { colour: c })} selected={c === color} onPress={() => store.getState().setColor(c)} rovingProps={roving.itemProps(COLORS.length + i)} />
        ))}
      </View>
      <CustomColour store={store} current={color} />
    </View>
  );
}

/** Any colour by hex, kept in the recent list once used (docs/08 §7.10). */
function CustomColour({ store, current }: { store: Store; current: string }) {
  const [text, setText] = useLocalText(current);
  const invalid = text.length > 1 && !HEX.test(text);
  return (
    <TextField
      label={gt('studio.customColour')}
      value={text}
      onChangeText={(v) => {
        const next = v.startsWith('#') || v === '' ? v : `#${v}`;
        setText(next);
        if (HEX.test(next)) store.getState().setColor(next.length === 4 ? `#${[1, 2, 3].map((i) => next[i]! + next[i]!).join('')}` : next);
      }}
      placeholder="#1E88E5"
      autoCapitalize="characters"
      autoCorrect={false}
      maxLength={7}
      error={invalid ? gt('studio.customColourError') : undefined}
    />
  );
}

/** Text box value that follows the chosen colour but lets the person type freely. */
function useLocalText(current: string): [string, (v: string) => void] {
  const [text, setText] = useState(current);
  // When the stored value changes (undo, another page), take it over. Done while rendering, as React advises, not in an effect.
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setText(current);
  }
  return [text, setText];
}

function Sizes({ store }: { store: Store }) {
  const size = useStore(store, (s) => s.size);
  const { space } = useKalamTheme();
  const roving = useRovingFocus({ count: SIZES.length, orientation: 'both', current: Math.max(0, (SIZES as readonly number[]).indexOf(size)), onMove: (i) => store.getState().setSize(SIZES[i]!) });
  return (
    <View role="radiogroup" aria-label={gt('studio.size')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {SIZES.map((v, i) => (
        <Chip key={v} label={gt(SIZE_KEYS[i]!)} role="radio" selected={size === v} onPress={() => store.getState().setSize(v)} rovingProps={roving.itemProps(i)} />
      ))}
    </View>
  );
}

function StampPicker({ store }: { store: Store }) {
  const stamp = useStore(store, (s) => s.stamp);
  const tool = useStore(store, (s) => s.tool);
  const { space } = useKalamTheme();
  const chosen = tool === 'stamp' ? STAMPS.findIndex((d) => d.component === stamp) : -1;
  const roving = useRovingFocus({ count: STAMPS.length, orientation: 'both', current: Math.max(0, chosen), onMove: (i) => store.getState().setStamp(STAMPS[i]!.component as StampComponent) });
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="bodySmall" tone="secondary">{gt('studio.stampHint')}</Text>
      <View role="radiogroup" aria-label={gt('studio.stampGroup')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {STAMPS.map((d, i) => (
          <Chip
            key={d.component}
            label={d.name}
            role="radio"
            selected={tool === 'stamp' && stamp === d.component}
            onPress={() => store.getState().setStamp(d.component as StampComponent)}
            rovingProps={roving.itemProps(i)}
          />
        ))}
      </View>
    </View>
  );
}

/** Add things without dragging: for people who cannot place a shape precisely (docs/10 §10.3). */
function InsertPanel({ store }: { store: Store }) {
  const { space } = useKalamTheme();
  const photo = useAddPhoto(store);
  const a = store.getState();
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="bodySmall" weight="semibold" tone="secondary">{gt('studio.addToScreen')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Button label={gt('studio.add.box')} variant="outline" size="sm" icon={Square} onPress={() => a.insertShape('rect')} />
        <Button label={gt('studio.add.circle')} variant="outline" size="sm" icon={Circle} onPress={() => a.insertShape('ellipse')} />
        <Button label={gt('studio.add.arrow')} variant="outline" size="sm" icon={MoveUpRight} onPress={() => a.insertShape('arrow')} />
        <Button label={gt('studio.add.label')} variant="outline" size="sm" icon={Type} onPress={() => a.insertShape('text')} />
        <Button label={gt('studio.add.photo')} variant="outline" size="sm" icon={ImagePlus} loading={photo.busy} onPress={() => { void photo.add(); }} />
      </View>
    </View>
  );
}

/** Colour, size, stamps and selected-object settings (right panel on desktop, sheet on phones). */
export function PropertiesPanel({ store, onReadHandwriting }: { store: Store; onReadHandwriting?: () => void }) {
  const { space } = useKalamTheme();
  const tool = useStore(store, (s) => s.tool);
  const showStyle = tool !== 'stamp' && tool !== 'eraser';
  return (
    <View style={{ gap: space[6] }}>
      {tool === 'stamp' ? <StampPicker store={store} /> : null}
      {tool === 'select' ? <SelectionPanel store={store} onReadHandwriting={onReadHandwriting} /> : null}
      {showStyle ? (
        <>
          <View style={{ gap: space[2] }}>
            <Text variant="bodySmall" weight="semibold" tone="secondary">{gt('studio.colour')}</Text>
            <Swatches store={store} />
          </View>
          <View style={{ gap: space[2] }}>
            <Text variant="bodySmall" weight="semibold" tone="secondary">{tool === 'text' ? gt('studio.textSize') : gt('studio.size')}</Text>
            <Sizes store={store} />
          </View>
        </>
      ) : null}
      {tool === 'eraser' ? (
        <Text variant="bodySmall" tone="muted">{gt('studio.eraserHint')}</Text>
      ) : null}
      {tool !== 'stamp' ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" weight="semibold" tone="secondary">{gt('studio.stampsHeading')}</Text>
          <StampPicker store={store} />
        </View>
      ) : null}
      <InsertPanel store={store} />
    </View>
  );
}

const saveText = (s: SaveStatus | 'restoring'): string => gt(`studio.save.${s}` as const);

export function SaveIndicator({ store }: { store: Store }) {
  const status = useStore(store, (s) => (s.loaded ? s.saveStatus : 'restoring'));
  const { colors, space } = useKalamTheme();
  const dot = status === 'saved' ? colors.success : status === 'error' ? colors.danger : colors.warning;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }} accessibilityLiveRegion="polite" accessibilityLabel={saveText(status)}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      <Text variant="caption" tone="secondary">{saveText(status)}</Text>
    </View>
  );
}

export function HistoryButtons({ store }: { store: Store }) {
  const canUndo = useStore(store, canUndoStudio);
  const canRedo = useStore(store, canRedoStudio);
  return (
    <>
      <Tooltip label={gt('studio.undo')} placement="bottom"><IconButton icon={Undo2} label={gt('studio.undo')} disabled={!canUndo} onPress={() => store.getState().undo()} /></Tooltip>
      <Tooltip label={gt('studio.redo')} placement="bottom"><IconButton icon={Redo2} label={gt('studio.redo')} disabled={!canRedo} onPress={() => store.getState().redo()} /></Tooltip>
    </>
  );
}

/** Opens the keyboard shortcut list (the same as pressing ?). Only useful with a keyboard, so the screen shows it on wide windows. */
export function ShortcutsButton({ onPress }: { onPress: () => void }) {
  return (
    <Tooltip label={gt('studio.shortcuts.button')} placement="bottom">
      <IconButton icon={Keyboard} label={gt('studio.shortcuts.button')} onPress={onPress} testID="studio-shortcuts-button" />
    </Tooltip>
  );
}

export function ZoomControls({ store }: { store: Store }) {
  const scale = useStore(store, (s) => s.view.scale);
  return (
    <>
      <Tooltip label={gt('studio.zoomOut')} placement="bottom"><IconButton icon={ZoomOut} label={gt('studio.zoomOut')} onPress={() => store.getState().zoomBy(1 / 1.2)} /></Tooltip>
      <Text variant="caption" tone="secondary" numeric style={{ minWidth: 40, textAlign: 'center' }}>{Math.round(scale * 100)}%</Text>
      <Tooltip label={gt('studio.zoomIn')} placement="bottom"><IconButton icon={ZoomIn} label={gt('studio.zoomIn')} onPress={() => store.getState().zoomBy(1.2)} /></Tooltip>
      <Tooltip label={gt('studio.fitView')} placement="bottom"><IconButton icon={Maximize} label={gt('studio.fitView')} onPress={() => store.getState().fitPage()} /></Tooltip>
    </>
  );
}

/** Zoom buttons floating over the canvas for touch screens, where pinching is not always possible (docs/08 §8.3). */
export function FloatingZoom({ store, side }: { store: Store; side: 'left' | 'right' }) {
  const { colors, space, radius, elevation, scheme } = useKalamTheme();
  return (
    <View
      role="toolbar"
      aria-label={gt('studio.zoom')}
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute', bottom: space[3], [side]: space[3], borderRadius: radius.lg, padding: 2,
          backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border,
        },
        scheme === 'light' ? elevation[2] : null,
      ]}
    >
      <IconButton icon={ZoomIn} label={gt('studio.zoomIn')} onPress={() => store.getState().zoomBy(1.25)} />
      <IconButton icon={ZoomOut} label={gt('studio.zoomOut')} onPress={() => store.getState().zoomBy(1 / 1.25)} />
      <IconButton icon={Maximize} label={gt('studio.fitView')} onPress={() => store.getState().fitPage()} />
    </View>
  );
}

export function TitleInput({ store }: { store: Store }) {
  const title = useStore(store, (s) => s.history.present.title);
  const { colors, fontScale, radius } = useKalamTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={title}
      onChangeText={(t) => store.getState().setTitle(t)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityLabel={gt('studio.drawingName')}
      maxLength={60}
      style={{
        flex: 1, minWidth: 48, minHeight: 36, paddingHorizontal: 4, color: colors.text, fontFamily: fontFamily('semibold'), fontSize: 17 * fontScale,
        borderBottomWidth: 2.5, borderBottomColor: focused ? colors.focusRing : 'transparent', borderRadius: radius.sm, outlineStyle: 'none',
      } as object}
    />
  );
}
