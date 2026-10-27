import type { PhotoSummary } from '../types.js';

export interface PhotoEvent {
  /** Stable id derived from the first photo's local timestamp, e.g. `2025-11-30T14:05`. */
  id: string;
  start: string;
  end: string;
  photos: PhotoSummary[];
}

const time = (p: PhotoSummary) => Date.parse(p.date) || 0;

/** Splits photos into events wherever consecutive captures are more than `gapHours` apart. */
export function splitEvents(photos: PhotoSummary[], gapHours = 3): PhotoEvent[] {
  const sorted = [...photos].sort((a, b) => time(a) - time(b));
  const events: PhotoEvent[] = [];
  for (const p of sorted) {
    const last = events.at(-1);
    if (last && time(p) - time(last.photos.at(-1)!) <= gapHours * 3_600_000) {
      last.photos.push(p);
      last.end = p.date;
    } else {
      events.push({ id: p.date.slice(0, 16), start: p.date, end: p.date, photos: [p] });
    }
  }
  return events;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export interface DuplicateOptions {
  /** Shots this close together are one burst regardless of content. */
  burstSeconds?: number;
  /** Only compare hashes of shots within this window. */
  windowSeconds?: number;
  /** dHash distance at or below which two shots are near-duplicates. */
  maxDistance?: number;
}

/**
 * Groups near-duplicates: shots in the same burst, or visually similar shots
 * taken close together. A group never spans more than `windowSeconds`, so a long
 * run of pairwise-similar shots (a show filmed from one seat) splits into several
 * groups instead of chaining into one. Returns uuid groups in capture order;
 * singletons included.
 */
export function groupNearDuplicates(
  photos: PhotoSummary[],
  hashes: Map<string, bigint>,
  { burstSeconds = 2, windowSeconds = 120, maxDistance = 10 }: DuplicateOptions = {},
): string[][] {
  const sorted = [...photos].sort((a, b) => time(a) - time(b));
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // Capture-time span of each root's group, in ms.
  const first = sorted.map(time);
  const last = sorted.map(time);

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const dt = (time(sorted[j]) - time(sorted[i])) / 1000;
      if (dt > windowSeconds) break;
      const a = hashes.get(sorted[i].uuid);
      const b = hashes.get(sorted[j].uuid);
      const similar = a !== undefined && b !== undefined && hamming(a, b) <= maxDistance;
      if (!(dt <= burstSeconds || similar)) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri === rj) continue;
      const start = Math.min(first[ri], first[rj]);
      const end = Math.max(last[ri], last[rj]);
      if (end - start > windowSeconds * 1000) continue;
      parent[rj] = ri;
      first[ri] = start;
      last[ri] = end;
    }
  }

  const groups = new Map<number, string[]>();
  sorted.forEach((p, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), p.uuid]);
  });
  return [...groups.values()];
}
