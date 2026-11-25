/**
 * Remote Config entry point where the web SDK does not run (Android, Node tests). Metro picks
 * remote-config.web.ts on the web. Here the in-code defaults stay in force, as docs/04 §11.6 requires
 * when Remote Config is unavailable.
 */
import { remoteConfigState, type RemoteConfigState } from '@/core/ai/remote-config';

export async function loadRemoteConfig(): Promise<RemoteConfigState> {
  return remoteConfigState();
}
