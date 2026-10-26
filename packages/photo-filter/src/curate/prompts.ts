import { z } from 'zod';

import type { CurationContext, EventSummary, Verdict } from './context.js';
import type { PhotoEvent } from './group.js';
import { image, text, type ModelRequest, type Part } from './model.js';

/** Bump when prompts or schemas change; cached verdicts and summaries from other versions are ignored. */
export const PROMPT_VERSION = 1;

export interface RefImage {
  name: string;
  jpeg: Buffer;
}

const SYSTEM = `You help curate a family photo library. You only judge images; code handles everything else.
Answer strictly in the requested JSON. Be concrete and brief. Judge what you see, not what metadata suggests.`;

const localTime = (iso: string) => iso.slice(0, 16).replace('T', ' ');

function briefBlock(ctx: CurationContext): string {
  const lines = [`Album: ${ctx.album}`, `Brief: ${ctx.brief}`];
  if (ctx.subjects.length) lines.push(`Subjects: ${ctx.subjects.map((s) => s.name).join(', ')}`);
  return lines.join('\n');
}

function refParts(refs: RefImage[]): Part[] {
  return refs.flatMap((r, i) => [text(`REFERENCE ${i + 1}: this is ${r.name}.`), image(r.jpeg)]);
}

function tasteBlock(ctx: CurationContext, limit = 12): string {
  const notes = ctx.feedback.filter((f) => f.note).slice(-limit);
  const rejected = ctx.feedback.filter((f) => f.verdict === 'rejected').length;
  const kept = ctx.feedback.filter((f) => f.verdict === 'kept').length;
  if (!notes.length && !rejected) return '';
  return [
    `User review history: kept ${kept}, rejected ${rejected} earlier suggestions.`,
    ...notes.map((f) => `- ${f.verdict}: ${f.note}`),
  ].join('\n');
}

// ---- survey: one contact sheet per event -> what is this event?

const surveySchema = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Short event name, e.g. "Birthday party at home"' },
    people: { type: 'array', items: { type: 'string' }, description: 'Named subjects you can recognise; else short descriptions' },
    inScope: { type: 'boolean', description: 'Whether this event could contain photos matching the brief' },
    notes: { type: 'string', description: 'One sentence on what happens in this event' },
  },
  required: ['label', 'people', 'inScope', 'notes'],
  additionalProperties: false,
};

const SurveyReply = z.object({
  label: z.string().min(1),
  people: z.array(z.string()),
  inScope: z.boolean(),
  notes: z.string(),
});

export function surveyRequest(
  ctx: CurationContext,
  event: PhotoEvent,
  sheet: Buffer,
  sampled: number,
  refs: RefImage[],
): ModelRequest {
  return {
    name: `survey ${event.id}`,
    system: SYSTEM,
    schema: surveySchema,
    parts: [
      text(briefBlock(ctx)),
      ...refParts(refs),
      text(
        `Event from ${localTime(event.start)} to ${localTime(event.end)}, ${event.photos.length} photos ` +
          `(contact sheet shows ${sampled}). Summarise the event and decide if it is in scope for the brief. ` +
          `When unsure, mark it in scope.`,
      ),
      image(sheet),
    ],
  };
}

export function parseSurvey(reply: unknown, event: PhotoEvent): EventSummary {
  const r = SurveyReply.parse(reply);
  return { id: event.id, photoCount: event.photos.length, ...r, promptVersion: PROMPT_VERSION };
}

// ---- judge: per-photo verdicts, with the event summary and running tally as shared context

const judgeSchema = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Photo number as labelled' },
          subjectPresent: { type: 'boolean', description: 'A brief subject (per the references) is clearly visible' },
          relevant: { type: 'boolean', description: 'Matches the brief' },
          quality: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '5 = keeper: sharp, eyes open, good expression and framing' },
          moment: { type: 'string', description: '1-3 word tag for what is happening, e.g. "cake", "gifts", "group photo"' },
          reason: { type: 'string', description: 'One short line' },
        },
        required: ['index', 'subjectPresent', 'relevant', 'quality', 'moment', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

const JudgeReply = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int(),
      subjectPresent: z.boolean(),
      relevant: z.boolean(),
      quality: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
      moment: z.string(),
      reason: z.string(),
    }),
  ),
});

