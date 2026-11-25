/**
 * File and export menu for the Studio top bar (docs/02 §11.4): save now, export PNG, add a photo and
 * screen actions. Also holds the explicit Save button, which flushes autosave (docs/08 §13).
 */
import { Eraser, FileDown, Files, Ellipsis, ImagePlus, Save, Trash2 } from 'lucide-react-native';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { IconButton, Menu, useToast, type MenuAnchor, type MenuItem } from '@/design';
import { MAX_PAGES } from './model';
import type { StudioState } from './studio-store';
import { useAddPhoto } from './use-add-photo';
import { useConfirm } from './use-confirm';
import { flushStudio } from './use-studio';

type Store = StoreApi<StudioState>;

/** Saves now and says so. Autosave keeps running either way. */
export function useSaveNow(store: Store): () => Promise<boolean> {
  const toast = useToast();
  return async () => {
    store.getState().commitTextEdit();
    const ok = await flushStudio(store);
    toast.show(ok ? { message: 'Saved.', tone: 'success' } : { message: 'Not saved yet. Kalam will keep trying.', tone: 'danger' });
    return ok;
  };
}

export function SaveButton({ store }: { store: Store }) {
  const save = useSaveNow(store);
  return <IconButton icon={Save} label="Save now (Ctrl+S)" onPress={() => { void save(); }} />;
}

export function FileMenu({ store, onExport }: { store: Store; onExport: (scope: 'page' | 'all') => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const trigger = useRef<ComponentRef<typeof Pressable> | null>(null);
  const [confirmNode, ask] = useConfirm();
  const save = useSaveNow(store);
  const photo = useAddPhoto(store);
  const pageCount = useStore(store, (s) => s.history.present.pages.length);
  const count = useStore(store, (s) => (s.history.present.pages.find((p) => p.id === s.pageId) ?? s.history.present.pages[0]!).elements.length);

  const show = () => {
    const node = trigger.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (node?.measureInWindow) node.measureInWindow((x, y, width, height) => { setAnchor({ x, y, width, height }); setOpen(true); });
    else { setAnchor(null); setOpen(true); }
  };

  const items: MenuItem[] = [
    { key: 'save', label: 'Save now', icon: Save, onSelect: () => { void save(); } },
    { key: 'export-page', label: 'Export this screen as PNG', icon: FileDown, onSelect: () => onExport('page') },
    ...(pageCount > 1 ? [{ key: 'export-all', label: 'Export all screens as PNG', icon: FileDown, onSelect: () => onExport('all') }] : []),
    { key: 'photo', label: photo.busy ? 'Adding photo' : 'Add photo', icon: ImagePlus, onSelect: () => { void photo.add(); } },
    ...(pageCount < MAX_PAGES ? [{ key: 'dup', label: 'Duplicate this screen', icon: Files, onSelect: () => store.getState().duplicatePage(store.getState().pageId) }] : []),
    ...(count > 0 ? [{
      key: 'clear', label: 'Clear this screen', icon: Eraser, destructive: true,
      onSelect: () => ask({
        title: 'Clear this screen?',
        message: `This removes all ${count} ${count === 1 ? 'object' : 'objects'} from the screen. You can undo it right after.`,
        confirmLabel: 'Clear screen',
        destructive: true,
        onConfirm: () => store.getState().clearPage(),
      }),
    }] : []),
    ...(pageCount > 1 ? [{
      key: 'delete', label: 'Delete this screen', icon: Trash2, destructive: true,
      onSelect: () => {
        const remove = () => store.getState().removePage(store.getState().pageId);
        if (count === 0) { remove(); return; }
        ask({
          title: 'Delete this screen?',
          message: `It has ${count} ${count === 1 ? 'object' : 'objects'}. You can undo this right after.`,
          confirmLabel: 'Delete screen',
          destructive: true,
          onConfirm: remove,
        });
      },
    }] : []),
  ];

  return (
    <>
      <IconButton icon={Ellipsis} label="File and export menu" onRef={(v) => { trigger.current = v; }} onPress={show} />
      <Menu visible={open} onClose={() => setOpen(false)} title="File and export" items={items} anchor={anchor} />
      {confirmNode}
    </>
  );
}
