/**
 * What each queued kind does when its turn comes. Thin wrappers over the services the app already has:
 * the create pipeline, the translate service and the AI step service. They run the same consent and
 * routing rules as a live call (on-device first, one cloud attempt, nothing sent when cloud is off).
 *
 * They return codes, never messages, and never put record values or prompts anywhere but the local rows.
 */
import type {
  AIBlockService, AIExecutionResult, AIImage, CreateApplication, CreationResult, KalamDatabase, NetworkMonitor, RecordValue,
  StoredApp, TranslateService,
} from '@/core/contracts';
import type { OpHandler } from '@/core/queue';
import { buildNormalizedInput } from '@/features/input/normalize';
import { parseAiStepSnapshot, restoreBuild } from './snapshot';

export interface HandlerDeps {
  apps: Pick<KalamDatabase['apps'], 'get'>;
  blobs: Pick<NonNullable<KalamDatabase['blobs']>, 'get'>;
  network: Pick<NetworkMonitor, 'online'>;
  createApplication: CreateApplication;
  translate?: Pick<TranslateService, 'translateApp'>;
  aiBlocks: Pick<AIBlockService, 'run'>;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** The attempt may work later when there was no connection before or after the call, or the call said so. */
const mayWork = (wasOnline: boolean, deps: HandlerDeps, saidOffline = false) => saidOffline || !wasOnline || !deps.network.online();

const missing = { ok: false, code: 'source_missing' } as const;

export function createQueueHandlers(deps: HandlerDeps): { compile: OpHandler; translate: OpHandler; ai_step: OpHandler } {
  /** Build an app from the frozen draft. The result waits for the person to open it; nothing is saved by itself. */
  const compile: OpHandler = async (op, { signal }) => {
    const draft = await restoreBuild(op.snapshot, (id) => deps.blobs.get(id));
    if (!draft) return missing;
    const wasOnline = deps.network.online();
    const result: CreationResult = await deps.createApplication(buildNormalizedInput(draft), { signal });
    if (signal.aborted) return { ok: false, code: 'failed' };
    if (!result.ok || !result.spec) {
      const noNetwork = !!result.compileAttempts?.some((a) => a.category === 'NETWORK_UNAVAILABLE');
      const retry = mayWork(wasOnline, deps, noNetwork);
      return { ok: false, code: retry ? 'offline' : result.provider === 'none' ? 'not_configured' : 'failed', retryable: retry };
    }
    return { ok: true, result: JSON.stringify(result), keepSnapshot: true };
  };

  /** Translate an app's labels. The answer is saved in the translation cache, so the result row is only a summary. */
  const translate: OpHandler = async (op, { signal }) => {
    const app: StoredApp | undefined = op.appId ? await deps.apps.get(op.appId) : undefined;
    const lang = typeof op.params.lang === 'string' ? op.params.lang : undefined;
    if (!app || !lang || !deps.translate) return missing;
    const wasOnline = deps.network.online();
    const res = await deps.translate.translateApp(app.spec, lang, { signal, preferCloud: op.params.preferCloud === true });
    if (signal.aborted) return { ok: false, code: 'failed' };
    if (!res.ok) {
      const retry = mayWork(wasOnline, deps);
      return { ok: false, code: retry ? 'offline' : 'failed', retryable: retry };
    }
    return { ok: true, result: JSON.stringify({ lang: res.lang, missing: res.missing.length }) };
  };

  /** Run one AI step on what the person typed or picked. The values it finds wait to be shown as a proposal. */
  const ai_step: OpHandler = async (op, { signal }) => {
    const app = op.appId ? await deps.apps.get(op.appId) : undefined;
    const snap = parseAiStepSnapshot(op.snapshot);
    const block = app && snap ? app.spec.aiBlocks[snap.blockId] : undefined;
    if (!app || !snap || !block) return missing;
    let image: AIImage | undefined;
    if (block.kind === 'extractFromPhoto') {
      const blob = snap.imageBlobId ? await deps.blobs.get(snap.imageBlobId) : undefined;
      const mimeType = IMAGE_TYPES.find((t) => t === blob?.mimeType);
      if (!blob || !mimeType) return missing;
      image = { mimeType, base64: blob.base64 };
    } else if (snap.input === undefined || !snap.input.trim()) {
      return missing;
    }
    const formValues: Record<string, RecordValue> = block.kind === 'extractFromPhoto' ? {} : { [block.inputField]: snap.input ?? '' };
    const wasOnline = deps.network.online();
    let res: AIExecutionResult<Record<string, RecordValue>>;
    try {
      res = await deps.aiBlocks.run({ appId: app.id, blockId: snap.blockId, block, spec: app.spec, image, formValues });
    } catch {
      return { ok: false, code: 'failed', retryable: mayWork(wasOnline, deps) };
    }
    if (signal.aborted) return { ok: false, code: 'failed' };
    if (!res.success || !res.output) {
      const retry = mayWork(wasOnline, deps, res.errorCode === 'offline');
      return { ok: false, code: retry ? 'offline' : 'failed', retryable: retry };
    }
    return { ok: true, result: JSON.stringify({ blockId: snap.blockId, output: res.output }) };
  };

  return { compile, translate, ai_step };
}

