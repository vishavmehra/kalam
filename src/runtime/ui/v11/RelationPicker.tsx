/**
 * Link picker (KalamSpec 1.1 relations): replaces the text box for a field that stores one entry of
 * another collection. Shows the linked entry's label, opens an inline list (radio rows, searchable
 * once it is long). Stores the entry's id; never free text.
 */
import { Check, ChevronDown, Search } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { KalamRecord, RecordValue } from '@/core/contracts';
import type { ComponentOf, KalamRelation, KalamSpec } from '@/core/spec/schema';
import type { RuntimeTheme } from '../../engine/theme';
import type { FieldDef } from '../../engine/types';
import { relationLabel, relationOptions, safeLocale } from '../../engine/v11';
import { useV11Words } from '../../use-app-t';
import { fieldBox, FieldShell, invalidProps } from '../inputs';
import { font, Pressy } from '../kit';

const SEARCH_FROM = 8;

export interface RelationPickerProps {
  c: ComponentOf<'textInput'>;
  t: RuntimeTheme;
  spec: KalamSpec;
  relation: KalamRelation;
  /** Entries of the linked collection. */
  records: readonly KalamRecord[];
  def?: FieldDef;
  value: RecordValue | undefined;
  error?: string;
  onChange(value: RecordValue): void;
  onFocus(): void;
}

export const RelationPicker = memo(function RelationPicker({ c, t, spec, relation, records, def, value, error, onChange, onFocus }: RelationPickerProps) {
  const w = useV11Words(spec.lang);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const options = useMemo(() => relationOptions(spec, relation, records), [spec, relation, records]);
  const current = relationLabel(spec, relation, records, value);
  const id = `lbl_${c.id}`;
  const required = def?.required ?? c.required;
  const collectionName = spec.collections[relation.collection]?.label ?? relation.collection.replace(/_/g, ' ');
  const locale = safeLocale(spec.lang);
  const q = query.trim().toLocaleLowerCase(locale);
  const shown = q ? options.filter((o) => o.label.toLocaleLowerCase(locale).includes(q)) : options;
  const pick = (v: RecordValue) => {
    onChange(v);
    setOpen(false);
    setQuery('');
  };
  const row = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Pressy
      key={key}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, { minHeight: t.target, paddingHorizontal: 14, borderTopColor: t.colors.border, borderTopWidth: t.borderWidth }]}
    >
      <Text style={[font(t, 16, selected ? '600' : '400'), { color: t.colors.text, flex: 1 }]}>{label}</Text>
      {selected ? <Check size={20 * t.fontScale} color={t.colors.primaryText} /> : null}
    </Pressy>
  );
  return (
    <FieldShell t={t} componentId={c.id} label={c.label} required={required} error={error} nativeID={id}>
      <Pressy
        accessibilityRole="button"
        accessibilityLabel={`${c.a11yLabel ?? c.label}: ${current ?? w.noLinkChosen}. ${open ? '' : w.chooseLink(c.label)}`}
        accessibilityHint={c.a11yDescription}
        accessibilityState={{ expanded: open }}
        {...invalidProps(id, error, required)}
        onPress={() => {
          onFocus();
          setOpen((o) => !o);
        }}
        style={[fieldBox(t, open, error), styles.row]}
      >
        <Text style={[font(t, 16), { color: current ? t.colors.text : t.colors.textMuted, flex: 1 }]}>{current ?? w.noLinkChosen}</Text>
        <ChevronDown size={20 * t.fontScale} color={t.colors.textMuted} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressy>
      {open ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={w.chooseLink(c.label)} style={[styles.list, { borderRadius: Math.min(t.radius, 16), borderColor: t.colors.border, borderWidth: Math.max(1, t.borderWidth), backgroundColor: t.colors.surface }]}>
          {options.length > SEARCH_FROM ? (
            // The browser outline is off, so the box itself shows focus (WCAG 2.4.7), like every other input.
            <View style={[fieldBox(t, searchFocused), styles.row, { gap: 8, margin: 6 }]}>
              <Search size={18 * t.fontScale} color={t.colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={w.searchLinks}
                placeholderTextColor={t.colors.textMuted}
                accessibilityLabel={`${w.searchLinks} ${collectionName}`}
                autoCorrect={false}
                style={[font(t, 16), { flex: 1, color: t.colors.text, paddingVertical: 8, outlineStyle: 'none' } as object]}
              />
            </View>
          ) : null}
          {!options.length ? (
            <Text style={[font(t, 15), { color: t.colors.textMuted, padding: 14 }]}>{w.noLinkOptions(collectionName)}</Text>
          ) : !shown.length ? (
            <Text style={[font(t, 15), { color: t.colors.textMuted, padding: 14 }]}>{w.noLinkMatches}</Text>
          ) : null}
          {shown.slice(0, 200).map((o) => row(o.id, o.label, o.id === value, () => pick(o.id)))}
          {!required && typeof value === 'string' && value ? row('__clear', w.clearLink, false, () => pick(null)) : null}
        </View>
      ) : null}
    </FieldShell>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  list: { overflow: 'hidden' },
});
