import type { PhotoSummary, QueryOptions } from './types.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Resolves `around`/`days` into a `[from, to)` date range of `YYYY-MM-DD`
 * strings; `to` is exclusive, matching osxphotos' `--to-date`.
 */
export function dateWindow(around: string, days = 2): { from: string; to: string } {
  if (!DATE_ONLY.test(around) || Number.isNaN(Date.parse(around))) {
    throw new Error(`around must be YYYY-MM-DD, got "${around}"`);
  }
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`days must be a non-negative integer, got ${days}`);
  }
  return { from: shiftDate(around, -days), to: shiftDate(around, days + 1) };
}

/** Applies the post-query filters osxphotos does not express: movies, min score, sort, limit. */
export function selectPhotos(photos: PhotoSummary[], opts: QueryOptions = {}): PhotoSummary[] {
  const { includeMovies = false, minScore, sort = 'date', limit } = opts;
  let out = photos.filter((p) => includeMovies || !p.isMovie);
  if (minScore !== undefined) out = out.filter((p) => p.score !== null && p.score >= minScore);
  const time = (p: PhotoSummary) => Date.parse(p.date) || 0;
  const byDate = (a: PhotoSummary, b: PhotoSummary) => time(a) - time(b);
  out.sort(
    sort === 'score' ? (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || byDate(a, b) : byDate,
  );
  return limit !== undefined ? out.slice(0, limit) : out;
}
