import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPhotoLibrary } from '../src/index.js';
import { fakeRunner } from './fake-runner.js';

describe('createPhotoLibrary', () => {
  let dest: string;
  beforeEach(async () => {
    dest = await mkdtemp(join(tmpdir(), 'photo-filter-test-'));
  });
  afterEach(async () => {
    await rm(dest, { recursive: true, force: true });
  });

  it('passes library, album, and date window to osxphotos query', async () => {
    const fake = fakeRunner();
    const lib = createPhotoLibrary({ run: fake.run, osxphotos: ['uvx', 'osxphotos'], library: '/L.photoslibrary' });
    const photos = await lib.queryPhotos({ album: ['Annaelle 4'], around: '2025-11-30', days: 1, sort: 'score' });
    expect(fake.calls[0]).toEqual({
      command: 'uvx',
      args: [
        'osxphotos', 'query', '--library', '/L.photoslibrary', '--json',
        '--album', 'Annaelle 4', '--from-date', '2025-11-29', '--to-date', '2025-12-02',
      ],
    });
    expect(photos.map((p) => p.uuid)).toEqual(['AAA-1', 'BBB-2']);
  });

  it('lists albums including shared ones', async () => {
    const lib = createPhotoLibrary({ run: fakeRunner().run, osxphotos: ['osxphotos'] });
    expect(await lib.listAlbums()).toContainEqual({ name: 'Annaelle 4', count: 340, shared: true });
  });

  it('renders thumbnails from the largest preview with sips', async () => {
    const fake = fakeRunner();
    const lib = createPhotoLibrary({ run: fake.run, osxphotos: ['osxphotos'] });
    const [thumb] = await lib.thumbnails(['AAA-1'], 256);
    expect(thumb).toMatchObject({ uuid: 'AAA-1', mimeType: 'image/jpeg' });
    expect(thumb.data.length).toBeGreaterThan(0);
    const sips = fake.calls.find((c) => c.command === 'sips');
    expect(sips?.args.slice(0, 5)).toEqual(['-Z', '256', '-s', 'format', 'jpeg']);
    expect(sips?.args[5]).toBe('/lib/derivatives/AAA-1_1_105_c.jpeg');
  });

  it('fails clearly for iCloud-only photos and unknown uuids', async () => {
    const lib = createPhotoLibrary({ run: fakeRunner().run, osxphotos: ['osxphotos'] });
    await expect(lib.thumbnails(['BBB-2'])).rejects.toThrow(/iCloud-only/);
    await expect(lib.thumbnails(['ZZZ-9'])).rejects.toThrow(/not found/);
    await expect(lib.thumbnails(['bad; rm -rf'])).rejects.toThrow(/invalid uuid/);
  });

  it('exports by uuid file and returns newly written files', async () => {
    const fake = fakeRunner();
    const lib = createPhotoLibrary({ run: fake.run, osxphotos: ['osxphotos'] });
    const files = await lib.exportPhotos(['AAA-1'], dest, { version: 'original', convertToJpeg: true });
    expect(files).toEqual([join(dest, 'IMG_0001.jpeg')]);
    const args = fake.calls[0].args;
    expect(args.slice(0, 2)).toEqual(['export', dest]);
    expect(args).toEqual(expect.arrayContaining(['--uuid-from-file', '--skip-live', '--skip-edited', '--convert-to-jpeg']));
    expect(args).not.toContain('--download-missing');
  });
});
