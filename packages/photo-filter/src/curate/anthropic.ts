import type { ModelRequest, VisionModel } from './model.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

export interface AnthropicOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  maxAttempts?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  error?: { message?: string };
}

/** Claude via the Messages API, using structured outputs (`output_config.format`) for schema-shaped replies. */
export function createAnthropicModel(opts: AnthropicOptions = {}): VisionModel {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const model = opts.model ?? process.env.PHOTO_FILTER_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const baseUrl = opts.baseUrl ?? 'https://api.anthropic.com';
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 4;

  return {
    id: `anthropic:${model}`,
    async generate(req: ModelRequest) {
      const body = JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 16_000,
        system: req.system,
        messages: [
          {
            role: 'user',
            content: req.parts.map((p) =>
              p.type === 'text'
                ? { type: 'text', text: p.text }
                : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.jpeg.toString('base64') } },
            ),
          },
        ],
        output_config: { format: { type: 'json_schema', schema: req.schema } },
      });

      for (let attempt = 1; ; attempt++) {
        const res = await doFetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body,
        });
        const json = (await res.json().catch(() => ({}))) as MessagesResponse;
        if (!res.ok) {
          if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
            const after = Number(res.headers.get('retry-after'));
            await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 2 ** attempt * 1000);
            continue;
          }
          throw new Error(`${req.name}: Anthropic API ${res.status}: ${json.error?.message ?? res.statusText}`);
        }
        if (json.stop_reason === 'refusal') throw new Error(`${req.name}: model refused`);
        if (json.stop_reason === 'max_tokens') throw new Error(`${req.name}: reply truncated (max_tokens)`);
        const block = json.content?.find((c) => c.type === 'text');
        if (!block?.text) throw new Error(`${req.name}: reply has no text block`);
        return JSON.parse(block.text) as unknown;
      }
    },
  };
}
