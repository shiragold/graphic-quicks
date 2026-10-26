import { beforeEach, describe, expect, it } from 'vitest';

import {
  countForRange,
  curateWithDecisions,
  emptyContext,
  photoScore,
  type Answer,
  type CurationContext,
  type DecisionModel,
  type DecisionRequest,
  type Question,
} from '../src/index.js';
import { fakeImages, fakeLibrary } from './curate-fixtures.js';

function fakeDecisionModel(): DecisionModel & { requests: DecisionRequest[] } {
  const requests: DecisionRequest[] = [];
  let n = 0;
  const rnd = () => ((n = (n * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return {
    id: 'fake:jev',
    requests,
    async decide(req) {
      requests.push(req);
      const answers: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(req.questions) as [string, Question][]) {
        if (q.type === 'noul') {
          // Keep most photos above the default min-score thresholds.
          answers[id] = { type: 'noul', noul: id === 'subject' ? 0.9 : 0.55 + rnd() * 0.4 };
        } else if (q.type === 'score') {
          answers[id] = { type: 'score', score: 2 + rnd() * 2 };
        } else {
          const keys = Object.keys(q.criteria);
          answers[id] = { type: 'choice', choice: keys[0] };
        }
      }
      return { answers, model: 'fake:jev', usage: { inputTokens: 10, costUsd: 0.000001 } };
    },
  };
}

describe('countForRange', () => {
  it('scales 20 per month by the date window', () => {
    expect(countForRange({ from: '2025-11-30', to: '2025-12-31' })).toBe(21);
    expect(countForRange({ from: '2025-11-30', to: '2025-12-15' }, 20)).toBe(10);
    expect(countForRange({ around: '2025-11-30', days: 2 })).toBe(3);
    expect(countForRange({})).toBe(20);
  });
});

describe('curateWithDecisions', () => {
  let ctx: CurationContext;
  beforeEach(() => {
    ctx = emptyContext('annaelle 4', 'birthday party');
  });

  const run = (model = fakeDecisionModel(), lib = fakeLibrary()) =>
    curateWithDecisions(
      { lib, model, images: fakeImages, fit: async (b) => b },
      {
        album: 'annaelle 4',
        around: '2025-11-30',
        brief: 'birthday party',
        count: 3,
        subjects: [{ name: 'Annaelle' }],
        context: ctx,
        minScore: 0.2,
      },
    );

  it('judges each photo, knocks out bursts, and spreads picks across events', async () => {
    const model = fakeDecisionModel();
    const lib = fakeLibrary();
    const result = await run(model, lib);

    expect(result.album.name).toBe('Annaelle 4');
    expect(result.skipped).toEqual(['X1']);
    expect(result.picks).toHaveLength(3);
    expect(new Set(result.picks.map((p) => p.candidate.uuid)).size).toBe(3);
    expect(result.modelCalls).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(model.requests.some((r) => r.name.startsWith('judge'))).toBe(true);
    expect(model.requests.some((r) => r.name.startsWith('burst'))).toBe(true);
    // Prefer originals when present: fixtures only have previewPath, so that path is used.
    expect(Object.keys(result.previews).length).toBe(result.shortlist.length);
  });

  it('reuses cached decision verdicts for the same model and prompt version', async () => {
    const first = await run();
    const again = fakeDecisionModel();
    const second = await run(again);
    expect(again.requests.filter((r) => r.name.startsWith('judge'))).toHaveLength(0);
    expect(second.picks.map((p) => p.candidate.uuid).sort()).toEqual(
      first.picks.map((p) => p.candidate.uuid).sort(),
    );
  });

  it('excludes previously rejected photos', async () => {
    const first = await run();
    ctx.feedback.push({ uuid: first.picks[0].candidate.uuid, verdict: 'rejected', at: '' });
    const second = await run();
    expect(second.shortlist.map((c) => c.uuid)).not.toContain(first.picks[0].candidate.uuid);
  });

  it('re-judges when the model id changes', async () => {
    await run();
    const other = fakeDecisionModel();
    Object.defineProperty(other, 'id', { value: 'fake:jev-other' });
    await run(other);
    expect(other.requests.filter((r) => r.name.startsWith('judge')).length).toBeGreaterThan(0);
  });

  it('validates count', async () => {
    await expect(
      curateWithDecisions(
        { lib: fakeLibrary(), model: fakeDecisionModel(), images: fakeImages, fit: async (b) => b },
        { album: 'Annaelle 4', brief: 'b', count: 0, context: ctx },
      ),
    ).rejects.toThrow(/count/);
  });

  it('scores with the quality weight', () => {
    const v = { uuid: 'x', subject: 1, special: 1, quality: 0, promptVersion: 1, modelId: 'm' };
    expect(photoScore(v, 0)).toBe(1);
    expect(photoScore(v, 1)).toBe(0);
    expect(photoScore({ ...v, quality: 4 }, 0.3)).toBeCloseTo(1);
  });
});
