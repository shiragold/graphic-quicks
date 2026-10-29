import type { AlbumSummary, PhotoSummary } from './types.js';

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Photos reports all-zero scores for assets it never analysed (e.g. shared-album items). */
function scoreOf(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof (v as Json).overall === 'number') {
    const unscored = Object.values(v as Json).every((x) => x === 0);
    return unscored ? null : ((v as Json).overall as number);
  }
  return null;
}

/** Normalizes one record of `osxphotos query --json` output. */
export function normalizePhoto(raw: Json): PhotoSummary {
  const uuid = str(raw.uuid);
  if (!uuid) throw new Error('osxphotos record has no uuid');
  return {
    uuid,
    filename: str(raw.original_filename) ?? str(raw.filename) ?? uuid,
    date: str(raw.date) ?? '',
    width: num(raw.width),
    height: num(raw.height),
    isMovie: raw.ismovie === true,
    favorite: raw.favorite === true,
    score: scoreOf(raw.score),
    albums: strList(raw.albums),
    persons: strList(raw.persons).filter((p) => p !== '_UNKNOWN_'),
    labels: strList(raw.labels),
    title: str(raw.title),
    description: str(raw.description),
    path: str(raw.path),
    previewPath: strList(raw.path_derivatives)[0] ?? null,
    missing: raw.ismissing === true,
    shared: raw.shared === true,
  };
}

/**
 * Normalizes `osxphotos albums --json` output, which maps album name to photo
 * count under separate `albums` and `shared albums` keys.
 */
export function normalizeAlbums(raw: Json): AlbumSummary[] {
  const collect = (section: unknown, shared: boolean): AlbumSummary[] =>
    section && typeof section === 'object'
      ? Object.entries(section as Json).map(([name, count]) => ({ name, count: num(count), shared }))
      : [];
  return [...collect(raw.albums, false), ...collect(raw['shared albums'], true)];
}
