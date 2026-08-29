import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePhoto, writePng, type FixtureOptions } from './fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'fixtures');

interface Case {
  name: string;
  opts: FixtureOptions;
  hasOutputs?: boolean;
}

const CASES: Case[] = [
  { name: 'clean-0deg', opts: { angleDeg: 0 } },
  { name: 'tilted-+5deg', opts: { angleDeg: 5 } },
  { name: 'tilted--10deg', opts: { angleDeg: -10 } },
  { name: 'off-center', opts: { cx: 300, cy: 400 } },
  { name: 'low-contrast', opts: { photoColor: [220, 210, 210], bgColor: [240, 240, 240] } },
  { name: 'blank', opts: { photoW: 0, photoH: 0 }, hasOutputs: false },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const c of CASES) {
    const dir = join(OUT_DIR, c.name);
    await mkdir(dir, { recursive: true });
    const fx = makePhoto(c.opts);
    await writePng(fx.input, join(dir, 'input.png'));
    if (c.hasOutputs !== false) {
      await writePng(fx.expected.outputs.tightCrop, join(dir, 'expected-tight.png'));
      await writePng(fx.expected.outputs.deskewedTight, join(dir, 'expected-deskewed-tight.png'));
      await writePng(fx.expected.outputs.deskewedPadded, join(dir, 'expected-deskewed-padded.png'));
    }
    console.log(`wrote ${c.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
