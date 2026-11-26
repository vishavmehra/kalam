/**
 * Tells subscribers something changed. A subscriber that throws must not break the feature being
 * measured (a record write, an app open, an error report), so each call is isolated.
 */
export function notifyAll(listeners: Iterable<() => void>): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Observability never breaks the thing it observes.
    }
  }
}
