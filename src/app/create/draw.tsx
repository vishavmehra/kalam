/**
 * Drawing Studio (docs/08, docs/02 §11.4). Canvas-first: desktop has a top bar, a tool rail, a
 * properties panel and a bottom screen strip; phones get a compact top bar, a tool palette, floating
 * zoom buttons and bottom sheets. Left-handed mode mirrors the rail, panel and palette.
 * "Use this drawing" saves, then attaches a structured summary + page PNGs to the creation session;
 * the drawing itself stays a separate document.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check, Layers, SlidersHorizontal } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { Button, IconButton, Sheet, Text, useBreakpoint, useKalamTheme, useToast } from '@/design';
import { DrawingCanvas } from '@/features/drawing/DrawingCanvas';
import { ExportSheet } from '@/features/drawing/ExportSheet';
import { exportDrawingPages } from '@/features/drawing/export';
import { FileMenu, SaveButton, useSaveNow } from '@/features/drawing/FileMenu';
import { hasDrawingContent, summarizeDrawing } from '@/features/drawing/model';
import {
  FloatingZoom, HistoryButtons, PageStrip, PropertiesPanel, SaveIndicator, TitleInput, ToolPalette, ZoomControls,
} from '@/features/drawing/StudioChrome';
import { flushStudio, useStudio } from '@/features/drawing/use-studio';
import { useCreationStore } from '@/state/creation-store';
import { getServices } from '@/services';

/**
 * Keeps the page PNGs of a drawing in the local blob store, owned by the drawing so they are backed up
 * with it and deleted with it (docs/06 §10.11). Ids are per page, so the next export replaces them.
 */
async function persistPagePngs(drawingId: string, images: Awaited<ReturnType<typeof exportDrawingPages>>): Promise<void> {
  const blobs = getServices().db.blobs;
  if (!blobs) return;
  for (const img of images) {
    try {
      await blobs.put({ id: img.id, kind: 'drawing_png', mimeType: img.mimeType, base64: img.base64, ownerId: drawingId });
    } catch { /* one page too large to keep must not stop the others */ }
  }
}

