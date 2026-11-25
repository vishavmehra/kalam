/**
 * Selection controls and the object list (docs/08 §9–§10, docs/10 §10.2–§10.4). Everything a person
 * can do by dragging also has a button here: move, resize, turn, order, lock, hide, duplicate, copy.
 */
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BringToFront, ChevronDown, ChevronUp, ClipboardPaste, Copy, CopyPlus, Expand,
  Eye, EyeOff, Lock, LockOpen, RotateCcw, RotateCw, Scissors, SendToBack, Shrink, Trash2,
} from 'lucide-react-native';
import { useMemo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Chip, IconButton, SwitchRow, Text, TextField, useKalamTheme, webData } from '@/design';
import { HINT_LABELS, HINTS, PAGE_OBJECT_CAP } from './model';
import { currentPage, describeElement, type StudioState } from './studio-store';

type Store = StoreApi<StudioState>;
const OBJECT_LIST_LIMIT = 60;

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { space } = useKalamTheme();
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="bodySmall" weight="semibold" tone="secondary">{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>{children}</View>
    </View>
  );
}

export function SelectionPanel({ store }: { store: Store }) {
  const { space } = useKalamTheme();
  const ids = useStore(store, (s) => s.selectedIds);
  const elements = useStore(store, (s) => currentPage(s).elements);
  const multiSelect = useStore(store, (s) => s.multiSelect);
  const canPaste = useStore(store, (s) => s.canPaste);
  const selected = useMemo(() => {
    const set = new Set(ids);
    return elements.filter((e) => set.has(e.id));
  }, [ids, elements]);
  const a = store.getState();

  if (selected.length === 0) {
    return (
      <View style={{ gap: space[3] }}>
        <Text variant="bodySmall" tone="muted" accessibilityLiveRegion="polite">
          Tap an object to select it. Drag on empty space to select several. Drag a corner to resize it, or the round handle to turn it.
        </Text>
        <SwitchRow label="Select several" description="Tap objects to add them or take them off." value={multiSelect} onValueChange={(v) => a.setMultiSelect(v)} />
        {canPaste ? <IconButton icon={ClipboardPaste} label="Paste" variant="outline" onPress={() => a.paste()} /> : null}
        <ObjectList store={store} />
      </View>
    );
  }

  const single = selected.length === 1 ? selected[0]! : undefined;
  const allLocked = selected.every((e) => e.locked);
  const anyEditable = selected.some((e) => !e.locked);
  const hint = selected.every((e) => e.hint === selected[0]!.hint) ? selected[0]!.hint : undefined;
  const step = 10;

  return (
    <View style={{ gap: space[4] }}>
      <Text weight="semibold" accessibilityLiveRegion="polite">
        {single ? `${describeElement(single)} selected` : `${selected.length} objects selected`}
        {allLocked ? ', locked' : ''}
      </Text>
      <SwitchRow label="Select several" description="Tap objects to add them or take them off." value={multiSelect} onValueChange={(v) => a.setMultiSelect(v)} />

      <Group title="Edit">
        <IconButton icon={CopyPlus} label="Duplicate" onPress={() => a.duplicateSelected()} />
        <IconButton icon={Copy} label="Copy" onPress={() => a.copySelected()} />
        <IconButton icon={Scissors} label="Cut" disabled={!anyEditable} onPress={() => a.cutSelected()} />
        <IconButton icon={ClipboardPaste} label="Paste" disabled={!canPaste} onPress={() => a.paste()} />
        <IconButton icon={Trash2} label="Delete selected" disabled={!anyEditable} onPress={() => a.deleteSelected()} />
      </Group>

      <Group title="Order">
        <IconButton icon={BringToFront} label="Bring to front" disabled={!anyEditable} onPress={() => a.reorderSelected('front')} />
        <IconButton icon={ChevronUp} label="Bring forward" disabled={!anyEditable} onPress={() => a.reorderSelected('forward')} />
        <IconButton icon={ChevronDown} label="Send backward" disabled={!anyEditable} onPress={() => a.reorderSelected('backward')} />
        <IconButton icon={SendToBack} label="Send to back" disabled={!anyEditable} onPress={() => a.reorderSelected('back')} />
      </Group>

      <Group title="Lock and hide">
        <IconButton
          icon={allLocked ? LockOpen : Lock}
          label={allLocked ? 'Unlock' : 'Lock'}
          selected={allLocked}
          onPress={() => a.setLocked(!allLocked)}
        />
        <IconButton icon={EyeOff} label="Hide" onPress={() => a.setHidden(true)} />
      </Group>

      <Group title="Move">
        <IconButton icon={ArrowLeft} label="Move left" disabled={!anyEditable} onPress={() => a.nudgeSelected(-step, 0)} />
        <IconButton icon={ArrowUp} label="Move up" disabled={!anyEditable} onPress={() => a.nudgeSelected(0, -step)} />
        <IconButton icon={ArrowDown} label="Move down" disabled={!anyEditable} onPress={() => a.nudgeSelected(0, step)} />
        <IconButton icon={ArrowRight} label="Move right" disabled={!anyEditable} onPress={() => a.nudgeSelected(step, 0)} />
      </Group>

      <Group title="Size and turn">
        <IconButton icon={Shrink} label="Make smaller" disabled={!anyEditable} onPress={() => a.scaleSelected(0.9)} />
        <IconButton icon={Expand} label="Make larger" disabled={!anyEditable} onPress={() => a.scaleSelected(1.1)} />
        <IconButton icon={RotateCcw} label="Turn left 15 degrees" disabled={!anyEditable} onPress={() => a.rotateSelectedBy(-15)} />
        <IconButton icon={RotateCw} label="Turn right 15 degrees" disabled={!anyEditable} onPress={() => a.rotateSelectedBy(15)} />
      </Group>

      <View style={{ gap: space[1] }}>
        <Text variant="bodySmall" weight="semibold" tone="secondary">What it is</Text>
        <View role="radiogroup" aria-label="What this object is for" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          <Chip label="Not set" role="radio" selected={!hint} onPress={() => a.setHint(null)} />
          {HINTS.map((h) => (
            <Chip key={h} label={HINT_LABELS[h]} role="radio" selected={hint === h} onPress={() => a.setHint(h)} />
          ))}
        </View>
        <Text variant="caption" tone="muted">Kalam uses this when it builds your app.</Text>
      </View>

      {single?.kind === 'stamp' ? (
        <TextField
          label="Label"
          value={single.label ?? ''}
          onChangeText={(label) => a.updateSelected({ label })}
          helper="Shown on the component, e.g. the button's words or the field name."
          maxLength={60}
        />
      ) : null}
      {single?.kind === 'text' ? (
        <TextField label="Text" value={single.text} multiline onChangeText={(text) => a.updateSelected({ text })} />
      ) : null}
      {single?.kind === 'image' ? (
        <TextField
          label="Describe this photo"
          value={single.alt ?? ''}
          onChangeText={(alt) => a.updateSelected({ alt })}
          helper="Read aloud by screen readers and used by Kalam to understand the photo."
          maxLength={200}
        />
      ) : null}
      <ObjectList store={store} />
    </View>
  );
}

