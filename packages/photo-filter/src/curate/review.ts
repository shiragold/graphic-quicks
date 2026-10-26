import { writeFile } from 'node:fs/promises';

import type { CurationContext } from './context.js';
import type { DecisionCuratedPick, DecisionCurationResult } from './decision-pipeline.js';
import type { CuratedPick, CurationResult } from './pipeline.js';

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

type AnyPick = CuratedPick | DecisionCuratedPick;

function pickUuid(p: AnyPick): string {
  return p.candidate.uuid;
}
function pickDate(p: AnyPick): string {
  return p.candidate.date;
}
function pickEvent(p: AnyPick): string {
  return p.candidate.event;
}
function pickMoment(p: AnyPick): string {
  return 'verdict' in p.candidate && 'moment' in p.candidate.verdict
    ? (p.candidate.verdict as { moment: string }).moment
    : 'special';
}
function shortlistCaption(c: CurationResult['shortlist'][number] | DecisionCurationResult['shortlist'][number]): string {
  if ('verdict' in c && 'moment' in c.verdict) {
    const v = c.verdict as { quality: number; moment: string; reason: string };
    return `q${v.quality} · ${v.moment}: ${v.reason}`;
  }
  const d = c as DecisionCurationResult['shortlist'][number];
  return `score ${d.score.toFixed(2)} · special ${Math.round(d.verdict.special * 100)}% · q${d.verdict.quality.toFixed(1)}`;
}

/** Self-contained HTML contact sheet of the picks (numbered as in the CLI prompt) and the shortlist. */
export async function writeReviewSheet(
  path: string,
  result: CurationResult | DecisionCurationResult,
  brief: string,
  thumbnail: (uuid: string) => Promise<Buffer | null>,
): Promise<void> {
  const card = async (uuid: string, title: string, caption: string) => {
    const jpeg = await thumbnail(uuid);
    const img = jpeg ? `<img src="data:image/jpeg;base64,${jpeg.toString('base64')}">` : '<div class="missing">no preview</div>';
    return `<figure>${img}<figcaption><b>${esc(title)}</b> ${esc(caption)}<br><code>${uuid}</code></figcaption></figure>`;
  };
  const picked = new Set(result.picks.map(pickUuid));
  const picks = await Promise.all(
    result.picks.map((p, i) =>
      card(pickUuid(p), `${i + 1}.`, `${pickDate(p).slice(0, 16).replace('T', ' ')} · ${p.reason}`),
    ),
  );
  const rest = await Promise.all(
    result.shortlist
      .filter((c) => !picked.has(c.uuid))
      .map((c) => card(c.uuid, c.date.slice(0, 10), `${c.date.slice(0, 16).replace('T', ' ')} · ${shortlistCaption(c)}`)),
  );
  const events = result.events
    .map((e) => {
      const inScope = e.inScope;
      return `<li>${esc(e.id.replace('T', ' '))} · ${e.photoCount} photos · ${esc(e.label)}${inScope ? '' : ' <i>(out of scope)</i>'}</li>`;
    })
    .join('');
  const cost = 'costUsd' in result && typeof result.costUsd === 'number' && result.costUsd > 0 ? ` · $${result.costUsd.toFixed(4)}` : '';
  await writeFile(
    path,
    `<!doctype html><meta charset="utf-8"><title>${esc(result.album.name)} — review</title>
<style>
body{font:14px -apple-system,system-ui,sans-serif;margin:24px;background:#fafafa;color:#222}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
figure{margin:0;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px #0002}
img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.missing{aspect-ratio:1;display:grid;place-items:center;color:#999}
figcaption{padding:8px 10px;line-height:1.4}code{font-size:11px;color:#888}
details{margin-top:32px}
</style>
<h1>${esc(result.album.name)}</h1>
<p>${esc(brief)} — ${result.picks.length} picks from ${result.shortlist.length} shortlisted of ${result.considered} photos (${result.modelCalls} model calls${cost}).</p>
<div class="grid">${picks.join('')}</div>
<details><summary>Other shortlisted (${rest.length})</summary><div class="grid">${rest.join('')}</div></details>
<details><summary>Events (${result.events.length})</summary><ul>${events}</ul></details>
`,
  );
}

/** Parses the confirm prompt: `y`, `n`, or picks to drop like `3,7` with an optional `: note`. */
export function parseReviewAnswer(answer: string, pickCount: number): { export: boolean; drop: number[]; note?: string } {
  const a = answer.trim();
  if (/^(y|yes)?$/i.test(a)) return { export: true, drop: [] };
  if (/^(n|no)$/i.test(a)) return { export: false, drop: [] };
  const m = /^([\d,\s]+)(?::\s*(.*))?$/.exec(a);
  if (!m) throw new Error(`could not understand "${answer}"; answer y, n, or numbers to drop like 3,7: too blurry`);
  const drop = [...new Set(m[1].split(/[,\s]+/).filter(Boolean).map(Number))];
  const bad = drop.find((n) => !Number.isInteger(n) || n < 1 || n > pickCount);
  if (bad !== undefined) throw new Error(`no pick number ${bad}`);
  return { export: true, drop, note: m[2]?.trim() || undefined };
}

/** Records the outcome of a review in the context so later runs can learn from it. */
export function recordReview(ctx: CurationContext, picks: AnyPick[], dropped: number[], note?: string): AnyPick[] {
  const at = new Date().toISOString();
  const drop = new Set(dropped);
  const kept: AnyPick[] = [];
  picks.forEach((p, i) => {
    const rejected = drop.has(i + 1);
    ctx.feedback.push({
      uuid: pickUuid(p),
      verdict: rejected ? 'rejected' : 'kept',
      ...(rejected && note ? { note: `${pickMoment(p)} (${p.reason}): ${note}` } : {}),
      at,
    });
    if (!rejected) {
      kept.push(p);
      ctx.picks.push({
        uuid: pickUuid(p),
        event: pickEvent(p),
        date: pickDate(p),
        moment: pickMoment(p),
        reason: p.reason,
        runAt: at,
      });
    }
  });
  return kept;
}
