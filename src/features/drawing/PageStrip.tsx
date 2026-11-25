/**
 * Screen manager (docs/08 §11): thumbnails, add, rename, reorder, duplicate, background, clear and
 * delete. Clearing or deleting a screen with content asks first; both can be undone afterwards.
 */
import {
  ChevronLeft, ChevronRight, Eraser, FileDown, Files, Palette, Plus, Trash2,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Button, IconButton, SegmentedControl, Sheet, Text, TextField, fontFamily, useKalamTheme, webData } from '@/design';
import { DEFAULT_PAGE_COLOR, MAX_PAGES, PAGE_BACKGROUNDS, PAGE_COLORS, type PageBackground } from './model';
import { PageThumb } from './PageThumb';
import type { StudioState } from './studio-store';
import { useConfirm } from './use-confirm';

type Store = StoreApi<StudioState>;
const HEX6 = /^#[0-9a-f]{6}$/i;

/** Pattern and paper colour for one screen. */
export function PageBackgroundSheet({ store, pageId, visible, onClose }: { store: Store; pageId: string; visible: boolean; onClose: () => void }) {
  const { colors, space, touchTarget } = useKalamTheme();
  const page = useStore(store, (s) => s.history.present.pages.find((p) => p.id === pageId));
  const [custom, setCustom] = useState('');
  if (!page) return null;
  const paper = page.backgroundColor ?? DEFAULT_PAGE_COLOR;
  const customInvalid = custom.length > 0 && !HEX6.test(custom);
  return (
    <Sheet visible={visible} onClose={onClose} title="Screen background" description="Applies to this screen only.">
      <View style={{ gap: space[5] }}>
        <SegmentedControl<PageBackground>
          label="Pattern"
          options={PAGE_BACKGROUNDS.map((b) => ({ value: b.id, label: b.label }))}
          value={page.background ?? 'plain'}
          onChange={(background) => store.getState().setPageBackground(pageId, { background })}
        />
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" weight="medium" tone="secondary">Paper colour</Text>
          <View role="radiogroup" aria-label="Paper colour" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
            {PAGE_COLORS.map((c) => {
              const selected = c.value.toLowerCase() === paper.toLowerCase();
              return (
                <Pressable
                  key={c.value}
                  role="radio"
                  aria-checked={selected}
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={c.name}
                  onPress={() => store.getState().setPageBackground(pageId, { backgroundColor: c.value === DEFAULT_PAGE_COLOR ? null : c.value })}
                  {...webData({ kPress: '' })}
                  style={{ width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View
                    style={{
                      width: 32, height: 32, borderRadius: 16, backgroundColor: c.value,
                      borderWidth: selected ? 3 : 1, borderColor: selected ? colors.focusRing : colors.borderStrong,
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
        <TextField
          label="Custom colour"
          value={custom}
          onChangeText={(v) => {
            setCustom(v);
            if (HEX6.test(v)) store.getState().setPageBackground(pageId, { backgroundColor: v });
          }}
          placeholder="#F4EBD9"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          error={customInvalid ? 'Use six letters or numbers after the #, like #F4EBD9.' : undefined}
        />
        <Button label="Done" onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** Page = screen manager (docs/08 §11). */
export function PageStrip({ store, compact, onExport }: { store: Store; compact?: boolean; onExport?: () => void }) {
  const { colors, space, radius, touchTarget, fontScale } = useKalamTheme();
  const pages = useStore(store, (s) => s.history.present.pages);
  const pageId = useStore(store, (s) => s.pageId);
  const [confirmNode, ask] = useConfirm();
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const index = pages.findIndex((p) => p.id === pageId);
  const active = pages[index];
  const count = active?.elements.length ?? 0;
  const a = store.getState();

  const deletePage = () => {
    if (!active) return;
    const title = active.title || `Screen ${index + 1}`;
    if (count === 0) { a.removePage(active.id); return; }
    ask({
      title: `Delete "${title}"?`,
      message: `It has ${count} ${count === 1 ? 'object' : 'objects'}. You can undo this right after.`,
      confirmLabel: 'Delete screen',
      destructive: true,
      onConfirm: () => store.getState().removePage(active.id),
    });
  };
  const clearPage = () => {
    if (!active || count === 0) return;
    ask({
      title: 'Clear this screen?',
      message: `This removes all ${count} ${count === 1 ? 'object' : 'objects'} from "${active.title}". You can undo it right after.`,
      confirmLabel: 'Clear screen',
      destructive: true,
      onConfirm: () => store.getState().clearPage(),
    });
  };

  return (
    <View style={{ gap: space[2] }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2], alignItems: 'flex-end', paddingVertical: 2 }} role="tablist" aria-label="Screens">
        {pages.map((p, i) => {
          const current = p.id === pageId;
          const n = p.elements.length;
          return (
            <Pressable
              key={p.id}
              onPress={() => store.getState().selectPage(p.id)}
              role="tab"
              aria-selected={current}
              accessibilityState={{ selected: current }}
              accessibilityLabel={`Screen ${i + 1} of ${pages.length}: ${p.title}, ${n === 0 ? 'empty' : `${n} ${n === 1 ? 'object' : 'objects'}`}`}
              {...webData({ kPress: '', kHover: current ? 'none' : 'surface' })}
              style={{
                width: compact ? 72 : 84, padding: space[1], gap: 4, alignItems: 'center', borderRadius: radius.md,
                borderWidth: current ? 2 : 1, borderColor: current ? colors.primary : colors.border,
                backgroundColor: current ? colors.primarySoft : colors.surface,
              }}
            >
              <PageThumb page={p} width={compact ? 40 : 48} />
              <Text variant="caption" weight={current ? 'semibold' : 'medium'} numberOfLines={1} style={{ maxWidth: '100%' }}>{i + 1}. {p.title}</Text>
            </Pressable>
          );
        })}
        {pages.length < MAX_PAGES ? <IconButton icon={Plus} label="Add screen" variant="outline" onPress={() => a.addPage()} /> : null}
      </ScrollView>
      {active && !compact ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], flexWrap: 'wrap' }}>
          <TextInput
            value={active.title}
            onChangeText={(t) => store.getState().renamePage(active.id, t)}
            accessibilityLabel="Screen name"
            maxLength={60}
            style={{
              flexGrow: 1, flexBasis: 140, minHeight: touchTarget - 8, paddingHorizontal: space[3], borderRadius: radius.md, borderWidth: 1,
              borderColor: colors.border, color: colors.text, backgroundColor: colors.surface,
              fontFamily: fontFamily('medium'), fontSize: 14 * fontScale, outlineStyle: 'none',
            } as object}
          />
          <IconButton icon={ChevronLeft} label="Move screen earlier" disabled={index <= 0} onPress={() => a.movePage(active.id, -1)} />
          <IconButton icon={ChevronRight} label="Move screen later" disabled={index >= pages.length - 1} onPress={() => a.movePage(active.id, 1)} />
          <IconButton icon={Files} label="Duplicate screen" disabled={pages.length >= MAX_PAGES} onPress={() => a.duplicatePage(active.id)} />
          <IconButton icon={Palette} label="Screen background" onPress={() => setBackgroundOpen(true)} />
          {onExport ? <IconButton icon={FileDown} label="Export screen as PNG" onPress={onExport} /> : null}
          <IconButton icon={Eraser} label="Clear screen" disabled={count === 0} onPress={clearPage} />
          <IconButton icon={Trash2} label="Delete screen" disabled={pages.length <= 1} onPress={deletePage} />
        </View>
      ) : null}
      {active ? <PageBackgroundSheet store={store} pageId={active.id} visible={backgroundOpen} onClose={() => setBackgroundOpen(false)} /> : null}
      {confirmNode}
    </View>
  );
}
