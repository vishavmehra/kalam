/**
 * Kalam Cloud Functions (codebase "kalam"). Every exported name is prefixed `kalam` because the
 * Firebase project is shared with another app.
 *
 * `kalamSpecialistReason` — the only path to Claude / Nebius (docs/07 §7.4, §8.4, CP8/CP9):
 * App Check enforced, secrets from Secret Manager, strict request validation + size limits,
 * a per-task allowlist, timeouts, server-side output validation, and a usage log that records
 * task / provider / model / latency / tokens only — never user content.
 */
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall, type FunctionsErrorCode } from 'firebase-functions/https';
import { SpecialistError, TASK_CONFIG, runSpecialistTask, type KalamErrorCode } from './providers.js';
import { createRateLimiter } from './rate-limit.js';
import { specialistRequestSchema } from './schemas.js';

const ANTHROPIC_API_KEY = defineSecret('KALAM_ANTHROPIC_API_KEY');
const NEBIUS_API_KEY = defineSecret('KALAM_NEBIUS_API_KEY');

const limiter = createRateLimiter({ windowMs: 10 * 60_000, maxPerWindow: 30, maxKeys: 5_000 });

const HTTPS_CODE: Record<KalamErrorCode, FunctionsErrorCode> = {
  not_configured: 'failed-precondition',
  timeout: 'deadline-exceeded',
  invalid_output: 'internal',
  provider_error: 'unavailable',
  quota: 'resource-exhausted',
};

export const kalamSpecialistReason = onCall(
  {
    enforceAppCheck: true,
    // Each App Check token works once (client sends limited-use tokens): a captured token cannot be replayed (R-01c).
    consumeAppCheckToken: true,
    secrets: [ANTHROPIC_API_KEY, NEBIUS_API_KEY],
    timeoutSeconds: 150,
    memory: '512MiB',
    maxInstances: 3,
  },
  async (request) => {
    const started = Date.now();
    const clientKey = request.app?.appId ?? request.rawRequest.ip ?? 'unknown';
    if (limiter.limited(`${clientKey}:${request.rawRequest.ip ?? ''}`)) {
      throw new HttpsError('resource-exhausted', 'Too many specialist requests. Try again in a few minutes.', { kalamCode: 'quota' });
    }

    const parsed = specialistRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      const where = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new HttpsError('invalid-argument', `Invalid specialist request: ${where}`, { kalamCode: 'provider_error' });
    }
    const req = parsed.data;
    const cfg = TASK_CONFIG[req.task];
    const model = cfg.model();
    const apiKey = (cfg.provider === 'claude' ? ANTHROPIC_API_KEY : NEBIUS_API_KEY).value();
    const log = (fields: Record<string, unknown>) =>
      logger.info('kalam_specialist_usage', {
        task: req.task, provider: cfg.provider, model, latencyMs: Date.now() - started,
        images: req.images?.length ?? 0, promptChars: req.prompt.length, ...fields,
      });

    if (!apiKey) {
      log({ ok: false, errorCode: 'not_configured' });
      throw new HttpsError('failed-precondition', `${cfg.provider} is not configured on the server.`, { kalamCode: 'not_configured' });
    }
    try {
      const result = await runSpecialistTask(req, apiKey);
      const latencyMs = Date.now() - started;
      log({ ok: true, model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
      return { output: result.output, provider: result.provider, model: result.model, latencyMs, usage: result.usage };
    } catch (e) {
      const err = e instanceof SpecialistError ? e : new SpecialistError('provider_error', 'Specialist request failed.');
      log({ ok: false, errorCode: err.code });
      throw new HttpsError(HTTPS_CODE[err.code], err.message, { kalamCode: err.code, provider: cfg.provider, model });
    }
  },
);

// Kalam Bazaar trusted operations (wallet, paid purchases, moderation, recount). See ./bazaar/index.ts.
export { kalamBazaarModerate, kalamBazaarPurchase, kalamBazaarWallet } from './bazaar/index.js';
