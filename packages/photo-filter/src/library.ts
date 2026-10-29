import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { normalizeAlbums, normalizePhoto } from './normalize.js';
import { osxphotosCommand, runCommand, type CommandRunner } from './runner.js';
import { dateWindow, selectPhotos } from './select.js';
import type {
  AlbumSummary,
  ExportOptions,
  PhotoSummary,
  QueryOptions,
  Thumbnail,
} from './types.js';

export interface PhotoLibraryOptions {
  /** Path to a `.photoslibrary`; defaults to `PHOTO_FILTER_LIBRARY`, then osxphotos' own default. */
  library?: string;
  /** osxphotos invocation; defaults to `osxphotosCommand()`. */
  osxphotos?: string[];
  run?: CommandRunner;
}

export interface PhotoLibrary {
  listAlbums(): Promise<AlbumSummary[]>;
  queryPhotos(opts?: QueryOptions): Promise<PhotoSummary[]>;
  getPhotos(uuids: string[]): Promise<PhotoSummary[]>;
  /** JPEG previews whose long edge is at most `size` px, in the order of `uuids`. */
  thumbnails(uuids: string[], size?: number): Promise<Thumbnail[]>;
  /** Exports photos into `dest` and returns the absolute paths of files written. */
  exportPhotos(uuids: string[], dest: string, opts?: ExportOptions): Promise<string[]>;
}

const UUID = /^[0-9A-Za-z-]{1,64}$/;

function assertUuids(uuids: string[]): void {
  if (uuids.length === 0) throw new Error('at least one uuid is required');
  const bad = uuids.find((u) => !UUID.test(u));
  if (bad !== undefined) throw new Error(`invalid uuid "${bad}"`);
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'photo-filter-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createPhotoLibrary(options: PhotoLibraryOptions = {}): PhotoLibrary {
  const run = options.run ?? runCommand;
  const [bin, ...prefix] = options.osxphotos ?? osxphotosCommand();
  const library = options.library ?? process.env.PHOTO_FILTER_LIBRARY;
  const libraryArgs = library ? ['--library', library] : [];

  const osxphotos = (subcommand: string, args: string[]) =>
    run(bin, [...prefix, subcommand, ...libraryArgs, ...args]);

  const queryRaw = async (args: string[]): Promise<PhotoSummary[]> => {
    const out = await osxphotos('query', ['--json', ...args]);
    const parsed: unknown = JSON.parse(out.trim() || '[]');
    if (!Array.isArray(parsed)) throw new Error('unexpected osxphotos query output');
    return parsed.map((r) => normalizePhoto(r as Record<string, unknown>));
  };

  const getPhotos = async (uuids: string[]) => {
    assertUuids(uuids);
    const found = await queryRaw(uuids.flatMap((u) => ['--uuid', u]));
    const byUuid = new Map(found.map((p) => [p.uuid, p]));
    return uuids.map((u) => {
      const p = byUuid.get(u);
      if (!p) throw new Error(`photo ${u} not found`);
      return p;
    });
  };

  return {
    async listAlbums() {
      const out = await osxphotos('albums', ['--json']);
      return normalizeAlbums(JSON.parse(out) as Record<string, unknown>);
    },

    async queryPhotos(opts = {}) {
      const range = opts.around ? dateWindow(opts.around, opts.days) : opts;
      const args = [
        ...(opts.album ?? []).flatMap((a) => ['--album', a]),
        ...(opts.person ?? []).flatMap((p) => ['--person', p]),
        ...(range.from ? ['--from-date', range.from] : []),
        ...(range.to ? ['--to-date', range.to] : []),
      ];
      return selectPhotos(await queryRaw(args), opts);
    },

    getPhotos,

    async thumbnails(uuids, size = 512) {
      const photos = await getPhotos(uuids);
      return withTempDir(async (dir) =>
        Promise.all(
          photos.map(async (p) => {
            const source = p.previewPath ?? p.path;
            if (!source) {
              throw new Error(`photo ${p.uuid} has no local file or preview (iCloud-only); export it with downloadMissing`);
            }
            const out = join(dir, `${p.uuid}.jpg`);
            await run('sips', ['-Z', String(size), '-s', 'format', 'jpeg', source, '--out', out]);
            return { uuid: p.uuid, mimeType: 'image/jpeg' as const, data: await readFile(out) };
          }),
        ),
      );
    },

    async exportPhotos(uuids, dest, opts = {}) {
      assertUuids(uuids);
      const { version = 'edited', convertToJpeg = false, downloadMissing = false } = opts;
      const target = resolve(dest);
      await mkdir(target, { recursive: true });
      const before = new Set(await readdir(target));
      await withTempDir(async (dir) => {
        const uuidFile = join(dir, 'uuids.txt');
        await writeFile(uuidFile, uuids.join('\n'));
        await osxphotos('export', [
          target,
          '--uuid-from-file',
          uuidFile,
          '--skip-live',
          ...(version === 'original' ? ['--skip-edited'] : []),
          ...(version === 'edited' ? ['--skip-original-if-edited'] : []),
          ...(convertToJpeg ? ['--convert-to-jpeg'] : []),
          ...(downloadMissing ? ['--download-missing'] : []),
        ]);
      });
      const after = await readdir(target);
      return after.filter((f) => !before.has(f)).sort().map((f) => join(target, f));
    },
  };
}
