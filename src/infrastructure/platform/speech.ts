/**
 * Type shim: Metro resolves `speech.web.ts` / `speech.native.ts`; tsc resolves this file and
 * type-checks callers against the native implementation (both export the same API).
 */
export * from './speech.native';
