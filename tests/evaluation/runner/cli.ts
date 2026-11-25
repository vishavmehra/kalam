/** Pure parts of scripts/eval.mjs: argument parsing, case selection, file naming and the live-spend guard. */
import {
  DATASETS,
  type Dataset,
  type EvalMode,
  type GateThresholds,
  type GoldenModalityCase,
  type GoldenSketchCase,
  type GoldenTextCase,
} from './types';
import { DEFAULT_THRESHOLDS } from './metrics';

export interface EvalArgs {
  mode: EvalMode;
  /** Live mode only: the most model requests this run may make. Deterministic mode makes none. */
  budget: number;
  only?: Dataset;
  cases: string[];
  outDir?: string;
  write: boolean;
  /** Exit with code 1 when a quality floor is missed (CI). */
  check: boolean;
  json: boolean;
  help: boolean;
  thresholds: GateThresholds;
}

export class UsageError extends Error {}

const THRESHOLD_FLAGS: ReadonlyArray<readonly [string, keyof GateThresholds]> = [
  ['--min-template-validity', 'templateValidity'],
  ['--min-text-complexity', 'textComplexity'],
  ['--min-text-route', 'textRoute'],
  ['--min-sketch-route', 'sketchRoute'],
  ['--min-sketch-extraction', 'sketchExtraction'],
  ['--min-modality-route', 'modalityRoute'],
  ['--min-offline-graceful', 'offlineGraceful'],
  ['--min-runtime', 'runtime'],
];

export const USAGE = `Kalam evaluation runner (docs/13 §6-9, §19)

  node scripts/eval.mjs [options]

Default: deterministic stages only (classifier, template build, validateSpec, describeSpec,
drawing summary). No model is called and nothing is spent.

  --live --budget N      Also compile cloud-route cases with the real Firebase AI Logic provider.
                         N is the hard cap on model requests (a compile can use 2: draft + repair).
                         --live without --budget is refused. Costs real money.
  --only NAME            Run one dataset: text, sketch, image, audio, video or mixed.
  --case ID              Run only this case (repeatable).
  --out-dir DIR          Where to write the report (default tests/evaluation/reports).
  --no-write             Print the summary but do not write a report file.
  --check                Exit 1 when a quality floor is missed (for CI).
  --min-template-validity N, --min-text-complexity N, --min-text-route N,
  --min-sketch-route N, --min-sketch-extraction N, --min-modality-route N,
  --min-offline-graceful N, --min-runtime N           Override a floor (0 to 1).
  --json                 Print the full report JSON instead of the summary.
  --help                 Show this text.
`;

function take(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value.`);
  return v;
}

export function parseArgs(argv: readonly string[]): EvalArgs {
  const a = [...argv];
  const args: EvalArgs = {
    mode: 'deterministic',
    budget: 0,
    cases: [],
    write: true,
    check: false,
    json: false,
    help: false,
    thresholds: { ...DEFAULT_THRESHOLDS },
  };
  let budgetGiven = false;
  for (let i = 0; i < a.length; i += 1) {
    const f = a[i] ?? '';
    const threshold = THRESHOLD_FLAGS.find(([flag]) => flag === f);
    if (threshold) {
      const n = Number(take(a, i, f));
      if (!Number.isFinite(n) || n < 0 || n > 1) throw new UsageError(`${f} must be a number from 0 to 1.`);
      args.thresholds[threshold[1]] = n;
      i += 1;
      continue;
    }
    switch (f) {
      case '--live':
        args.mode = 'live';
        break;
      case '--budget': {
        const n = Number(take(a, i, f));
        if (!Number.isInteger(n) || n < 0) throw new UsageError('--budget must be a whole number, 0 or more.');
        args.budget = n;
        budgetGiven = true;
        i += 1;
        break;
      }
      case '--only': {
        const v = take(a, i, f);
        if (!(DATASETS as readonly string[]).includes(v))
          throw new UsageError(`--only must be one of: ${DATASETS.join(', ')}.`);
        args.only = v as Dataset;
        i += 1;
        break;
      }
      case '--case':
        args.cases.push(take(a, i, f));
        i += 1;
        break;
      case '--out-dir':
        args.outDir = take(a, i, f);
        i += 1;
        break;
      case '--no-write':
        args.write = false;
        break;
      case '--check':
        args.check = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new UsageError(`Unknown option "${f}".`);
    }
  }
  if (args.mode === 'live' && !budgetGiven) {
    throw new UsageError('--live needs --budget N (the most model requests to make). Nothing was run.');
  }
  if (args.mode === 'deterministic' && budgetGiven) {
    throw new UsageError('--budget only applies with --live. Deterministic runs never call a model.');
  }
  return args;
}

export function selectCases(
  golden: {
    text: readonly GoldenTextCase[];
    sketches: readonly GoldenSketchCase[];
    modalities?: readonly GoldenModalityCase[];
  },
  args: Pick<EvalArgs, 'only' | 'cases'>,
): { text: GoldenTextCase[]; sketches: GoldenSketchCase[]; modalities: GoldenModalityCase[]; unknown: string[] } {
  const modalities = golden.modalities ?? [];
  const known = new Set([...golden.text, ...golden.sketches, ...modalities].map((c) => c.id));
  const unknown = args.cases.filter((id) => !known.has(id));
  const want = (id: string) => args.cases.length === 0 || args.cases.includes(id);
  const only = (d: Dataset) => !args.only || args.only === d;
  return {
    text: only('text') ? golden.text.filter((c) => want(c.id)) : [],
    sketches: only('sketch') ? golden.sketches.filter((c) => want(c.id)) : [],
    modalities: modalities.filter((c) => only(c.modality) && want(c.id)),
    unknown,
  };
}

/** Sortable, filesystem-safe, dated: eval-2026-11-18T01-30-45-123Z-deterministic.json */
export function reportFileName(createdAt: Date, mode: EvalMode): string {
  return `eval-${createdAt.toISOString().replace(/[:.]/g, '-')}-${mode}.json`;
}

/**
 * Live spend guard. Returns a reason to skip the next cloud case, or undefined when it may run.
 * The wire-level cap in eval.mjs is the real limit; this keeps skipped cases out of the failure list.
 */
export function budgetSkipReason(used: number, budget: number): string | undefined {
  return used >= budget ? `Request budget used up (${used} of ${budget}).` : undefined;
}