export interface JudgeItem {
  uuid: string;
  date: string;
  /** Near-duplicate group number within the event; shared by burst siblings. */
  group: number;
  jpeg: Buffer;
}

export function judgeRequest(
  ctx: CurationContext,
  summary: EventSummary,
  items: JudgeItem[],
  tally: Map<string, number>,
  refs: RefImage[],
  batchLabel: string,
): ModelRequest {
  const seen = [...tally].map(([m, n]) => `${m} x${n}`).join(', ');
  return {
    name: `judge ${summary.id} ${batchLabel}`,
    system: SYSTEM,
    schema: judgeSchema,
    parts: [
      text(briefBlock(ctx)),
      ...refParts(refs),
      text(
        [
          `Event: ${summary.label} — ${summary.notes}`,
          seen ? `Strong photos already found in this event: ${seen}. Prefer rating new moments on their own merit; duplicates of covered moments need to be clearly better.` : '',
          tasteBlock(ctx),
          `Rate each photo below. Photos with the same group number are near-duplicates; give the best one in a group the highest quality.`,
        ]
          .filter(Boolean)
          .join('\n'),
      ),
      ...items.flatMap((it, i) => [text(`Photo ${i + 1} — ${localTime(it.date)}, group ${it.group}`), image(it.jpeg)]),
    ],
  };
}

export function parseJudge(reply: unknown, items: JudgeItem[]): Verdict[] {
  const { verdicts } = JudgeReply.parse(reply);
  const byIndex = new Map(verdicts.map((v) => [v.index, v]));
  if (byIndex.size !== verdicts.length) throw new Error('judge reply repeats a photo index');
  return items.map((it, i) => {
    const v = byIndex.get(i + 1);
    if (!v) throw new Error(`judge reply is missing photo ${i + 1}`);
    const { index: _index, ...rest } = v;
    return { uuid: it.uuid, ...rest, promptVersion: PROMPT_VERSION };
  });
}

// ---- pick: final selection over numbered contact sheets of the shortlist

const pickSchema = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Candidate number as labelled on the sheet' },
          reason: { type: 'string', description: 'One short line: why this photo earns a place' },
        },
        required: ['index', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['picks'],
  additionalProperties: false,
};

const PickReply = z.object({ picks: z.array(z.object({ index: z.number().int(), reason: z.string() })) });

export interface PickCandidate {
  uuid: string;
  date: string;
  event: string;
  verdict: Verdict;
}

export function pickRequest(
  ctx: CurationContext,
  candidates: PickCandidate[],
  sheets: Buffer[],
  count: number,
  scope: string,
): ModelRequest {
  const earlier = ctx.picks.slice(-30).map((p) => `- ${p.date.slice(0, 10)} ${p.moment}: ${p.reason}`);
  return {
    name: `pick ${scope}`,
    system: SYSTEM,
    schema: pickSchema,
    parts: [
      text(briefBlock(ctx)),
      text(
        [
          `Choose the best ${count} of these ${candidates.length} candidates (${scope}) for the brief.`,
          `Aim for a set that tells the story: strongest images first, varied moments, no near-duplicates, the subject well represented.`,
          earlier.length ? `Already chosen in earlier runs (avoid repeating the same moment):\n${earlier.join('\n')}` : '',
          tasteBlock(ctx),
          `Candidates:`,
          ...candidates.map(
            (c, i) => `#${i + 1} ${localTime(c.date)} [${c.event}] q${c.verdict.quality} ${c.verdict.moment}: ${c.verdict.reason}`,
          ),
        ]
          .filter(Boolean)
          .join('\n'),
      ),
      ...sheets.map(image),
      text(`Return exactly ${count} picks ordered best first, by candidate number.`),
    ],
  };
}

export function parsePick(reply: unknown, candidates: PickCandidate[], count: number) {
  const { picks } = PickReply.parse(reply);
  const seen = new Set<number>();
  const out = picks.map((p) => {
    if (p.index < 1 || p.index > candidates.length) throw new Error(`pick reply has unknown candidate #${p.index}`);
    if (seen.has(p.index)) throw new Error(`pick reply repeats candidate #${p.index}`);
    seen.add(p.index);
    return { candidate: candidates[p.index - 1], reason: p.reason };
  });
  const expected = Math.min(count, candidates.length);
  if (out.length !== expected) throw new Error(`pick reply has ${out.length} picks, expected ${expected}`);
  return out;
}
