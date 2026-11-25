/**
 * The names one formula may use, and what people call them. Built from the spec only, never from entries.
 * A stat sees every collection, the counters, and the values typed on its own screen (`form.<id>`).
 */
import type { FormulaScope } from '../contracts';
import type { KalamField, KalamSpec } from '../spec/schema';

export interface FieldShape {
  type: KalamField['type'];
  label: string;
  options?: readonly string[];
  min?: number;
  max?: number;
  unit?: string;
}
export interface NamedField extends FieldShape { id: string }

export const shapeOf = (f: KalamField): FieldShape => ({
  type: f.type,
  label: f.label,
  ...(f.type === 'enum' ? { options: f.options } : {}),
  ...(f.type === 'number' ? { min: f.min, max: f.max, unit: f.unit } : {}),
});

export interface AssistScope {
  scope: FormulaScope;
  /** Screen whose typed values `form.<id>` refers to. */
  screenId?: string;
  /** Values typed on that screen, by field id. */
  form: Readonly<Record<string, NamedField>>;
  /** Counters that keep a value, by component id → label. */
  counters: Readonly<Record<string, string>>;
}

/** The screen a component sits on. */
export const screenOfComponent = (spec: KalamSpec, componentId: string): string | undefined =>
  spec.screens.find((s) => s.children.some((c) => c.id === componentId))?.id;

export function assistScope(spec: KalamSpec, screenId?: string): AssistScope {
  const screen = spec.screens.find((s) => s.id === screenId);
  const counters = Object.fromEntries(
    spec.screens.flatMap((s) => s.children).flatMap((c) => (c.type === 'counter' && !c.field ? [[c.id, c.label] as const] : [])),
  );
  const form: Record<string, NamedField> = {};
  if (screen) {
    const collection = screen.form && Object.hasOwn(spec.collections, screen.form) ? spec.collections[screen.form] : undefined;
    for (const [id, def] of Object.entries(collection?.fields ?? {})) form[id] = { id, ...shapeOf(def) };
    for (const c of screen.children) {
      const field = 'field' in c ? c.field : undefined;
      if (!field) continue;
      const base = form[field];
      switch (c.type) {
        case 'number': case 'counter': form[field] = { ...base, id: field, type: 'number', label: c.label }; break;
        case 'textInput': form[field] = { ...base, id: field, type: 'text', label: c.label }; break;
        case 'date': form[field] = { ...base, id: field, type: 'date', label: c.label }; break;
        case 'toggle': form[field] = { ...base, id: field, type: 'boolean', label: c.label }; break;
        case 'choice': {
          const options = c.options ?? (base?.type === 'enum' ? base.options : undefined);
          form[field] = { ...base, id: field, type: 'enum', label: c.label, ...(options ? { options } : {}) };
          break;
        }
        default: break;
      }
    }
  }
  return {
    screenId: screen?.id,
    form,
    counters,
    scope: {
      collections: Object.fromEntries(Object.entries(spec.collections).map(([id, c]) => [id, Object.keys(c.fields)])),
      formFields: Object.keys(form),
      stateKeys: Object.keys(counters),
    },
  };
}
