/** "Add photo": choose an image, store it in the BlobRepository and place it on the current screen. */
import { useCallback, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useToast } from '@/design';
import { pickPhotoForDrawing } from './drawing-actions';
import type { StudioState } from './studio-store';

export function useAddPhoto(store: StoreApi<StudioState>): { add: () => Promise<void>; busy: boolean } {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const add = useCallback(async () => {
    setBusy(true);
    try {
      const res = await pickPhotoForDrawing(store.getState().history.present.id);
      if (res.status === 'placed') store.getState().placeImage(res.image);
      else if (res.status === 'unavailable') toast.show({ message: 'This device cannot keep photos in a drawing yet.', tone: 'info' });
    } catch {
      toast.show({ message: 'The photo could not be added. Try another one.', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [store, toast]);
  return { add, busy };
}
