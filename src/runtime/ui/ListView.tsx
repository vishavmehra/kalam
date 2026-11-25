/**
 * Collection list: filter/sort/limit, a search box once the list is long (docs/00 §12, docs/01 §8.4),
 * inline checklist toggle, tap-through to detail, delete with confirm.
 */
import { Check, ChevronRight, Search, Trash2 } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { KalamRecord, RecordValue } from '@/core/contracts';
import type { ComponentOf, KalamSpec } from '@/core/spec/schema';
import { formatFieldValue, formulaContext, queryList, type CollectionValues } from '../engine/data';
import { collectionFieldDefs } from '../engine/fields';
import type { RuntimeTheme } from '../engine/theme';
import { useComponentBounds } from '../layout';
import { useOptionLabel } from '../translation/option-labels';
import { font, Pressy } from './kit';

export interface ListViewProps {
  c: ComponentOf<'list'>;
  t: RuntimeTheme;
  spec: KalamSpec;
  records: KalamRecord[];
  collections: CollectionValues;
  form: Record<string, RecordValue>;
  state: Record<string, RecordValue>;
  onOpen(record: KalamRecord): void;
  onToggle(record: KalamRecord): void;
  onDelete(record: KalamRecord, title: string): void;
}

export const ListView = memo(function ListView({ c, t, spec, records, collections, form, state, onOpen, onToggle, onDelete }: ListViewProps) {
  const bounds = useComponentBounds(c.id);
  const optionLabel = useOptionLabel();
  const defs = useMemo(() => collectionFieldDefs(spec, c.source) ?? {}, [spec, c.source]);
  const { rows } = useMemo(
    () => queryList(c, records, formulaContext(collections, form, state, new Date())),
    [c, records, collections, form, state],
  );
  const lang = spec.lang;
  // Enum values are stored in the app's own words; a translated view only changes what is shown.
  const show = useCallback(
    (field: string, value: RecordValue | undefined) =>
      defs[field]?.type === 'enum' && typeof value === 'string' ? optionLabel(value) : formatFieldValue(defs[field], value, lang),
    [defs, optionLabel, lang],
  );
  const radius = Math.min(t.radius, 20);
  const [query, setQuery] = useState('');
  const searchable = rows.length > SEARCH_FROM || query.length > 0;
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(lang);
    if (!q) return rows;
    return rows.filter((r) => Object.entries(r.values).some(([k, v]) => show(k, v).toLocaleLowerCase(lang).includes(q)));
  }, [rows, query, show, lang]);

  return (
    <View {...bounds} style={{ gap: 8 }}>
      {c.label ? <Text accessibilityRole="header" style={[font(t, 15, '600'), { color: t.colors.text }]}>{c.label}</Text> : null}
      {searchable ? (
        <View style={[styles.search, { minHeight: t.target, borderRadius: radius, borderColor: t.colors.border, borderWidth: Math.max(1, t.borderWidth), backgroundColor: t.colors.surface, paddingHorizontal: t.space * 0.75 }]}>
          <Search size={18 * t.fontScale} color={t.colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={t.colors.textMuted}
            accessibilityLabel={`Search ${c.label ?? 'this list'}`}
            autoCorrect={false}
            style={[font(t, 16), { flex: 1, color: t.colors.text, paddingVertical: 8, outlineStyle: 'none' } as object]}
          />
        </View>
      ) : null}
      {query && shown.length === 0 ? (
        <Text style={[font(t, 15), { color: t.colors.textMuted }]}>Nothing matches “{query.trim()}”.</Text>
      ) : rows.length === 0 ? (
        <View style={[styles.empty, { borderColor: t.colors.border, borderRadius: radius, padding: t.space * 1.25 }]}>
          <Text style={[font(t, 15), { color: t.colors.textMuted, textAlign: 'center' }]}>
            {c.emptyText ?? 'Nothing here yet.'}
          </Text>
        </View>
      ) : (
        <View
          role="list"
          style={{ backgroundColor: t.colors.surface, borderRadius: radius, borderWidth: t.borderWidth, borderColor: t.colors.border, overflow: 'hidden' }}
        >
          {shown.map((r, i) => {
            const title = show(c.primary, r.values[c.primary]) || 'Untitled';
            const sub = c.secondary ? show(c.secondary, r.values[c.secondary]) : '';
            const done = c.toggleField ? r.values[c.toggleField] === true : false;
            const check = c.toggleField ? (
              <Pressy
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={`${defs[c.toggleField]?.label ?? 'Done'}: ${title}`}
                onPress={() => onToggle(r)}
                style={[styles.iconBtn, { width: t.target, height: t.target }]}
              >
                <View
                  style={[
                    styles.box,
                    { borderRadius: Math.min(t.radius / 2, 8), borderColor: done ? t.colors.primary : t.colors.border, backgroundColor: done ? t.colors.primary : 'transparent' },
                  ]}
                >
                  {done ? <Check size={16} color={t.colors.onPrimary} strokeWidth={3} /> : null}
                </View>
              </Pressy>
            ) : null;
            const del = c.allowDelete ? (
              <Pressy
                accessibilityRole="button"
                accessibilityLabel={`Delete ${title}`}
                onPress={() => onDelete(r, title)}
                style={[styles.iconBtn, { width: t.target, height: t.target }]}
              >
                <Trash2 size={20 * t.fontScale} color={t.colors.textMuted} />
              </Pressy>
            ) : null;
            const body = (
              <View style={{ flex: 1, paddingVertical: 10, gap: 2 }}>
                <Text
                  style={[
                    font(t, 16, '500'),
                    { color: done ? t.colors.textMuted : t.colors.text, textDecorationLine: done ? 'line-through' : 'none' },
                  ]}
                >
                  {title}
                </Text>
                {sub ? <Text style={[font(t, 14), { color: t.colors.textMuted }]}>{sub}</Text> : null}
              </View>
            );
            return (
              <View
                key={r.id}
                role="listitem"
                style={[
                  styles.row,
                  { minHeight: t.target + 8, paddingHorizontal: c.toggleField || c.allowDelete ? 4 : t.space * 0.75 },
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth * (t.highContrast ? 3 : 1), borderTopColor: t.colors.border },
                ]}
              >
                {check}
                {c.detailScreen ? (
                  <Pressy
                    accessibilityRole="button"
                    accessibilityLabel={sub ? `${title}, ${sub}` : title}
                    accessibilityHint="Opens details"
                    onPress={() => onOpen(r)}
                    style={[styles.row, { flex: 1, minHeight: t.target, paddingLeft: c.toggleField ? 0 : 8 }]}
                  >
                    {body}
                    <ChevronRight size={18 * t.fontScale} color={t.colors.textMuted} />
                  </Pressy>
                ) : (
                  <View style={{ flex: 1, paddingLeft: c.toggleField ? 0 : 8 }}>{body}</View>
                )}
                {del}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
});

const SEARCH_FROM = 6;

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  empty: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  box: { width: 24, height: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
