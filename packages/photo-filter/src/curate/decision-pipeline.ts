import type { PhotoLibrary } from '../library.js';
import type { AlbumSummary, PhotoSummary } from '../types.js';
import type { CurationContext, DecisionVerdict, Subject } from './context.js';
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
import { mapLimit, resolveAlbum } from './pipeline.js';

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
export const previewSource = (p: PhotoSummary) =>
  (p.path && /\.(jpe?g|png)$/i.test(p.path) ? p.path : p.previewPath) ?? null;

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

/** Default pick count: `perMonth` photos per 30 days of the date range (falls back to `perMonth` when unknown). */
export function countForRange(
  opts: { from?: string; to?: string; around?: string; days?: number },
  perMonth = 20,
): number {
  let days: number | undefined;
  if (opts.from && opts.to) days = (Date.parse(opts.to) - Date.parse(opts.from)) / 86_400_000;
  else if (opts.around !== undefined) days = 2 * (opts.days ?? 2) + 1;
  if (days === undefined || !Number.isFinite(days) || days <= 0) return perMonth;
  return Math.max(1, Math.round((perMonth * days) / 30));
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
  const { qualityWeight = 0.3, minScore = 0.3, concurrency = 4, gapHours = 3 } = opts;
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > MAX_DECISION_COUNT) {
    throw new Error(`count must be an integer from 1 to ${MAX_DECISION_COUNT}`);
  }
  if (!(qualityWeight >= 0 && qualityWeight <= 1)) throw new Error('qualityWeight must be between 0 and 1');
  if (!(minScore >= 0 && minScore <= 1)) throw new Error('minScore must be between 0 and 1');

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
  const photos = queried.filter((p) => previewSource(p) !== null);
  const skipped = queried.filter((p) => previewSource(p) === null).map((p) => p.uuid);
  log(
    `${album.name}: ${queried.length} photos in range` +
      `${skipped.length ? `, ${skipped.length} iCloud-only skipped` : ''}; model ${model.id}`,
  );

  const subjects: Subject[] = [];
  for (const s of opts.subjects ?? []) {
    const saved = ctx.subjects.find((c) => c.name === s.name);
    let refs = s.refs?.length ? s.refs : (saved?.refs ?? []);
    if (!refs.length) {
      refs = (await lib.queryPhotos({ person: [s.name], sort: 'score', limit: 3 })).map((p) => p.uuid);
      if (!refs.length) log(`no People-tagged photos of ${s.name}; pass --ref ${s.name}=UUID for better recognition`);
    }
    subjects.push({ name: s.name, refs });
  }
  if (subjects.length) ctx.subjects = subjects;

  const refUuids = ctx.subjects.flatMap((s) => s.refs.map((uuid) => ({ name: s.name, uuid })));
  const refPhotos = refUuids.length ? await lib.getPhotos(refUuids.map((r) => r.uuid)) : [];
  const refBuffers: { name: string; jpeg: Buffer }[] = (
    await Promise.all(
      refPhotos.map(async (p, i) => {
        const src = previewSource(p);
        return src ? { name: refUuids[i].name, jpeg: await fit(await images.thumbnail(src, 384)) } : null;
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
  await mapLimit(photos, 8, async (p) => {
    thumbs.set(p.uuid, await fit(await images.thumbnail(previewSource(p)!, 512)));
    try {
      hashes.set(p.uuid, await images.dhash(previewSource(p)!));
    } catch {
      // unreadable: grouped by burst timing only
    }
  });

  const groups = groupNearDuplicates(photos, hashes);
  const groupOf = new Map(groups.flatMap((g, gi) => g.map((u) => [u, gi + 1] as const)));
  const events = splitEvents(photos, gapHours);
  const eventOf = new Map(events.flatMap((e) => e.photos.map((p) => [p.uuid, e.id] as const)));
  log(`${groups.length} near-duplicate groups, ${events.length} events`);

  const questions = judgeQuestions(subjectText);
  const scoreOf = (v: DecisionVerdict) => photoScore(v, qualityWeight);
  let done = 0;

  await mapLimit(photos, concurrency, async (p) => {
    const cached = ctx.decisionVerdicts[p.uuid];
    if (
      cached &&
      cached.promptVersion === DECISION_PROMPT_VERSION &&
      cached.modelId === model.id
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
        next.push(heat[LETTERS.indexOf(letter as (typeof LETTERS)[number])] ?? heat[0]);
      }
      remaining = next;
    }
    return remaining[0];
  }

  const winners = new Map<number, string>();
  await mapLimit(
    groups.filter((g) => g.length > 1),
    concurrency,
    async (group) => {
      const g = groupOf.get(group[0])!;
      winners.set(g, await knockout(`burst ${g}`, group, burstCompareInstructions()));
    },
  );

  const rejected = new Set(ctx.feedback.filter((f) => f.verdict === 'rejected').map((f) => f.uuid));
  const keepers = groups
    .map((g, gi) => (g.length > 1 ? winners.get(gi + 1)! : g[0]))
    .filter((u) => {
      const v = ctx.decisionVerdicts[u];
      return v && v.subject >= 0.5 && v.quality >= 1 && !rejected.has(u);
    });
  const strong = keepers.filter((u) => scoreOf(ctx.decisionVerdicts[u]) >= minScore);

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
    .slice(0, opts.count)
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
      ` (${strong.length} candidates above min-score ${minScore}); $${costUsd.toFixed(4)}`,
  );

  return {
    album,
    considered: queried.length,
    skipped,
    events: eventSummaries,
    shortlist,
    picks,
    previews: Object.fromEntries(shortlist.map((c) => [c.uuid, previewSource(photoBy.get(c.uuid)!)!])),
    modelCalls,
    inputTokens,
    costUsd,
    modelBuild,
  };
}
