/**
 * Edit by drawing (docs/08 §16, docs/03 §17.3, docs/04 §12.5–12.6, docs/00 §16).
 *
 * Wraps the running app preview. When `active`, a drawing layer sits on top: the person circles,
 * crosses out, draws arrows or writes notes on the real app. Marks are mapped to KalamSpec parts
 * by geometry (runtime bounds, no AI), turned into a proposed change by core/edit/visual-edit,
 * shown live in the preview, and only saved (as a new version, through `onKeep`) when the person
 * keeps it. When `active` is false the app renders untouched and bounds tracking is off.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { EditService } from '@/core/contracts';
import {
  diffParts, findPart, partName, partTag, runVisualEdit,
  type PartDiff, type VisualAnnotation, type VisualEditOutcome, type VisualEditRequest,
} from '@/core/edit/visual-edit';
import type { KalamComponent, KalamSpec } from '@/core/spec/schema';
import { ConfirmSheet, useBreakpoint, useKalamTheme, useReducedMotion, useToast, type ExecutionSource } from '@/design';
import { ComponentBoundsProvider, createBoundsRegistry, type BoundsRect, type MeasurableNode } from '@/runtime/layout';
import { useOnline } from '@/runtime/RunAppScreen';
import { getServices } from '@/services';
import { routeSource } from '../edit-model';
import { boundsOf, type Point } from './geometry';
import { classifyStroke, combineStrokes, markPoints, type InkPoint, type MarkGesture } from './gestures';
import { resolveMark, resolveNote, type MarkIntent } from './hit-test';
import { InkCanvas } from './InkCanvas';
import { newStroke, type InkStroke } from './ink';
import { MarkPanel, type PanelChip, type PanelMessage, type PanelView } from './MarkPanel';
import { MarksLayer } from './MarksLayer';
import { NoteBubble, NotePin } from './NoteBubble';
import { PartPicker } from './PartPicker';
import { shownScreen, visibleParts } from './parts';
import { ToolRail, type OverlayTool } from './ToolRail';
import { useDictation } from './useDictation';

/** A proposed change the person chose to keep. The host saves it as a new version. */
export interface DrawnEdit {
  /** Validated spec with the change applied. */
  spec: KalamSpec;
  /** Plain summary for the version history. */
  summary: string;
  /** Where the change was worked out (honest badge). */
  source: ExecutionSource;
  request: VisualEditRequest;
}

export interface EditByDrawingProps {
  /** The spec being edited: the saved version, or the host's pending draft. */
  spec: KalamSpec;
  /** Drawing layer on or off. Off: the app renders untouched and costs nothing extra. */
  active: boolean;
  /** Renders the running app for a spec (the base, or a proposed change while previewing). */
  renderApp(spec: KalamSpec): ReactNode;
  /** Save the kept change as a new version. Resolve true when saved. */
  onKeep(edit: DrawnEdit): Promise<boolean>;
  onClose(): void;
  /** True while a proposed change is on screen, so the host can pause its own edits. */
  onPendingChange?(pending: boolean): void;
  /** Defaults to `getServices().edit` (deterministic parser, then Gemini Nano, then Firebase cloud). */
  edit?: Pick<EditService, 'applyInstruction'>;
}

/** `drawn` keeps what was drawn with the request (docs/08 §16.4); it is never sent to AI. */
type Mark = { screen: string; drawn?: VisualAnnotation[] } & (
  | { kind: 'select'; targets: string[]; via: 'circled' | 'picked' | 'underlined' | 'marked' }
  | { kind: 'relabel'; target: string }
  | { kind: 'remove'; targets: string[]; mode: 'remove' | 'hide' }
  | { kind: 'move'; target: string; before: string | null }
  | { kind: 'note'; at: Point; text: string; target?: string; before: string | null }
);

interface Proposal { outcome: VisualEditOutcome & { spec: KalamSpec }; diff: PartDiff; request: VisualEditRequest; base: KalamSpec }

