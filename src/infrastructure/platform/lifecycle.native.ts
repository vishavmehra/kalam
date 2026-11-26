import { AppState } from 'react-native';
import { createFlushRegistry } from './lifecycle.shared';

/** Android and iOS: the app leaves the foreground ('background', or 'inactive' on iOS), where the process may be killed. */
export function onSuspend(callback: () => void): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') callback();
  });
  return () => sub.remove();
}

export const lifecycle = createFlushRegistry(onSuspend);
