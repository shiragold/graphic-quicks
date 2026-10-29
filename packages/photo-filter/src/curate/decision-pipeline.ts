import { createHash } from 'node:crypto';

import type { PhotoLibrary } from '../library.js';
import type { AlbumSummary, PhotoSummary } from '../types.js';
import type { CurationContext, DecisionVerdict } from './context.js';
import {
  burstCompareInstructions,
  DECISION_PROMPT_VERSION,
  judgeQuestions,
  specialCompareInstructions,
} from './decision-prompts.js';
import type { Answer, DecisionModel, DecisionRequest, StateItem } from './decisions.js';
import { fitForDecision } from './fit.js';
import { groupNearDuplicates, splitEvents } from './group.js';
import { sharpImageTools, type ImageTools } from './images.js';
import { mapLimit, previewSource, resolveAlbum, resolveSubjects } from './pipeline.js';

export interface DecisionCurateDeps {
  lib: PhotoLibrary;
  model: DecisionModel;
  images?: ImageTools;
  /** Resize/pad JPEGs for the decision model; defaults to `fitForDecision`. */
  fit?: (jpeg: Buffer) => Promise<Buffer>;
  log?: (message: string) => void;
}

export interface DecisionCurateOptions {
  album: string;
  around?: string;
  days?: number;
  from?: string;
  to?: string;
  brief: string;
  count: number;
  subjects?: { name: string; refs?: string[] }[];
  context: CurationContext;
  qualityWeight?: number;
  minScore?: number;
  /**
   * Floor on pick count. When fewer than this many keepers clear `minScore`,
   * fill from the next-best keepers below the barrier (still subject/quality eligible).
   * Default 0 (no floor); the CLI defaults `--min-photos` to 10.
   */
  minPhotos?: number;
  concurrency?: number;
  gapHours?: number;
}

export interface DecisionPickCandidate {
  uuid: string;
  date: string;
  event: string;
  verdict: DecisionVerdict;
  score: number;
}

export interface DecisionCuratedPick {
  candidate: DecisionPickCandidate;
  reason: string;
}

export interface DecisionCurationResult {
  album: AlbumSummary;
  considered: number;
  skipped: string[];
  events: { id: string; photoCount: number; label: string; inScope: boolean }[];
  shortlist: DecisionPickCandidate[];
  picks: DecisionCuratedPick[];
  previews: Record<string, string>;
  modelCalls: number;
  inputTokens: number;
  costUsd: number;
  modelBuild: string;
}

export const MAX_DECISION_COUNT = 60;
const LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Prefer a local original JPEG/PNG over the often-tiny shared-album preview. */
const source = (p: PhotoSummary) => previewSource(p, true);

const localTime = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const num = (a: Answer) => (a.type === 'noul' ? a.noul : a.type === 'score' ? a.score : NaN);

export function photoScore(v: DecisionVerdict, qualityWeight: number): number {
  return (1 - qualityWeight + (qualityWeight * v.quality) / 4) * v.special * (0.6 + 0.4 * v.subject);
}

export function formatDecisionReason(v: DecisionVerdict, qualityWeight: number): string {
  return (
    `special ${Math.round(v.special * 100)}% · subject ${Math.round(v.subject * 100)}% · ` +
    `q${v.quality.toFixed(1)} · score ${photoScore(v, qualityWeight).toFixed(2)}`
  );
}

/**
 * Default pick count: `perMonth` photos per 30 days of the date range (falls back
 * to `perMonth` when unknown), capped at `MAX_DECISION_COUNT`.
 */
export function countForRange(
  opts: { from?: string; to?: string; around?: string; days?: number },
  perMonth = 20,
): number {
  let days: number | undefined;
  if (opts.from && opts.to) days = (Date.parse(opts.to) - Date.parse(opts.from)) / 86_400_000;
  else if (opts.around !== undefined) days = 2 * (opts.days ?? 2) + 1;
  const count = days === undefined || !Number.isFinite(days) || days <= 0 ? perMonth : (perMonth * days) / 30;
  return Math.min(MAX_DECISION_COUNT, Math.max(1, Math.round(count)));
}