/** Every object on this screen, topmost first, with lock and hide switches. Also the way to reach hidden objects. */
export function ObjectList({ store }: { store: Store }) {
  const { colors, space, radius, touchTarget } = useKalamTheme();
  const elements = useStore(store, (s) => currentPage(s).elements);
  const ids = useStore(store, (s) => s.selectedIds);
  const rows = useMemo(() => [...elements].reverse().slice(0, OBJECT_LIST_LIMIT), [elements]);
  if (elements.length === 0) return null;
  const selected = new Set(ids);
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="bodySmall" weight="semibold" tone="secondary">
        Objects on this screen ({elements.length} of {PAGE_OBJECT_CAP})
      </Text>
      <View role="list" aria-label="Objects on this screen" style={{ gap: 2 }}>
        {rows.map((el) => {
          const isSel = selected.has(el.id);
          const name = describeElement(el);
          const state = `${el.locked ? ', locked' : ''}${el.hidden ? ', hidden' : ''}`;
          return (
            <View
              key={el.id}
              role="listitem"
              style={{
                flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingLeft: space[2],
                backgroundColor: isSel ? colors.primarySoft : 'transparent', minHeight: touchTarget,
              }}
            >
              <Pressable
                role="button"
                accessibilityLabel={`${name}${state}${isSel ? ', selected' : ''}`}
                accessibilityState={{ selected: isSel }}
                onPress={() => { store.getState().setTool('select'); store.getState().select([el.id]); }}
                {...webData({ kPress: '', kHover: isSel ? 'none' : 'surface' })}
                style={{ flex: 1, minHeight: touchTarget, justifyContent: 'center' }}
              >
                <Text variant="bodySmall" weight={isSel ? 'semibold' : 'regular'} numberOfLines={1} tone={el.hidden ? 'muted' : 'default'}>
                  {name}
                </Text>
              </Pressable>
              <IconButton
                icon={el.hidden ? EyeOff : Eye}
                label={el.hidden ? `Show ${name}` : `Hide ${name}`}
                size={36}
                onPress={() => store.getState().toggleHidden(el.id)}
              />
              <IconButton
                icon={el.locked ? Lock : LockOpen}
                label={el.locked ? `Unlock ${name}` : `Lock ${name}`}
                size={36}
                selected={!!el.locked}
                onPress={() => store.getState().toggleLocked(el.id)}
              />
            </View>
          );
        })}
      </View>
      {elements.length > OBJECT_LIST_LIMIT ? <Text variant="caption" tone="muted">Showing the top {OBJECT_LIST_LIMIT}.</Text> : null}
    </View>
  );
}
