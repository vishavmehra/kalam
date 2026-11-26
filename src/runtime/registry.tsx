/**
 * The strict component registry (docs/04 §6.4 and §9.3). One renderer for every KalamSpec component type, held in
 * ONE map. `COMPONENT_RENDERERS` is typed over `KalamComponentType`, so adding a type to the schema without a renderer
 * here fails the type check (the exhaustive check), and `registry.test.ts` checks the keys against `COMPONENT_TYPES`
 * at run time. A type outside the map, such as one from a newer Kalam, never executes: it draws a quiet note and the
 * rest of the screen keeps working (docs/09 §5.3).
 *
 * KalamRuntime owns the state (navigation, forms, data, AI status) and hands each renderer a `RenderEnv` of what it
 * may read and the few things it may ask for. A renderer holds no state of its own.
 */
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { AIImage, KalamRecord, RecordValue } from '@/core/contracts';
import type { ComponentOf, KalamComponent, KalamComponentType, KalamScreen, KalamSpec } from '@/core/spec/schema';
import type { TFunction } from '@/i18n/translator';
import { ChartBlock } from '@/features/reports/ChartBlock';
import { emptyListAdd } from '@/features/templates/empty-list-add';
import { clamp, parseNumber, type CollectionValues, type FieldDef, type FormValues } from './engine';
import { componentTheme, relationOf, statCurrency, type ReminderStatus } from './engine/v11';
import { BigButton, Counter, Heading, Stat, TextBlock } from './ui/blocks';
import { ChoiceField, DateField, NumberField, TextField, ToggleField } from './ui/inputs';
import { font, type AppTheme } from './ui/kit';
import { ListView } from './ui/ListView';
import { PhotoBlock, type AIRunStatus } from './ui/PhotoBlock';
import { ReminderBlock, RelationPicker, SignaturePad, TimerBlock } from './ui/v11';

const EMPTY: KalamRecord[] = [];

/** What a renderer may read and ask for. Built by KalamRuntime for the screen on show. */
export interface RenderEnv {
  spec: KalamSpec;
  appId: string;
  screen: KalamScreen;
  /** Field definitions of the screen's inputs. */
  defs: Record<string, FieldDef>;
  /** What was typed or picked, as stored. */
  rawForm: FormValues;
  /** The same values, read leniently for formulas. */
  form: FormValues;
  errors: Record<string, string>;
  records: Readonly<Record<string, KalamRecord[]>> | undefined;
  collections: CollectionValues;
  /** The app's counters and switches. */
  kv: Record<string, RecordValue>;
  /** Id of the entry the screen is about. */
  selected: string | null;
  busy: boolean;
  photos: Readonly<Record<string, AIImage>>;
  aiStatus: Readonly<Record<string, AIRunStatus>>;
  reminderStatus: Readonly<Record<string, ReminderStatus>>;
  /** The app's own words, in its own language. */
  tr: TFunction;
  /** Reads the component aloud when Read-aloud is on. */
  focus(c: KalamComponent): void;
  setField(field: string, value: RecordValue): void;
  /** One count step (queued, so rapid taps all count). */
  step(c: ComponentOf<'counter'>, op: 'increment' | 'decrement'): void;
  /** Runs a button's action. */
  press(actionId: string): void;
  openRecord(list: ComponentOf<'list'>, record: KalamRecord): void;
  toggleRecord(list: ComponentOf<'list'>, record: KalamRecord): void;
  deleteRecord(list: ComponentOf<'list'>, record: KalamRecord, title: string): void;
  switchReminder(c: ComponentOf<'reminder'>, on: boolean): void;
  openNotificationSettings?(): void;
  finishTimer(message: string): void;
  pickPhoto(c: ComponentOf<'photo'>): void;
}

export type ComponentRenderer<K extends KalamComponentType> = (c: ComponentOf<K>, t: AppTheme, x: RenderEnv) => ReactNode;

/** Props every field input takes, so the five input types and the signature pad read the same way. */
function fieldProps(c: { field: string }, x: RenderEnv) {
  return {
    def: x.defs[c.field],
    value: x.rawForm[c.field],
    error: x.errors[c.field],
    onChange: (v: RecordValue) => x.setField(c.field, v),
  };
}

