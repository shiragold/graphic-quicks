export const DEFAULT_DECISION_MODEL = 'typesafe/jev-1.14';

export type StateItem = string | { type: 'image'; jpeg: Buffer };

export type Question =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: 'score'; score: number; probabilities?: Record<string, number>; confidence?: number };

export interface DecisionRequest {
  /** Short name for logs and errors. */
  name: string;
  state: StateItem[];
  questions: Record<string, Question>;
}

export interface DecisionResult {
  answers: Record<string, Answer>;
  /** Exact build that answered, e.g. `typesafe/jev-1.14-20261014`. */
  model: string;
  usage: { inputTokens: number; costUsd: number };
}

/** A model that answers typed questions (yes/no, choice, score) with probabilities instead of text. */
export interface DecisionModel {
  readonly id: string;
  decide(req: DecisionRequest): Promise<DecisionResult>;
}

export interface OpenRouterDecisionOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxAttempts?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

interface DecisionsResponse {
  model?: string;
  answers?: Record<string, { type?: string } & Record<string, unknown>>;
  usage?: { input_tokens?: number; cost?: number };
  error?: { message?: string };
}

function checkAnswer(name: string, id: string, q: Question, a: ({ type?: string } & Record<string, unknown>) | undefined): Answer {
  if (!a) throw new Error(`${name}: no answer for "${id}"`);
  if (a.type !== q.type) throw new Error(`${name}: "${id}" answered as ${a.type}, expected ${q.type}`);
  const field = a[q.type];
  if (q.type === 'choice' ? typeof field !== 'string' : typeof field !== 'number') {
    throw new Error(`${name}: "${id}" has no ${q.type} value`);
  }
  return a as unknown as Answer;
}

/** Decision models (Jev and others) via OpenRouter's Decisions API. */
export function createOpenRouterDecisions(opts: OpenRouterDecisionOptions = {}): DecisionModel {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const model = opts.model ?? process.env.PHOTO_FILTER_DECISION_MODEL ?? DEFAULT_DECISION_MODEL;
  const baseUrl = opts.baseUrl ?? 'https://openrouter.ai';
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 4;

  return {
    id: `openrouter:${model}`,
    async decide(req) {
      const body = JSON.stringify({
        model,
        state: req.state.map((s) =>
          typeof s === 'string'
            ? s
            : { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${s.jpeg.toString('base64')}` } },
        ),
        questions: req.questions,
      });

      for (let attempt = 1; ; attempt++) {
        let res: Response;
        try {
          res = await doFetch(`${baseUrl}/api/alpha/decisions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body,
          });
        } catch (err) {
          // Network-level failure (reset, DNS, timeout): as transient as a 503.
          if (attempt < maxAttempts) {
            await sleep(2 ** attempt * 1000);
            continue;
          }
          throw new Error(`${req.name}: Decisions API request failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        const json = (await res.json().catch(() => ({}))) as DecisionsResponse;
        if (!res.ok) {
          if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
            const after = Number(res.headers.get('retry-after'));
            await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 2 ** attempt * 1000);
            continue;
          }
          throw new Error(`${req.name}: Decisions API ${res.status}: ${json.error?.message ?? res.statusText}`);
        }
        const answers = Object.fromEntries(
          Object.entries(req.questions).map(([id, q]) => [id, checkAnswer(req.name, id, q, json.answers?.[id])]),
        );
        return {
          answers,
          model: json.model ?? model,
          usage: { inputTokens: json.usage?.input_tokens ?? 0, costUsd: json.usage?.cost ?? 0 },
        };
      }
    },
  };
}
