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
import { DrawingCanvas } from './DrawingCanvas';
import { ExportSheet } from './ExportSheet';
import { HandwritingSheet } from './HandwritingSheet';
import { exportDrawingPages } from './export';
import { FileMenu, SaveButton, useSaveNow } from './FileMenu';
import { findSensitive, hasDrawingContent, summarizeDrawing, type ExportFormat, type SensitiveKind } from './model';
import { ShortcutsSheet } from './ShortcutsSheet';
import {
  FloatingZoom, HistoryButtons, PageStrip, PropertiesPanel, SaveIndicator, ShortcutsButton, TitleInput, ToolPalette, ZoomControls,
} from './StudioChrome';
import { flushStudio, useStudio } from './use-studio';
import { useT } from '@/i18n/react';
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

export default function DrawingStudioScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;
  const store = useStudio(id);
  const { colors, space, elevation, accessModes, uiLanguage, fontScale } = useKalamTheme();
  const t = useT(uiLanguage);
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
  const [exportAs, setExportAs] = useState<{ scope: 'page' | 'all'; format: ExportFormat }>();
  const [readingHandwriting, setReadingHandwriting] = useState(false);
  const setExportScope = (scope: 'page' | 'all' | undefined, format: ExportFormat = 'png') => setExportAs(scope ? { scope, format } : undefined);
  const readHandwriting = () => { setSheet(undefined); setReadingHandwriting(true); };
  const [using, setUsing] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Kinds of private detail found in the text of the drawing, while the question about sending it is open. */
  const [sensitive, setSensitive] = useState<SensitiveKind[] | null>(null);
  const saveNow = useSaveNow(store);
  const saveRef = useRef(saveNow);
  // Kept in an effect, not assigned while rendering, so the Ctrl+S handler always calls the newest save.
  useEffect(() => { saveRef.current = saveNow; });

  useEffect(() => { if (loaded) setDrawingId(docId); }, [loaded, docId, setDrawingId]);

  // Messages from the studio (screen full, locked object, nothing to paste, recovered changes).
  useEffect(() => {
    if (notice) toast.show({ message: notice.message, tone: 'info' });
    // The toast API object changes identity between renders; only a new notice should show one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  // Ctrl+S saves now instead of opening the browser's own save dialog; ? lists every shortcut (docs/10 §6.3).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
        return;
      }
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/create'));

  /**
   * Attaches the drawing to the new app. A drawing that looks like it holds private details asks first (docs/11 §7.5):
   * the picture that may go to the cloud is cropped to the drawing, and the cloud notice still asks before any send.
   */
  const finishDrawing = async (skipCue = false) => {
    store.getState().commitTextEdit();
    const doc = store.getState().history.present;
    if (!hasDrawingContent(doc)) {
      toast.show({ message: t('create.draw.empty'), tone: 'info' });
      return;
    }
    if (!skipCue) {
      const kinds = findSensitive(doc);
      if (kinds.length) { setSensitive(kinds); return; }
    }
    setUsing(true);
    try {
      if (!(await flushStudio(store))) {
        toast.show({ message: t('create.sketch.saveFailed'), tone: 'danger' });
        return;
      }
      const images = await exportDrawingPages(doc);
      // Keeping the page pictures is a convenience; a failure here must not block creating the app.
      try { await persistPagePngs(doc.id, images); } catch { /* optional */ }
      attachDrawing({ title: doc.title, summary: summarizeDrawing(doc, images) });
      setModality('draw');
      router.replace('/create');
    } catch {
      toast.show({ message: t('create.sketch.prepareFailed'), tone: 'danger' });
    } finally {
      setUsing(false);
    }
  };

  // Large text on a phone: the main button gets its own row, so the name and the tools are not squeezed out of the bar.
  const stackedUse = isPhone && fontScale > 1.2;
  const useButton = (
    <Button label={t(isPhone && !stackedUse ? 'create.sketch.useShort' : 'create.sketch.use')} icon={Check} onPress={() => { void finishDrawing(); }} loading={using} disabled={!loaded} fullWidth={stackedUse} testID="use-drawing" />
  );

  const topBar = (
    <View
      style={{
        paddingTop: insets.top + space[1], paddingBottom: space[1], paddingHorizontal: space[2], gap: space[1],
        borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
      }}
    >
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], flexWrap: 'nowrap' }}>
      <IconButton icon={ArrowLeft} label={t('create.backToCreation')} onPress={back} />
      <TitleInput store={store} />
      {!isPhone ? <SaveIndicator store={store} /> : null}
      {!isPhone ? <SaveButton store={store} /> : null}
      <FileMenu store={store} onExport={setExportScope} />
      <HistoryButtons store={store} />
      {isDesktop ? <ZoomControls store={store} /> : null}
      {isDesktop ? <ShortcutsButton onPress={() => setShortcutsOpen(true)} /> : null}
      {isPhone ? null : <View style={{ width: space[1] }} />}
      {stackedUse ? null : useButton}
    </View>
    {stackedUse ? useButton : null}
    </View>
  );

  const exportSheet = (
    <>
      <ExportSheet
        store={store}
        visible={exportAs !== undefined}
        initialScope={exportAs?.scope ?? 'page'}
        initialFormat={exportAs?.format ?? 'png'}
        onClose={() => setExportScope(undefined)}
      />
      <HandwritingSheet store={store} visible={readingHandwriting} onClose={() => setReadingHandwriting(false)} />
      <ShortcutsSheet visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <Sheet
        visible={sensitive !== null}
        onClose={() => setSensitive(null)}
        title={t('create.draw.sensitive.title')}
        description={t('create.draw.sensitive.body', { kinds: new Intl.ListFormat(uiLanguage, { style: 'long', type: 'conjunction' }).format((sensitive ?? []).map((k) => t(`create.draw.sensitive.kind.${k}` as const))) })}
        testID="drawing-sensitive-cue"
        footer={(
          <>
            <Button label={t('create.draw.sensitive.edit')} variant="secondary" onPress={() => setSensitive(null)} />
            <Button label={t('create.draw.sensitive.use')} onPress={() => { setSensitive(null); void finishDrawing(true); }} testID="drawing-sensitive-use" />
          </>
        )}
      />
    </>
  );

  if (isDesktop) {
    // Physical sides on purpose: left-handed mode follows the hand, not the reading direction (docs/10 §4.6, §13.6).
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
            <PropertiesPanel store={store} onReadHandwriting={readHandwriting} />
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
        <IconButton icon={SlidersHorizontal} label={t('create.sketch.props')} onPress={() => setSheet('props')} />
        <IconButton icon={Layers} label={t('create.sketch.pages', { n: pageIndex + 1, total: pageCount })} onPress={() => setSheet('pages')} />
        <Text variant="caption" tone="secondary" numeric importantForAccessibility="no">{pageIndex + 1}/{pageCount}</Text>
      </View>
      <Sheet visible={sheet === 'props'} onClose={() => setSheet(undefined)} title={t('create.sketch.settings')}>
        <PropertiesPanel store={store} onReadHandwriting={readHandwriting} />
      </Sheet>
      <Sheet visible={sheet === 'pages'} onClose={() => setSheet(undefined)} title={t('create.draw.screens')} description={t('create.draw.screensHint')}>
        <View style={{ gap: space[4] }}>
          <PageStrip store={store} onExport={() => { setSheet(undefined); setExportScope('page'); }} />
          <SaveIndicator store={store} />
        </View>
      </Sheet>
      {exportSheet}
    </View>
  );
}
