/**
 * Marketplace updates (docs/12 §10.3-10.4, §11.4): compatibility check and a plain-language
 * summary of what changed between the installed copy and the new published version. Installed
 * apps are never overwritten silently; the UI offers view / install / keep / review differences.
 */
import { SCHEMA_VERSION, type KalamSpec } from '../spec/schema';

/** Same major version and a minor this build understands (docs/05 §6.5). */
export function isCompatible(kalamSpecVersion: string, current: string = SCHEMA_VERSION): boolean {
  const [maj = NaN, min = NaN] = kalamSpecVersion.split('.').map(Number);
  const [curMaj = NaN, curMin = NaN] = current.split('.').map(Number);
  return maj === curMaj && min <= curMin;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a person would notice. Empty when the designs are identical. */
export function diffSpecs(from: KalamSpec, to: KalamSpec): string[] {
  const out: string[] = [];
  if (from.name !== to.name) out.push(`Renamed from "${from.name}" to "${to.name}".`);
  const fromScreens = new Map(from.screens.map((s) => [s.id, s]));
  const toScreens = new Map(to.screens.map((s) => [s.id, s]));
  for (const [id, s] of toScreens) {
    const old = fromScreens.get(id);
    if (!old) out.push(`New screen: ${s.title}.`);
    else if (!same(old, s)) out.push(`Changed screen: ${s.title}.`);
  }
  for (const [id, s] of fromScreens) if (!toScreens.has(id)) out.push(`Removed screen: ${s.title}.`);

  const label = (spec: KalamSpec, id: string) => spec.collections[id]?.label || id;
  for (const [id, c] of Object.entries(to.collections)) {
    const old = from.collections[id];
    if (!old) { out.push(`New list: ${label(to, id)}.`); continue; }
    for (const [fid, f] of Object.entries(c.fields)) {
      if (!old.fields[fid]) out.push(`New field in ${label(to, id)}: ${f.label}.`);
      else if (!same(old.fields[fid], f)) out.push(`Changed field in ${label(to, id)}: ${f.label}.`);
    }
    for (const [fid, f] of Object.entries(old.fields)) {
      if (!c.fields[fid]) out.push(`Removed field from ${label(to, id)}: ${f.label}. Values you saved in it are kept but no longer shown.`);
    }
  }
  for (const id of Object.keys(from.collections)) {
    if (!to.collections[id]) out.push(`Removed list: ${label(from, id)}. Entries you saved in it are kept but no longer shown.`);
  }

  const changedActions = new Set([...Object.keys(from.actions), ...Object.keys(to.actions)])
    .size - Object.keys(from.actions).filter((id) => to.actions[id] && same(from.actions[id], to.actions[id])).length;
  if (changedActions > 0) out.push(`${plural(changedActions, 'button action', 'button actions')} added or changed.`);
  const aiAdded = Object.keys(to.aiBlocks).filter((id) => !from.aiBlocks[id]).length;
  const aiRemoved = Object.keys(from.aiBlocks).filter((id) => !to.aiBlocks[id]).length;
  if (aiAdded) out.push(`${plural(aiAdded, 'new AI feature', 'new AI features')}.`);
  if (aiRemoved) out.push(`${plural(aiRemoved, 'AI feature', 'AI features')} removed.`);
  if (!same(from.theme, to.theme) || !same(from.icon, to.icon)) out.push('New colours, style or icon.');
  return out;
}
