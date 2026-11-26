/** "Bring in an SVG file": choose a file, read its simple shapes and add them to the current screen as one step. */
import { useCallback, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useToast } from '@/design';
import { importSvgFile } from './drawing-actions';
import { PAGE_OBJECT_CAP } from './model';
import { currentPage, type StudioState } from './studio-store';

export function useImportSvg(store: StoreApi<StudioState>): { run: () => Promise<void>; busy: boolean } {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      const room = PAGE_OBJECT_CAP - currentPage(store.getState()).elements.length;
      const res = await importSvgFile(room);
      if (res.status === 'imported') {
        const n = store.getState().importElements(res.elements);
        const what = n === 1 ? 'Brought in 1 shape.' : `Brought in ${n} shapes.`;
        toast.show({ message: `${what} ${res.notices.slice(0, 2).join(' ')}`.trim(), tone: 'success' });
      } else if (res.status === 'failed') {
        toast.show({ message: res.message, tone: 'danger' });
      }
    } catch {
      toast.show({ message: 'That file could not be opened. Try another one.', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [store, toast]);
  return { run, busy };
}
