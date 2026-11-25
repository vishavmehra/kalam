import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKalamServer } from '../src/server';
import { MAX_FILE_BYTES, openWorkspace, readAppFile, resolveInWorkspace, writeAppFile, type Workspace } from '../src/workspace';
import { connect, data, fixture, text } from './helpers';

let dir: string;
let outside: string;
let ws: Workspace;
const spec = fixture('notes-app');

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kalam-ws-'));
  outside = await mkdtemp(path.join(tmpdir(), 'kalam-out-'));
  ws = await openWorkspace(dir);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('workspace paths', () => {
  it('allows plain names only, directly inside the folder', () => {
    expect(resolveInWorkspace(ws, 'notes')).toBe(path.join(ws.root, 'notes.kalam.json'));
    expect(resolveInWorkspace(ws, 'my notes.kalam.json')).toBe(path.join(ws.root, 'my notes.kalam.json'));
    for (const bad of [
      '../notes', '..\\notes', 'sub/notes', 'sub\\notes', '/etc/passwd', 'C:\\Windows\\win', 'C:notes', '..',
      '.hidden', 'a..b', 'CON', 'nul.kalam.json', 'x'.repeat(90), 'notes\u0000', '%2e%2e/notes', 'notes.kalam.json/../../x',
    ]) {
      expect(resolveInWorkspace(ws, bad), bad).toBeUndefined();
    }
  });

  it('writes the importable file, reads it back, and never overwrites by accident', async () => {
    const w = await writeAppFile(ws, 'notes', spec, false, 1_800_000_000_000);
    expect(w.isError).toBeFalsy();
    const file = JSON.parse(await readFile(path.join(ws.root, 'notes.kalam.json'), 'utf8'));
    expect(file.format).toBe('kalam-backup');
    const again = await writeAppFile(ws, 'notes', spec);
    expect(again.isError).toBe(true);
    expect(text(again)).toMatch(/already exists/);
    expect((await writeAppFile(ws, 'notes', spec, true)).isError).toBeFalsy();
    const r = data(await readAppFile(ws, 'notes.kalam.json'));
    expect(r.ok).toBe(true);
    expect(r.spec.name).toBe(spec.name);
  });

  it('refuses invalid specs, traversal, big files and links', async () => {
    expect((await writeAppFile(ws, 'bad', { id: 'x' })).isError).toBe(true);
    expect((await writeAppFile(ws, '../escape', spec)).isError).toBe(true);
    expect((await readAppFile(ws, '../../etc/passwd')).isError).toBe(true);
    expect((await readAppFile(ws, 'missing')).isError).toBe(true);
    await writeFile(path.join(ws.root, 'big.kalam.json'), ' '.repeat(MAX_FILE_BYTES + 1));
    expect(text(await readAppFile(ws, 'big'))).toMatch(/larger than 1 MB/);
    await writeFile(path.join(outside, 'secret.kalam.json'), JSON.stringify(spec));
    let linked = true;
    try {
      await symlink(path.join(outside, 'secret.kalam.json'), path.join(ws.root, 'link.kalam.json'));
    } catch {
      linked = false; // Windows without developer mode cannot make symbolic links.
    }
    if (linked) {
      expect(text(await readAppFile(ws, 'link'))).toMatch(/Links are not followed/);
      expect((await writeAppFile(ws, 'link', spec, true)).isError).toBe(true);
    }
  });

  it('reads a bare spec file too, and reports invalid ones', async () => {
    await writeFile(path.join(ws.root, 'bare.kalam.json'), JSON.stringify(spec));
    expect(data(await readAppFile(ws, 'bare')).ok).toBe(true);
    await writeFile(path.join(ws.root, 'broken.kalam.json'), '{"format":"kalam-backup","apps":[]}');
    expect(data(await readAppFile(ws, 'broken')).ok).toBe(false);
  });

  it('registers the file tools only with a workspace', async () => {
    const client = await connect(createKalamServer({ workspace: ws }));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['kalam_workspace_list', 'kalam_workspace_read', 'kalam_workspace_write']));
    const list = data(await client.callTool({ name: 'kalam_workspace_list', arguments: {} }));
    expect(list.files.map((f: { name: string }) => f.name)).toContain('notes.kalam.json');
    const escape = await client.callTool({ name: 'kalam_workspace_write', arguments: { name: '../x', spec } });
    expect(escape.isError).toBe(true);
    await client.close();
  });
});
