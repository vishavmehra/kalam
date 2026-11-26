import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The app side is wired from several feature folders into a few screens. Parallel edits to those screens can drop a
 * mount without any type error, so this lists what each real screen must still render or call.
 */
const MOUNTS: Record<string, string[]> = {
  'src/runtime/RunAppScreen.tsx': [
    '<AskButton', '<ReportsButton', '<ShareButton', '<RemindersPanel', '<ShareWithPeopleSheet', '<SyncStatusBadge', '<AddToHomeScreenSheet',
    '<ExportEntrySheet', '<DocumentScan', 'canChangeStructure', 'startScreen',
  ],
  'src/features/shelf/ShelfScreen.tsx': [
    '<EndedNotices', '<JoinSheet', '<TeamSheet', '<CloneSheet', '<ShelfCategoryBar', '<DashboardCards', '<QueueStatusPill', 'useArchiveApp', 'deleteShared',
  ],
  'src/features/shelf/AppCard.tsx': ['<InAccountBadge', '<SyncStatusBadge'],
  'src/features/shelf/ShelfEmpty.tsx': ['shelfRoutes.templates'],
  'src/features/editing/EditAppScreen.tsx': [
    '<VisualStudio', '<UndoRedo', 'useDraftHistory', '<RestoreConfirmSheet', 'useStructureGate', '<StatFormulaPanel', '<RecoveryCard', '<VersionTimeline',
  ],
  'src/app/import.tsx': ['decodeImportLink', 'ConfirmSheet'],
  'src/app/join.tsx': ['<JoinSheet'],
  'src/app/templates.tsx': ['<TemplatesScreen'],
  'src/app/queue.tsx': ['<QueueScreen'],
  'src/app/app/[id]/index.tsx': ['startScreen', 'onStartScreenUsed'],
};

describe('app-side mounts', () => {
  for (const [file, tokens] of Object.entries(MOUNTS)) {
    it(`${file} still uses ${tokens.length} mounted parts`, () => {
      const source = readFileSync(fileURLToPath(new URL(`../../../${file}`, import.meta.url)), 'utf8');
      for (const token of tokens) expect(source, `${file} lost ${token}`).toContain(token);
    });
  }
});
