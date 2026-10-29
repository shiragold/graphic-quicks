// Thin harness around `curateWithDecisions` for eyeball review sheets.
// Usage: pnpm jev-eval --album NAME --from DATE --to DATE --brief TEXT [--subject TEXT] [--ref UUID]
//        [--count N | --per-month 20] [--quality-weight 0.3] [--min-score 0.3] [--mark UUID,UUID] [--out DIR] [--fake]
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  countForRange,
  createOpenRouterDecisions,
  createPhotoLibrary,
  curateWithDecisions,
  emptyContext,
  type Answer,
  type DecisionModel,
  type Question,
} from '../dist/index.js';

const { values: args } = parseArgs({
  options: {
    album: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    brief: { type: 'string' },
    subject: { type: 'string' },
    ref: { type: 'string' },
    count: { type: 'string' },
    'per-month': { type: 'string', default: '20' },
    out: { type: 'string' },
    'quality-weight': { type: 'string', default: '0.3' },
    'min-score': { type: 'string', default: '0.3' },
    mark: { type: 'string' },
    fake: { type: 'boolean', default: false },
  },
});
if (!args.album || !args.from || !args.to || !args.brief) {
  console.error('required: --album --from --to --brief');
  process.exit(2);
}

function fakeModel(): DecisionModel {
  let n = 0;
  const rnd = () => ((n = (n * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return {
    id: 'fake',
    async decide(req) {
      const answers: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(req.questions) as [string, Question][]) {
        if (q.type === 'noul') answers[id] = { type: 'noul', noul: rnd() };
        else if (q.type === 'score') answers[id] = { type: 'score', score: rnd() * (q.criteria.length - 1) };
        else {
          const keys = Object.keys(q.criteria);
          answers[id] = { type: 'choice', choice: keys[Math.floor(rnd() * keys.length)] };
        }
      }
      return { answers, model: 'fake', usage: { inputTokens: 0, costUsd: 0 } };
    },
  };
}

const album = args.album;
const brief = args.brief;
const count = args.count
  ? Number(args.count)
  : countForRange({ from: args.from, to: args.to }, Number(args['per-month']));
const qualityWeight = Number(args['quality-weight']);
const minScore = Number(args['min-score']);
const outDir = resolve(
  args.out ?? join(homedir(), '.photo-filter', 'jev-eval', `${album}--${args.from}`.replace(/[^\w.-]+/g, '_')),
);
const marked = new Set((args.mark ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const log = (m: string) => console.error(`· ${m}`);

const model = args.fake ? fakeModel() : createOpenRouterDecisions();
const lib = createPhotoLibrary();
const ctx = emptyContext(album, brief);
const subjects = args.subject
  ? [{ name: args.subject, refs: args.ref ? [args.ref] : undefined }]
  : [];

const result = await curateWithDecisions(
  { lib, model, log },
  {
    album,
    brief,
    count,
    from: args.from,
    to: args.to,
    subjects,
    context: ctx,
    qualityWeight,
    minScore,
  },
);

const pct = (x: number) => `${Math.round(x * 100)}%`;
const card = async (uuid: string, i?: number) => {
  const c = result.shortlist.find((s) => s.uuid === uuid) ?? result.picks.find((p) => p.candidate.uuid === uuid)?.candidate;
  if (!c) return '';
  const src = result.previews[uuid];
  const { sharpImageTools } = await import('../dist/index.js');
  const img = src ? (await sharpImageTools.thumbnail(src, 360)).toString('base64') : '';
  const cls = marked.has(uuid) ? 'mark' : '';
  return `<figure${cls ? ` class="${cls}"` : ''}><img src="data:image/jpeg;base64,${img}">
<figcaption>${i !== undefined ? `<b>#${i + 1}</b> ` : ''}${marked.has(uuid) ? '★ your pick · ' : ''}${c.date.slice(0, 16).replace('T', ' ')} · event ${c.event}<br>
score ${c.score.toFixed(2)} · special ${pct(c.verdict.special)} · subject ${pct(c.verdict.subject)} · quality ${c.verdict.quality.toFixed(2)}/4<br><small>${uuid}</small></figcaption></figure>`;
};

const hit = result.picks.filter((p) => marked.has(p.candidate.uuid)).length;
const html = `<!doctype html><meta charset="utf-8"><title>Jev eval — ${album}</title>
<style>body{font:14px system-ui;margin:24px;background:#111;color:#eee}figure{display:inline-block;width:360px;margin:6px;vertical-align:top}
img{width:360px;border-radius:4px}figcaption{font-size:12px;line-height:1.4}.mark img{outline:4px solid gold}small{color:#888}h2{margin-top:32px}</style>
<h1>${album}: ${brief}</h1>
<p>${args.from} → ${args.to} · ${result.considered} photos · ${result.events.length} events ·
${result.modelBuild} · ${result.modelCalls} requests · ${result.inputTokens.toLocaleString()} input tokens ·
<b>$${result.costUsd.toFixed(4)}</b>${marked.size ? ` · ${hit} of your ${marked.size} picks` : ''}</p>
<p>Up to ${count} picks (${args['per-month']} per 30 days). Min score ${minScore}. Quality weight ${qualityWeight}.</p>
<h2>Picks (${result.picks.length})</h2>
${(await Promise.all(result.picks.map((p, i) => card(p.candidate.uuid, i)))).join('\n')}
<h2>Shortlist by score (${result.shortlist.length})</h2>
${(await Promise.all(result.shortlist.map((c) => card(c.uuid)))).join('\n')}`;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'review.html'), html);
await writeFile(join(outDir, 'results.json'), `${JSON.stringify({ ...result, picks: result.picks.map((p) => p.candidate.uuid) }, null, 2)}\n`);
log(`picks: ${result.picks.length} from ${new Set(result.picks.map((p) => p.candidate.event)).size} events`);
console.log(join(outDir, 'review.html'));
