/**
 * Optional kalam_compile_with_firebase. Off by default. It is registered only when the server starts
 * with --firebase AND the environment holds the Firebase web config and an App Check debug token.
 * It sends the request text to Firebase AI Logic (Gemini in the cloud) and nothing else: no records.
 *
 * It runs the app's own compiler (src/core/compiler compileWithCloud: request IR, convert, validate,
 * at most one repair). The app's provider (src/infrastructure/firebase) is not reused: it is bound to
 * the browser and React Native (reCAPTCHA App Check, Chrome's Prompt API, Remote Config on the web).
 * This file is the Node equivalent for the cloud leg only. App Check uses the documented debug-token
 * exchange (firebaseappcheck.googleapis.com, projects.apps.exchangeDebugToken) through CustomProvider.
 * There is no on-device model in Node, so every call is a cloud call and is labelled that way.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { cloudResponseSchema } from '@/core/ai/json-schema';
import { modelForRole } from '@/core/ai/model-config';
import { classifyRequest } from '@/core/classifier';
import { compileWithCloud } from '@/core/compiler/compile';
import type {
  AIErrorCode, AIExecutionResult, AIOrchestrator, AIProvider, OnDeviceStatus, StructuredRequest,
} from '@/core/contracts';
import { fail, newAppId, ok, withHints } from './tools';

export interface FirebaseEnv {
  apiKey: string;
  projectId: string;
  appId: string;
  debugToken: string;
  backend: 'google' | 'agent_platform';
  location?: string;
}

const envSchema = z.object({
  EXPO_PUBLIC_FIREBASE_API_KEY: z.string().regex(/^[A-Za-z0-9_-]{20,80}$/),
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: z.string().regex(/^[a-z0-9-]{4,40}$/),
  EXPO_PUBLIC_FIREBASE_APP_ID: z.string().regex(/^[0-9A-Za-z:._-]{5,120}$/),
  EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN: z.string().regex(/^[0-9A-Za-z-]{8,80}$/),
  EXPO_PUBLIC_AI_BACKEND: z.enum(['google', 'agent_platform']).optional(),
  EXPO_PUBLIC_AI_LOCATION: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
});

/** The same variable names the app uses. Undefined unless every required one is present and well formed. */
export function firebaseEnv(env: Record<string, string | undefined>): FirebaseEnv | undefined {
  const r = envSchema.safeParse(env);
  if (!r.success) return undefined;
  const e = r.data;
  return {
    apiKey: e.EXPO_PUBLIC_FIREBASE_API_KEY, projectId: e.EXPO_PUBLIC_FIREBASE_PROJECT_ID, appId: e.EXPO_PUBLIC_FIREBASE_APP_ID,
    debugToken: e.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN, backend: e.EXPO_PUBLIC_AI_BACKEND ?? 'google', location: e.EXPO_PUBLIC_AI_LOCATION,
  };
}

const NO_DEVICE: OnDeviceStatus = {
  platform: 'other', apiExposed: false, availability: 'unavailable',
  detail: 'The MCP server runs on Node, where Gemini Nano is not available.',
};

const tokenSchema = z.object({ token: z.string().min(1).max(8192), ttl: z.string().regex(/^\d+(\.\d+)?s$/) });

