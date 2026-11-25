/**
 * Type shim: Metro resolves `adapter.web.ts` / `adapter.native.ts`; tsc resolves this file and
 * type-checks callers against the native implementation (both export the same API).
 */
export * from './adapter.native';
