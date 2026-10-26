import { beforeEach, describe, expect, it } from 'vitest';

import { curatePhotos, emptyContext, type CurationContext } from '../src/index.js';
import { fakeImages, fakeLibrary, fakeModel } from './curate-fixtures.js';

describe('curatePhotos', () => {
  let ctx: CurationContext;
  beforeEach(() => {
    ctx = emptyContext('annaelle 4', 'birthday party');
    fakeImages.sheets.length = 0;
  });

  const run = (model = fakeModel(), lib = fakeLibrary()) =>
    curatePhotos(
      { lib, model, images: fakeImages },
      { album: 'annaelle 4', around: '2025-11-30', brief: 'birthday party', count: 3, subjects: [{ name: 'Annaelle' }], context: ctx },
    );

  it('surveys every event, judges only in-scope ones, and picks from deduplicated keepers', async () => {
    const model = fakeModel();
    const lib = fakeLibrary();
    const result = await run(model, lib);

    expect(result.album.name).toBe('Annaelle 4');
    expect(lib.queries).toContainEqual(expect.objectContaining({ album: ['Annaelle 4'], around: '2025-11-30' }));
    expect(lib.queries).toContainEqual(expect.objectContaining({ person: ['Annaelle'] }));
    expect(result.skipped).toEqual(['X1']);
    expect(result.events.map((e) => [e.label, e.inScope])).toEqual([
      ['Birthday party', true],
      ['Park walk', false],
    ]);

    expect(model.requests.map((r) => r.name.split(' ')[0])).toEqual(['survey', 'survey', 'judge', 'pick']);
    const judge = model.requests[2];
    expect(judge.parts.filter((p) => p.type === 'text' && p.text.startsWith('REFERENCE')).length).toBe(1);
    expect(judge.parts.filter((p) => p.type === 'text' && p.text.startsWith('Photo ')).length).toBe(10);

    // P2/P3 and P6/P7 are bursts: 10 photos -> 8 groups -> 8 candidates, none from the park walk.
    expect(result.shortlist).toHaveLength(8);
    expect(result.shortlist.map((c) => c.uuid)).not.toContain('O1');
    expect(result.shortlist.map((c) => c.uuid).filter((u) => ['P2', 'P3'].includes(u))).toHaveLength(1);
    expect(result.picks.map((p) => p.reason)).toEqual(['pick 1', 'pick 2', 'pick 3']);
    expect(fakeImages.sheets.at(-1)).toEqual(['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8']);
    expect(result.modelCalls).toBe(4);
  });

  it('reuses the shared context: a second run makes no model calls and repeats the picks', async () => {
    const first = await run();
    const again = fakeModel();
    const second = await run(again);
    expect(again.requests).toHaveLength(0);
    expect(second.picks.map((p) => p.candidate.uuid)).toEqual(first.picks.map((p) => p.candidate.uuid));
  });

  it('excludes previously rejected photos from the shortlist', async () => {
    const first = await run();
    ctx.feedback.push({ uuid: first.picks[0].candidate.uuid, verdict: 'rejected', at: '' });
    const second = await run();
    expect(second.shortlist.map((c) => c.uuid)).not.toContain(first.picks[0].candidate.uuid);
  });

  it('retries a malformed reply once, then fails', async () => {
    const model = fakeModel();
    const generate = model.generate.bind(model);
    let broken = 0;
    model.generate = async (req) => (req.name.startsWith('judge') && broken++ < 1 ? { verdicts: [] } : generate(req));
    await expect(run(model)).resolves.toBeDefined();

    ctx = emptyContext('annaelle 4', 'birthday party');
    const bad = fakeModel();
    bad.generate = async (req) => (req.name.startsWith('judge') ? { verdicts: [] } : fakeModel().generate(req));
    await expect(run(bad)).rejects.toThrow(/missing photo 1/);
  });

  it('validates count', async () => {
    await expect(
      curatePhotos(
        { lib: fakeLibrary(), model: fakeModel(), images: fakeImages },
        { album: 'Annaelle 4', brief: 'b', count: 0, context: ctx },
      ),
    ).rejects.toThrow(/count/);
  });
});
