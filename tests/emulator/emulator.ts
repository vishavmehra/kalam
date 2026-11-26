/**
 * Small helpers for talking to the Firebase emulators over their public REST interfaces (Auth, Firestore, and the
 * callable protocol of Cloud Functions). No Admin SDK and no secret: the emulators accept the bearer "owner" for
 * trusted calls. The project id is a demo id, so nothing here can reach a real Firebase project.
 */
export const PROJECT = 'demo-kalam';
export const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
export const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
export const FUNCTIONS_BASE = `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001'}/${PROJECT}/us-central1`;
export const DATABASE = 'kalam';
export const PASSWORD = 'a-long-test-passphrase';

const IDENTITY = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

export interface Session { uid: string; idToken: string; refreshToken: string; email?: string }

async function post(url: string, body: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, json };
}

const toSession = (j: Record<string, any>): Session => ({ uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, email: j.email });

/** A fresh email and password account. */
export async function signUp(label: string): Promise<Session> {
  const email = `${label}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { status, json } = await post(`${IDENTITY}/accounts:signUp?key=demo`, { email, password: PASSWORD, returnSecureToken: true });
  if (status !== 200) throw new Error(`sign up failed: ${status} ${JSON.stringify(json)}`);
  return toSession(json);
}

/** An anonymous session, as an older build of Kalam could leave behind. */
export async function signUpAnonymous(): Promise<Session> {
  const { status, json } = await post(`${IDENTITY}/accounts:signUp?key=demo`, { returnSecureToken: true });
  if (status !== 200) throw new Error(`anonymous sign up failed: ${status}`);
  return toSession(json);
}

/** Sets custom claims through the emulator's trusted endpoint, then returns a token that carries them. */
export async function withClaims(session: Session, claims: Record<string, unknown>): Promise<Session> {
  const set = await post(`${IDENTITY}/projects/${PROJECT}/accounts:update`, { localId: session.uid, customAttributes: JSON.stringify(claims) }, OWNER);
  if (set.status !== 200) throw new Error(`setting claims failed: ${set.status}`);
  const refreshed = await post(`http://${AUTH_HOST}/securetoken.googleapis.com/v1/token?key=demo`, { grant_type: 'refresh_token', refresh_token: session.refreshToken });
  if (refreshed.status !== 200) throw new Error(`token refresh failed: ${refreshed.status}`);
  return { ...session, idToken: refreshed.json.id_token, refreshToken: refreshed.json.refresh_token };
}

/** The payload of an ID token. The emulator's tokens are unsigned, so this only reads them. */
export function tokenClaims(idToken: string): Record<string, any> {
  return JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
}

export interface CallResult { status: number; ok: boolean; result?: any; error?: { status: string; message: string } }

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/**
 * An unsigned App Check token. The Functions emulator does not verify signatures but still requires the header
 * when a function sets enforceAppCheck, so this stands in for the token a real client gets from reCAPTCHA or
 * Play Integrity. Pass `appCheck: false` to prove that a call without one is refused.
 */
const fakeAppCheckToken = () =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '1:1:web:kalamtest', aud: [`projects/${PROJECT}`], iss: `https://firebaseappcheck.googleapis.com/${PROJECT}`, exp: Math.floor(Date.now() / 1000) + 3600 })}.`;

/** Calls an HTTPS callable the way the Firebase SDK does: POST {data}, optional bearer ID token and App Check token. */
export async function callFunction(name: string, data: unknown, session?: Session, opts: { appCheck?: boolean } = {}): Promise<CallResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) headers.Authorization = `Bearer ${session.idToken}`;
  if (opts.appCheck !== false) headers['X-Firebase-AppCheck'] = fakeAppCheckToken();
  const { status, json } = await post(`${FUNCTIONS_BASE}/${name}`, { data }, headers);
  return { status, ok: status === 200 && 'result' in json, result: json.result, error: json.error };
}

// Firestore REST value encoding, just enough for the documents these tests write and read.
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
function encode(v: Json): Record<string, unknown> {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
}
function decode(v: Record<string, any>): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, decode(x as Record<string, any>)]));
  return null;
}
const docUrl = (path: string) => `http://${FIRESTORE_HOST}/v1/projects/${PROJECT}/databases/${DATABASE}/documents/${path}`;

/** Writes a document as the emulator owner (rules do not apply), the way the Admin SDK would. */
export async function seedDocument(path: string, fields: Record<string, Json>): Promise<void> {
  const res = await fetch(docUrl(path), { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)])) }) });
  if (!res.ok) throw new Error(`seeding ${path} failed: ${res.status}`);
}

/** Reads a document as the emulator owner. Undefined when it does not exist. */
export async function readDocument(path: string): Promise<Record<string, any> | undefined> {
  const res = await fetch(docUrl(path), { headers: OWNER });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`reading ${path} failed: ${res.status}`);
  const json = (await res.json()) as { fields?: Record<string, Record<string, any>> };
  return Object.fromEntries(Object.entries(json.fields ?? {}).map(([k, v]) => [k, decode(v)]));
}

/** A listing id the callables accept: "l" and 19 lowercase letters or digits. */
export const listingId = (suffix: string) => `l${suffix.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(19, '0').slice(0, 19)}`;