export default function DrawingStudio() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;
  const store = useStudio(id);
  const { colors, space, elevation, accessModes } = useKalamTheme();
  const leftHanded = accessModes.leftHanded;
  const insets = useSafeAreaInsets();
  const { isDesktop, isPhone } = useBreakpoint();
  const toast = useToast();
  const loaded = useStore(store, (s) => s.loaded);
  const docId = useStore(store, (s) => s.history.present.id);
  const pageCount = useStore(store, (s) => s.history.present.pages.length);
  const pageIndex = useStore(store, (s) => s.history.present.pages.findIndex((p) => p.id === s.pageId));
  const notice = useStore(store, (s) => s.notice);
  const attachDrawing = useCreationStore((s) => s.attachDrawing);
  const setDrawingId = useCreationStore((s) => s.setDrawingId);
  const setModality = useCreationStore((s) => s.setModality);
  const [sheet, setSheet] = useState<'props' | 'pages'>();
  const [exportScope, setExportScope] = useState<'page' | 'all'>();
  const [using, setUsing] = useState(false);
  const saveNow = useSaveNow(store);
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;

  useEffect(() => { if (loaded) setDrawingId(docId); }, [loaded, docId, setDrawingId]);

  // Messages from the studio (screen full, locked object, nothing to paste, recovered changes).
  useEffect(() => {
    if (notice) toast.show({ message: notice.message, tone: 'info' });
    // The toast API object changes identity between renders; only a new notice should show one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  // Ctrl+S saves now instead of opening the browser's own save dialog.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/create'));

  const useDrawing = async () => {
    store.getState().commitTextEdit();
    const doc = store.getState().history.present;
    if (!hasDrawingContent(doc)) {
      toast.show({ message: 'Draw something or place a component first.', tone: 'info' });
      return;
    }
    setUsing(true);
    try {
      if (!(await flushStudio(store))) {
        toast.show({ message: 'The drawing could not be saved. Try again.', tone: 'danger' });
        return;
      }
      const images = await exportDrawingPages(doc);
      // Keeping the page pictures is a convenience; a failure here must not block creating the app.
      try { await persistPagePngs(doc.id, images); } catch { /* optional */ }
      attachDrawing({ title: doc.title, summary: summarizeDrawing(doc, images) });
      setModality('draw');
      router.replace('/create');
    } catch {
      toast.show({ message: 'The drawing could not be prepared. Try again.', tone: 'danger' });
    } finally {
      setUsing(false);
    }
  };

  const useButton = (
    <Button label={isPhone ? 'Use' : 'Use this drawing'} icon={Check} onPress={useDrawing} loading={using} disabled={!loaded} testID="use-drawing" />
  );

  const topBar = (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space[1], flexWrap: 'nowrap',
        paddingTop: insets.top + space[1], paddingBottom: space[1], paddingHorizontal: space[2],
        borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
      }}
    >
      <IconButton icon={ArrowLeft} label="Back to creation" onPress={back} />
      <TitleInput store={store} />
      {!isPhone ? <SaveIndicator store={store} /> : null}
      {!isPhone ? <SaveButton store={store} /> : null}
      <FileMenu store={store} onExport={setExportScope} />
      <HistoryButtons store={store} />
      {isDesktop ? <ZoomControls store={store} /> : null}
      <View style={{ width: space[1] }} />
      {useButton}
    </View>
  );

  const exportSheet = <ExportSheet store={store} visible={exportScope !== undefined} initialScope={exportScope ?? 'page'} onClose={() => setExportScope(undefined)} />;

  if (isDesktop) {
    const edge = leftHanded ? 'borderLeftWidth' : 'borderRightWidth';
    const edgeColor = leftHanded ? 'borderLeftColor' : 'borderRightColor';
    const panelEdge = leftHanded ? 'borderRightWidth' : 'borderLeftWidth';
    const panelEdgeColor = leftHanded ? 'borderRightColor' : 'borderLeftColor';
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {topBar}
        <View style={{ flex: 1, flexDirection: leftHanded ? 'row-reverse' : 'row' }}>
          <ScrollView
            style={{ width: 72, flexGrow: 0, [edge]: 1, [edgeColor]: colors.border, backgroundColor: colors.surface }}
            contentContainerStyle={{ paddingVertical: space[3] }}
          >
            <ToolPalette store={store} direction="column" />
          </ScrollView>
          <View style={{ flex: 1 }}>
            {loaded ? <DrawingCanvas store={store} /> : null}
          </View>
          <ScrollView
            style={{ width: 296, flexGrow: 0, [panelEdge]: 1, [panelEdgeColor]: colors.border, backgroundColor: colors.surface }}
            contentContainerStyle={{ padding: space[5] }}
            keyboardShouldPersistTaps="handled"
          >
            <PropertiesPanel store={store} />
          </ScrollView>
        </View>
        <View style={{ padding: space[3], paddingHorizontal: space[5], borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
          <PageStrip store={store} onExport={() => setExportScope('page')} />
        </View>
        {exportSheet}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {topBar}
      <View style={{ flex: 1 }}>
        {loaded ? <DrawingCanvas store={store} /> : null}
        <FloatingZoom store={store} side={leftHanded ? 'right' : 'left'} />
      </View>
      <View
        style={{
          flexDirection: leftHanded ? 'row-reverse' : 'row', alignItems: 'center', gap: space[1],
          paddingHorizontal: space[2], paddingTop: space[1], paddingBottom: insets.bottom + space[1],
          borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceElevated, ...elevation[1],
        }}
      >
        <View style={{ flex: 1 }}>
          <ToolPalette store={store} direction="row" />
        </View>
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: colors.border }} />
        <IconButton icon={SlidersHorizontal} label="Colour, size and objects" onPress={() => setSheet('props')} />
        <IconButton icon={Layers} label={`Screens, ${pageIndex + 1} of ${pageCount}`} onPress={() => setSheet('pages')} />
        <Text variant="caption" tone="secondary" numeric importantForAccessibility="no">{pageIndex + 1}/{pageCount}</Text>
      </View>
      <Sheet visible={sheet === 'props'} onClose={() => setSheet(undefined)} title="Drawing settings">
        <PropertiesPanel store={store} />
      </Sheet>
      <Sheet visible={sheet === 'pages'} onClose={() => setSheet(undefined)} title="Screens" description="Each page becomes one screen of your app.">
        <View style={{ gap: space[4] }}>
          <PageStrip store={store} onExport={() => { setSheet(undefined); setExportScope('page'); }} />
          <SaveIndicator store={store} />
        </View>
      </Sheet>
      {exportSheet}
    </View>
  );
}
