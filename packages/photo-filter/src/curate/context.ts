import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface EventSummary {
  id: string;
  photoCount: number;
  label: string;
  people: string[];
  inScope: boolean;
  notes: string;
  promptVersion: number;
}

export interface Verdict {
  uuid: string;
  subjectPresent: boolean;
  relevant: boolean;
  quality: 1 | 2 | 3 | 4 | 5;
  moment: string;
  reason: string;
  promptVersion: number;
}

/** Per-photo scores from a decision model (Jev); probabilities, not free text. */
export interface DecisionVerdict {
  uuid: string;
  subject: number;
  special: number;
  /** Quality on the model's 0..N-1 score scale (Jev quality criteria are length 5 → 0..4). */
  quality: number;
  promptVersion: number;
  /** `DecisionModel.id` that produced this verdict; cache misses when it changes. */
  modelId: string;
  /** Subjects and reference uuids the subject score was judged against; cache misses when they change. */
  subjectKey?: string;
}

export interface PickRecord {
  uuid: string;
  event: string;
  date: string;
  moment: string;
  reason: string;
  runAt: string;
}

export interface FeedbackRecord {
  uuid: string;
  verdict: 'kept' | 'rejected';
  note?: string;
  at: string;
}

export interface Subject {
  name: string;
  /** Reference photo uuids showing this person. */
  refs: string[];
}

/**
 * Everything the model calls share, within a run and across runs: event
 * summaries and verdicts act as a cache; picks and feedback steer later runs.
 */
export interface CurationContext {
  version: 1;
  album: string;
  brief: string;
  subjects: Subject[];
  events: Record<string, EventSummary>;
  verdicts: Record<string, Verdict>;
  /** Cached Jev (decision-model) per-photo scores; keyed by uuid. */
  decisionVerdicts: Record<string, DecisionVerdict>;
  picks: PickRecord[];
  feedback: FeedbackRecord[];
  /** Model pick replies keyed by the exact candidate set, so a re-run reproduces the reviewed picks. */
  pickCache: Record<string, { uuid: string; reason: string }[]>;
}

export function emptyContext(album: string, brief: string): CurationContext {
  return {
    version: 1,
    album,
    brief,
    subjects: [],
    events: {},
    verdicts: {},
    decisionVerdicts: {},
    picks: [],
    feedback: [],
    pickCache: {},
  };
}

const slug = (s: string) =>
  s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

export function defaultContextPath(album: string, brief: string): string {
  return join(homedir(), '.photo-filter', 'context', `${slug(album)}--${slug(brief)}.json`);
}

/**
 * Loads a saved context, or starts a new one. Verdicts are brief-specific, so a
 * context saved for a different brief keeps its events, picks, and feedback only.
 */
export async function loadContext(path: string, album: string, brief: string): Promise<CurationContext> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyContext(album, brief);
    throw err;
  }
  const ctx = JSON.parse(raw) as CurationContext;
  if (ctx.version !== 1) throw new Error(`unsupported context version in ${path}`);
  if (ctx.album !== album) throw new Error(`context ${path} belongs to album "${ctx.album}", not "${album}"`);
  ctx.pickCache ??= {};
  ctx.decisionVerdicts ??= {};
  return ctx.brief === brief
    ? ctx
    : { ...ctx, brief, verdicts: {}, decisionVerdicts: {}, pickCache: {} };
}

export async function saveContext(path: string, ctx: CurationContext): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(ctx, null, 2)}\n`);
  await rename(tmp, path);
}
