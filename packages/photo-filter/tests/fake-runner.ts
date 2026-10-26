import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CommandRunner } from '../src/index.js';

export const RAW_PHOTOS = [
  {
    uuid: 'AAA-1',
    original_filename: 'IMG_0001.HEIC',
    filename: 'AAA-1.heic',
    date: '2025-11-30T15:04:05+02:00',
    width: 4032,
    height: 3024,
    ismovie: false,
    favorite: true,
    score: { overall: 0.82, curation: 0.5 },
    albums: ['Annaelle 4'],
    persons: ['Annaelle', '_UNKNOWN_'],
    labels: ['Cake', 'Party'],
    path: '/lib/originals/AAA-1.heic',
    path_derivatives: ['/lib/derivatives/AAA-1_1_105_c.jpeg', '/lib/derivatives/AAA-1_1_102_o.jpeg'],
    ismissing: false,
    shared: true,
  },
  {
    uuid: 'BBB-2',
    original_filename: 'IMG_0002.JPG',
    date: '2025-11-29T10:00:00+02:00',
    width: 3000,
    height: 2000,
    ismovie: false,
    favorite: false,
    score: { overall: 0.41 },
    albums: ['Annaelle 4'],
    persons: [],
    labels: [],
    path: null,
    path_derivatives: [],
    ismissing: true,
    shared: true,
  },
  {
    uuid: 'CCC-3',
    original_filename: 'IMG_0003.MOV',
    date: '2025-11-30T16:00:00+02:00',
    width: 1920,
    height: 1080,
    ismovie: true,
    score: null,
    path: '/lib/originals/CCC-3.mov',
  },
];

export interface FakeRunner {
  run: CommandRunner;
  calls: { command: string; args: string[] }[];
}

/** Simulates osxphotos (query/albums/export) and sips well enough to exercise the library. */
export function fakeRunner(photos: Record<string, unknown>[] = RAW_PHOTOS): FakeRunner {
  const calls: FakeRunner['calls'] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === 'sips') {
      await writeFile(args[args.indexOf('--out') + 1], Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return '';
    }
    const subcommand = args.find((a) => ['albums', 'query', 'export'].includes(a));
    if (subcommand === 'albums') {
      return JSON.stringify({ albums: { Trips: 12 }, 'shared albums': { 'Annaelle 4': 340 } });
    }
    if (subcommand === 'query') {
      const wanted = args.flatMap((a, i) => (args[i - 1] === '--uuid' ? [a] : []));
      return JSON.stringify(wanted.length ? photos.filter((p) => wanted.includes(p.uuid as string)) : photos);
    }
    if (subcommand === 'export') {
      const dest = args.find((a) => a.startsWith('/'));
      if (dest) await writeFile(join(dest, 'IMG_0001.jpeg'), 'x');
      return '';
    }
    throw new Error(`unexpected command ${command} ${args.join(' ')}`);
  };
  return { run, calls };
}
