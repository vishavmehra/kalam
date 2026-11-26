// Type/resolution shim: Metro picks lifecycle.web.ts / lifecycle.native.ts; tsc and Vitest resolve here.
export { lifecycle, onSuspend } from './lifecycle.web';
export type { Flusher, FlushRegistry } from './lifecycle.shared';
