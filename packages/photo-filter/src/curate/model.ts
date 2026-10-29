export type Part = { type: 'text'; text: string } | { type: 'image'; jpeg: Buffer };

export interface ModelRequest {
  /** Short name for logs and errors, e.g. `judge 2025-11-30T14:05 #2`. */
  name: string;
  system: string;
  parts: Part[];
  /** JSON Schema the reply must match (no numeric range keywords; validate those in code). */
  schema: Record<string, unknown>;
}

/** A vision model that returns schema-shaped JSON. The only non-deterministic piece of curation. */
export interface VisionModel {
  readonly id: string;
  generate(req: ModelRequest): Promise<unknown>;
}

export const text = (t: string): Part => ({ type: 'text', text: t });
export const image = (jpeg: Buffer): Part => ({ type: 'image', jpeg });
