// Type/resolution shim: Metro picks notifications.web.ts / notifications.native.ts; tsc and Vitest
// resolve here. Both implementations export the same API, and the web one has no native imports, so
// it is safe to load in Node tests.
export * from './notifications.shared';
export { getNotificationAdapter } from './notifications.web';
