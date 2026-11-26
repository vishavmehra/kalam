/**
 * "Open in Kalam" links (docs/18_MCP_SERVER.md). A validated spec travels in the URL fragment as
 * gzip + base64url, so it is never sent to a server: browsers keep the part after `#` on the device.
 *
 * Decoding trusts nothing in the link. It caps the size before and after decompression (a small link
 * cannot expand into a large allocation), then runs the full `validateSpec` with the strict schema.
 * The caller still previews the app and asks before saving (lead decision 16).
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { base64ToBytes, bytesToBase64 } from '../backup/base64';
import { stripImportedClaims } from '../backup/sanitize';
import type { SpecIssue } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { MAX_SPEC_BYTES, validateSpec } from '../spec/validate';

/** Format tag at the start of the fragment. A new encoding gets a new tag; old links keep working. */
export const IMPORT_LINK_PREFIX = 'k1.';
/** Opens the installed app (Expo Router route `/import`). A web base such as `https://host/import` also works. */
export const DEFAULT_IMPORT_BASE = 'kalam://import';
/** gzip adds at most a few hundred bytes to 100 KB of JSON, and base64 adds a third. */
export const MAX_FRAGMENT_CHARS = IMPORT_LINK_PREFIX.length + Math.ceil(((MAX_SPEC_BYTES + 1024) * 4) / 3);

export type EncodeLinkResult =
  | { ok: true; url: string; fragment: string; specBytes: number; linkChars: number }
  | { ok: false; message: string; errors: SpecIssue[] };
export type DecodeLinkResult =
  | { ok: true; spec: KalamSpec; warnings: SpecIssue[] }
  | { ok: false; message: string; errors: SpecIssue[] };

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const broken = (message: string): DecodeLinkResult => ({ ok: false, message, errors: [] });
const DAMAGED = 'This link is damaged or incomplete. Ask for a new link.';

const toBase64Url = (bytes: Uint8Array): string =>
  bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromBase64Url(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new Error('bad length');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** Validates the spec, then builds `<base>#k1.<gzip+base64url>`. An invalid spec never gets a link. */
export function encodeImportLink(spec: unknown, base: string = DEFAULT_IMPORT_BASE): EncodeLinkResult {
  const checked = validateSpec(spec);
  if (!checked.ok || !checked.spec) {
    return { ok: false, message: 'Fix the errors in this app before making a link.', errors: checked.errors };
  }
  const json = strToU8(JSON.stringify(checked.spec));
  // mtime 0 keeps the link the same for the same app.
  const fragment = IMPORT_LINK_PREFIX + toBase64Url(gzipSync(json, { level: 9, mtime: 0 }));
  const url = `${base.split('#')[0]}#${fragment}`;
  return { ok: true, url, fragment, specBytes: json.length, linkChars: url.length };
}

/**
 * Reads a whole URL or just its fragment. Returns the validated spec, or a plain message. Never
 * throws, whatever the input.
 */
export function decodeImportLink(urlOrFragment: string): DecodeLinkResult {
  if (typeof urlOrFragment !== 'string') return broken(DAMAGED);
  const hash = urlOrFragment.indexOf('#');
  const fragment = (hash >= 0 ? urlOrFragment.slice(hash + 1) : urlOrFragment).trim();
  if (!fragment) return broken('This link has no app in it.');
  if (!fragment.startsWith(IMPORT_LINK_PREFIX)) return broken('This is not a Kalam app link, or it needs a newer version of Kalam.');
  if (fragment.length > MAX_FRAGMENT_CHARS) return broken('This link is too large. An app can be at most 100 KB.');
  const data = fragment.slice(IMPORT_LINK_PREFIX.length);
  if (!BASE64URL_RE.test(data)) return broken(DAMAGED);

  let text: string;
  try {
    const gz = fromBase64Url(data);
    if (gz.length < 18 || gz[0] !== 0x1f || gz[1] !== 0x8b) return broken(DAMAGED);
    // The gzip trailer states the original size. Check it before inflating anything.
    const n = gz.length;
    const stated = (gz[n - 4] | (gz[n - 3] << 8) | (gz[n - 2] << 16) | (gz[n - 1] << 24)) >>> 0;
    if (stated > MAX_SPEC_BYTES) return broken('This link is too large. An app can be at most 100 KB.');
    // A fixed output buffer: fflate truncates anything longer, so a lying trailer cannot allocate more.
    const out = gunzipSync(gz, { out: new Uint8Array(MAX_SPEC_BYTES + 1) });
    if (out.length > MAX_SPEC_BYTES) return broken('This link is too large. An app can be at most 100 KB.');
    if (out.length !== stated) return broken(DAMAGED);
    text = strFromU8(out);
  } catch {
    return broken(DAMAGED);
  }

  return checkApp(text, 'link');
}

/** Full validation, then the AI-verification and provenance claims are reset and checked again. */
function checkApp(input: unknown, from: 'link' | 'file'): DecodeLinkResult {
  const checked = validateSpec(input);
  // An app from outside can claim AI blocks were verified or a cloud model made it. Reset that, as backup import does.
  const final = checked.ok && checked.spec ? validateSpec(stripImportedClaims(checked.spec)) : checked;
  if (!final.ok || !final.spec) {
    return { ok: false, message: `The app in this ${from} did not pass Kalam checks, so it was not opened.`, errors: final.errors };
  }
  return { ok: true, spec: final.spec, warnings: final.warnings };
}

/**
 * The app in an app file: what kalam_package_app and kalam_workspace_write make, and what the app's
 * "Design only" export makes (a kalam-backup with exactly one app), or a bare spec. The same checks
 * as a link. Records in the file are ignored. Never throws. The caller previews and asks before saving.
 */
export function decodeAppFile(json: unknown): DecodeLinkResult {
  const file = json as { format?: unknown; apps?: unknown } | null;
  if (file && typeof file === 'object' && file.format === 'kalam-backup') {
    const apps = Array.isArray(file.apps) ? file.apps : [];
    const app = apps.length === 1 ? (apps[0] as { spec?: unknown } | null) : null;
    if (!app || typeof app !== 'object' || app.spec === undefined) return broken('This file does not hold exactly one Kalam app.');
    return checkApp(app.spec, 'file');
  }
  return checkApp(json, 'file');
}
