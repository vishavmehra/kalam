/** True in development builds. Missing-key warnings are dev-only. Pure TypeScript. */
export function isDev(): boolean {
  const g = globalThis as { __DEV__?: boolean; process?: { env?: Record<string, string | undefined> } };
  if (typeof g.__DEV__ === 'boolean') return g.__DEV__;
  return g.process?.env?.NODE_ENV !== 'production';
}
