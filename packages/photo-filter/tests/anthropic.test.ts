import { describe, expect, it } from 'vitest';

import { createAnthropicModel, image, text } from '../src/index.js';

const req = { name: 'judge x', system: 'sys', parts: [text('hi'), image(Buffer.from('jpg'))], schema: { type: 'object' } };

function fakeFetch(responses: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (json: unknown) => ({
  status: 200,
  body: { content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(json) }], stop_reason: 'end_turn' },
});

describe('createAnthropicModel', () => {
  it('requires an API key', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createAnthropicModel()).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('sends images and the schema as structured output, and parses the text block', async () => {
    const f = fakeFetch([ok({ a: 1 })]);
    const model = createAnthropicModel({ apiKey: 'k', model: 'claude-test', fetch: f.fn });
    expect(model.id).toBe('anthropic:claude-test');
    expect(await model.generate(req)).toEqual({ a: 1 });

    const body = JSON.parse(f.calls[0].init.body as string);
    expect(f.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect((f.calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(body).toMatchObject({ model: 'claude-test', system: 'sys', output_config: { format: { type: 'json_schema', schema: { type: 'object' } } } });
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('jpg').toString('base64') } },
    ]);
  });

  it('retries overloads and honours retry-after', async () => {
    const waits: number[] = [];
    const f = fakeFetch([{ status: 529, body: {}, headers: { 'retry-after': '3' } }, { status: 429, body: {} }, ok({ b: 2 })]);
    const model = createAnthropicModel({ apiKey: 'k', fetch: f.fn, sleep: async (ms) => void waits.push(ms) });
    expect(await model.generate(req)).toEqual({ b: 2 });
    expect(waits).toEqual([3000, 4000]);
  });

  it('fails on client errors, refusals, and truncation', async () => {
    const mk = (r: { status: number; body: unknown }) => createAnthropicModel({ apiKey: 'k', fetch: fakeFetch([r]).fn });
    await expect(mk({ status: 400, body: { error: { message: 'bad schema' } } }).generate(req)).rejects.toThrow(/400: bad schema/);
    await expect(mk({ status: 200, body: { content: [], stop_reason: 'refusal' } }).generate(req)).rejects.toThrow(/refused/);
    await expect(mk({ status: 200, body: { content: [], stop_reason: 'max_tokens' } }).generate(req)).rejects.toThrow(/truncated/);
  });
});
