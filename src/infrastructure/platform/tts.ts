/**
 * Type shim: Metro resolves `tts.web.ts` / `tts.native.ts`; tsc resolves this file and
 * type-checks callers against the native implementation (both export the same API).
 */
export * from './tts.native';
