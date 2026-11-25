/**
 * Optional file access (--workspace <dir>). Only `*.kalam.json` files directly inside that one folder:
 * no subfolders, no `..`, no absolute paths, no symbolic links, size caps on read. Files are the
 * importable app format, so Kalam can open them with Settings, Storage, Import.
 */
import { lstat, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { validateSpec } from '@/core/spec/validate';
import { appFile, fail, isResult, needValid, ok, specInput, withHints } from './tools';

export const SUFFIX = '.kalam.json';
export const MAX_FILE_BYTES = 1_000_000;
const MAX_LISTED = 500;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;
// Windows device names stay devices even with an extension (CON.kalam.json).
const DEVICE_RE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

export interface Workspace { root: string }

export async function openWorkspace(dir: string): Promise<Workspace> {
  const root = await realpath(path.resolve(dir));
  if (!(await stat(root)).isDirectory()) throw new Error(`${dir} is not a folder.`);
  return { root };
}

/** A direct child of the workspace named `<name>.kalam.json`, or undefined for anything else. */
export function resolveInWorkspace(ws: Workspace, name: string): string | undefined {
  const base = name.endsWith(SUFFIX) ? name : name + SUFFIX;
  if (!NAME_RE.test(base) || base.includes('..') || DEVICE_RE.test(base) || base.length > 96) return undefined;
  const full = path.resolve(ws.root, base);
  return path.dirname(full) === ws.root && path.basename(full) === base ? full : undefined;
}

const BAD_NAME = 'Use a plain file name such as "expenses" or "expenses.kalam.json": letters, digits, spaces, dots, _ and -. No folders.';

export async function listFiles(ws: Workspace): Promise<CallToolResult> {
  const entries = await readdir(ws.root, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (files.length >= MAX_LISTED) break;
    if (!e.isFile() || !e.name.endsWith(SUFFIX)) continue;
    const s = await stat(path.join(ws.root, e.name));
    files.push({ name: e.name, bytes: s.size, modified: s.mtime.toISOString() });
  }
  return ok({ files });
}

/** The spec inside a file: a one-app kalam-backup (what Kalam exports) or a bare spec. */
function specFrom(json: unknown): unknown {
  const b = json as { format?: unknown; apps?: Array<{ spec?: unknown }> } | null;
  if (b && b.format === 'kalam-backup') return Array.isArray(b.apps) && b.apps.length ? b.apps[0]?.spec : undefined;
  return json;
}

export async function readAppFile(ws: Workspace, name: string): Promise<CallToolResult> {
  const full = resolveInWorkspace(ws, name);
  if (!full) return fail(BAD_NAME);
  let info;
  try { info = await lstat(full); } catch { return fail(`There is no file called ${path.basename(full)} in the workspace.`); }
  if (info.isSymbolicLink() || !info.isFile()) return fail('Only ordinary files can be read. Links are not followed.');
  if (info.size > MAX_FILE_BYTES) return fail('This file is larger than 1 MB.');
  let json: unknown;
  try { json = JSON.parse(await readFile(full, 'utf8')); } catch { return fail('This file is not valid JSON.'); }
  const r = validateSpec(specFrom(json) ?? null);
  return ok({ name: path.basename(full), ok: r.ok, spec: r.spec, errors: withHints(r.errors), warnings: withHints(r.warnings) });
}

export async function writeAppFile(ws: Workspace, name: string, spec: unknown, overwrite = false, now = Date.now()): Promise<CallToolResult> {
  const full = resolveInWorkspace(ws, name);
  if (!full) return fail(BAD_NAME);
  const v = needValid(spec);
  if (isResult(v)) return v;
  const existing = await lstat(full).catch(() => undefined);
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) return fail('That name is taken by a link or a folder.');
  if (existing && !overwrite) return fail(`${path.basename(full)} already exists. Pass overwrite: true to replace it.`);
  const { file } = appFile(v.spec, now);
  // ponytail: check-then-write; a race with another local process could still swap the file. Fine for one user's folder.
  try {
    await writeFile(full, file, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
  } catch {
    return fail('Kalam could not write that file.');
  }
  return ok({ name: path.basename(full), bytes: Buffer.byteLength(file), warnings: withHints(v.warnings) });
}

const nameInput = z.string().min(1).max(96).describe('A file name in the workspace, such as "expenses" or "expenses.kalam.json".');
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function registerWorkspaceTools(server: McpServer, ws: Workspace): void {
  server.registerTool('kalam_workspace_list', {
    title: 'List app files',
    description: 'Lists the *.kalam.json app files in the workspace folder the person chose.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => listFiles(ws));
  server.registerTool('kalam_workspace_read', {
    title: 'Read an app file',
    description: 'Reads one *.kalam.json file from the workspace and validates the app in it.',
    inputSchema: { name: nameInput }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ name }) => readAppFile(ws, name));
  server.registerTool('kalam_workspace_write', {
    title: 'Save an app file',
    description: 'Validates a spec and saves it as an importable *.kalam.json file in the workspace. Never replaces a file unless overwrite is true.',
    inputSchema: { name: nameInput, spec: specInput, overwrite: z.boolean().default(false) }, annotations: RW,
  }, ({ name, spec, overwrite }) => writeAppFile(ws, name, spec, overwrite));
}