/** Wait this long after a stroke for a second one (an X, an arrow head) before running on its own. */
const SETTLE_MS = 450;
const COMBINE_MS = 1500;
const EMPTY_RECTS: ReadonlyMap<string, BoundsRect> = new Map();
const NO_IDS: ReadonlySet<string> = new Set();
const NO_STROKES: InkStroke[] = [];
const HINTS: Record<Extract<MarkIntent, { kind: 'none' }>['reason'], string> = {
  empty: 'Draw around a part of the app to pick it.',
  no_source: 'Start the arrow on the part you want to move.',
  same_place: 'It is already there.',
};
/** Lead decision 7: offline structural edits are refused plainly and the words are kept. */
const OFFLINE_EDIT = "You're offline. This change needs the internet, so Kalam didn't make it. Your words are kept. Colours, sizes and names still work offline.";

const annotationOf = (g: MarkGesture): VisualAnnotation => {
  const b = boundsOf(markPoints(g));
  return { kind: g.kind, x: b.x, y: b.y, width: b.width, height: b.height };
};

function examples(c: KalamComponent | undefined): string {
  switch (c?.type) {
    case 'bigButton': return 'For example: bigger, green';
    case 'number': case 'textInput': case 'date': case 'choice': return 'For example: make it required';
    case 'heading': case 'text': return 'For example: call it Today';
    default: return 'For example: move it up';
  }
}

