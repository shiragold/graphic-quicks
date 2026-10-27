import { describe, expect, it } from 'vitest';

import { createOpenRouterDecisions, type DecisionRequest } from '../src/index.js';

const req: DecisionRequest = {
  name: 'judge x',
  state: ['Brief: party', { type: 'image', jpeg: Buffer.from('jpg') }],
  questions: {
    relevant: { type: 'noul', instructions: 'Fits the brief.' },
    quality: { type: 'score', instructions: 'How good?', criteria: ['bad', 'ok', 'great'] },
    best: { type: 'choice', instructions: 'Best shot?', criteria: { A: null, B: null } },
  },
};

function fakeFetch(responses: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const answers = {
  relevant: { type: 'noul', noul: 0.91 },
  quality: { type: 'score', score: 1.7, probabilities: { 0: 0, 1: 0.3, 2: 0.7 }, confidence: 0.6 },
  best: { type: 'choice', choice: 'B', probabilities: { A: 0.2, B: 0.8 }, confidence: 0.5 },
};
const ok = (a: unknown = answers) => ({
  status: 200,
  body: { model: 'typesafe/jev-1.14-20261014', answers: a, usage: { input_tokens: 1200, output_tokens: 40, cost: 0.00005 } },
});

describe('createOpenRouterDecisions', () => {
  it('requires an API key', () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      expect(() => createOpenRouterDecisions()).toThrow(/OPENROUTER_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev;
    }
  });

  it('sends text and image parts in state, and returns typed answers with usage', async () => {
    const f = fakeFetch([ok()]);
    const model = createOpenRouterDecisions({ apiKey: 'k', fetch: f.fn });
    expect(model.id).toBe('openrouter:typesafe/jev-1.14');
    const result = await model.decide(req);
    expect(result.answers).toEqual(answers);
    expect(result.model).toBe('typesafe/jev-1.14-20261014');
    expect(result.usage).toEqual({ inputTokens: 1200, costUsd: 0.00005 });

    expect(f.calls[0].url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer k');
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.model).toBe('typesafe/jev-1.14');
    expect(body.state).toEqual([
      'Brief: party',
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}` } },
    ]);
    expect(body.questions).toEqual(req.questions);
  });

  it('retries rate limits and honours retry-after', async () => {
    const waits: number[] = [];
    const f = fakeFetch([{ status: 429, body: {}, headers: { 'retry-after': '2' } }, { status: 503, body: {} }, ok()]);
    const model = createOpenRouterDecisions({ apiKey: 'k', fetch: f.fn, sleep: async (ms) => void waits.push(ms) });
    await model.decide(req);
    expect(waits).toEqual([2000, 4000]);
  });

  it('retries network failures, then gives up after maxAttempts', async () => {
    const waits: number[] = [];
    let calls = 0;
    const flaky = (async () => {
      if (++calls === 1) throw new TypeError('fetch failed: ECONNRESET');
      return new Response(JSON.stringify(ok().body), { status: 200 });
    }) as unknown as typeof fetch;
    const model = createOpenRouterDecisions({ apiKey: 'k', fetch: flaky, sleep: async (ms) => void waits.push(ms) });
    await expect(model.decide(req)).resolves.toMatchObject({ answers });
    expect(waits).toEqual([2000]);

    const down = (async () => {
      throw new TypeError('fetch failed: ENOTFOUND');
    }) as unknown as typeof fetch;
    const dead = createOpenRouterDecisions({ apiKey: 'k', fetch: down, maxAttempts: 3, sleep: async () => {} });
    await expect(dead.decide(req)).rejects.toThrow(/judge x: Decisions API request failed: fetch failed: ENOTFOUND/);
  });

  it('fails on client errors and on missing or mistyped answers', async () => {
    const mk = (r: { status: number; body: unknown }) => createOpenRouterDecisions({ apiKey: 'k', fetch: fakeFetch([r]).fn });
    await expect(mk({ status: 400, body: { error: { message: 'too many images' } } }).decide(req)).rejects.toThrow(/400: too many images/);
    await expect(mk(ok({ ...answers, best: undefined })).decide(req)).rejects.toThrow(/no answer for "best"/);
    await expect(mk(ok({ ...answers, relevant: { type: 'choice', choice: 'x' } })).decide(req)).rejects.toThrow(/expected noul/);
    await expect(mk(ok({ ...answers, quality: { type: 'score' } })).decide(req)).rejects.toThrow(/no score value/);
  });
});
