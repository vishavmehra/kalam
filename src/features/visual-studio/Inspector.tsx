/**
 * The panel under the app for the selected part: name, order, screen, copy, and (opened up) size,
 * width and field controls. Every control is an ordinary button, so everything a drag does can be done
 * without dragging (docs/10 §3: no gesture is the only way). It never edits the spec itself: each
 * control asks core/edit/direct for a validated result and hands it to `onResult`.
 */
import {
  ArrowDown, ArrowRightLeft, ArrowUp, ChevronDown, ChevronUp, Copy, PencilLine, X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  canRequire, duplicateComponent, FIELD_KINDS, fieldKindOf, isRequired, moveComponentTo, resizeComponent, setFieldKind, setRequired,
  sizeOf, staysOnScreen, widenComponent, type DirectResult, type FieldKind, type StyleSize,
} from '@/core/edit/direct';
import { findPart } from '@/core/edit/visual-edit';
import type { KalamSpec } from '@/core/spec/schema';
import { STYLE_SIZES } from '@/core/spec/schema';
import { IconButton, Menu, SegmentedControl, SwitchRow, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';
import { FIELD_KEY, NOUN_KEY, SIZE_KEY } from './copy';
import { nameOf, nounOf } from './model';

export interface InspectorProps {
  spec: KalamSpec;
  /** The selected part. */
  id: string;
  expanded: boolean;
  onExpanded(open: boolean): void;
  onResult(r: DirectResult): void;
  onRename(): void;
  onClose(): void;
  /** Does this collection hold saved entries? Unknown counts as yes, so a type is never changed blind. */
  hasEntries?(collection: string): boolean;
  /** The size a resize drag is on right now, shown before it is let go. */
  liveSize?: StyleSize | null;
  maxHeight: number;
}

export function Inspector({ spec, id, expanded, onExpanded, onResult, onRename, onClose, hasEntries, liveSize, maxHeight }: InspectorProps) {
  const k = useKalamTheme();
  const t = useT(k.uiLanguage);
  const [menu, setMenu] = useState(false);
  const at = findPart(spec, id);
  const ids = useMemo(() => at?.screen.children.map((c) => c.id) ?? [], [at]);
  if (!at) return null;
  const c = at.component;
  const i = at.index;
  const others = spec.screens.filter((s) => s.id !== at.screen.id);
  const stays = staysOnScreen(spec, c);
  const kind = fieldKindOf(c);
  const filled = at.screen.form ? (hasEntries ? hasEntries(at.screen.form) : true) : false;
  const name = nameOf(c) || t(NOUN_KEY[nounOf(c)]);
  const size = liveSize ?? sizeOf(c);
  const edit = (r: DirectResult) => onResult(r);
  const gap = k.space[2];

  return (
    <View
      accessibilityLabel={t('visualStudio.panel')}
      style={{
        gap, padding: k.space[3], maxHeight, borderRadius: k.radius.lg, borderWidth: 1, borderColor: k.colors.border,
        backgroundColor: k.colors.surfaceElevated, ...k.elevation[2],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
        <Text weight="semibold" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{name}</Text>
        <IconButton icon={X} label={t('common.close')} onPress={onClose} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: k.space[1] }}>
        <IconButton icon={PencilLine} label={t('visualStudio.rename')} onPress={onRename} />
        <IconButton icon={ArrowUp} label={t('visualStudio.up')} disabled={i === 0} onPress={() => edit(moveComponentTo(spec, id, { screen: at.screen.id, before: ids[i - 1] ?? null }))} />
        <IconButton
          icon={ArrowDown}
          label={t('visualStudio.down')}
          disabled={i >= ids.length - 1}
          onPress={() => edit(moveComponentTo(spec, id, { screen: at.screen.id, before: ids[i + 2] ?? null }))}
        />
        <IconButton icon={ArrowRightLeft} label={t('visualStudio.moveTo')} disabled={stays || !others.length} onPress={() => setMenu(true)} />
        <IconButton icon={Copy} label={t('visualStudio.duplicate')} disabled={'field' in c && !!c.field} onPress={() => edit(duplicateComponent(spec, id))} />
        <View style={{ flex: 1 }} />
        <IconButton
          icon={expanded ? ChevronDown : ChevronUp}
          label={expanded ? t('visualStudio.less') : t('visualStudio.more')}
          selected={expanded}
          onPress={() => onExpanded(!expanded)}
        />
      </View>

      {expanded ? (
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: k.space[3], paddingBottom: k.space[1] }} keyboardShouldPersistTaps="handled">
          <SegmentedControl<StyleSize>
            label={t('visualStudio.size.label')}
            value={size}
            onChange={(v) => edit(resizeComponent(spec, id, v))}
            options={STYLE_SIZES.map((s) => ({ value: s, label: t(SIZE_KEY[s]) }))}
          />
          <SwitchRow label={t('visualStudio.width')} value={c.style?.fullWidth === true} onValueChange={(on) => edit(widenComponent(spec, id, on))} />
          {kind ? (
            <SegmentedControl<FieldKind>
              label={t('visualStudio.field.type')}
              wrap
              value={kind}
              onChange={(v) => edit(setFieldKind(spec, id, v, { hasEntries: filled }))}
              options={FIELD_KINDS.map((f) => ({ value: f, label: t(FIELD_KEY[f]) }))}
            />
          ) : c.type === 'choice' ? (
            <Text variant="caption" tone="muted">{t('visualStudio.field.fixedType')}</Text>
          ) : null}
          {canRequire(c) ? (
            <SwitchRow label={t('visualStudio.field.required')} value={isRequired(spec, id)} onValueChange={(on) => edit(setRequired(spec, id, on))} />
          ) : null}
        </ScrollView>
      ) : null}

      <Menu
        visible={menu}
        onClose={() => setMenu(false)}
        title={t('visualStudio.moveTo')}
        items={others.map((s) => ({
          key: s.id,
          label: s.title,
          onSelect: () => edit(moveComponentTo(spec, id, { screen: s.id, before: null })),
        }))}
      />
    </View>
  );
}
