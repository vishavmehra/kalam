/**
 * One announcer for the whole shell (docs/10 §7.4): screen-reader messages for things that change
 * without moving focus (route changes, build progress). Web uses a single visually hidden live
 * region; Android uses the platform announcement API.
 */
import { AccessibilityInfo, Platform } from 'react-native';

let region: HTMLElement | null = null;

function liveRegion(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (region && region.isConnected) return region;
  region = document.createElement('div');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.setAttribute('data-k-announcer', '');
  Object.assign(region.style, {
    position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', overflow: 'hidden',
    clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: '0',
  });
  document.body.appendChild(region);
  return region;
}

/** Says `message` to screen readers without moving focus. Repeating the same text re-announces it. */
export function announce(message: string): void {
  if (!message) return;
  if (Platform.OS !== 'web') {
    AccessibilityInfo.announceForAccessibility(message);
    return;
  }
  const el = liveRegion();
  if (!el) return;
  el.textContent = '';
  // A new text node on the next frame makes repeated messages audible.
  requestAnimationFrame(() => { el.textContent = message; });
}
