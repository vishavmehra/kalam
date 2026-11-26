/**
 * Client for kalamCollabJoin (functions/src/collab), the one trusted step in sharing: it checks an
 * invite and adds the caller as a member, which clients may never do for themselves. App Check and
 * Firebase Auth tokens are attached by the SDK.
 */
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { z } from 'zod';
import { roleSchema, SHARED_ID_RE, TEAM_ID_RE, type CollabRemote } from '@/core/collab';
import { getFirebaseApp } from '@/infrastructure/firebase/app';
import { emulatorAddress } from '@/infrastructure/specialist/specialist-provider';

let functions: Functions | undefined;

function instance(): Functions | undefined {
  if (functions) return functions;
  const app = getFirebaseApp();
  if (!app) return undefined;
  functions = getFunctions(app);
  const emulator = emulatorAddress();
  if (emulator) connectFunctionsEmulator(functions, emulator.host, emulator.port);
  return functions;
}

const joinResponseSchema = z.object({
  kind: z.enum(['app', 'team']),
  id: z.string(),
  role: roleSchema,
  already: z.boolean(),
}).refine((r) => (r.kind === 'app' ? SHARED_ID_RE : TEAM_ID_RE).test(r.id));

export const callCollabJoin: CollabRemote['join'] = async (token) => {
  const f = instance();
  if (!f) return { ok: false, error: 'not_set_up' };
  try {
    const res = await httpsCallable<{ token: string }, unknown>(f, 'kalamCollabJoin', { timeout: 20_000 })({ token });
    const parsed = joinResponseSchema.safeParse(res.data);
    if (!parsed.success) return { ok: false, error: 'invalid' };
    return { ok: true, value: { target: { kind: parsed.data.kind, id: parsed.data.id }, role: parsed.data.role, already: parsed.data.already } };
  } catch (e) {
    const x = e as { code?: string; message?: string; details?: { kalamCode?: string } };
    // The function never throws not-found itself, so this means it is not deployed.
    if (x.code === 'functions/not-found') return { ok: false, error: 'not_set_up' };
    if (x.code === 'functions/unavailable' || x.code === 'functions/deadline-exceeded') return { ok: false, error: 'offline' };
    // Server messages from functions/src/collab/plan.ts are written for people; anything else is not shown.
    const message = x.details?.kalamCode && x.message && !/[{}<>]/.test(x.message) ? x.message : undefined;
    if (x.code === 'functions/permission-denied' || x.code === 'functions/failed-precondition' || x.code === 'functions/invalid-argument') {
      return { ok: false, error: 'denied', message };
    }
    if (x.code === 'functions/unauthenticated') return { ok: false, error: 'denied', message };
    return { ok: false, error: 'unavailable' };
  }
};
