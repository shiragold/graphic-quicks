import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import type { PhotoLibrary } from '../library.js';
import type { PhotoVersion } from '../types.js';
import { defaultContextPath, loadContext, saveContext } from './context.js';
import { countForRange, curateWithDecisions } from './decision-pipeline.js';
import { DECISION_PROMPT_VERSION } from './decision-prompts.js';
import { createOpenRouterDecisions, type DecisionModel } from './decisions.js';
import { sharpImageTools, type ImageTools } from './images.js';
import { parseReviewAnswer, recordReview, writeReviewSheet } from './review.js';

export interface CurateCommandOptions {
  album: string;
  brief: string;
  dest: string;
  /** Explicit pick count; when omitted, derived from `--per-month` and the date range. */
  count?: number;
  perMonth?: number;
  around?: string;
  days?: number;
  from?: string;
  to?: string;
  subjects: { name: string; refs?: string[] }[];
  contextPath?: string;
  model?: string;
  qualityWeight?: number;
  minScore?: number;
  /** Floor on picks; fill below min-score when needed (CLI default 10). */
  minPhotos?: number;
  yes: boolean;
  version?: PhotoVersion;
  convertToJpeg: boolean;
  json: boolean;
}

export interface CurateCommandDeps {
  model?: DecisionModel;
  images?: ImageTools;
  fit?: (jpeg: Buffer) => Promise<Buffer>;
  /** Asks the confirm question; defaults to a stdin prompt when stdin is a TTY. */
  ask?: (question: string) => Promise<string>;
}

const log = (message: string) => console.error(`· ${message}`);

const ttyAsk = async (question: string) => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};

/** The `photo-filter curate` flow: Jev pipeline, review sheet, confirm, export, manifest, save context. */
export async function runCurateCommand(
  lib: PhotoLibrary,
  opts: CurateCommandOptions,
  deps: CurateCommandDeps = {},
): Promise<void> {
  const model = deps.model ?? createOpenRouterDecisions({ model: opts.model });
  const images = deps.images ?? sharpImageTools;
  const contextPath = opts.contextPath ?? defaultContextPath(opts.album, opts.brief);
  const ctx = await loadContext(contextPath, opts.album, opts.brief);
  const dest = resolve(opts.dest);
  await mkdir(dest, { recursive: true });
  const count =
    opts.count ??
    countForRange({ from: opts.from, to: opts.to, around: opts.around, days: opts.days }, opts.perMonth ?? 20);

  let result;
  try {
    result = await curateWithDecisions(
      { lib, model, images, fit: deps.fit, log },
      {
        album: opts.album,
        brief: opts.brief,
        count,
        around: opts.around,
        days: opts.days,
        from: opts.from,
        to: opts.to,
        subjects: opts.subjects,
        context: ctx,
        qualityWeight: opts.qualityWeight,
        minScore: opts.minScore,
        minPhotos: opts.minPhotos,
      },
    );
  } finally {
    await saveContext(contextPath, ctx);
  }

  const reviewPath = join(dest, 'review.html');
  await writeReviewSheet(reviewPath, result, opts.brief, async (uuid) => {
    const src = result.previews[uuid];
    return src ? images.thumbnail(src, 480) : null;
  });
  console.error(`· review sheet: ${reviewPath}`);
  console.error(`· context: ${contextPath}`);
  result.picks.forEach((p, i) =>
    console.error(
      `${String(i + 1).padStart(3)}. ${p.candidate.date.slice(0, 16).replace('T', ' ')}  ${p.candidate.uuid}  ${p.reason}`,
    ),
  );
  if (!result.picks.length) {
    console.error('nothing matched the brief; nothing to export');
    return;
  }

  let answer = 'y';
  if (!opts.yes) {
    const ask = deps.ask ?? (process.stdin.isTTY ? ttyAsk : undefined);
    if (!ask) {
      console.error('not a terminal: open the review sheet, then re-run with --yes to export (results are cached)');
      return;
    }
    answer = await ask(
      `Export ${result.picks.length} photos to ${dest}? [Y]es / [n]o / drop e.g. "3,7: too blurry": `,
    );
  }
  const review = parseReviewAnswer(answer, result.picks.length);
  if (!review.export) {
    console.error('not exported');
    return;
  }
  const kept = recordReview(ctx, result.picks, review.drop, review.note) as typeof result.picks;
  await saveContext(contextPath, ctx);
  if (!kept.length) {
    console.error('all picks dropped; nothing exported (rejections saved for the next run)');
    return;
  }

  const files = await lib.exportPhotos(
    kept.map((p) => p.candidate.uuid),
    dest,
    { version: opts.version, convertToJpeg: opts.convertToJpeg },
  );
  const manifest = {
    album: result.album.name,
    brief: opts.brief,
    range: { around: opts.around, days: opts.days, from: opts.from, to: opts.to },
    model: model.id,
    modelBuild: result.modelBuild,
    promptVersion: DECISION_PROMPT_VERSION,
    runAt: new Date().toISOString(),
    considered: result.considered,
    shortlisted: result.shortlist.length,
    modelCalls: result.modelCalls,
    inputTokens: result.inputTokens,
    costUsd: result.costUsd,
    picks: kept.map((p) => ({
      uuid: p.candidate.uuid,
      date: p.candidate.date,
      event: p.candidate.event,
      special: p.candidate.verdict.special,
      subject: p.candidate.verdict.subject,
      quality: p.candidate.verdict.quality,
      score: p.candidate.score,
      reason: p.reason,
    })),
    dropped: review.drop.map((n) => result.picks[n - 1].candidate.uuid),
    files,
  };
  await writeFile(join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (opts.json) console.log(JSON.stringify(manifest, null, 2));
  else console.log(files.join('\n'));
}
