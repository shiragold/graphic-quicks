import { beforeEach, describe, expect, it } from 'vitest';

import {
  countForRange,
  curateWithDecisions,
  emptyContext,
  MAX_DECISION_COUNT,
  photoScore,
  pickTarget,
  poolForTarget,
  type CurationContext,
  type ImageTools,
} from '../src/index.js';
import { fakeDecisionModel, fakeImages, fakeLibrary, photo } from './curate-fixtures.js';

describe('countForRange', () => {
  it('scales 20 per month by the date window', () => {
    expect(countForRange({ from: '2025-11-30', to: '2025-12-31' })).toBe(21);
    expect(countForRange({ from: '2025-11-30', to: '2025-12-15' }, 20)).toBe(10);
    expect(countForRange({ around: '2025-11-30', days: 2 })).toBe(3);
    expect(countForRange({})).toBe(20);
  });

  it('caps long ranges at MAX_DECISION_COUNT', () => {
    expect(countForRange({ from: '2025-01-01', to: '2026-01-01' })).toBe(MAX_DECISION_COUNT);
    expect(countForRange({ from: '2025-01-01', to: '2026-01-01' }, 1)).toBe(12);
  });
});

describe('pickTarget / poolForTarget', () => {
  it('floors count at minPhotos and caps at MAX', () => {
    expect(pickTarget(3, 10)).toBe(10);
    expect(pickTarget(20, 10)).toBe(20);
    expect(pickTarget(20, 0)).toBe(20);
    expect(pickTarget(50, 60)).toBe(60);
  });

  it('fills below the score barrier to meet the target', () => {
    const scores: Record<string, number> = { a: 0.9, b: 0.5, c: 0.2, d: 0.1, e: 0.05 };
    const scoreOf = (u: string) => scores[u]!;
    const keepers = Object.keys(scores);
    const thin = poolForTarget(keepers, scoreOf, 0.3, 4);
    expect(thin.aboveBarrier).toBe(2);
    expect(thin.filledBelow).toBe(2);
    expect(thin.pool).toEqual(['a', 'b', 'c', 'd']);
    const enough = poolForTarget(keepers, scoreOf, 0.3, 2);
    expect(enough.filledBelow).toBe(0);
    expect(enough.pool).toEqual(['a', 'b']);
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

  it('reproduces knockout winners on a re-run, without asking the model again', async () => {
    // Rotating answers: an uncached re-run would pick differently.
    const rotating = () => fakeDecisionModel((keys, call) => keys[call % keys.length]);
    const first = await run(rotating());
    const again = rotating();
    const second = await run(again);
    expect(again.requests).toHaveLength(0);
    expect(second.picks.map((p) => p.candidate.uuid)).toEqual(first.picks.map((p) => p.candidate.uuid));
  });

  it('re-judges when the subjects or their reference photos change', async () => {
    await run();
    const other = fakeDecisionModel();
    await curateWithDecisions(
      { lib: fakeLibrary(), model: other, images: fakeImages, fit: async (b) => b },
      {
        album: 'annaelle 4',
        around: '2025-11-30',
        brief: 'birthday party',
        count: 3,
        subjects: [{ name: 'Noam', refs: ['REF'] }],
        context: ctx,
        minScore: 0.2,
      },
    );
    expect(other.requests.filter((r) => r.name.startsWith('judge'))).toHaveLength(12);
  });

  it('fills below min-score when minPhotos demands more picks', async () => {
    const logs: string[] = [];
    // Only P1 / O1 get a high special; everyone else stays below a 0.5 barrier.
    const base = fakeDecisionModel();
    const model = {
      ...base,
      async decide(req: Parameters<typeof base.decide>[0]) {
        const r = await base.decide(req);
        if (req.name.startsWith('judge') && !/P1|O1/.test(req.name)) {
          r.answers.special = { type: 'noul', noul: 0.15 };
        }
        if (req.name.startsWith('judge') && /P1|O1/.test(req.name)) {
          r.answers.special = { type: 'noul', noul: 0.95 };
        }
        return r;
      },
    };
    const result = await curateWithDecisions(
      { lib: fakeLibrary(), model, images: fakeImages, fit: async (b) => b, log: (m) => logs.push(m) },
      {
        album: 'annaelle 4',
        around: '2025-11-30',
        brief: 'birthday party',
        count: 2,
        minPhotos: 5,
        minScore: 0.5,
        subjects: [{ name: 'Annaelle' }],
        context: ctx,
      },
    );
    expect(result.picks.length).toBeGreaterThanOrEqual(5);
    expect(logs.some((m) => /filled \d+ below min-score/.test(m))).toBe(true);
  });

  it('filters near-duplicates by subject and quality before the burst knockout', async () => {
    const base = fakeDecisionModel();
    // B1 (the knockout's default choice) is off-subject; B2 shows the subject.
    const model = {
      ...base,
      async decide(req: Parameters<typeof base.decide>[0]) {
        const r = await base.decide(req);
        if (req.name === 'judge B1') r.answers.subject = { type: 'noul', noul: 0.3 };
        return r;
      },
    };
    const lib = fakeLibrary([
      photo('B1', '2025-11-30T15:00:00+02:00'),
      photo('B2', '2025-11-30T15:00:01+02:00'),
    ]);
    const result = await run(model, lib);
    expect(result.picks.map((p) => p.candidate.uuid)).toEqual(['B2']);
    expect(base.requests.some((r) => r.name.startsWith('burst'))).toBe(false);
  });

  it('skips photos whose file cannot be read instead of failing the run', async () => {
    const images: ImageTools = {
      ...fakeImages,
      thumbnail: async (path, size) => {
        if (path.includes('P4')) throw new Error('corrupt JPEG');
        return fakeImages.thumbnail(path, size);
      },
    };
    const model = fakeDecisionModel();
    const result = await curateWithDecisions(
      { lib: fakeLibrary(), model, images, fit: async (b) => b },
      { album: 'annaelle 4', around: '2025-11-30', brief: 'birthday party', count: 3, context: ctx, minScore: 0.2 },
    );
    expect(result.skipped).toEqual(['X1', 'P4']);
    expect(result.picks).toHaveLength(3);
    expect(model.requests.some((r) => r.name === 'judge P4')).toBe(false);
  });

  it('hashes the decoded thumbnail rather than re-reading the original', async () => {
    const inputs: (string | Buffer)[] = [];
    const images: ImageTools = {
      ...fakeImages,
      dhash: async (input) => {
        inputs.push(input);
        return fakeImages.dhash(input);
      },
    };
    await curateWithDecisions(
      { lib: fakeLibrary(), model: fakeDecisionModel(), images, fit: async (b) => b },
      { album: 'annaelle 4', around: '2025-11-30', brief: 'birthday party', count: 3, context: ctx },
    );
    expect(inputs).toHaveLength(12);
    expect(inputs.every((i) => Buffer.isBuffer(i))).toBe(true);
  });
});
