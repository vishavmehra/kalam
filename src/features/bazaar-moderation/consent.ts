/**
 * The one switch for anonymous view counts. Off until the person turns it on. It is kept on this device only;
 * wipe it with "delete all data" through `clearShareViews`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'kalam.bazaar.shareViews';

export async function getShareViews(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'on';
  } catch {
    return false;
  }
}

/** Resolves false when the choice could not be saved, so it may not survive a restart. */
export async function setShareViews(on: boolean): Promise<boolean> {
  try {
    if (on) await AsyncStorage.setItem(KEY, 'on');
    else await AsyncStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

export const clearShareViews = () => setShareViews(false);

export function useShareViews(): { on: boolean; set: (on: boolean) => Promise<boolean> } {
  const [on, setOn] = useState(false);
  useEffect(() => { void getShareViews().then(setOn); }, []);
  const set = useCallback(async (next: boolean) => {
    setOn(next);
    const saved = await setShareViews(next);
    if (!saved) setOn(await getShareViews());
    return saved;
  }, []);
  return { on, set };
}