export function EditByDrawing({ spec, active, renderApp, onKeep, onClose, onPendingChange, edit }: EditByDrawingProps) {
  const k = useKalamTheme();
  const reduced = useReducedMotion();
  const { isDesktop } = useBreakpoint();
  const toast = useToast();
  const online = useOnline();
  const registry = useMemo(() => createBoundsRegistry(), []);
  const originRef = useRef<ComponentRef<typeof View>>(null);

  const [rects, setRects] = useState<ReadonlyMap<string, BoundsRect>>(EMPTY_RECTS);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<OverlayTool>('pen');
  const [strokes, setStrokes] = useState<InkStroke[]>(NO_STROKES);
  const [mark, setMark] = useState<Mark | null>(null);
  const [words, setWords] = useState('');
  const [noteDraft, setNoteDraft] = useState<{ at: Point; text: string } | null>(null);
  const [busy, setBusy] = useState<{ ctrl: AbortController; slow: boolean } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [message, setMessage] = useState<PanelMessage | undefined>();
  const [peek, setPeek] = useState(false);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const gestureRef = useRef<MarkGesture | null>(null);
  const lastStrokeEnd = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busyRef = useRef<AbortController | null>(null);
  const lastScreen = useRef(spec.initialScreen);
  const dictation = useDictation(spec.lang, setWords);

  const shown = proposal && !peek ? proposal.outcome.spec : spec;
  const screen = useMemo(() => shownScreen(shown, rects), [shown, rects]);
  const parts = useMemo(() => visibleParts(screen, rects, area.height), [screen, rects, area.height]);
  useEffect(() => {
    if (screen) lastScreen.current = screen.id;
  }, [screen]);

  // ── Measuring (only while the layer is on) ─────────────────────────────────
  const measureNow = useCallback(async (): Promise<ReadonlyMap<string, BoundsRect>> => {
    const node: MeasurableNode | null = originRef.current;
    if (!node) return EMPTY_RECTS;
    const measured = await registry.measure(node);
    setRects(measured);
    return measured;
  }, [registry]);

  useEffect(() => {
    if (!active) return undefined;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        void measureNow();
      });
    };
    const off = registry.subscribe(schedule);
    schedule();
    return () => {
      off();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, registry, measureNow]);

  // ── Resetting ──────────────────────────────────────────────────────────────
  const stopListening = dictation.stop;
  const clearMarks = useCallback(() => {
    clearTimeout(settleTimer.current);
    clearTimeout(fadeTimer.current);
    stopListening();
    gestureRef.current = null;
    setStrokes(NO_STROKES);
    setMark(null);
    setWords('');
    setNoteDraft(null);
    setMessage(undefined);
    setPeek(false);
  }, [stopListening]);

  const stopWork = useCallback(() => {
    busyRef.current?.abort();
    busyRef.current = null;
    setBusy(null);
  }, []);

  useEffect(() => {
    if (active) return;
    stopWork();
    setProposal(null);
    setPicking(false);
    setTool('pen');
    clearMarks();
  }, [active, stopWork, clearMarks]);

  // A proposal is tied to the spec it was made from.
  useEffect(() => {
    setProposal((p) => (p && p.base !== spec ? null : p));
  }, [spec]);

  useEffect(() => {
    onPendingChange?.(!!proposal);
  }, [proposal, onPendingChange]);

  useEffect(() => () => {
    clearTimeout(settleTimer.current);
    clearTimeout(fadeTimer.current);
    busyRef.current?.abort();
  }, []);

  // ── Proposing ──────────────────────────────────────────────────────────────
  const requestFor = useCallback((m: Mark, instruction?: string): VisualEditRequest => {
    const base = { appId: spec.id, baseVersion: spec.version, screenId: m.screen, annotations: m.drawn, source: 'drawing_overlay' as const };
    switch (m.kind) {
      case 'select': return { ...base, targets: m.targets, gesture: { kind: 'select' }, instruction };
      case 'relabel': return { ...base, targets: [m.target], gesture: { kind: 'relabel' }, instruction };
      case 'remove': return { ...base, targets: m.targets, gesture: { kind: 'remove', mode: m.mode } };
      case 'move': return { ...base, targets: [m.target], gesture: { kind: 'move', before: m.before } };
      case 'note': return { ...base, targets: m.target ? [m.target] : [], gesture: { kind: 'note', text: m.text, before: m.before } };
    }
  }, [spec]);

  /** Works out the change and shows it as a proposal. Resolves false when nothing could be proposed. */
  const propose = useCallback(async (request: VisualEditRequest): Promise<boolean> => {
    busyRef.current?.abort();
    stopListening();
    const ctrl = new AbortController();
    busyRef.current = ctrl;
    setMessage(undefined);
    setBusy({ ctrl, slow: false });
    // Deterministic changes come back at once; only show "working" when it takes a moment.
    const slow = setTimeout(() => setBusy((b) => (b?.ctrl === ctrl ? { ctrl, slow: true } : b)), 180);
    try {
      const outcome = await runVisualEdit(spec, request, { edit: edit ?? getServices().edit, signal: ctrl.signal });
      if (ctrl.signal.aborted) return false;
      if (outcome.ok && outcome.spec) {
        setProposal({ outcome: { ...outcome, spec: outcome.spec }, diff: diffParts(spec, outcome.spec), request, base: spec });
        return true;
      }
      const offline = !getServices().network.online() && outcome.route === 'cloud';
      setMessage({ text: offline ? OFFLINE_EDIT : outcome.message ?? "Kalam couldn't make that change. Try saying it differently.", tone: 'danger' });
      return false;
    } catch {
      if (!ctrl.signal.aborted) setMessage({ text: "Kalam couldn't make that change. Your app is unchanged.", tone: 'danger' });
      return false;
    } finally {
      clearTimeout(slow);
      if (busyRef.current === ctrl) {
        busyRef.current = null;
        setBusy(null);
      }
    }
  }, [spec, edit, stopListening]);

  // ── Strokes ────────────────────────────────────────────────────────────────
  const onStrokeStart = useCallback(() => {
    // The next stroke may finish an X or an arrow: hold the change that was about to run.
    clearTimeout(settleTimer.current);
    clearTimeout(fadeTimer.current);
  }, []);

  const onStrokeEnd = useCallback(async (points: InkPoint[]) => {
    if (proposal || busyRef.current) return;
    const fresh = await measureNow(); // the app may have moved since the last measure
    const scr = shownScreen(spec, fresh);
    const here = visibleParts(scr, fresh, area.height);
    const screenId = scr?.id ?? lastScreen.current;
    if (tool === 'note') {
      const at = points[0];
      if (at) setNoteDraft({ at: { x: at.x, y: at.y }, text: '' });
      return;
    }
    const shape = classifyStroke(points);
    const now = Date.now();
    const prev = gestureRef.current;
    const combined = prev && now - lastStrokeEnd.current < COMBINE_MS ? combineStrokes(prev, shape) : undefined;
    lastStrokeEnd.current = now;
    const gesture = combined ?? shape;
    gestureRef.current = gesture;
    const stroke = newStroke(points);
    setStrokes((s) => (combined ? [...s, stroke] : [stroke]));
    setMessage(undefined);
    setWords((w) => (combined ? w : ''));

    const intent = resolveMark(gesture, here);
    const drawn = [annotationOf(gesture)];
    switch (intent.kind) {
      case 'select': {
        const via = gesture.kind === 'circle' ? 'circled' : gesture.kind === 'tap' ? 'picked' : gesture.kind === 'line' ? 'underlined' : 'marked';
        setMark({ kind: 'select', targets: intent.targets, via, screen: screenId, drawn });
        return;
      }
      case 'relabel':
        setMark({ kind: 'relabel', target: intent.target, screen: screenId, drawn });
        return;
      case 'remove':
      case 'move': {
        const m: Mark = intent.kind === 'remove'
          ? { kind: 'remove', targets: intent.targets, mode: 'remove', screen: screenId, drawn }
          : { kind: 'move', target: intent.target, before: intent.before, screen: screenId, drawn };
        setMark(m);
        settleTimer.current = setTimeout(() => void propose(requestFor(m)), SETTLE_MS);
        return;
      }
      case 'none':
        setMark(null);
        setMessage({ text: HINTS[intent.reason], tone: 'muted' });
        fadeTimer.current = setTimeout(() => {
          gestureRef.current = null;
          setStrokes(NO_STROKES);
        }, 900);
    }
  }, [proposal, measureNow, spec, area.height, tool, propose, requestFor]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const submitWords = useCallback(() => {
    const text = words.trim();
    if (!text || busyRef.current || (mark?.kind !== 'select' && mark?.kind !== 'relabel')) return;
    void propose(requestFor(mark, text));
  }, [words, mark, propose, requestFor]);

  const addNote = useCallback(() => {
    const text = noteDraft?.text.trim();
    if (!noteDraft || !text) return;
    const { at } = noteDraft;
    const where = resolveNote(at, parts);
    const common = { at, text, screen: screen?.id ?? lastScreen.current, drawn: [{ kind: 'note' as const, x: at.x, y: at.y, width: 0, height: 0, text }] };
    const m: Mark = 'target' in where
      ? { kind: 'note', ...common, target: where.target, before: null }
      : { kind: 'note', ...common, before: where.before };
    setNoteDraft(null);
    setStrokes(NO_STROKES);
    gestureRef.current = null;
    setMark(m);
    // If it can't be done (for example offline), reopen the note so its words are kept.
    void propose(requestFor(m)).then((ok) => {
      if (!ok) setNoteDraft({ at, text });
    });
  }, [noteDraft, parts, screen, propose, requestFor]);

  const hideInstead = useCallback(() => {
    if (mark?.kind !== 'remove') return;
    const m: Mark = { ...mark, mode: 'hide' };
    setProposal(null);
    setMark(m);
    void propose(requestFor(m));
  }, [mark, propose, requestFor]);

  const keep = useCallback(async () => {
    if (!proposal || saving) return;
    setSaving(true);
    try {
      const saved = await onKeep({
        spec: proposal.outcome.spec, summary: proposal.outcome.summary, source: routeSource(proposal.outcome.route), request: proposal.request,
      });
      if (saved) {
        setProposal(null);
        clearMarks();
      } else {
        setMessage({ text: "Couldn't save the change. Your app is unchanged.", tone: 'danger' });
      }
    } catch {
      setMessage({ text: "Couldn't save the change. Your app is unchanged.", tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }, [proposal, saving, onKeep, clearMarks]);

  const discard = useCallback(() => {
    const kind = proposal?.request.gesture.kind;
    setProposal(null);
    setPeek(false);
    // A picked part keeps its words so they can be tried again; marks that ran on their own clear.
    if (kind === 'remove' || kind === 'move' || kind === 'note') clearMarks();
  }, [proposal, clearMarks]);

  const close = useCallback(() => {
    if (proposal) toast.show({ message: 'Change discarded', tone: 'neutral' });
    onClose();
  }, [proposal, toast, onClose]);

  const chooseTool = useCallback((t: OverlayTool) => {
    setTool(t);
    setNoteDraft(null);
    if (t === 'scroll') {
      // Ink is drawn in screen space; once the app scrolls it would point at the wrong place.
      gestureRef.current = null;
      setStrokes(NO_STROKES);
    } else {
      registry.invalidate();
    }
  }, [registry]);

  // Escape steps back one level on web: note, then proposal, then marks, then the layer.
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || picking) return;
      if (noteDraft) setNoteDraft(null);
      else if (proposal) discard();
      else if (mark || strokes.length) clearMarks();
      else close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, picking, noteDraft, proposal, mark, strokes.length, discard, clearMarks, close]);

  // ── View model ─────────────────────────────────────────────────────────────
  const nameOf = useCallback((id: string) => {
    const c = findPart(spec, id)?.component;
    return c ? partName(c) : 'this part';
  }, [spec]);

  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of parts) {
      const c = findPart(shown, p.id)?.component;
      out[p.id] = c ? partTag(c) : p.id;
    }
    return out;
  }, [parts, shown]);

  const view: PanelView = (() => {
    if (proposal) {
      const g = proposal.request.gesture;
      return {
        stage: 'proposed', summary: proposal.outcome.summary, notes: proposal.outcome.notes, warnings: proposal.outcome.warnings,
        source: routeSource(proposal.outcome.route), saving, message,
        alternative: g.kind === 'remove' && g.mode !== 'hide' ? { key: 'hide', label: 'Hide it instead', onPress: hideInstead } : undefined,
      };
    }
    if (busy?.slow) return { stage: 'working' };
    if (mark?.kind === 'select' || mark?.kind === 'relabel') {
      const targets = mark.kind === 'select' ? mark.targets : [mark.target];
      const first = targets[0];
      const chips: PanelChip[] = [];
      if (mark.kind === 'select') {
        if (targets.length === 1 && first) {
          chips.push({ key: 'rename', label: 'Rename', onPress: () => { setMark({ kind: 'relabel', target: first, screen: mark.screen }); setWords(''); } });
          chips.push({ key: 'up', label: 'Move up', onPress: () => void propose(requestFor(mark, 'move up')) });
          chips.push({ key: 'down', label: 'Move down', onPress: () => void propose(requestFor(mark, 'move down')) });
        }
        chips.push({
          key: 'remove', label: 'Remove',
          onPress: () => {
            const m: Mark = { kind: 'remove', targets, mode: 'remove', screen: mark.screen };
            setMark(m);
            void propose(requestFor(m));
          },
        });
      }
      const who = targets.length === 1 && first ? nameOf(first) : `${targets.length} parts`;
      const component = first ? findPart(spec, first)?.component : undefined;
      return {
        stage: 'picked',
        title: mark.kind === 'select' ? `You ${mark.via} ${who}.` : `New words for ${who}`,
        chips, words, busy: !!busy, autoFocus: Platform.OS === 'web' && isDesktop, offline: !online,
        message: message ?? (dictation.error ? { text: dictation.error, tone: 'danger' } : undefined),
        mic: { listening: dictation.listening, onPress: () => void dictation.toggle(words) },
        inputLabel: mark.kind === 'select' ? 'What should change?' : 'New words',
        placeholder: mark.kind === 'select' ? examples(component) : 'Type the new words',
      };
    }
    if (mark?.kind === 'remove') {
      const who = mark.targets.length === 1 && mark.targets[0] ? nameOf(mark.targets[0]) : `${mark.targets.length} parts`;
      return {
        stage: 'waiting', title: `You crossed out ${who}.`, message,
        alternative: message?.tone === 'danger' && mark.mode !== 'hide' ? { key: 'hide', label: 'Hide it instead', onPress: hideInstead } : undefined,
      };
    }
    if (mark?.kind === 'move') return { stage: 'waiting', title: `Moving ${nameOf(mark.target)}.`, message };
    if (mark?.kind === 'note') return { stage: 'waiting', title: mark.target ? `Your note on ${nameOf(mark.target)}` : 'Adding your note', message };
    return { stage: 'hint', message };
  })();

  const picked = useMemo<ReadonlySet<string>>(() => {
    if (!mark || proposal) return NO_IDS;
    if (mark.kind === 'select' || mark.kind === 'remove') return new Set(mark.targets);
    if (mark.kind === 'note') return mark.target ? new Set([mark.target]) : NO_IDS;
    return new Set([mark.target]);
  }, [mark, proposal]);

  const changed = useMemo<ReadonlySet<string>>(
    () => (proposal && !peek ? new Set([...proposal.diff.changed, ...proposal.diff.added, ...proposal.diff.moved]) : NO_IDS),
    [proposal, peek],
  );

  const pickerParts = useMemo(() => {
    const scr = screen ?? spec.screens.find((s) => s.id === lastScreen.current);
    return (scr?.children ?? []).filter((c) => c.visible !== false).map((c) => ({ id: c.id, label: partTag(c) }));
  }, [screen, spec]);

  const inkStyle = useMemo(
    () => ({ ink: k.colors.accent, halo: k.scheme === 'dark' ? k.colors.onPrimary : k.colors.text, size: 7 }),
    [k.colors, k.scheme],
  );

  const canDraw = active && tool !== 'scroll' && !proposal && !busy && !saving && !noteDraft && !picking;
  const leftHanded = k.accessModes.leftHanded;

  return (
    <View style={styles.root}>
      <ComponentBoundsProvider registry={registry} tracking={active}>
        {renderApp(shown)}
      </ComponentBoundsProvider>
      {active ? (
        <View
          ref={originRef}
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
          onLayout={(e) => {
            setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
            registry.invalidate();
          }}
        >
          {tool !== 'scroll' ? (
            <MarksLayer parts={parts} picked={picked} changed={changed} names={names} outlines={!mark && !proposal} reduced={reduced} />
          ) : null}
          <InkCanvas
            strokes={proposal ? NO_STROKES : strokes}
            style={inkStyle}
            enabled={canDraw}
            tool={tool === 'note' ? 'note' : 'pen'}
            onStrokeStart={onStrokeStart}
            onStrokeEnd={(pts) => void onStrokeEnd(pts)}
          />
          {mark?.kind === 'note' && !peek && !noteDraft ? <NotePin at={mark.at} text={mark.text} area={area} /> : null}
          {noteDraft ? (
            <NoteBubble
              at={noteDraft.at}
              area={area}
              text={noteDraft.text}
              onText={(text) => setNoteDraft((d) => (d ? { ...d, text } : d))}
              onAdd={addNote}
              onCancel={() => setNoteDraft(null)}
              reduced={reduced}
            />
          ) : null}
          <ToolRail
            tool={tool}
            onTool={chooseTool}
            onPick={() => setPicking(true)}
            onClear={() => {
              stopWork();
              setProposal(null);
              clearMarks();
            }}
            onClose={close}
            canClear={!!(mark || strokes.length || proposal || noteDraft)}
            disabled={!!busy || saving}
            left={leftHanded}
            reduced={reduced}
          />
          <MarkPanel
            view={view}
            leftHanded={leftHanded}
            reduced={reduced}
            onWords={setWords}
            onSubmit={submitWords}
            onCancel={stopWork}
            onKeep={() => void keep()}
            onDiscard={discard}
            onPeek={setPeek}
            onPick={() => setPicking(true)}
          />
          <PartPicker
            visible={picking}
            parts={pickerParts}
            initial={mark?.kind === 'select' ? mark.targets : []}
            onClose={() => setPicking(false)}
            onPick={(ids) => {
              setPicking(false);
              clearMarks();
              if (ids.length) setMark({ kind: 'select', targets: ids, via: 'picked', screen: screen?.id ?? lastScreen.current });
            }}
          />
          <ConfirmSheet
            visible={!!dictation.ask}
            title="Use online speech?"
            message={dictation.ask?.message ?? ''}
            confirmLabel="Use it"
            onConfirm={() => dictation.ask?.answer(true)}
            onCancel={() => dictation.ask?.answer(false)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
