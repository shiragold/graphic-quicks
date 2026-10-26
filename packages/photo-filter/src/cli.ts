#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { runCurateCommand } from './curate/command.js';
import { createPhotoLibrary } from './library.js';
import type { PhotoSummary, PhotoVersion, SortOrder } from './types.js';

const USAGE = `Usage: photo-filter <command> [options]

Commands:
  albums                         List albums (shared albums marked)
  query                          Find photos
      --album NAME               Album name; repeatable (OR)
      --around YYYY-MM-DD        Centre of a date window
      --days N                   Half-width of --around window (default 2)
      --from DATE --to DATE      Explicit range (to is exclusive)
      --min-score S              Minimum Photos aesthetic score
      --sort score|date          Default date
      --limit N
      --movies                   Include videos
  thumbs UUID... --out DIR       Write JPEG previews (for viewing)
      --size PX                  Long edge (default 512)
  export UUID... --dest DIR      Export photos
      --version original|edited|both   Default edited
      --jpeg                     Convert to JPEG
      --download-missing         Fetch iCloud-only originals via Photos.app
  curate                         Pick special-moment photos with Jev, then export
      --album NAME --brief TEXT --dest DIR   Required
      --around/--days or --from/--to         Date range (as for query)
      --count N                  Photos to pick (overrides --per-month; max 60)
      --per-month N              Target density (default 20 per 30 days of the range)
      --subject NAME             Person the brief is about; repeatable
      --ref NAME=UUID            Reference photo of a subject; repeatable
      --quality-weight W         Weight of quality in the score (default 0.3)
      --min-score S              Drop candidates below this score (default 0.3)
      --context FILE             Shared context (default ~/.photo-filter/context/<album>--<brief>.json)
      --model ID                 Default typesafe/jev-1.14 (needs OPENROUTER_API_KEY)
      --yes                      Export without the confirm prompt
      --version, --jpeg          As for export

Global:
  --library PATH                 .photoslibrary to read (or PHOTO_FILTER_LIBRARY)
  --json                         Machine-readable output
  -h, --help`;

function formatPhoto(p: PhotoSummary): string {
  const score = p.score === null ? '  -  ' : p.score.toFixed(3);
  const who = p.persons.length ? `  [${p.persons.join(', ')}]` : '';
  return `${p.uuid}  ${p.date.slice(0, 19)}  ${score}  ${p.filename}${who}`;
}

function int(name: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer`);
  return n;
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      library: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      album: { type: 'string', multiple: true },
      around: { type: 'string' },
      days: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      'min-score': { type: 'string' },
      sort: { type: 'string' },
      limit: { type: 'string' },
      movies: { type: 'boolean', default: false },
      out: { type: 'string' },
      size: { type: 'string' },
      dest: { type: 'string' },
      version: { type: 'string' },
      jpeg: { type: 'boolean', default: false },
      'download-missing': { type: 'boolean', default: false },
      person: { type: 'string', multiple: true },
      brief: { type: 'string' },
      count: { type: 'string' },
      'per-month': { type: 'string' },
      'quality-weight': { type: 'string' },
      subject: { type: 'string', multiple: true },
      ref: { type: 'string', multiple: true },
      context: { type: 'string' },
      model: { type: 'string' },
      yes: { type: 'boolean', default: false },
    },
  });
  const [command, ...uuids] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  const lib = createPhotoLibrary({ library: values.library });
  const print = (value: unknown, text: () => string) =>
    console.log(values.json ? JSON.stringify(value, null, 2) : text());

  switch (command) {
    case 'albums': {
      const albums = await lib.listAlbums();
      print(albums, () =>
        albums.map((a) => `${String(a.count).padStart(6)}  ${a.shared ? '[shared] ' : ''}${a.name}`).join('\n'),
      );
      return;
    }
    case 'query': {
      const sort = values.sort as SortOrder | undefined;
      if (sort && sort !== 'score' && sort !== 'date') throw new Error('--sort must be score or date');
      const minScore = values['min-score'] === undefined ? undefined : Number(values['min-score']);
      if (Number.isNaN(minScore)) throw new Error('--min-score must be a number');
      const photos = await lib.queryPhotos({
        album: values.album,
        person: values.person,
        around: values.around,
        days: int('days', values.days),
        from: values.from,
        to: values.to,
        minScore,
        sort,
        limit: int('limit', values.limit),
        includeMovies: values.movies,
      });
      print(photos, () => [`${photos.length} photo(s)`, ...photos.map(formatPhoto)].join('\n'));
      return;
    }
    case 'thumbs': {
      if (!values.out) throw new Error('thumbs requires --out DIR');
      const out = resolve(values.out);
      await mkdir(out, { recursive: true });
      const thumbs = await lib.thumbnails(uuids, int('size', values.size));
      const files = await Promise.all(
        thumbs.map(async (t) => {
          const file = join(out, `${t.uuid}.jpg`);
          await writeFile(file, t.data);
          return file;
        }),
      );
      print(files, () => files.join('\n'));
      return;
    }
    case 'export': {
      if (!values.dest) throw new Error('export requires --dest DIR');
      const version = values.version as PhotoVersion | undefined;
      if (version && !['original', 'edited', 'both'].includes(version)) {
        throw new Error('--version must be original, edited, or both');
      }
      const files = await lib.exportPhotos(uuids, values.dest, {
        version,
        convertToJpeg: values.jpeg,
        downloadMissing: values['download-missing'],
      });
      print(files, () => files.join('\n'));
      return;
    }
    case 'curate': {
      const [album] = values.album ?? [];
      if (!album || !values.brief || !values.dest) throw new Error('curate requires --album, --brief, and --dest');
      const version = values.version as PhotoVersion | undefined;
      if (version && !['original', 'edited', 'both'].includes(version)) {
        throw new Error('--version must be original, edited, or both');
      }
      const refs = new Map<string, string[]>();
      for (const r of values.ref ?? []) {
        const eq = r.indexOf('=');
        if (eq < 1) throw new Error(`--ref must be NAME=UUID, got "${r}"`);
        const name = r.slice(0, eq);
        refs.set(name, [...(refs.get(name) ?? []), r.slice(eq + 1)]);
      }
      const names = [...new Set([...(values.subject ?? []), ...refs.keys()])];
      const qualityWeight =
        values['quality-weight'] === undefined ? undefined : Number(values['quality-weight']);
      if (qualityWeight !== undefined && Number.isNaN(qualityWeight)) {
        throw new Error('--quality-weight must be a number');
      }
      const minScore = values['min-score'] === undefined ? undefined : Number(values['min-score']);
      if (minScore !== undefined && Number.isNaN(minScore)) throw new Error('--min-score must be a number');
      await runCurateCommand(lib, {
        album,
        brief: values.brief,
        dest: values.dest,
        count: int('count', values.count),
        perMonth: int('per-month', values['per-month']),
        around: values.around,
        days: int('days', values.days),
        from: values.from,
        to: values.to,
        subjects: names.map((name) => ({ name, refs: refs.get(name) })),
        contextPath: values.context,
        model: values.model,
        qualityWeight,
        minScore,
        yes: values.yes,
        version,
        convertToJpeg: values.jpeg,
        json: values.json,
      });
      return;
    }
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`photo-filter: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
