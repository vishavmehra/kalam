/**
 * Drawing Studio chrome (docs/08 §3, docs/02 §11.4): tool palette, properties, save status, history
 * and zoom. Every control reads/writes the studio store; the canvas stays separate. Selection
 * controls live in SelectionPanel.tsx and the screen manager in PageStrip.tsx.
 */
import {
  Brush, Circle, Component, Eraser, Highlighter, ImagePlus, Maximize, Minus, MousePointer2, MoveUpRight, Pen, Redo2, Square,
  Type, Undo2, ZoomIn, ZoomOut, type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Button, Chip, IconButton, Text, TextField, fontFamily, useKalamTheme, webData } from '@/design';
import { STAMPS, type StampComponent } from './model';
import { SelectionPanel } from './SelectionPanel';
import {
  canRedoStudio, canUndoStudio, COLOR_NAMES, COLORS, SIZES, TOOL_LABELS, type SaveStatus, type StudioState, type Tool,
} from './studio-store';
import { useAddPhoto } from './use-add-photo';

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
const SIZE_NAMES = ['Fine', 'Medium', 'Bold', 'Heavy'];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function ToolPalette({ store, direction }: { store: Store; direction: 'column' | 'row' }) {
  const tool = useStore(store, (s) => s.tool);
  const { space } = useKalamTheme();
  const buttons = TOOLS.map((t) => (
    <IconButton
      key={t.id}
      icon={t.icon}
      label={t.key ? `${t.label} (${t.key})` : t.label}
      selected={tool === t.id}
      onPress={() => store.getState().setTool(t.id)}
    />
  ));
  if (direction === 'column') {
    return <View role="toolbar" aria-label="Drawing tools" style={{ gap: space[1], alignItems: 'center' }}>{buttons}</View>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} role="toolbar" aria-label="Drawing tools" contentContainerStyle={{ gap: space[1], paddingHorizontal: space[1] }}>
      {buttons}
    </ScrollView>
  );
}

function Swatch({ value, name, selected, onPress }: { value: string; name: string; selected: boolean; onPress: () => void }) {
  const { colors, touchTarget } = useKalamTheme();
  return (
    <Pressable
      role="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
      onPress={onPress}
      {...webData({ kPress: '' })}
      style={{ width: touchTarget - 4, height: touchTarget - 4, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          width: 28, height: 28, borderRadius: 14, backgroundColor: value,
          borderWidth: selected ? 3 : 1, borderColor: selected ? colors.focusRing : colors.border,
        }}
      />
    </Pressable>
  );
}

