/**
 * Type shim: Metro resolves `media-audio.web.ts` / `media-audio.native.ts`; tsc resolves this file and
 * type-checks callers against the native implementation (both export the same API).
 */
export * from './media-audio.native';
