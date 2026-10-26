import { describe, expect, it } from 'vitest';

import { dateWindow, normalizeAlbums, normalizePhoto, selectPhotos } from '../src/index.js';
import { RAW_PHOTOS } from './fake-runner.js';

const photos = RAW_PHOTOS.map(normalizePhoto);

describe('dateWindow', () => {
  it('spans days either side with an exclusive end', () => {
    expect(dateWindow('2025-11-30', 2)).toEqual({ from: '2025-11-28', to: '2025-12-03' });
  });

  it('defaults to two days and handles a zero-width window', () => {
    expect(dateWindow('2025-11-30')).toEqual({ from: '2025-11-28', to: '2025-12-03' });
    expect(dateWindow('2025-11-30', 0)).toEqual({ from: '2025-11-30', to: '2025-12-01' });
  });

  it('rejects malformed input', () => {
    expect(() => dateWindow('Nov 30')).toThrow(/YYYY-MM-DD/);
    expect(() => dateWindow('2025-11-30', -1)).toThrow(/non-negative/);
  });
});

describe('normalizePhoto', () => {
  it('maps osxphotos fields and drops unknown persons', () => {
    expect(photos[0]).toMatchObject({
      uuid: 'AAA-1',
      filename: 'IMG_0001.HEIC',
      score: 0.82,
      persons: ['Annaelle'],
      previewPath: '/lib/derivatives/AAA-1_1_105_c.jpeg',
      shared: true,
    });
  });

  it('tolerates missing fields', () => {
    expect(photos[2]).toMatchObject({ score: null, albums: [], previewPath: null, isMovie: true });
    expect(() => normalizePhoto({})).toThrow(/uuid/);
  });

  it('treats an all-zero score as unscored', () => {
    expect(normalizePhoto({ uuid: 'X', score: { overall: 0, curation: 0 } }).score).toBeNull();
    expect(normalizePhoto({ uuid: 'X', score: { overall: 0, curation: 0.2 } }).score).toBe(0);
  });
});

describe('normalizeAlbums', () => {
  it('flags shared albums', () => {
    expect(normalizeAlbums({ albums: { Trips: 3 }, 'shared albums': { Fam: 9 } })).toEqual([
      { name: 'Trips', count: 3, shared: false },
      { name: 'Fam', count: 9, shared: true },
    ]);
  });
});

describe('selectPhotos', () => {
  it('excludes movies and sorts by date by default', () => {
    expect(selectPhotos(photos).map((p) => p.uuid)).toEqual(['BBB-2', 'AAA-1']);
  });

  it('sorts by score, filters by minScore, and limits', () => {
    expect(selectPhotos(photos, { sort: 'score', includeMovies: true }).map((p) => p.uuid)).toEqual([
      'AAA-1',
      'BBB-2',
      'CCC-3',
    ]);
    expect(selectPhotos(photos, { minScore: 0.5 }).map((p) => p.uuid)).toEqual(['AAA-1']);
    expect(selectPhotos(photos, { sort: 'score', limit: 1 })).toHaveLength(1);
  });
});
