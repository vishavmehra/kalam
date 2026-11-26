/**
 * Selection controls and the object list (docs/08 §9–§10, docs/10 §10.2–§10.4). Everything a person
 * can do by dragging also has a button here: move, resize, turn, order, lock, hide, duplicate, copy.
 */
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BringToFront, ChevronDown, ChevronUp, ClipboardPaste, Copy, CopyPlus, Expand,
  Eye, EyeOff, Group as GroupIcon, Lock, LockOpen, RotateCcw, RotateCw, ScanText, Scissors, SendToBack, Shrink, Trash2, Ungroup,
} from 'lucide-react-native';
import { useMemo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { DrawingElement } from '@/core/contracts';
import { Button, Chip, IconButton, SwitchRow, Text, TextField, useKalamTheme, webData } from '@/design';
import {
  canGroup, canReadHandwriting, canUngroup, FONT_CHOICES, HEAD_OPTIONS, HINTS, hasFill, hasFont, hasHead, hasRadius,
  OBJECT_PROPERTIES, PAGE_COLORS, PAGE_OBJECT_CAP, propsOf, RADIUS_OPTIONS, singleGroupSize,
} from './model';
import { ColourDot } from './ColourDot';
import { currentPage, describeElement, describeInPage, type StudioState } from './studio-store';
import { t as gt } from '@/i18n/active';
import { fontLabel, hintLabel, headLabel, paperName, radiusLabel } from './studio-text';

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

/** Fill, corner, arrow head and font (docs/08 §6). Shown only for the kinds each one applies to. */
function ShapeControls({ store, selected }: { store: Store; selected: readonly DrawingElement[] }) {
  const { space, touchTarget } = useKalamTheme();
  const a = store.getState();
  const common = <T,>(pick: (e: DrawingElement) => T | undefined, of: (e: DrawingElement) => boolean): T | undefined => {
    const values = selected.filter(of).map(pick);
    return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
  };
  const fill = common((e) => propsOf(e).fill, hasFill);
  const noFill = selected.filter(hasFill).every((e) => !propsOf(e).fill);
  const radius = common((e) => propsOf(e).radius ?? 4, hasRadius);
  const head = selected.filter(hasHead).every((e) => propsOf(e).headSize === undefined) ? null : common((e) => propsOf(e).headSize, hasHead);
  const font = common((e) => propsOf(e).font ?? 'sans', hasFont);
  const bold = selected.filter(hasFont).length > 0 && selected.filter(hasFont).every((e) => !!propsOf(e).bold);
  return (
    <>
      {selected.some(hasFill) ? (
        <View style={{ gap: space[1] }}>
          <Text variant="bodySmall" weight="semibold" tone="secondary">{gt('studio.sel.fill')}</Text>
          <View role="radiogroup" aria-label={gt('studio.sel.fillColour')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1], alignItems: 'center' }}>
            <Chip label={gt('studio.sel.noFill')} role="radio" selected={noFill} onPress={() => a.updateSelected({ fill: null })} />
            {PAGE_COLORS.map((c) => (
              <Pressable
                key={c.value}
                role="radio"
                aria-checked={fill === c.value}
                accessibilityState={{ checked: fill === c.value }}
                accessibilityLabel={gt('studio.sel.fillOf', { name: paperName(c.name) })}
                onPress={() => a.updateSelected({ fill: c.value })}
                {...webData({ kPress: '' })}
                style={{ width: touchTarget - 4, height: touchTarget - 4, alignItems: 'center', justifyContent: 'center' }}
              >
                <ColourDot value={c.value} selected={fill === c.value} square />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {selected.some(hasRadius) ? (
        <View style={{ gap: space[1] }}>
          <Text variant="bodySmall" weight="semibold" tone="secondary">{gt('studio.sel.corners')}</Text>
          <View role="radiogroup" aria-label={gt('studio.sel.cornerShape')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {RADIUS_OPTIONS.map((o) => (
              <Chip key={o.id} label={radiusLabel(o.id, o.label)} role="radio" selected={radius === o.value} onPress={() => a.updateSelected({ radius: o.value })} />
            ))}
          </View>
        </View>
      ) : null}
      {selected.some(hasHead) ? (
        <View style={{ gap: space[1] }}>
          <Text variant="bodySmall" weight="semibold" tone="secondary">{gt('studio.sel.arrowHead')}</Text>
          <View role="radiogroup" aria-label={gt('studio.sel.arrowHeadSize')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {HEAD_OPTIONS.map((o) => (
              <Chip key={o.id} label={headLabel(o.id, o.label)} role="radio" selected={head === o.value} onPress={() => a.updateSelected({ headSize: o.value })} />
            ))}
          </View>
        </View>
      ) : null}
      {selected.some(hasFont) ? (
        <View style={{ gap: space[1] }}>
          <Text variant="bodySmall" weight="semibold" tone="secondary">{gt('studio.sel.font')}</Text>
          <View role="radiogroup" aria-label={gt('studio.sel.typeface')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {FONT_CHOICES.map((f) => (
              <Chip key={f.id} label={fontLabel(f.id)} role="radio" selected={font === f.id} onPress={() => a.updateSelected({ font: f.id })} />
            ))}
            <Chip label={gt('studio.sel.bold')} selected={bold} onPress={() => a.updateSelected({ bold: !bold })} />
          </View>
        </View>
      ) : null}
    </>
  );
}

export function SelectionPanel({ store, onReadHandwriting }: { store: Store; onReadHandwriting?: () => void }) {
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
          {gt('studio.sel.hint')}
        </Text>
        <SwitchRow label={gt('studio.sel.several')} description={gt('studio.sel.severalHint')} value={multiSelect} onValueChange={(v) => a.setMultiSelect(v)} />
        {canPaste ? <IconButton icon={ClipboardPaste} label={gt('studio.sel.paste')} variant="outline" onPress={() => a.paste()} /> : null}
        <ObjectList store={store} />
      </View>
    );
  }

  const single = selected.length === 1 ? selected[0]! : undefined;
  const groupSize = singleGroupSize(currentPage(store.getState()), selected);
  const allLocked = selected.every((e) => e.locked);
  const anyEditable = selected.some((e) => !e.locked);
  const hint = selected.every((e) => e.hint === selected[0]!.hint) ? selected[0]!.hint : undefined;
  const step = 10;

  return (
    <View style={{ gap: space[4] }}>
      <Text weight="semibold" accessibilityLiveRegion="polite">
        {single ? gt('studio.sel.oneSelected', { name: describeElement(single) }) : groupSize ? gt('studio.sel.groupSelected', { count: groupSize }) : gt('studio.sel.manySelected', { count: selected.length })}
        {allLocked ? gt('studio.sel.lockedSuffix') : ''}
      </Text>
      <SwitchRow label={gt('studio.sel.several')} description={gt('studio.sel.severalHint')} value={multiSelect} onValueChange={(v) => a.setMultiSelect(v)} />

      <Group title={gt('studio.sel.group.edit')}>
        <IconButton icon={CopyPlus} label={gt('studio.sel.duplicate')} onPress={() => a.duplicateSelected()} />
        <IconButton icon={Copy} label={gt('studio.sel.copy')} onPress={() => a.copySelected()} />
        <IconButton icon={Scissors} label={gt('studio.sel.cut')} disabled={!anyEditable} onPress={() => a.cutSelected()} />
        <IconButton icon={ClipboardPaste} label={gt('studio.sel.paste')} disabled={!canPaste} onPress={() => a.paste()} />
        <IconButton icon={Trash2} label={gt('studio.sel.deleteSelected')} disabled={!anyEditable} onPress={() => a.deleteSelected()} />
      </Group>

      <Group title={gt('studio.sel.group.group')}>
        <IconButton icon={GroupIcon} label={gt('studio.sel.groupBtn')} disabled={!canGroup(selected)} onPress={() => a.groupSelected()} />
        <IconButton icon={Ungroup} label={gt('studio.sel.ungroupBtn')} disabled={!canUngroup(selected)} onPress={() => a.ungroupSelected()} />
      </Group>

      <Group title={gt('studio.sel.group.order')}>
        <IconButton icon={BringToFront} label={gt('studio.sel.toFront')} disabled={!anyEditable} onPress={() => a.reorderSelected('front')} />
        <IconButton icon={ChevronUp} label={gt('studio.sel.forward')} disabled={!anyEditable} onPress={() => a.reorderSelected('forward')} />
        <IconButton icon={ChevronDown} label={gt('studio.sel.backward')} disabled={!anyEditable} onPress={() => a.reorderSelected('backward')} />
        <IconButton icon={SendToBack} label={gt('studio.sel.toBack')} disabled={!anyEditable} onPress={() => a.reorderSelected('back')} />
      </Group>

      <Group title={gt('studio.sel.group.lock')}>
        <IconButton
          icon={allLocked ? LockOpen : Lock}
          label={allLocked ? gt('studio.sel.unlock') : gt('studio.sel.lock')}
          selected={allLocked}
          onPress={() => a.setLocked(!allLocked)}
        />
        <IconButton icon={EyeOff} label={gt('studio.sel.hide')} onPress={() => a.setHidden(true)} />
      </Group>

      <Group title={gt('studio.sel.group.move')}>
        <IconButton icon={ArrowLeft} label={gt('studio.sel.left')} disabled={!anyEditable} onPress={() => a.nudgeSelected(-step, 0)} />
        <IconButton icon={ArrowUp} label={gt('studio.sel.up')} disabled={!anyEditable} onPress={() => a.nudgeSelected(0, -step)} />
        <IconButton icon={ArrowDown} label={gt('studio.sel.down')} disabled={!anyEditable} onPress={() => a.nudgeSelected(0, step)} />
        <IconButton icon={ArrowRight} label={gt('studio.sel.right')} disabled={!anyEditable} onPress={() => a.nudgeSelected(step, 0)} />
      </Group>

      <Group title={gt('studio.sel.group.size')}>
        <IconButton icon={Shrink} label={gt('studio.sel.smaller')} disabled={!anyEditable} onPress={() => a.scaleSelected(0.9)} />
        <IconButton icon={Expand} label={gt('studio.sel.larger')} disabled={!anyEditable} onPress={() => a.scaleSelected(1.1)} />
        <IconButton icon={RotateCcw} label={gt('studio.sel.turnLeft')} disabled={!anyEditable} onPress={() => a.rotateSelectedBy(-15)} />
        <IconButton icon={RotateCw} label={gt('studio.sel.turnRight')} disabled={!anyEditable} onPress={() => a.rotateSelectedBy(15)} />
      </Group>

      {OBJECT_PROPERTIES && anyEditable ? <ShapeControls store={store} selected={selected.filter((e) => !e.locked)} /> : null}

      {onReadHandwriting && canReadHandwriting(selected) ? (
        <View style={{ gap: space[1] }}>
          <Button label={gt('studio.sel.handwriting')} icon={ScanText} variant="outline" onPress={onReadHandwriting} testID="read-handwriting" />
          <Text variant="caption" tone="muted">{gt('studio.sel.handwritingNote')}</Text>
        </View>
      ) : null}

      <View style={{ gap: space[1] }}>
        <Text variant="bodySmall" weight="semibold" tone="secondary">{gt('studio.sel.whatItIs')}</Text>
        <View role="radiogroup" aria-label={gt('studio.sel.whatFor')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          <Chip label={gt('studio.sel.notSet')} role="radio" selected={!hint} onPress={() => a.setHint(null)} />
          {HINTS.map((h) => (
            <Chip key={h} label={hintLabel(h)} role="radio" selected={hint === h} onPress={() => a.setHint(h)} />
          ))}
        </View>
        <Text variant="caption" tone="muted">{gt('studio.sel.usedWhenBuilding')}</Text>
      </View>

      {single?.kind === 'stamp' ? (
        <TextField
          label={gt('studio.add.label')}
          value={single.label ?? ''}
          onChangeText={(label) => a.updateSelected({ label })}
          helper={gt('studio.sel.labelHelper')}
          maxLength={60}
        />
      ) : null}
      {single?.kind === 'text' ? (
        <TextField label={gt('studio.sel.text')} value={single.text} multiline onChangeText={(text) => a.updateSelected({ text })} />
      ) : null}
      {single?.kind === 'image' ? (
        <TextField
          label={gt('studio.sel.describePhoto')}
          value={single.alt ?? ''}
          onChangeText={(alt) => a.updateSelected({ alt })}
          helper={gt('studio.sel.describePhotoHelper')}
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
  const page = useStore(store, (s) => currentPage(s));
  const ids = useStore(store, (s) => s.selectedIds);
  const rows = useMemo(() => [...elements].reverse().slice(0, OBJECT_LIST_LIMIT), [elements]);
  if (elements.length === 0) return null;
  const selected = new Set(ids);
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="bodySmall" weight="semibold" tone="secondary">
        {gt('studio.sel.objectsHeading', { count: elements.length, max: PAGE_OBJECT_CAP })}
      </Text>
      <View role="list" aria-label={gt('studio.sel.objectsLabel')} style={{ gap: 2 }}>
        {rows.map((el) => {
          const isSel = selected.has(el.id);
          const name = describeInPage(page, el);
          const state = `${el.locked ? gt('studio.sel.lockedSuffix') : ''}${el.hidden ? gt('studio.sel.hiddenSuffix') : ''}`;
          return (
            <View
              key={el.id}
              role="listitem"
              style={{
                flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingStart: space[2],
                backgroundColor: isSel ? colors.primarySoft : 'transparent', minHeight: touchTarget,
              }}
            >
              <Pressable
                role="button"
                accessibilityLabel={`${name}${state}${isSel ? gt('studio.sel.selectedSuffix') : ''}`}
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
                label={el.hidden ? gt('studio.sel.showName', { name }) : gt('studio.sel.hideName', { name })}
                size={36}
                onPress={() => store.getState().toggleHidden(el.id)}
              />
              <IconButton
                icon={el.locked ? Lock : LockOpen}
                label={el.locked ? gt('studio.sel.unlockName', { name }) : gt('studio.sel.lockName', { name })}
                size={36}
                selected={!!el.locked}
                onPress={() => store.getState().toggleLocked(el.id)}
              />
            </View>
          );
        })}
      </View>
      {elements.length > OBJECT_LIST_LIMIT ? <Text variant="caption" tone="muted">{gt('studio.sel.showingTop', { count: OBJECT_LIST_LIMIT })}</Text> : null}
    </View>
  );
}
