import { createHash } from 'node:crypto';

import type { PhotoLibrary } from '../library.js';
import type { AlbumSummary, PhotoSummary } from '../types.js';
import type { CurationContext, EventSummary, Subject, Verdict } from './context.js';
import { groupNearDuplicates, splitEvents, type PhotoEvent } from './group.js';
import { sharpImageTools, type ImageTools } from './images.js';
import type { ModelRequest, VisionModel } from './model.js';
import {
  PROMPT_VERSION,
  judgeRequest,
  parseJudge,
  parsePick,
  parseSurvey,
  pickRequest,
  surveyRequest,
  type JudgeItem,
  type PickCandidate,
  type RefImage,
} from './prompts.js';

export interface CurateDeps {
  lib: PhotoLibrary;
  model: VisionModel;
  images?: ImageTools;
  log?: (message: string) => void;
}

export interface CurateOptions {
  album: string;
  around?: string;
  days?: number;
  from?: string;
  to?: string;
  brief: string;
  count: number;
  /** People the brief is about; refs default to their top-scored People-tagged photos. */
  subjects?: { name: string; refs?: string[] }[];
  /** Shared, persisted context; mutated in place with new summaries and verdicts. */
  context: CurationContext;
  gapHours?: number;
  batchSize?: number;
  concurrency?: number;
  minQuality?: number;
}

export interface CuratedPick {
  candidate: PickCandidate;
  reason: string;
}

export interface CurationResult {
  album: AlbumSummary;
  considered: number;
  /** uuids with no local preview (iCloud-only), so never shown to the model. */
  skipped: string[];
  events: EventSummary[];
  shortlist: PickCandidate[];
  picks: CuratedPick[];
  /** Preview file per shortlisted uuid, for building review sheets. */
  previews: Record<string, string>;
  modelCalls: number;
}

export const MAX_COUNT = 40;
const MAX_PICK_POOL = 48;
const SHEET_PAGE = 24;

export function resolveAlbum(albums: AlbumSummary[], name: string): AlbumSummary {
  const exact = albums.find((a) => a.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  const same = albums.filter((a) => a.name.toLowerCase() === lower);
  if (same.length === 1) return same[0];
  const partial = albums.filter((a) => a.name.toLowerCase().includes(lower));
  if (partial.length === 1 && same.length === 0) return partial[0];
  const options = (same.length ? same : partial).slice(0, 10).map((a) => `"${a.name}"`);
  throw new Error(
    options.length ? `album "${name}" is ambiguous: ${options.join(', ')}` : `no album named "${name}"`,
  );
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const previewSource = (p: PhotoSummary) =>
  p.previewPath ?? (p.path && /\.(jpe?g|png)$/i.test(p.path) ? p.path : null);

const time = (iso: string) => Date.parse(iso) || 0;

function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)]);
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