/** Target pick count: at least `minPhotos`, at most `MAX_DECISION_COUNT`. */
export function pickTarget(count: number, minPhotos = 0): number {
  if (!Number.isInteger(minPhotos) || minPhotos < 0 || minPhotos > MAX_DECISION_COUNT) {
    throw new Error(`minPhotos must be an integer from 0 to ${MAX_DECISION_COUNT}`);
  }
  return Math.min(MAX_DECISION_COUNT, Math.max(count, minPhotos));
}

/**
 * Prefer keepers at/above `minScore`; if that pool is thinner than `target`,
 * append the next-best keepers below the barrier (already ranked by score).
 */
export function poolForTarget(
  keepers: string[],
  scoreOf: (uuid: string) => number,
  minScore: number,
  target: number,
): { pool: string[]; aboveBarrier: number; filledBelow: number } {
  const ranked = [...keepers].sort((a, b) => scoreOf(b) - scoreOf(a));
  const above = ranked.filter((u) => scoreOf(u) >= minScore);
  if (above.length >= target) {
    return { pool: above, aboveBarrier: above.length, filledBelow: 0 };
  }
  const below = ranked.filter((u) => scoreOf(u) < minScore);
  const filledBelow = Math.min(below.length, Math.max(0, target - above.length));
  return {
    pool: [...above, ...below.slice(0, filledBelow)],
    aboveBarrier: above.length,
    filledBelow,
  };
}

