/**
 * The Maestro flows on phones (.maestro) name screens by test id and by the words on the screen. A renamed button breaks
 * them silently until the next CI run on an emulator. This test keeps them honest from a laptop:
 *   - every `id:` a flow taps exists as a testID in the source;
 *   - every word a flow looks for appears somewhere in the app's text (the English catalogue or the source).
 * It is a drift alarm, not a replacement for running the flows. Whole phrases are not checked (some labels are built from
 * parts at run time), only their fixed words.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

function walk(dir: string, accept: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}

const flowFiles = ['.maestro/flows', '.maestro/live']
  .map((d) => join(ROOT, d))
  .filter(existsSync)
  .flatMap((d) => walk(d, (f) => f.endsWith('.yaml')));

const sources = walk(join(ROOT, 'src'), (f) => /\.(tsx?|json)$/.test(f) && !/\.test\./.test(f));
const haystack = sources.map((f) => readFileSync(f, 'utf8')).join('\n').toLowerCase();
const testIds = new Set(sources.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/testID(?:=|: )\{?["'`]([\w-]+)["'`]/g)].map((m) => m[1]!)));

/** The quoted strings after tapOn, assertVisible, assertNotVisible, visible and element, and the ids. */
function references(text: string) {
  const strings: string[] = [];
  const ids: string[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const quoted = /^\s*(?:-\s*)?(?:tapOn|assertVisible|assertNotVisible|visible|element|text):\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (quoted) strings.push(quoted[1]!);
    const id = /^\s*id:\s*([\w-]+)\s*$/.exec(line);
    if (id) ids.push(id[1]!);
  }
  return { strings, ids };
}

/** The words of 4 or more letters left once the regular-expression parts are taken out. */
const fixedWords = (pattern: string) =>
  pattern
    .replace(/\\\\./g, ' ')
    .replace(/\(\?:?|\)|\||\.\*|\.\+|\[[^\]]*\]|[?*+^$\\]/g, ' ')
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length >= 4);

describe('Maestro flows', () => {
  it('there are flows to check', () => {
    expect(flowFiles.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of flowFiles) {
    const name = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const { strings, ids } = references(readFileSync(file, 'utf8'));

    it(`${name}: every test id it uses is in the source`, () => {
      const missing = ids.filter((id) => !testIds.has(id));
      expect(missing).toEqual([]);
    });

    it(`${name}: every fixed word it looks for is in the app's text`, () => {
      const missing = strings.flatMap((s) => fixedWords(s)).filter((w) => !haystack.includes(w.toLowerCase()));
      expect([...new Set(missing)]).toEqual([]);
    });
  }

  it('the offline flow always turns airplane mode back off, even when it fails', () => {
    const offline = readFileSync(join(ROOT, '.maestro/flows/08-offline.yaml'), 'utf8');
    expect(offline).toMatch(/onFlowComplete:[\s\S]*setAirplaneMode: disabled/);
  });

  it('the phone flows start from a stopped process, so they do not depend on each other\'s screen', () => {
    for (const f of ['09-drawing', '10-cloud-needed-without-cloud', '11-back-and-keyboard']) {
      expect(readFileSync(join(ROOT, `.maestro/flows/${f}.yaml`), 'utf8')).toMatch(/- stopApp\n- launchApp/);
    }
  });
});
