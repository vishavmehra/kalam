/**
 * Applies constrained patch ops (docs/07 §15.3) to a spec. Immutable: works on a deep copy and
 * returns the re-validated result, so every edit passes the same checks as a freshly generated app.
 * Does NOT bump `version` / `meta.updatedAt` — the edit service / repository owns versioning.
 */
import type { PatchResult, SpecIssue, SpecPatchOp } from '../contracts';
import { FONT_FAMILIES, type KalamComponent, type KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { parsePatchOp } from './ops';
import { THEME_PRESET_TOKENS } from './presets';

const MAX_OPS = 100;
const LOCKED_PROPERTIES = new Set(['id', 'type', 'constructor', 'prototype']);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const own = (obj: object, k: string): boolean => Object.prototype.hasOwnProperty.call(obj, k);

/** `#abc` / `#AABBCC` → `#AABBCC`; anything else → undefined. */
export function normalizeHex(value: string): string | undefined {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase() : undefined;
}

function findComponent(spec: KalamSpec, id: string): { children: KalamComponent[]; index: number } | undefined {
  for (const s of spec.screens) {
    const index = s.children.findIndex((c) => c.id === id);
    if (index >= 0) return { children: s.children, index };
  }
  return undefined;
}

/** Applies one op to the draft in place. Returns an error message or undefined. */
function applyOne(d: KalamSpec, op: SpecPatchOp): string | undefined {
  switch (op.op) {
    case 'setThemeToken': {
      const hex = normalizeHex(op.value);
      if (!hex) return `"${op.value}" is not a colour like #1F6F5C`;
      d.theme[op.token] = hex;
      delete d.theme.preset; // custom colours no longer match a named preset
      return undefined;
    }
    case 'setThemeNumber':
      if (op.token === 'radius') d.theme.radius = clamp(Math.round(op.value), 0, 32);
      else d.theme.fontScale = clamp(Math.round(op.value * 100) / 100, 0.8, 1.6);
      return undefined;
    case 'setThemePreset':
      Object.assign(d.theme, THEME_PRESET_TOKENS[op.preset], { preset: op.preset });
      return undefined;
    case 'setThemeOption':
      if (op.option === 'fontFamily') {
        if (!(FONT_FAMILIES as readonly string[]).includes(op.value)) return `Unknown font "${op.value}".`;
        d.theme.fontFamily = op.value as (typeof FONT_FAMILIES)[number];
      } else {
        if (!['compact', 'comfortable', 'spacious'].includes(op.value)) return `Unknown spacing "${op.value}".`;
        d.theme.spacing = op.value as 'compact' | 'comfortable' | 'spacious';
      }
      return undefined;
    case 'setAppName': d.name = op.value.trim(); return undefined;
    case 'setLanguage': d.lang = op.value; return undefined;
    case 'renameComponent': {
      const at = findComponent(d, op.component);
      if (!at) return `Component "${op.component}" does not exist`;
      (at.children[at.index] as { label?: string }).label = op.label;
      return undefined;
    }
    case 'setComponentProperty': {
      const at = findComponent(d, op.component);
      if (!at) return `Component "${op.component}" does not exist`;
      if (LOCKED_PROPERTIES.has(op.property)) return `"${op.property}" cannot be changed`;
      (at.children[at.index] as unknown as Record<string, unknown>)[op.property] = op.value;
      return undefined;
    }
    case 'addComponent': {
      const screen = d.screens.find((s) => s.id === op.screen);
      if (!screen) return `Screen "${op.screen}" does not exist`;
      if (findComponent(d, op.component.id)) return `Component id "${op.component.id}" is already used`;
      screen.children.splice(clamp(op.index ?? screen.children.length, 0, screen.children.length), 0, op.component);
      return undefined;
    }
    case 'removeComponent': {
      const at = findComponent(d, op.component);
      if (!at) return `Component "${op.component}" does not exist`;
      at.children.splice(at.index, 1);
      return undefined;
    }
    case 'moveComponent': {
      const at = findComponent(d, op.component);
      if (!at) return `Component "${op.component}" does not exist`;
      const to = at.index + (op.direction === 'up' ? -1 : 1);
      if (to < 0 || to >= at.children.length) return undefined; // already at the edge
      const [moved] = at.children.splice(at.index, 1);
      if (moved) at.children.splice(to, 0, moved);
      return undefined;
    }
    case 'addScreen': {
      if (d.screens.some((s) => s.id === op.screen.id)) return `Screen id "${op.screen.id}" is already used`;
      const after = op.after ? d.screens.findIndex((s) => s.id === op.after) : -1;
      if (op.after && after < 0) return `Screen "${op.after}" does not exist`;
      d.screens.splice(after >= 0 ? after + 1 : d.screens.length, 0, op.screen);
      return undefined;
    }
    case 'removeScreen': {
      const i = d.screens.findIndex((s) => s.id === op.screen);
      if (i < 0) return `Screen "${op.screen}" does not exist`;
      if (d.screens.length === 1) return 'An app needs at least one screen';
      d.screens.splice(i, 1);
      if (d.initialScreen === op.screen) d.initialScreen = (d.screens[0] as { id: string }).id;
      return undefined;
    }
    case 'renameScreen': {
      const screen = d.screens.find((s) => s.id === op.screen);
      if (!screen) return `Screen "${op.screen}" does not exist`;
      screen.title = op.title;
      return undefined;
    }
    case 'addCollection':
      if (own(d.collections, op.id)) return `Collection "${op.id}" already exists`;
      d.collections[op.id] = op.collection;
      return undefined;
    case 'updateCollectionField': {
      const col = own(d.collections, op.collection) ? d.collections[op.collection] : undefined;
      if (!col) return `Collection "${op.collection}" does not exist`;
      col.fields[op.field] = op.definition;
      return undefined;
    }
    case 'addAction':
      if (own(d.actions, op.id)) return `Action "${op.id}" already exists`;
      d.actions[op.id] = op.action;
      return undefined;
    case 'addAIBlock':
      if (own(d.aiBlocks, op.id)) return `AI block "${op.id}" already exists`;
      d.aiBlocks[op.id] = op.block;
      return undefined;
  }
}

const opError = (index: number, code: string, message: string): SpecIssue => ({
  code, path: `ops[${index}]`, message: `Change ${index + 1}: ${message}`, severity: 'error', recoverable: true,
});

/** Applies ops in order, then validates. Never mutates `spec` or `ops`. */
export function applyPatchOps(spec: KalamSpec, ops: readonly SpecPatchOp[]): PatchResult {
  if (!Array.isArray(ops)) return { ok: false, errors: [opError(0, 'PATCH_INVALID', 'Changes must be a list')] };
  if (ops.length > MAX_OPS) return { ok: false, errors: [opError(MAX_OPS, 'PATCH_TOO_LARGE', `At most ${MAX_OPS} changes at once`)] };
  const draft = JSON.parse(JSON.stringify(spec)) as KalamSpec;
  for (let i = 0; i < ops.length; i++) {
    const parsed = parsePatchOp(ops[i]);
    if (!parsed.success) return { ok: false, errors: [opError(i, 'PATCH_INVALID', parsed.error)] };
    const problem = applyOne(draft, JSON.parse(JSON.stringify(parsed.data)) as SpecPatchOp);
    if (problem) return { ok: false, errors: [opError(i, 'PATCH_FAILED', problem)] };
  }
  const result = validateSpec(draft);
  return result.ok ? { ok: true, spec: result.spec, errors: [] } : { ok: false, errors: result.errors };
}