function Swatches({ store }: { store: Store }) {
  const { space } = useKalamTheme();
  const color = useStore(store, (s) => s.color);
  const recent = useStore(store, (s) => s.recentColors);
  return (
    <View style={{ gap: space[2] }}>
      <View role="radiogroup" aria-label="Colour" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
        {COLORS.map((c) => (
          <Swatch key={c} value={c} name={COLOR_NAMES[c] ?? c} selected={c === color} onPress={() => store.getState().setColor(c)} />
        ))}
        {recent.map((c) => (
          <Swatch key={c} value={c} name={`Recent colour ${c}`} selected={c === color} onPress={() => store.getState().setColor(c)} />
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
      label="Custom colour"
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
      error={invalid ? 'Use three or six letters or numbers after the #.' : undefined}
    />
  );
}

/** Text box value that follows the chosen colour but lets the person type freely. */
function useLocalText(current: string): [string, (v: string) => void] {
  const [text, setText] = useState(current);
  useEffect(() => { setText(current); }, [current]);
  return [text, setText];
}

function Sizes({ store }: { store: Store }) {
  const size = useStore(store, (s) => s.size);
  const { space } = useKalamTheme();
  return (
    <View role="radiogroup" aria-label="Size" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {SIZES.map((v, i) => (
        <Chip key={v} label={SIZE_NAMES[i]!} role="radio" selected={size === v} onPress={() => store.getState().setSize(v)} />
      ))}
    </View>
  );
}

function StampPicker({ store }: { store: Store }) {
  const stamp = useStore(store, (s) => s.stamp);
  const tool = useStore(store, (s) => s.tool);
  const { space } = useKalamTheme();
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="bodySmall" tone="secondary">Tap the page to place. Stamps tell Kalam exactly which component you mean.</Text>
      <View role="radiogroup" aria-label="Component stamp" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {STAMPS.map((d) => (
          <Chip
            key={d.component}
            label={d.name}
            role="radio"
            selected={tool === 'stamp' && stamp === d.component}
            onPress={() => store.getState().setStamp(d.component as StampComponent)}
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
      <Text variant="bodySmall" weight="semibold" tone="secondary">Add to this screen</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Button label="Box" variant="outline" size="sm" icon={Square} onPress={() => a.insertShape('rect')} />
        <Button label="Circle" variant="outline" size="sm" icon={Circle} onPress={() => a.insertShape('ellipse')} />
        <Button label="Arrow" variant="outline" size="sm" icon={MoveUpRight} onPress={() => a.insertShape('arrow')} />
        <Button label="Label" variant="outline" size="sm" icon={Type} onPress={() => a.insertShape('text')} />
        <Button label="Photo" variant="outline" size="sm" icon={ImagePlus} loading={photo.busy} onPress={() => { void photo.add(); }} />
      </View>
    </View>
  );
}

/** Colour, size, stamps and selected-object settings (right panel on desktop, sheet on phones). */
export function PropertiesPanel({ store }: { store: Store }) {
  const { space } = useKalamTheme();
  const tool = useStore(store, (s) => s.tool);
  const showStyle = tool !== 'stamp' && tool !== 'eraser';
  return (
    <View style={{ gap: space[6] }}>
      {tool === 'stamp' ? <StampPicker store={store} /> : null}
      {tool === 'select' ? <SelectionPanel store={store} /> : null}
      {showStyle ? (
        <>
          <View style={{ gap: space[2] }}>
            <Text variant="bodySmall" weight="semibold" tone="secondary">Colour</Text>
            <Swatches store={store} />
          </View>
          <View style={{ gap: space[2] }}>
            <Text variant="bodySmall" weight="semibold" tone="secondary">{tool === 'text' ? 'Text size' : 'Size'}</Text>
            <Sizes store={store} />
          </View>
        </>
      ) : null}
      {tool === 'eraser' ? (
        <Text variant="bodySmall" tone="muted">Drag across a pen stroke to rub out the part you touch. Shapes and text are erased whole. Undo brings it back.</Text>
      ) : null}
      {tool !== 'stamp' ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" weight="semibold" tone="secondary">Component stamps</Text>
          <StampPicker store={store} />
        </View>
      ) : null}
      <InsertPanel store={store} />
    </View>
  );
}

const SAVE_TEXT: Record<SaveStatus | 'restoring', string> = {
  saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Not saved. Trying again', restoring: 'Opening your drawing…',
};

export function SaveIndicator({ store }: { store: Store }) {
  const status = useStore(store, (s) => (s.loaded ? s.saveStatus : 'restoring'));
  const { colors, space } = useKalamTheme();
  const dot = status === 'saved' ? colors.success : status === 'error' ? colors.danger : colors.warning;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }} accessibilityLiveRegion="polite" accessibilityLabel={SAVE_TEXT[status]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      <Text variant="caption" tone="secondary">{SAVE_TEXT[status]}</Text>
    </View>
  );
}

export function HistoryButtons({ store }: { store: Store }) {
  const canUndo = useStore(store, canUndoStudio);
  const canRedo = useStore(store, canRedoStudio);
  return (
    <>
      <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!canUndo} onPress={() => store.getState().undo()} />
      <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onPress={() => store.getState().redo()} />
    </>
  );
}

export function ZoomControls({ store }: { store: Store }) {
  const scale = useStore(store, (s) => s.view.scale);
  return (
    <>
      <IconButton icon={ZoomOut} label="Zoom out" onPress={() => store.getState().zoomBy(1 / 1.2)} />
      <Text variant="caption" tone="secondary" numeric style={{ minWidth: 40, textAlign: 'center' }}>{Math.round(scale * 100)}%</Text>
      <IconButton icon={ZoomIn} label="Zoom in" onPress={() => store.getState().zoomBy(1.2)} />
      <IconButton icon={Maximize} label="Fit screen to view" onPress={() => store.getState().fitPage()} />
    </>
  );
}

/** Zoom buttons floating over the canvas for touch screens, where pinching is not always possible (docs/08 §8.3). */
export function FloatingZoom({ store, side }: { store: Store; side: 'left' | 'right' }) {
  const { colors, space, radius, elevation, scheme } = useKalamTheme();
  return (
    <View
      role="toolbar"
      aria-label="Zoom"
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute', bottom: space[3], [side]: space[3], borderRadius: radius.lg, padding: 2,
          backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border,
        },
        scheme === 'light' ? elevation[2] : null,
      ]}
    >
      <IconButton icon={ZoomIn} label="Zoom in" onPress={() => store.getState().zoomBy(1.25)} />
      <IconButton icon={ZoomOut} label="Zoom out" onPress={() => store.getState().zoomBy(1 / 1.25)} />
      <IconButton icon={Maximize} label="Fit screen to view" onPress={() => store.getState().fitPage()} />
    </View>
  );
}

export function TitleInput({ store }: { store: Store }) {
  const title = useStore(store, (s) => s.history.present.title);
  const { colors, fontScale } = useKalamTheme();
  return (
    <TextInput
      value={title}
      onChangeText={(t) => store.getState().setTitle(t)}
      accessibilityLabel="Drawing name"
      maxLength={60}
      style={{ flex: 1, minWidth: 80, color: colors.text, fontFamily: fontFamily('semibold'), fontSize: 17 * fontScale, outlineStyle: 'none' } as object}
    />
  );
}
