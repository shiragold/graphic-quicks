import { describe, expect, it } from 'vitest';

import {
  emptyContext,
  groupNearDuplicates,
  hamming,
  parseJudge,
  parsePick,
  parseReviewAnswer,
  recordReview,
  resolveAlbum,
  splitEvents,
  type CuratedPick,
  type JudgeItem,
  type PickCandidate,
} from '../src/index.js';
import { partyPhotos, photo } from './curate-fixtures.js';

describe('splitEvents', () => {
  it('splits on gaps longer than gapHours and keeps capture order', () => {
    const events = splitEvents(partyPhotos().reverse(), 3);
    expect(events.map((e) => [e.id, e.photos.length])).toEqual([
      ['2025-06-01T12:00', 1],
      ['2025-11-30T15:00', 11],
      ['2025-12-01T10:00', 2],
    ]);
    expect(events[1].end).toBe('2025-11-30T15:40:00+02:00');
  });
});

describe('groupNearDuplicates', () => {
  const photos = [
    photo('A', '2025-11-30T15:00:00+02:00'),
    photo('B', '2025-11-30T15:00:01+02:00'),
    photo('C', '2025-11-30T15:01:00+02:00'),
    photo('D', '2025-11-30T15:10:00+02:00'),
  ];

  it('merges bursts by time alone', () => {
    const hashes = new Map([['A', 0n], ['B', 0xffffn], ['C', 0xff00ffn], ['D', 0n]]);
    expect(groupNearDuplicates(photos, hashes)).toEqual([['A', 'B'], ['C'], ['D']]);
  });

  it('merges visually similar shots inside the window only', () => {
    const hashes = new Map([['A', 0n], ['B', 0xffffn], ['C', 0b11n], ['D', 0n]]);
    expect(groupNearDuplicates(photos, hashes)).toEqual([['A', 'B', 'C'], ['D']]);
  });

  it('counts differing bits', () => {
    expect(hamming(0b1011n, 0b0001n)).toBe(2);
  });
});

describe('resolveAlbum', () => {
  const albums = [
    { name: 'Annaelle 4', count: 1, shared: true },
    { name: 'Annaelle 3', count: 1, shared: true },
    { name: 'Trips', count: 1, shared: false },
  ];
  it('matches exactly, case-insensitively, or by a unique substring', () => {
    expect(resolveAlbum(albums, 'Annaelle 4').name).toBe('Annaelle 4');
    expect(resolveAlbum(albums, 'annaelle 4').name).toBe('Annaelle 4');
    expect(resolveAlbum(albums, 'trip').name).toBe('Trips');
  });
  it('refuses to guess', () => {
    expect(() => resolveAlbum(albums, 'annaelle')).toThrow(/ambiguous.*Annaelle 4/);
    expect(() => resolveAlbum(albums, 'nope')).toThrow(/no album/);
  });
});

const items: JudgeItem[] = ['U1', 'U2'].map((uuid, i) => ({ uuid, date: '', group: i + 1, jpeg: Buffer.from('') }));
const verdict = (index: number) => ({ index, subjectPresent: true, relevant: true, quality: 4, moment: 'cake', reason: 'r' });

describe('parseJudge', () => {
  it('maps indices back to uuids', () => {
    const out = parseJudge({ verdicts: [verdict(2), verdict(1)] }, items);
    expect(out.map((v) => v.uuid)).toEqual(['U1', 'U2']);
    expect(out[0]).not.toHaveProperty('index');
  });
  it('rejects missing, repeated, or out-of-range replies', () => {
    expect(() => parseJudge({ verdicts: [verdict(1)] }, items)).toThrow(/missing photo 2/);
    expect(() => parseJudge({ verdicts: [verdict(1), verdict(1)] }, items)).toThrow(/repeats/);
    expect(() => parseJudge({ verdicts: [verdict(1), { ...verdict(2), quality: 7 }] }, items)).toThrow();
  });
});

describe('parsePick', () => {
  const cands = ['A', 'B', 'C'].map((uuid) => ({ uuid }) as PickCandidate);
  it('requires exactly min(count, candidates) unique known picks', () => {
    expect(parsePick({ picks: [{ index: 3, reason: 'x' }, { index: 1, reason: 'y' }] }, cands, 2).map((p) => p.candidate.uuid)).toEqual(['C', 'A']);
    expect(() => parsePick({ picks: [{ index: 1, reason: '' }] }, cands, 2)).toThrow(/expected 2/);
    expect(() => parsePick({ picks: [{ index: 4, reason: '' }, { index: 1, reason: '' }] }, cands, 2)).toThrow(/unknown/);
    expect(() => parsePick({ picks: [{ index: 1, reason: '' }, { index: 1, reason: '' }] }, cands, 2)).toThrow(/repeats/);
  });
});

describe('review', () => {
  it('parses confirm answers', () => {
    expect(parseReviewAnswer('', 5)).toEqual({ export: true, drop: [] });
    expect(parseReviewAnswer('n', 5)).toEqual({ export: false, drop: [] });
    expect(parseReviewAnswer('3, 1: too dark', 5)).toEqual({ export: true, drop: [3, 1], note: 'too dark' });
    expect(() => parseReviewAnswer('9', 5)).toThrow(/no pick number 9/);
    expect(() => parseReviewAnswer('maybe', 5)).toThrow(/could not understand/);
  });

  it('records kept picks and rejections with notes', () => {
    const ctx = emptyContext('A', 'b');
    const picks = ['U1', 'U2'].map(
      (uuid) =>
        ({
          candidate: { uuid, date: '2025-11-30T15:00', event: 'Party', verdict: { moment: 'cake' } },
          reason: 'nice',
        }) as unknown as CuratedPick,
    );
    const kept = recordReview(ctx, picks, [2], 'blurry');
    expect(kept.map((p) => p.candidate.uuid)).toEqual(['U1']);
    expect(ctx.picks.map((p) => p.uuid)).toEqual(['U1']);
    expect(ctx.feedback.map((f) => [f.uuid, f.verdict, f.note])).toEqual([
      ['U1', 'kept', undefined],
      ['U2', 'rejected', 'cake (nice): blurry'],
    ]);
  });
});
