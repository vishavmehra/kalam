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
import { useRovingFocus } from '@/design/inputs';
import { ColourDot } from './ColourDot';
import { DEFAULT_PAGE_COLOR, MAX_PAGES, PAGE_BACKGROUNDS, PAGE_COLORS, type PageBackground } from './model';
import { PageThumb } from './PageThumb';
import type { StudioState } from './studio-store';
import { useConfirm } from './use-confirm';
import { t as gt } from '@/i18n/active';
import { backgroundLabel, paperName } from './studio-text';

type Store = StoreApi<StudioState>;
const HEX6 = /^#[0-9a-f]{6}$/i;

/** Pattern and paper colour for one screen. */
export function PageBackgroundSheet({ store, pageId, visible, onClose }: { store: Store; pageId: string; visible: boolean; onClose: () => void }) {
  const { space, touchTarget } = useKalamTheme();
  const page = useStore(store, (s) => s.history.present.pages.find((p) => p.id === pageId));
  const [custom, setCustom] = useState('');
  if (!page) return null;
  const paper = page.backgroundColor ?? DEFAULT_PAGE_COLOR;
  const customInvalid = custom.length > 0 && !HEX6.test(custom);
  return (
    <Sheet visible={visible} onClose={onClose} title={gt('studio.bg.title')} description={gt('studio.bg.applies')}>
      <View style={{ gap: space[5] }}>
        <SegmentedControl<PageBackground>
          label={gt('studio.bg.pattern')}
          options={PAGE_BACKGROUNDS.map((b) => ({ value: b.id, label: backgroundLabel(b.id) }))}
          value={page.background ?? 'plain'}
          onChange={(background) => store.getState().setPageBackground(pageId, { background })}
        />
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" weight="medium" tone="secondary">{gt('studio.bg.paper')}</Text>
          <View role="radiogroup" aria-label={gt('studio.bg.paper')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
            {PAGE_COLORS.map((c) => {
              const selected = c.value.toLowerCase() === paper.toLowerCase();
              return (
                <Pressable
                  key={c.value}
                  role="radio"
                  aria-checked={selected}
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={paperName(c.name)}
                  onPress={() => store.getState().setPageBackground(pageId, { backgroundColor: c.value === DEFAULT_PAGE_COLOR ? null : c.value })}
                  {...webData({ kPress: '' })}
                  style={{ width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' }}
                >
                  <ColourDot value={c.value} selected={selected} size={32} />
                </Pressable>
              );
            })}
          </View>
        </View>
        <TextField
          label={gt('studio.customColour')}
          value={custom}
          onChangeText={(v) => {
            setCustom(v);
            if (HEX6.test(v)) store.getState().setPageBackground(pageId, { backgroundColor: v });
          }}
          placeholder="#F4EBD9"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          error={customInvalid ? gt('studio.bg.hexError') : undefined}
        />
        <Button label={gt('common.done')} onPress={onClose} />
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
  const [nameFocused, setNameFocused] = useState(false);
  const index = pages.findIndex((p) => p.id === pageId);
  const active = pages[index];
  const count = active?.elements.length ?? 0;
  const a = store.getState();
  // Arrow keys move between the screens on the web (D02-030); Tab leaves the strip.
  const roving = useRovingFocus({ count: pages.length, current: index, onMove: (i) => store.getState().selectPage(pages[i]!.id) });

  const deletePage = () => {
    if (!active) return;
    const title = active.title || gt('studio.pages.untitled', { n: index + 1 });
    if (count === 0) { a.removePage(active.id); return; }
    ask({
      title: gt('studio.pages.deleteTitle', { title }),
      message: gt('studio.pages.deleteBody', { count }),
      confirmLabel: gt('studio.pages.delete'),
      destructive: true,
      onConfirm: () => store.getState().removePage(active.id),
    });
  };
  const clearPage = () => {
    if (!active || count === 0) return;
    ask({
      title: gt('studio.pages.clearTitle'),
      message: gt('studio.pages.clearBody', { count, title: active.title }),
      confirmLabel: gt('studio.pages.clear'),
      destructive: true,
      onConfirm: () => store.getState().clearPage(),
    });
  };

  return (
    <View style={{ gap: space[2] }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2], alignItems: 'flex-end', paddingVertical: 2 }} role="tablist" aria-label={gt('studio.pages.label')}>
        {pages.map((p, i) => {
          const current = p.id === pageId;
          const n = p.elements.length;
          return (
            <Pressable
              key={p.id}
              onPress={() => store.getState().selectPage(p.id)}
              {...roving.itemProps(i)}
              role="tab"
              aria-selected={current}
              accessibilityState={{ selected: current }}
              accessibilityLabel={gt('studio.pages.tabLabel', { n: i + 1, total: pages.length, title: p.title, content: n === 0 ? gt('studio.pages.emptyPage') : gt('studio.objects', { count: n }) })}
              {...webData({ kPress: '', kHover: current ? 'none' : 'surface' })}
              style={{
                width: compact ? 72 : 84, padding: space[1], gap: 4, alignItems: 'center', borderRadius: radius.md,
                borderWidth: current ? 2 : 1, borderColor: current ? colors.primary : colors.border,
                backgroundColor: current ? colors.primarySoft : colors.surface,
              }}
            >
              <PageThumb page={p} width={compact ? 40 : 48} />
              <Text variant="caption" weight={current ? 'semibold' : 'medium'} numberOfLines={1} style={{ maxWidth: '100%' }}>
                <Text mono variant="caption" style={{ color: colors.markInk }}>{String(i + 1).padStart(2, '0')}</Text> {p.title}
              </Text>
            </Pressable>
          );
        })}
        {pages.length < MAX_PAGES ? <IconButton icon={Plus} label={gt('studio.pages.add')} variant="outline" onPress={() => a.addPage()} /> : null}
      </ScrollView>
      {active && !compact ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], flexWrap: 'wrap' }}>
          <TextInput
            value={active.title}
            onChangeText={(t) => store.getState().renamePage(active.id, t)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            accessibilityLabel={gt('studio.pages.name')}
            maxLength={60}
            style={{
              flexGrow: 1, flexBasis: 140, minHeight: touchTarget - 8, paddingHorizontal: space[3], borderRadius: radius.md,
              borderWidth: nameFocused ? 2.5 : 1, borderColor: nameFocused ? colors.focusRing : colors.borderStrong, color: colors.text, backgroundColor: colors.surface,
              fontFamily: fontFamily('medium'), fontSize: 14 * fontScale, outlineStyle: 'none',
            } as object}
          />
          <IconButton icon={ChevronLeft} label={gt('studio.pages.earlier')} disabled={index <= 0} onPress={() => a.movePage(active.id, -1)} />
          <IconButton icon={ChevronRight} label={gt('studio.pages.later')} disabled={index >= pages.length - 1} onPress={() => a.movePage(active.id, 1)} />
          <IconButton icon={Files} label={gt('studio.pages.duplicate')} disabled={pages.length >= MAX_PAGES} onPress={() => a.duplicatePage(active.id)} />
          <IconButton icon={Palette} label={gt('studio.bg.title')} onPress={() => setBackgroundOpen(true)} />
          {onExport ? <IconButton icon={FileDown} label={gt('studio.pages.exportPng')} onPress={onExport} /> : null}
          <IconButton icon={Eraser} label={gt('studio.pages.clear')} disabled={count === 0} onPress={clearPage} />
          <IconButton icon={Trash2} label={gt('studio.pages.delete')} disabled={pages.length <= 1} onPress={deletePage} />
        </View>
      ) : null}
      {active ? <PageBackgroundSheet store={store} pageId={active.id} visible={backgroundOpen} onClose={() => setBackgroundOpen(false)} /> : null}
      {confirmNode}
    </View>
  );
}
