/**
 * Picks listing screenshots (docs/12 §9.2 step 7). Each image is re-encoded as JPEG, which drops
 * EXIF and location (docs/11 §7.2), shrunk until it fits the 100 KB limit, then checked from its
 * bytes with the same validator the server-side rules and readers rely on.
 */
import * as ImagePicker from 'expo-image-picker';
import { SCREENSHOT_LIMITS, validateScreenshot, type Screenshot } from '@/core/bazaar';
import { normalizeImageUri } from '@/infrastructure/platform/image';

const SIDES = [720, 600, 480] as const;

export async function pickScreenshots(max: number): Promise<{ shots: Screenshot[]; error?: string }> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], quality: 1, exif: false, allowsMultipleSelection: max > 1, selectionLimit: max,
  });
  if (res.canceled) return { shots: [] };
  const shots: Screenshot[] = [];
  for (const asset of res.assets.slice(0, Math.min(max, SCREENSHOT_LIMITS.count))) {
    let checked: ReturnType<typeof validateScreenshot> | undefined;
    for (const side of SIDES) {
      const image = await normalizeImageUri(asset.uri, 'screenshot', undefined, side);
      checked = validateScreenshot({ mimeType: image.mimeType, base64: image.base64 });
      if (checked.ok) break;
    }
    if (!checked?.ok) return { shots, error: checked?.reason ?? 'That screenshot could not be used.' };
    shots.push(checked.screenshot);
  }
  return { shots };
}