/** The renderer for each component type. Typed over every type, so a missing one does not compile. */
export const COMPONENT_RENDERERS: { readonly [K in KalamComponentType]: ComponentRenderer<K> } = {
  text: (c, t) => <TextBlock key={c.id} c={c} t={t} />,
  heading: (c, t) => <Heading key={c.id} c={c} t={t} />,
  number: (c, t, x) => <NumberField key={c.id} c={c} t={t} {...fieldProps(c, x)} onFocus={() => x.focus(c)} />,
  textInput: (c, t, x) => {
    // A link (KalamSpec 1.1) is picked from the linked collection's entries, never typed.
    const relation = relationOf(x.spec, x.screen.form, c.field);
    if (relation) {
      return (
        <RelationPicker
          key={c.id} c={c} t={t} spec={x.spec} relation={relation} records={x.records?.[relation.collection] ?? EMPTY}
          {...fieldProps(c, x)} onFocus={() => x.focus(c)}
        />
      );
    }
    return <TextField key={c.id} c={c} t={t} {...fieldProps(c, x)} onFocus={() => x.focus(c)} />;
  },
  date: (c, t, x) => <DateField key={c.id} c={c} t={t} {...fieldProps(c, x)} onFocus={() => x.focus(c)} />,
  choice: (c, t, x) => <ChoiceField key={c.id} c={c} t={t} {...fieldProps(c, x)} onFocus={() => x.focus(c)} />,
  toggle: (c, t, x) => (
    <ToggleField key={c.id} c={c} t={t} def={x.defs[c.field]} value={x.rawForm[c.field]} onChange={(v) => x.setField(c.field, v)} onFocus={() => x.focus(c)} />
  ),
  counter: (c, t, x) => {
    const stored = c.field ? parseNumber(x.rawForm[c.field]) : x.kv[c.id];
    const value = typeof stored === 'number' ? stored : clamp(0, c.min, c.max);
    return <Counter key={c.id} c={c} t={t} value={value} onStep={(op) => x.step(c, op)} />;
  },
  bigButton: (c, t, x) => (
    <BigButton key={c.id} c={c} t={t} busy={x.busy} onPress={() => { x.focus(c); x.press(c.action); }} />
  ),
  list: (c, t, x) => {
    // An empty list offers the screen that adds its first entry, when the app has one (docs/14 §12).
    const add = emptyListAdd(x.spec, x.screen.id, c.source);
    return (
      <ListView
        key={c.id} c={c} t={t} spec={x.spec} records={x.records?.[c.source] ?? EMPTY} collections={x.collections}
        form={x.form} state={x.kv} selected={x.selected} allRecords={x.records}
        onOpen={(r) => x.openRecord(c, r)}
        onToggle={(r) => x.toggleRecord(c, r)}
        onDelete={(r, title) => x.deleteRecord(c, r, title)}
        onAdd={add ? () => x.press(add.action) : undefined}
        addLabel={add?.label}
      />
    );
  },
  stat: (c, t, x) => (
    <Stat key={c.id} c={c} t={t} lang={x.spec.lang} collections={x.collections} form={x.form} state={x.kv} selected={x.selected} currency={statCurrency(x.spec, c)} />
  ),
  photo: (c, t, x) => (
    <PhotoBlock key={c.id} c={c} t={t} image={x.photos[c.id]} status={c.aiBlock ? x.aiStatus[c.aiBlock] : undefined} disabled={x.busy} onPick={() => x.pickPhoto(c)} />
  ),
  chart: (c, t, x) => <ChartBlock key={c.id} c={c} t={t} spec={x.spec} records={x.records?.[c.source] ?? EMPTY} />,
  timer: (c, t, x) => (
    <TimerBlock
      key={c.id} c={c} t={t} appId={x.appId} lang={x.spec.lang}
      onValue={c.field ? (v) => x.setField(c.field as string, v) : undefined}
      onFinish={x.finishTimer}
      onFocus={() => x.focus(c)}
    />
  ),
  reminder: (c, t, x) => (
    <ReminderBlock
      key={c.id} c={c} t={t} spec={x.spec} lang={x.spec.lang} enabled={x.kv[c.id] === true} status={x.reminderStatus[c.id]} busy={x.busy}
      onToggle={(on) => x.switchReminder(c, on)}
      onOpenSettings={x.openNotificationSettings}
      onFocus={() => x.focus(c)}
    />
  ),
  signature: (c, t, x) => (
    <SignaturePad key={c.id} c={c} t={t} lang={x.spec.lang} {...fieldProps(c, x)} onFocus={() => x.focus(c)} />
  ),
};

/** True for a component type this Kalam can draw. Own keys only: "constructor" or "__proto__" are never a renderer. */
export function isKnownComponentType(type: unknown): type is KalamComponentType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(COMPONENT_RENDERERS, type);
}

/**
 * Draws one component with its own style applied (KalamSpec 1.1 `style`: size, tone, emphasis, from the app's own
 * palette). A type this Kalam does not know draws a note instead of anything that could run.
 */
export function renderComponent(c: KalamComponent, appTheme: AppTheme, x: RenderEnv): ReactNode {
  const type: unknown = (c as { type?: unknown }).type;
  const t = componentTheme(appTheme, c.style, typeof type === 'string' ? type : undefined);
  if (!isKnownComponentType(type)) {
    return (
      <View key={(c as { id: string }).id} style={{ padding: t.space, borderRadius: t.radius, backgroundColor: t.colors.surfaceAlt }}>
        <Text style={[font(t, 14), { color: t.colors.textMuted }]}>
          {x.tr('runtime.chrome.newerPart', { kind: String(type ?? 'unknown').slice(0, 40) })}
        </Text>
      </View>
    );
  }
  // The map is typed per key, so a lookup by a union key needs this one cast: `type` is `c.type`, so they agree.
  const draw = COMPONENT_RENDERERS[type] as (c: KalamComponent, t: AppTheme, x: RenderEnv) => ReactNode;
  return draw(c, t, x);
}
