/** A picked, dropped or pasted file before it joins the session. Local references only. */
export interface MediaSource {
  /** file:// on Android and iOS; blob: or data: on web. Never a network URL. */
  uri: string;
  /** The browser File, when the platform gave one (drop, paste, picker on web). */
  file?: File;
  name?: string;
  sizeBytes?: number;
  /** What the picker claims. Only a hint: the content is sniffed. */
  mimeType?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export const platformName = (os: string): 'web' | 'android' | 'ios' => (os === 'web' ? 'web' : os === 'ios' ? 'ios' : 'android');
