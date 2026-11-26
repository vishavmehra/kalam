/**
 * Widget definitions and settings on this device. One JSON value in the device's key-value storage (AsyncStorage:
 * localStorage on the web, a file on Android and iOS). It is not part of an app's backup or of anything published: where a
 * widget sits on a home screen is a fact about this phone. Rows are validated on the way out; a damaged one is dropped.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBlobWidgetStore, type WidgetStore, type WidgetStoreData } from '@/core/widgets';

export const WIDGETS_STORAGE_KEY = 'kalam.widgets.v1';

export function createDeviceWidgetStore(): WidgetStore {
  return createBlobWidgetStore({
    async load() {
      const raw = await AsyncStorage.getItem(WIDGETS_STORAGE_KEY);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return undefined;
      }
    },
    save: (data: WidgetStoreData) => AsyncStorage.setItem(WIDGETS_STORAGE_KEY, JSON.stringify(data)),
    erase: () => AsyncStorage.removeItem(WIDGETS_STORAGE_KEY),
  });
}
