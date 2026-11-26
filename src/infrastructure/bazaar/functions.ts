/**
 * Callables of the trusted Bazaar functions (functions/src/bazaar, codebase `kalam`). Paid
 * purchases, wallets and moderation never happen on the client (docs/12 §12.6, §17.6).
 * Credits are off unless EXPO_PUBLIC_BAZAAR_PAYMENTS=on, because they need those functions deployed.
 */
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { getFirebaseApp } from '@/infrastructure/firebase/app';
import { emulatorAddress } from '@/infrastructure/specialist/specialist-provider';

let functions: Functions | undefined;

export function bazaarPaymentsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_BAZAAR_PAYMENTS === 'on';
}

function instance(): Functions | undefined {
  if (functions) return functions;
  const app = getFirebaseApp();
  if (!app) return undefined;
  functions = getFunctions(app);
  const emulator = emulatorAddress();
  if (emulator) connectFunctionsEmulator(functions, emulator.host, emulator.port);
  return functions;
}

export type CallResult<T> = { ok: true; data: T } | { ok: false; message: string; code?: string };

/** Calls a trusted function and turns errors into plain sentences (the server sends safe messages). */
export type BazaarFunctionName =
  | 'kalamBazaarWallet' | 'kalamBazaarPurchase'
  | 'kalamBazaarModerate' | 'kalamBazaarModerationList' | 'kalamBazaarCount' | 'kalamBazaarStats';

export async function callBazaar<Req, Res>(name: BazaarFunctionName, data: Req): Promise<CallResult<Res>> {
  const f = instance();
  if (!f) return { ok: false, message: 'Kalam Bazaar is not set up in this build.' };
  try {
    const res = await httpsCallable<Req, Res>(f, name, { timeout: 30_000 })(data);
    return { ok: true, data: res.data };
  } catch (e) {
    const err = e as { code?: string; message?: string; details?: { kalamCode?: string } };
    const code = err.details?.kalamCode ?? err.code;
    if (err.code === 'functions/not-found' || (err.code === 'functions/internal' && !err.details)) {
      return { ok: false, code, message: 'Credits are not switched on yet. Paid apps cannot be bought right now.' };
    }
    if (err.code === 'functions/unavailable' || err.code === 'functions/deadline-exceeded') {
      return { ok: false, code, message: 'Could not reach Kalam Bazaar. Check your connection and try again.' };
    }
    // Server messages from functions/src/bazaar/plan.ts are written for people; others are not shown.
    const safe = err.details?.kalamCode && err.message && !/[{}<>]/.test(err.message) ? err.message : undefined;
    return { ok: false, code, message: safe ?? 'That did not work. Please try again.' };
  }
}
