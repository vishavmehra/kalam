// Type/resolution shim: Metro picks platform.web.ts / platform.native.ts; tsc and Vitest resolve here. Both export the
// same `createWidgetPlatform`, and the web one has no native imports, so it is safe to load in Node tests.
export { createWidgetPlatform } from './platform.web';