async function exchangeDebugToken(env: FirebaseEnv): Promise<{ token: string; expireTimeMillis: number }> {
  const url = `https://firebaseappcheck.googleapis.com/v1/projects/${env.projectId}/apps/${env.appId}:exchangeDebugToken?key=${encodeURIComponent(env.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ debugToken: env.debugToken }), signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`App Check exchange failed with HTTP ${res.status}`);
  const body = tokenSchema.parse(await res.json());
  return { token: body.token, expireTimeMillis: Date.now() + Number.parseFloat(body.ttl) * 1000 };
}

const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

function errorCode(e: unknown): AIErrorCode {
  const text = `${(e as { code?: unknown })?.code ?? ''} ${(e as Error)?.message ?? ''}`.toLowerCase();
  if (text.includes('app check') || text.includes('app-check')) return 'app_check_failed';
  if (text.includes('quota') || text.includes('429')) return 'quota';
  if (text.includes('abort') || text.includes('timeout')) return 'timeout';
  if (text.includes('400')) return 'bad_request';
  return 'provider_error';
}

/** Firebase AI Logic, cloud leg, for Node. The SDK is loaded only when the first request needs it. */
export function createNodeFirebaseProvider(env: FirebaseEnv): AIProvider {
  let sdk: Promise<{ ai: import('firebase/ai').AI; mod: typeof import('firebase/ai') }> | undefined;
  const load = () => (sdk ??= (async () => {
    const { initializeApp } = await import('firebase/app');
    const { initializeAppCheck, CustomProvider } = await import('firebase/app-check');
    const mod = await import('firebase/ai');
    const app = initializeApp({ apiKey: env.apiKey, projectId: env.projectId, appId: env.appId }, 'kalam-mcp');
    initializeAppCheck(app, { provider: new CustomProvider({ getToken: () => exchangeDebugToken(env) }), isTokenAutoRefreshEnabled: false });
    const backend = env.backend === 'agent_platform'
      ? env.location ? new mod.AgentPlatformBackend(env.location) : new mod.AgentPlatformBackend()
      : new mod.GoogleAIBackend();
    return { ai: mod.getAI(app, { backend }), mod };
  })());

  return {
    name: 'firebase',
    isConfigured: () => true,
    onDeviceStatus: async () => NO_DEVICE,
    async generateStructured<T>(req: StructuredRequest<T>): Promise<AIExecutionResult<T>> {
      const started = Date.now();
      const model = modelForRole(req.role ?? 'compiler');
      const failed = (code: AIErrorCode, message: string): AIExecutionResult<T> => ({
        success: false, provider: 'firebase', source: 'cloud', model, latencyMs: Date.now() - started, fallbackUsed: false,
        errorCode: code, errorMessage: message,
      });
      if (req.mode === 'only_on_device') return failed('model_unavailable', 'On-device AI is not available in the MCP server.');
      try {
        const { ai, mod } = await load();
        const gm = mod.getGenerativeModel(ai, {
          model,
          systemInstruction: req.system,
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: cloudResponseSchema(req.jsonSchema),
            thinkingConfig: { thinkingLevel: mod.ThinkingLevel.LOW },
            maxOutputTokens: req.maxOutputTokens === undefined ? undefined : Math.max(req.maxOutputTokens, 2048),
            ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
          },
        });
        const parts: import('firebase/ai').Part[] = [
          { type: 'text', text: req.prompt },
          ...(req.images ?? []).map((img): import('firebase/ai').Part => ({ type: 'inlineData', inlineData: { mimeType: img.mimeType, data: img.base64 } })),
        ];
        const { response } = await gm.generateContent(parts, { timeout: req.timeoutMs ?? 90_000, signal: req.signal });
        const usage = response.usageMetadata;
        if (usage) req.onUsage?.({ input: usage.promptTokenCount, output: usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0) });
        let raw: unknown;
        try { raw = JSON.parse(stripFences(response.text())); } catch { return failed('invalid_output', 'The model reply was not JSON.'); }
        const parsed = req.parse(raw);
        if (!parsed.success) return failed('invalid_output', parsed.error);
        return { success: true, output: parsed.data, provider: 'firebase', source: 'cloud', model, latencyMs: Date.now() - started, fallbackUsed: false };
      } catch (e) {
        // The provider message can quote the request, so only the error kind leaves this function.
        return failed(errorCode(e), 'Firebase AI Logic did not answer.');
      }
    },
  };
}

export interface CallBudget { left: number }

/** compileWithCloud only needs run(). Each model call spends one unit of the per-process budget. */
export function budgetedOrchestrator(provider: AIProvider, budget: CallBudget): AIOrchestrator {
  return {
    async run(req) {
      if (budget.left <= 0) {
        return {
          success: false, provider: 'firebase', source: 'cloud', latencyMs: 0, fallbackUsed: false, errorCode: 'quota',
          errorMessage: 'The cloud call budget of this MCP server is used up. Restart the server to reset it.',
        };
      }
      budget.left -= 1;
      return provider.generateStructured(req);
    },
    recordDeterministic: async () => {},
    status: async () => ({ onDevice: NO_DEVICE, cloudConfigured: provider.isConfigured(), online: true, specialistConfigured: false }),
    prepareOnDevice: async () => NO_DEVICE,
    warmUpOnDevice: async () => NO_DEVICE,
  };
}

export const compileShape = {
  request: z.string().min(3).max(4000).describe('What the app should do, in the person\'s words. This text is sent to Google.'),
};

export async function compileWithFirebaseTool(
  { request }: { request: string }, provider: AIProvider, budget: CallBudget,
): Promise<CallToolResult> {
  const input = { text: request, modalities: ['text' as const], images: [] };
  const classification = classifyRequest(input);
  const out = await compileWithCloud(input, classification, { ai: budgetedOrchestrator(provider, budget), appId: newAppId() });
  const label = { provider: out.provider, source: out.source, model: out.model, route: out.route, callsLeft: budget.left };
  if (!out.ok || !out.spec) {
    return fail(out.message ?? 'Firebase could not build this app.', {
      ...label, errorCode: out.errorCode, errors: withHints(out.errors), clarifications: out.clarifications,
    });
  }
  return ok({ spec: out.spec, ...label, warnings: withHints(out.warnings), assumptions: out.assumptions });
}

export function registerFirebaseTool(server: McpServer, provider: AIProvider, budget: CallBudget): void {
  server.registerTool('kalam_compile_with_firebase', {
    title: 'Build with Firebase AI',
    description:
      "Sends the request text to Firebase AI Logic (Gemini in Google's cloud) and runs Kalam's compiler on the answer. " +
      'Use it only when the person agreed to send the request to Google and no template fits. Each call costs money and spends the server budget.',
    inputSchema: compileShape,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, (a) => compileWithFirebaseTool(a, provider, budget));
}
