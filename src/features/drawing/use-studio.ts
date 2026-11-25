/**
 * Creates a studio store, loads the drawing (or starts a new one) and keeps it saved (docs/08 §13):
 * a debounced autosave after every change, a real retry when a write fails, and a flush when the app
 * goes to the background, the page is hidden or the studio closes. Saved drawings are validated and
 * migrated on load; a newer emergency copy from a closed tab is recovered.
 */
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import type { DrawingDocument } from '@/core/contracts';
import { getServices } from '@/services';
import { createAutosaver, type Autosaver } from './autosave';
import { connectImageStorage } from './drawing-actions';
import { createDocument, DRAWING_SCHEMA_VERSION, migrateDrawing } from './model';
import { clearRecovery, defaultStorage, readRecovery, writeRecovery } from './recovery';
import { createStudioStore, type StudioState } from './studio-store';

type Store = StoreApi<StudioState>;

interface Session {
  autosaver: Autosaver;
  /** The document last written to storage (or loaded from it). Untouched drawings are never written. */
  lastSaved?: DrawingDocument;
  /** Mounted effects using this session; it is disposed when the last one leaves. */
  users: number;
}
const sessions = new WeakMap<Store, Session>();

/** Document as stored: current format, active page and a fresh timestamp. */
export function serializeDrawing(doc: DrawingDocument, pageId: string, now = Date.now()): DrawingDocument {
  return { ...doc, schemaVersion: DRAWING_SCHEMA_VERSION, activePageId: pageId, updatedAt: now };
}

function ensureSession(store: Store): Session {
  const existing = sessions.get(store);
  if (existing) return existing;
  const session: Session = {
    users: 0,
    autosaver: createAutosaver({
      isDirty: () => store.getState().history.present !== session.lastSaved,
      onStatus: (status) => store.getState().setSaveStatus(status),
      save: async () => {
        const s = store.getState();
        const doc = s.history.present;
        await getServices().db.drawings.save(serializeDrawing(doc, s.pageId));
        session.lastSaved = doc;
        clearRecovery(defaultStorage(), doc.id);
        // Say "Saved" only once the write finished, and only if nothing changed meanwhile.
        store.getState().setSaveStatus(store.getState().history.present === doc ? 'saved' : 'unsaved');
      },
    }),
  };
  sessions.set(store, session);
  return session;
}

/** Saves now. Resolves true when the drawing is safely stored. */
export function flushStudio(store: Store): Promise<boolean> {
  return sessions.get(store)?.autosaver.flush() ?? Promise.resolve(true);
}

/** Kept for callers that only need "save and wait". */
export const saveStudio = flushStudio;

export function useStudio(id: string | undefined): Store {
  const [store] = useState(() => createStudioStore());

  // Load, validate, recover.
  useEffect(() => {
    let alive = true;
    const session = ensureSession(store);
    const disconnect = connectImageStorage();
    (async () => {
      let stored: ReturnType<typeof migrateDrawing> = undefined;
      let doc: DrawingDocument | undefined;
      let recovered = false;
      const notices: string[] = [];
      if (id) {
        let raw: unknown;
        try { raw = await getServices().db.drawings.get(id); } catch { raw = undefined; }
        stored = raw === undefined ? undefined : migrateDrawing(raw);
        if (raw !== undefined && !stored) notices.push('That drawing could not be opened, so this is a new one.');
        if (stored) {
          doc = stored.doc;
          notices.push(...stored.notices);
          const emergency = migrateDrawing(readRecovery(defaultStorage(), id));
          if (emergency && emergency.doc.updatedAt > stored.doc.updatedAt) {
            doc = emergency.doc;
            recovered = true;
            notices.push('Brought back the changes from your last visit.');
          }
        }
      }
      if (!alive) return;
      const loaded = doc ?? createDocument();
      session.lastSaved = recovered ? stored?.doc : loaded;
      store.getState().load(loaded);
      if (recovered) { store.getState().setSaveStatus('unsaved'); session.autosaver.notify(); }
      if (notices.length) store.getState().notify(notices.join(' '));
    })();
    return () => { alive = false; disconnect(); };
  }, [id, store]);

  // Autosave, flush triggers and teardown.
  useEffect(() => {
    const session = ensureSession(store);
    session.users += 1;
    const unsub = store.subscribe((s, prev) => {
      if (!s.loaded || !prev.loaded || s.history.present === prev.history.present) return;
      session.autosaver.notify();
    });
    const flush = () => { void session.autosaver.flush(); };
    const appState = AppState.addEventListener('change', (state) => { if (state !== 'active') flush(); });
    const web = Platform.OS === 'web' && typeof window !== 'undefined';
    const onPageHide = () => {
      if (!store.getState().loaded) return;
      store.getState().commitTextEdit();
      const s = store.getState();
      // IndexedDB can be cut off during unload, so keep a synchronous copy as well.
      if (s.history.present !== session.lastSaved) writeRecovery(defaultStorage(), serializeDrawing(s.history.present, s.pageId));
      flush();
    };
    if (web) window.addEventListener('pagehide', onPageHide);
    return () => {
      unsub();
      appState.remove();
      if (web) window.removeEventListener('pagehide', onPageHide);
      store.getState().commitTextEdit();
      void session.autosaver.flush().finally(() => {
        session.users -= 1;
        if (session.users <= 0) session.autosaver.dispose();
      });
    };
  }, [store]);

  return store;
}