export async function curatePhotos(deps: CurateDeps, opts: CurateOptions): Promise<CurationResult> {
  const { lib, model } = deps;
  const images = deps.images ?? sharpImageTools;
  const log = deps.log ?? (() => {});
  const ctx = opts.context;
  const { batchSize = 12, concurrency = 4, minQuality = 3, gapHours = 3 } = opts;
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > MAX_COUNT) {
    throw new Error(`count must be an integer from 1 to ${MAX_COUNT}`);
  }
  let modelCalls = 0;

  const ask = async <T>(req: ModelRequest, parse: (reply: unknown) => T): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      modelCalls++;
      try {
        return parse(await model.generate(req));
      } catch (err) {
        if (attempt >= 2) throw err;
        log(`${req.name}: ${err instanceof Error ? err.message : String(err)}; retrying`);
      }
    }
  };

  // 1. Album and photos: one library query.
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
  log(`${album.name}: ${queried.length} photos in range${skipped.length ? `, ${skipped.length} iCloud-only skipped` : ''}`);

  // 2. Subjects and their reference images.
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
  const refs: RefImage[] = (
    await Promise.all(
      refPhotos.map(async (p, i) => {
        const src = previewSource(p);
        return src ? { name: refUuids[i].name, jpeg: await images.thumbnail(src, 384) } : null;
      }),
    )
  ).filter((r): r is RefImage => r !== null);

  // 3. Survey: summarise each event once (cached in context).
  const events = splitEvents(photos, gapHours);
  const summaries = await mapLimit(events, concurrency, async (event) => {
    const cached = ctx.events[event.id];
    if (cached && cached.promptVersion === PROMPT_VERSION && cached.photoCount === event.photos.length) return cached;
    const shown = sample(event.photos, 36);
    const sheet = await images.contactSheet(
      shown.map((p, i) => ({ path: previewSource(p)!, label: String(i + 1) })),
      { cols: 6, cell: 160 },
    );
    const summary = await ask(surveyRequest(ctx, event, sheet, shown.length, refs), (r) => parseSurvey(r, event));
    ctx.events[event.id] = summary;
    log(`event ${event.id} (${event.photos.length}): ${summary.label}${summary.inScope ? '' : ' — out of scope'}`);
    return summary;
  });

  // 4. Judge in-scope events, batch by batch, with a running tally per event.
  const groupOf = new Map<string, number>();
  const groupsByEvent = new Map<string, string[][]>();
  const inScope = events.filter((_, i) => summaries[i].inScope);

  await mapLimit(inScope, concurrency, async (event: PhotoEvent) => {
    const summary = ctx.events[event.id];
    const hashes = new Map<string, bigint>();
    await mapLimit(event.photos, 8, async (p) => {
      try {
        hashes.set(p.uuid, await images.dhash(previewSource(p)!));
      } catch {
        // unreadable preview: grouped by burst timing only
      }
    });
    const groups = groupNearDuplicates(event.photos, hashes);
    groupsByEvent.set(event.id, groups);
    groups.forEach((g, gi) => g.forEach((uuid) => groupOf.set(uuid, gi + 1)));

    const tally = new Map<string, number>();
    const count = (v: Verdict) => {
      if (v.relevant && v.quality >= 4) tally.set(v.moment, (tally.get(v.moment) ?? 0) + 1);
    };
    const fresh = (uuid: string) => ctx.verdicts[uuid]?.promptVersion === PROMPT_VERSION;
    event.photos.filter((p) => fresh(p.uuid)).forEach((p) => count(ctx.verdicts[p.uuid]));

    const byUuid = new Map(event.photos.map((p) => [p.uuid, p]));
    const pending = groups.flat().filter((uuid) => !fresh(uuid));
    const batches: string[][] = [];
    for (const group of groups) {
      const todo = group.filter((uuid) => !fresh(uuid));
      for (const part of chunk(todo, batchSize)) {
        const last = batches.at(-1);
        if (last && last.length + part.length <= batchSize) last.push(...part);
        else batches.push([...part]);
      }
    }
    if (pending.length) log(`event ${event.id}: judging ${pending.length} photos in ${batches.length} batch(es)`);

    for (const [bi, batch] of batches.entries()) {
      const items: JudgeItem[] = await Promise.all(
        batch.map(async (uuid) => {
          const p = byUuid.get(uuid)!;
          return { uuid, date: p.date, group: groupOf.get(uuid)!, jpeg: await images.thumbnail(previewSource(p)!, 512) };
        }),
      );
      const verdicts = await ask(
        judgeRequest(ctx, summary, items, tally, refs, `${bi + 1}/${batches.length}`),
        (r) => parseJudge(r, items),
      );
      for (const v of verdicts) {
        ctx.verdicts[v.uuid] = v;
        count(v);
      }
    }
  });

  // 5. Shortlist: best keeper per near-duplicate group, minus anything the user rejected before.
  const rejected = new Set(ctx.feedback.filter((f) => f.verdict === 'rejected').map((f) => f.uuid));
  const photoBy = new Map(photos.map((p) => [p.uuid, p]));
  const shortlist: PickCandidate[] = [];
  for (const event of inScope) {
    const label = ctx.events[event.id].label;
    for (const group of groupsByEvent.get(event.id) ?? []) {
      const keepers = group
        .map((uuid) => ctx.verdicts[uuid])
        .filter((v): v is Verdict => !!v && v.relevant && v.quality >= minQuality && !rejected.has(v.uuid))
        .sort(
          (a, b) =>
            b.quality - a.quality ||
            Number(b.subjectPresent) - Number(a.subjectPresent) ||
            time(photoBy.get(a.uuid)!.date) - time(photoBy.get(b.uuid)!.date),
        );
      if (keepers[0]) shortlist.push({ uuid: keepers[0].uuid, date: photoBy.get(keepers[0].uuid)!.date, event: label, verdict: keepers[0] });
    }
  }
  shortlist.sort((a, b) => time(a.date) - time(b.date));
  log(`shortlist: ${shortlist.length} candidates`);

  // 6. Final pick by the model over numbered contact sheets; large pools are reduced in rounds.
  const sheetsFor = (cands: PickCandidate[]) =>
    Promise.all(
      chunk(cands, SHEET_PAGE).map((page, pi) =>
        images.contactSheet(
          page.map((c, i) => ({ path: previewSource(photoBy.get(c.uuid)!)!, label: `#${pi * SHEET_PAGE + i + 1}` })),
          { cols: 6, cell: 256 },
        ),
      ),
    );
  const pickFrom = async (cands: PickCandidate[], n: number, scope: string): Promise<CuratedPick[]> => {
    if (cands.length <= n) return cands.map((candidate) => ({ candidate, reason: candidate.verdict.reason }));
    const key = createHash('sha1')
      .update(JSON.stringify([PROMPT_VERSION, n, ctx.feedback.length, cands.map((c) => c.uuid)]))
      .digest('hex');
    const byUuid = new Map(cands.map((c) => [c.uuid, c]));
    const cached = ctx.pickCache[key];
    if (cached?.every((p) => byUuid.has(p.uuid))) {
      return cached.map((p) => ({ candidate: byUuid.get(p.uuid)!, reason: p.reason }));
    }
    const sheets = await sheetsFor(cands);
    const picks = await ask(pickRequest(ctx, cands, sheets, n, scope), (r) => parsePick(r, cands, n));
    ctx.pickCache[key] = picks.map((p) => ({ uuid: p.candidate.uuid, reason: p.reason }));
    return picks;
  };

  let pool = shortlist;
  for (let round = 1; pool.length > MAX_PICK_POOL; round++) {
    const target = Math.max(opts.count, Math.ceil(pool.length / 2));
    const chunks = chunk(pool, MAX_PICK_POOL);
    const kept = await mapLimit(chunks, concurrency, (c, ci) =>
      pickFrom(c, Math.max(1, Math.round((c.length * target) / pool.length)), `round ${round}, part ${ci + 1}/${chunks.length}`),
    );
    pool = kept.flat().map((k) => k.candidate).sort((a, b) => time(a.date) - time(b.date));
    log(`pick round ${round}: ${pool.length} remain`);
  }
  const picks = await pickFrom(pool, opts.count, 'final');

  return {
    album,
    considered: queried.length,
    skipped,
    events: summaries,
    shortlist,
    picks,
    previews: Object.fromEntries(shortlist.map((c) => [c.uuid, previewSource(photoBy.get(c.uuid)!)!])),
    modelCalls,
  };
}
