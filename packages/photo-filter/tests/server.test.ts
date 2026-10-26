import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { createPhotoLibrary } from '../src/index.js';
import { createServer } from '../src/server.js';
import { fakeRunner } from './fake-runner.js';

describe('MCP server', () => {
  let client: Client;
  beforeEach(async () => {
    const server = createServer(createPhotoLibrary({ run: fakeRunner().run, osxphotos: ['osxphotos'] }));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  it('exposes the four tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['export_photos', 'get_thumbnails', 'list_albums', 'query_photos']);
  });

  it('returns compact query results without file paths', async () => {
    const res = await client.callTool({ name: 'query_photos', arguments: { around: '2025-11-30', sort: 'score' } });
    const [block] = res.content as { type: string; text: string }[];
    const body = JSON.parse(block.text);
    expect(body.count).toBe(2);
    expect(body.photos[0]).toMatchObject({ uuid: 'AAA-1', score: 0.82, localPreview: true });
    expect(body.photos[0]).not.toHaveProperty('path');
  });

  it('returns thumbnails as image content', async () => {
    const res = await client.callTool({ name: 'get_thumbnails', arguments: { uuids: ['AAA-1'] } });
    expect(res.content).toEqual([
      { type: 'text', text: 'uuid: AAA-1' },
      { type: 'image', mimeType: 'image/jpeg', data: expect.any(String) },
    ]);
  });

  it('reports library errors as tool errors', async () => {
    const res = await client.callTool({ name: 'get_thumbnails', arguments: { uuids: ['BBB-2'] } });
    expect(res.isError).toBe(true);
  });
});