export async function curateWithDecisions(
  deps: DecisionCurateDeps,
  opts: DecisionCurateOptions,
): Promise<DecisionCurationResult> {
  const { lib, model } = deps;
  const images = deps.images ?? sharpImageTools;
  const fit = deps.fit ?? fitForDecision;
  const log = deps.log ?? (() => {});
  const ctx = opts.context;
  const { qualityWeight = 0.3, minScore = 0.3, minPhotos = 0, concurrency = 4, gapHours = 3 } = opts;
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > MAX_DECISION_COUNT) {
    throw new Error(`count must be an integer from 1 to ${MAX_DECISION_COUNT}`);
  }
  if (!(qualityWeight >= 0 && qualityWeight <= 1)) throw new Error('qualityWeight must be between 0 and 1');
  if (!(minScore >= 0 && minScore <= 1)) throw new Error('minScore must be between 0 and 1');
  const target = pickTarget(opts.count, minPhotos);

  let modelCalls = 0;
  let inputTokens = 0;
  let costUsd = 0;
  let modelBuild = model.id;

  const decide = async (req: DecisionRequest) => {
    modelCalls++;
    const r = await model.decide(req);
    inputTokens += r.usage.inputTokens;
    costUsd += r.usage.costUsd;
    modelBuild = r.model;
    return r.answers;
  };

  const album = resolveAlbum(await lib.listAlbums(), opts.album);
  const queried = await lib.queryPhotos({
    album: [album.name],
    around: opts.around,
    days: opts.days,
    from: opts.from,
    to: opts.to,
    sort: 'date',
  });
  let photos = queried.filter((p) => source(p) !== null);
  const skipped = queried.filter((p) => source(p) === null).map((p) => p.uuid);
  log(
    `${album.name}: ${queried.length} photos in range` +
      `${skipped.length ? `, ${skipped.length} iCloud-only skipped` : ''}; model ${model.id}`,
  );

  const refPhotos = await resolveSubjects(lib, ctx, opts.subjects, log);
  const refBuffers: { name: string; jpeg: Buffer }[] = (
    await Promise.all(
      refPhotos.map(async ({ name, photo }) => {
        const src = source(photo);
        return src ? { name, jpeg: await fit(await images.thumbnail(src, 384)) } : null;
      }),
    )
  ).filter((r): r is { name: string; jpeg: Buffer } => r !== null);

  const subjectText = (() => {
    if (!ctx.subjects.length) return 'the subject of the brief';
    const names = ctx.subjects.map((s) => s.name).join(' and ');
    return refBuffers.length ? `${names} (shown in the reference photo${refBuffers.length > 1 ? 's' : ''})` : names;
  })();

  const header: StateItem[] = [
    `Album: ${album.name}. Brief: ${opts.brief}.`,
    ...refBuffers.flatMap((r) => [`Reference photo of ${r.name}:`, { type: 'image' as const, jpeg: r.jpeg }]),
  ];

  const thumbs = new Map<string, Buffer>();
  const hashes = new Map<string, bigint>();
  const unreadable = new Set<string>();
  await mapLimit(photos, 8, async (p) => {
    let thumb: Buffer;
    try {
      thumb = await images.thumbnail(source(p)!, 512);
      thumbs.set(p.uuid, await fit(thumb));
    } catch {
      unreadable.add(p.uuid);
      return;
    }
    try {
      // Hash the decoded thumbnail rather than decoding the original a second time.
      hashes.set(p.uuid, await images.dhash(thumb));
    } catch {
      // unhashable: grouped by burst timing only
    }
  });
  if (unreadable.size) {
    photos = photos.filter((p) => !unreadable.has(p.uuid));
    skipped.push(...unreadable);
    log(`${unreadable.size} unreadable photos skipped`);
  }

  const groups = groupNearDuplicates(photos, hashes);
  const events = splitEvents(photos, gapHours);
  const eventOf = new Map(events.flatMap((e) => e.photos.map((p) => [p.uuid, e.id] as const)));
  log(`${groups.length} near-duplicate groups, ${events.length} events`);

  const questions = judgeQuestions(subjectText);
  // Subject scores depend on who the subjects are and which reference photos show them.
  const subjectKey = ctx.subjects.map((s) => `${s.name}=${s.refs.join('+')}`).join(';');
  const scoreOf = (v: DecisionVerdict) => photoScore(v, qualityWeight);
  let done = 0;

  await mapLimit(photos, concurrency, async (p) => {
    const cached = ctx.decisionVerdicts[p.uuid];
    if (
      cached &&
      cached.promptVersion === DECISION_PROMPT_VERSION &&
      cached.modelId === model.id &&
      cached.subjectKey === subjectKey
    ) {
      done++;
      return;
    }
    const a = await decide({
      name: `judge ${p.uuid}`,
      state: [...header, `Photo to judge, taken ${localTime(p.date)}:`, { type: 'image', jpeg: thumbs.get(p.uuid)! }],
      questions,
    });
    ctx.decisionVerdicts[p.uuid] = {
      uuid: p.uuid,
      subject: num(a.subject),
      special: num(a.special),
      quality: num(a.quality),
      promptVersion: DECISION_PROMPT_VERSION,
      modelId: model.id,
      subjectKey,
    };
    if (++done % 10 === 0 || done === photos.length) log(`judged ${done}/${photos.length}`);
  });

  async function knockout(name: string, pool: string[], instructions: string): Promise<string> {
    let remaining = pool;
    while (remaining.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < remaining.length; i += 4) {
        const heat = remaining.slice(i, i + 4);
        if (heat.length === 1) {
          next.push(heat[0]);
          continue;
        }
        // Cache each heat's winner so a re-run (e.g. with --yes) reproduces the reviewed picks.
        const key = `decision:${createHash('sha1')
          .update(JSON.stringify([DECISION_PROMPT_VERSION, model.id, instructions, opts.brief, heat]))
          .digest('hex')}`;
        const cached = ctx.pickCache[key]?.[0]?.uuid;
        if (cached && heat.includes(cached)) {
          next.push(cached);
          continue;
        }
        const a = await decide({
          name,
          state: [
            `Album: ${album.name}. Brief: ${opts.brief}.`,
            ...heat.flatMap((u, k) => [`Photo ${LETTERS[k]}:`, { type: 'image' as const, jpeg: thumbs.get(u)! }]),
          ],
          questions: {
            best: {
              type: 'choice',
              instructions,
              criteria: Object.fromEntries(heat.map((_, k) => [LETTERS[k], null])),
            },
          },
        });
        const letter = a.best.type === 'choice' ? a.best.choice : 'A';
        const winner = heat[LETTERS.indexOf(letter as (typeof LETTERS)[number])] ?? heat[0];
        ctx.pickCache[key] = [{ uuid: winner, reason: name }];
        next.push(winner);
      }
      remaining = next;
    }
    return remaining[0];
  }

  // Filter each near-duplicate group before its knockout, so a winner that fails
  // the subject/quality bar can't take the whole group down with it.
  const rejected = new Set(ctx.feedback.filter((f) => f.verdict === 'rejected').map((f) => f.uuid));
  const eligible = (u: string) => {
    const v = ctx.decisionVerdicts[u];
    return !!v && v.subject >= 0.5 && v.quality >= 1 && !rejected.has(u);
  };
  const keepers = (
    await mapLimit(groups, concurrency, async (group, gi) => {
      const pool = group.filter(eligible);
      if (pool.length <= 1) return pool[0];
      return knockout(`burst ${gi + 1}`, pool, burstCompareInstructions());
    })
  ).filter((u): u is string => u !== undefined);
  const { pool: strong, aboveBarrier, filledBelow } = poolForTarget(
    keepers,
    (u) => scoreOf(ctx.decisionVerdicts[u]),
    minScore,
    target,
  );
  if (filledBelow > 0) {
    log(
      `min-photos ${minPhotos}: filled ${filledBelow} below min-score ${minScore}` +
        ` (${aboveBarrier} cleared the barrier; target ${target})`,
    );
  }

  const byEvent = new Map<string, string[]>();
  for (const u of strong) byEvent.set(eventOf.get(u)!, [...(byEvent.get(eventOf.get(u)!) ?? []), u]);
  for (const list of byEvent.values()) list.sort((a, b) => scoreOf(ctx.decisionVerdicts[b]) - scoreOf(ctx.decisionVerdicts[a]));

  const quota = new Map<string, number>();
  [...byEvent]
    .flatMap(([e, list]) => list.map((u, depth) => ({ e, u, depth })))
    .sort(
      (a, b) =>
        a.depth - b.depth || scoreOf(ctx.decisionVerdicts[b.u]) - scoreOf(ctx.decisionVerdicts[a.u]),
    )
    .slice(0, target)
    .forEach(({ e }) => quota.set(e, (quota.get(e) ?? 0) + 1));

  const specialQ = specialCompareInstructions(subjectText);
  const pickUuids = (
    await mapLimit([...quota], concurrency, async ([e, q]) => {
      let pool = byEvent.get(e)!.slice(0, q + 3);
      if (pool.length <= q) return pool;
      const chosen: string[] = [];
      while (chosen.length < q) {
        const best = await knockout(`event ${e} slot ${chosen.length + 1}`, pool, specialQ);
        chosen.push(best);
        pool = pool.filter((u) => u !== best);
      }
      return chosen;
    })
  )
    .flat()
    .sort((a, b) => scoreOf(ctx.decisionVerdicts[b]) - scoreOf(ctx.decisionVerdicts[a]));

  const photoBy = new Map(photos.map((p) => [p.uuid, p]));
  const toCandidate = (uuid: string): DecisionPickCandidate => {
    const v = ctx.decisionVerdicts[uuid];
    return {
      uuid,
      date: photoBy.get(uuid)!.date,
      event: eventOf.get(uuid)!,
      verdict: v,
      score: scoreOf(v),
    };
  };

  const shortlist = strong.map(toCandidate).sort((a, b) => b.score - a.score);
  const picks: DecisionCuratedPick[] = pickUuids.map((uuid) => {
    const candidate = toCandidate(uuid);
    return { candidate, reason: formatDecisionReason(candidate.verdict, qualityWeight) };
  });

  const inScope = new Set(strong.map((u) => eventOf.get(u)!));
  const eventSummaries = events.map((e) => ({
    id: e.id,
    photoCount: e.photos.length,
    label: e.id.slice(0, 16).replace('T', ' '),
    inScope: inScope.has(e.id),
  }));

  log(
    `picks: ${picks.length} from ${new Set(picks.map((p) => p.candidate.event)).size} events` +
      ` (${aboveBarrier} above min-score ${minScore}` +
      `${filledBelow ? `, ${filledBelow} below to meet min-photos` : ''}); $${costUsd.toFixed(4)}`,
  );

  return {
    album,
    considered: queried.length,
    skipped,
    events: eventSummaries,
    shortlist,
    picks,
    previews: Object.fromEntries(shortlist.map((c) => [c.uuid, source(photoBy.get(c.uuid)!)!])),
    modelCalls,
    inputTokens,
    costUsd,
    modelBuild,
  };
}
