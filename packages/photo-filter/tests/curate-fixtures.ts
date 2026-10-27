import type {
  Answer,
  DecisionModel,
  DecisionRequest,
  ImageTools,
  ModelRequest,
  PhotoLibrary,
  PhotoSummary,
  Question,
  VisionModel,
} from '../src/index.js';

export function photo(uuid: string, date: string, extra: Partial<PhotoSummary> = {}): PhotoSummary {
  return {
    uuid,
    filename: `${uuid}.jpg`,
    date,
    width: 1536,
    height: 2048,
    isMovie: false,
    favorite: false,
    score: null,
    albums: ['Annaelle 4'],
    persons: [],
    labels: [],
    title: null,
    description: null,
    path: null,
    previewPath: `/previews/${uuid}.jpeg`,
    missing: false,
    shared: true,
    ...extra,
  };
}

/** Party on Nov 30 (P1..P10, P2/P3 and P6/P7 are 1 s bursts), unrelated outing on Dec 1, one iCloud-only shot. */
export function partyPhotos(): PhotoSummary[] {
  const at = (h: number, m: number, s = 0) =>
    `2025-11-30T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+02:00`;
  return [
    photo('P1', at(15, 0)),
    photo('P2', at(15, 5, 0)),
    photo('P3', at(15, 5, 1)),
    photo('P4', at(15, 10)),
    photo('P5', at(15, 15)),
    photo('P6', at(15, 20, 0)),
    photo('P7', at(15, 20, 1)),
    photo('P8', at(15, 25)),
    photo('P9', at(15, 30)),
    photo('P10', at(15, 35)),
    photo('O1', '2025-12-01T10:00:00+02:00'),
    photo('O2', '2025-12-01T10:05:00+02:00'),
    photo('X1', at(15, 40), { previewPath: null, missing: true }),
    photo('REF', '2025-06-01T12:00:00+02:00', { persons: ['Annaelle'] }),
  ];
}

export function fakeLibrary(photos = partyPhotos()): PhotoLibrary & { queries: unknown[] } {
  const queries: unknown[] = [];
  return {
    queries,
    listAlbums: async () => [
      { name: 'Annaelle 4', count: 437, shared: true },
      { name: 'Annaelle 3', count: 332, shared: true },
    ],
    queryPhotos: async (opts = {}) => {
      queries.push(opts);
      if (opts.person) return photos.filter((p) => p.persons.some((n) => opts.person!.includes(n)));
      return photos.filter((p) => p.uuid !== 'REF');
    },
    getPhotos: async (uuids) => uuids.map((u) => photos.find((p) => p.uuid === u)!),
    thumbnails: async () => [],
    exportPhotos: async () => [],
  };
}

/** Distinct hashes everywhere except bursts, which the burst window already merges. */
export const fakeImages: ImageTools & { sheets: string[][] } = {
  sheets: [],
  thumbnail: async (path) => Buffer.from(path),
  dhash: async (input) => {
    // Thumbnails are the path's bytes, so a hashed thumbnail hashes like its path.
    const path = input.toString();
    return BigInt(path.length) << BigInt(path.charCodeAt(path.length - 6) % 60);
  },
  async contactSheet(items) {
    this.sheets.push(items.map((i) => i.label));
    return Buffer.from(items.map((i) => i.label).join(','));
  },
};

/**
 * Deterministic stand-in for the vision model: Nov 30 events are in scope,
 * every photo is relevant with quality 4 (photo 1 of each batch gets 5), and
 * pick returns the first N candidates.
 */
export function fakeModel(): VisionModel & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const texts = (req: ModelRequest) => req.parts.flatMap((p) => (p.type === 'text' ? [p.text] : []));
  return {
    id: 'fake:model',
    requests,
    async generate(req) {
      requests.push(req);
      if (req.name.startsWith('survey')) {
        const inScope = req.name.includes('2025-11-30');
        return { label: inScope ? 'Birthday party' : 'Park walk', people: ['Annaelle'], inScope, notes: 'n' };
      }
      if (req.name.startsWith('judge')) {
        const n = texts(req).filter((t) => t.startsWith('Photo ')).length;
        return {
          verdicts: Array.from({ length: n }, (_, i) => ({
            index: i + 1,
            subjectPresent: true,
            relevant: true,
            quality: i === 0 ? 5 : 4,
            moment: i % 2 ? 'cake' : 'candles',
            reason: `photo ${i + 1}`,
          })),
        };
      }
      const want = Number(/Return exactly (\d+) picks/.exec(texts(req).join('\n'))![1]);
      return { picks: Array.from({ length: want }, (_, i) => ({ index: i + 1, reason: `pick ${i + 1}` })) };
    },
  };
}

/**
 * Deterministic stand-in for Jev: subject 0.9, random-but-seeded special and
 * quality, and `choose` picks the answer to every choice question (first key by default).
 */
export function fakeDecisionModel(
  choose: (keys: string[], call: number) => string = (keys) => keys[0],
): DecisionModel & { requests: DecisionRequest[] } {
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
          answers[id] = { type: 'choice', choice: choose(keys, requests.length) };
        }
      }
      return { answers, model: 'fake:jev', usage: { inputTokens: 10, costUsd: 0.000001 } };
    },
  };
}
