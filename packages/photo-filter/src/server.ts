import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { createPhotoLibrary, type PhotoLibrary } from './library.js';
import type { PhotoSummary } from './types.js';

const MAX_THUMBNAILS = 12;

/** The fields an agent needs to choose photos; paths stay server-side. */
function compact(p: PhotoSummary) {
  return {
    uuid: p.uuid,
    date: p.date,
    filename: p.filename,
    score: p.score === null ? null : Math.round(p.score * 1000) / 1000,
    favorite: p.favorite,
    isMovie: p.isMovie,
    persons: p.persons,
    labels: p.labels,
    title: p.title,
    localPreview: p.previewPath !== null || p.path !== null,
  };
}

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

export function createServer(lib: PhotoLibrary = createPhotoLibrary()): McpServer {
  const server = new McpServer({ name: 'photo-filter', version: '0.1.0' });

  server.registerTool(
    'list_albums',
    {
      title: 'List Photos albums',
      description: 'List albums in the macOS Photos library, including iCloud shared albums (shared: true), with photo counts.',
      inputSchema: {},
    },
    async () => json(await lib.listAlbums()),
  );

  server.registerTool(
    'query_photos',
    {
      title: 'Query photos',
      description:
        'Find photos by album and date. Use `around` (YYYY-MM-DD) with `days` for "photos around a date", or `from`/`to`. ' +
        'Returns metadata only; `score` is Photos\' aesthetic score (higher is better) and is a useful first cut for "best" photos. ' +
        'Follow up with get_thumbnails to actually look at candidates.',
      inputSchema: {
        album: z.array(z.string()).optional().describe('Album names (folder albums as "Folder/Album"); OR-ed'),
        around: z.string().optional().describe('Centre date YYYY-MM-DD; overrides from/to'),
        days: z.number().int().min(0).max(366).optional().describe('Half-width of the around window (default 2)'),
        from: z.string().optional().describe('Inclusive start date (ISO 8601)'),
        to: z.string().optional().describe('Exclusive end date (ISO 8601)'),
        minScore: z.number().optional(),
        includeMovies: z.boolean().optional(),
        sort: z.enum(['score', 'date']).optional().describe('Default date'),
        limit: z.number().int().min(1).max(1000).optional().describe('Default 200'),
      },
    },
    async (args) => {
      const photos = await lib.queryPhotos({ ...args, limit: args.limit ?? 200 });
      return json({ count: photos.length, photos: photos.map(compact) });
    },
  );

  server.registerTool(
    'get_thumbnails',
    {
      title: 'View photo thumbnails',
      description: `Return up to ${MAX_THUMBNAILS} photos as inline JPEG images so you can judge their content (faces, focus, composition, duplicates).`,
      inputSchema: {
        uuids: z.array(z.string()).min(1).max(MAX_THUMBNAILS),
        size: z.number().int().min(64).max(1600).optional().describe('Long edge in px (default 512)'),
      },
    },
    async ({ uuids, size }) => {
      const thumbs = await lib.thumbnails(uuids, size);
      return {
        content: thumbs.flatMap((t) => [
          { type: 'text' as const, text: `uuid: ${t.uuid}` },
          { type: 'image' as const, data: t.data.toString('base64'), mimeType: t.mimeType },
        ]),
      };
    },
  );

  server.registerTool(
    'export_photos',
    {
      title: 'Export photos',
      description: 'Copy selected photos out of the Photos library into a destination directory. Never modifies the library.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).max(1000),
        dest: z.string().describe('Destination directory (created if missing)'),
        version: z.enum(['original', 'edited', 'both']).optional().describe('Default edited (falls back to original)'),
        convertToJpeg: z.boolean().optional(),
        downloadMissing: z.boolean().optional().describe('Fetch iCloud-only originals via Photos.app (slow)'),
      },
    },
    async ({ uuids, dest, ...opts }) => json({ files: await lib.exportPhotos(uuids, dest, opts) }),
  );

  return server;
}
