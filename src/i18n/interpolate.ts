/**
 * `{name}` interpolation. `{{` and `}}` write a literal brace. Pure TypeScript.
 * Numbers go through `formatNumber` so 1234567 reads as 12,34,567 in en-IN. Pass a string to keep a number as typed.
 */
import type { TranslateParams } from './types';

const TOKEN = /\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export interface InterpolateHooks {
  formatNumber(value: number): string;
  /** Called once for each placeholder that has no value. */
  onMissingParam?(name: string): void;
}

export function interpolate(template: string, params: TranslateParams | undefined, hooks: InterpolateHooks): string {
  if (!template.includes('{') && !template.includes('}')) return template;
  return template.replace(TOKEN, (match, name: string | undefined) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    const value = name === undefined ? undefined : params?.[name];
    if (value === undefined || value === null) {
      if (name !== undefined) hooks.onMissingParam?.(name);
      return '';
    }
    if (typeof value === 'number') return hooks.formatNumber(value);
    return String(value);
  });
}

/** Placeholder names in a template, in order, without duplicates. Used by catalogue checks. */
export function placeholdersOf(template: string): string[] {
  const names: string[] = [];
  for (const m of template.matchAll(TOKEN)) {
    const name = m[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
