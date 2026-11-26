/**
 * File and export menu for the Studio top bar (docs/02 §11.4): save now, export PNG, SVG or PDF, bring in an
 * SVG file, add a photo and screen actions. Also holds the explicit Save button, which flushes autosave (docs/08 §13).
 */
import { Eraser, FileArchive, FileCode, FileDown, FileText, FileUp, Files, Ellipsis, FolderOpen, ImagePlus, Save, Trash2 } from 'lucide-react-native';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { IconButton, Menu, useToast, type MenuAnchor, type MenuItem } from '@/design';
import { MAX_PAGES, type ExportFormat } from './model';
import type { StudioState } from './studio-store';
import { useAddPhoto } from './use-add-photo';
import { useConfirm } from './use-confirm';
import { useImportSvg } from './use-import-svg';
import { useKalamDrawingFile } from './use-kalam-file';
import { flushStudio } from './use-studio';
import { t as gt } from '@/i18n/active';

type Store = StoreApi<StudioState>;

/** Saves now and says so. Autosave keeps running either way. */
export function useSaveNow(store: Store): () => Promise<boolean> {
  const toast = useToast();
  return async () => {
    store.getState().commitTextEdit();
    const ok = await flushStudio(store);
    toast.show(ok ? { message: gt('studio.file.saved'), tone: 'success' } : { message: gt('studio.file.notSaved'), tone: 'danger' });
    return ok;
  };
}

export function SaveButton({ store }: { store: Store }) {
  const save = useSaveNow(store);
  return <IconButton icon={Save} label={gt('studio.file.saveShortcut')} onPress={() => { void save(); }} />;
}

export function FileMenu({ store, onExport }: { store: Store; onExport: (scope: 'page' | 'all', format?: ExportFormat) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const trigger = useRef<ComponentRef<typeof Pressable> | null>(null);
  const [confirmNode, ask] = useConfirm();
  const save = useSaveNow(store);
  const photo = useAddPhoto(store);
  const svg = useImportSvg(store);
  const file = useKalamDrawingFile(store);
  const pageCount = useStore(store, (s) => s.history.present.pages.length);
  const count = useStore(store, (s) => (s.history.present.pages.find((p) => p.id === s.pageId) ?? s.history.present.pages[0]!).elements.length);

  const show = () => {
    const node = trigger.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (node?.measureInWindow) node.measureInWindow((x, y, width, height) => { setAnchor({ x, y, width, height }); setOpen(true); });
    else { setAnchor(null); setOpen(true); }
  };

  const items: MenuItem[] = [
    { key: 'save', label: gt('studio.file.save'), icon: Save, onSelect: () => { void save(); } },
    { key: 'export-page', label: gt('studio.file.exportPage'), icon: FileDown, onSelect: () => onExport('page') },
    ...(pageCount > 1 ? [{ key: 'export-all', label: gt('studio.file.exportAll'), icon: FileDown, onSelect: () => onExport('all') }] : []),
    { key: 'export-svg', label: gt('studio.file.exportSvg'), icon: FileCode, onSelect: () => onExport('page', 'svg') },
    { key: 'export-pdf', label: pageCount > 1 ? gt('studio.file.exportAllPdf') : gt('studio.file.exportPdf'), icon: FileText, onSelect: () => onExport('all', 'pdf') },
    { key: 'kalam-save', label: gt('studio.kalamFile.save'), icon: FileArchive, onSelect: () => { void file.save(); } },
    { key: 'kalam-open', label: file.busy ? gt('studio.kalamFile.opening') : gt('studio.kalamFile.open'), icon: FolderOpen, onSelect: () => { void file.open(); } },
    { key: 'import-svg', label: svg.busy ? gt('studio.file.openingSvg') : gt('studio.file.importSvg'), icon: FileUp, onSelect: () => { void svg.run(); } },
    { key: 'photo', label: photo.busy ? gt('studio.file.addingPhoto') : gt('studio.file.addPhoto'), icon: ImagePlus, onSelect: () => { void photo.add(); } },
    ...(pageCount < MAX_PAGES ? [{ key: 'dup', label: gt('studio.file.duplicate'), icon: Files, onSelect: () => store.getState().duplicatePage(store.getState().pageId) }] : []),
    ...(count > 0 ? [{
      key: 'clear', label: gt('studio.file.clear'), icon: Eraser, destructive: true,
      onSelect: () => ask({
        title: gt('studio.pages.clearTitle'),
        message: gt('studio.file.clearBody', { count }),
        confirmLabel: gt('studio.pages.clear'),
        destructive: true,
        onConfirm: () => store.getState().clearPage(),
      }),
    }] : []),
    ...(pageCount > 1 ? [{
      key: 'delete', label: gt('studio.file.delete'), icon: Trash2, destructive: true,
      onSelect: () => {
        const remove = () => store.getState().removePage(store.getState().pageId);
        if (count === 0) { remove(); return; }
        ask({
          title: gt('studio.file.deleteTitle'),
          message: gt('studio.pages.deleteBody', { count }),
          confirmLabel: gt('studio.pages.delete'),
          destructive: true,
          onConfirm: remove,
        });
      },
    }] : []),
  ];

  return (
    <>
      <IconButton icon={Ellipsis} label={gt('studio.file.menu')} onRef={(v) => { trigger.current = v; }} onPress={show} />
      <Menu visible={open} onClose={() => setOpen(false)} title={gt('studio.file.menuTitle')} items={items} anchor={anchor} />
      {confirmNode}
    </>
  );
}
