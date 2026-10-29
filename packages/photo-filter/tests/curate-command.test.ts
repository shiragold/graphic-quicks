import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCurateCommand, type CurateCommandOptions } from '../src/curate/command.js';
import type { CurationContext } from '../src/index.js';
import { fakeDecisionModel, fakeImages, fakeLibrary } from './curate-fixtures.js';

describe('runCurateCommand', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'photo-filter-curate-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const opts = (): CurateCommandOptions => ({
    album: 'Annaelle 4',
    brief: 'birthday party',
    dest: join(dir, 'out'),
    count: 3,
    around: '2025-11-30',
    subjects: [{ name: 'Annaelle' }],
    contextPath: join(dir, 'context.json'),
    minScore: 0.2,
    yes: false,
    convertToJpeg: false,
    json: false,
  });

  it('records rejections and exports nothing when every pick is dropped', async () => {
    const lib = fakeLibrary();
    const exportPhotos = vi.spyOn(lib, 'exportPhotos');
    let picks = 0;
    await runCurateCommand(lib, opts(), {
      model: fakeDecisionModel(),
      images: fakeImages,
      fit: async (b) => b,
      ask: async (question) => {
        picks = Number(/Export (\d+) photos/.exec(question)![1]);
        return `${Array.from({ length: picks }, (_, i) => i + 1).join(',')}: none good`;
      },
    });

    expect(picks).toBe(3);
    expect(exportPhotos).not.toHaveBeenCalled();
    expect(await readdir(join(dir, 'out'))).toEqual(['review.html']);
    const ctx = JSON.parse(await readFile(join(dir, 'context.json'), 'utf8')) as CurationContext;
    expect(ctx.feedback.map((f) => f.verdict)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(ctx.feedback.every((f) => f.note?.endsWith(': none good'))).toBe(true);
  });

  it('exports the reviewed picks on a --yes re-run', async () => {
    const rotating = () => fakeDecisionModel((keys, call) => keys[call % keys.length]);
    const lib = fakeLibrary();
    await runCurateCommand(lib, opts(), {
      model: rotating(),
      images: fakeImages,
      fit: async (b) => b,
      ask: async () => 'n',
    });
    // The numbered pick lines the user reviewed: "  1. 2025-11-30 15:00  P4  special …".
    const reviewed = vi
      .mocked(console.error)
      .mock.calls.map(([line]) => /^\s*\d+\. \S+ \S+\s+(\S+)/.exec(String(line))?.[1])
      .filter(Boolean);
    expect(reviewed).toHaveLength(3);

    const exportPhotos = vi.spyOn(lib, 'exportPhotos');
    const again = rotating();
    await runCurateCommand(lib, { ...opts(), yes: true }, { model: again, images: fakeImages, fit: async (b) => b });
    expect(again.requests).toHaveLength(0);
    expect(exportPhotos).toHaveBeenCalledOnce();
    expect(exportPhotos.mock.calls[0][0]).toEqual(reviewed);
  });
});
