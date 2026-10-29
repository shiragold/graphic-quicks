// Writes the reference renderer's stand-in photos (SAMPLE_PHOTOS) as JPEGs plus photos.json,
// so the Swift renderer can be fed exactly the same pictures for the parity check.
//
//   node tools/parity/export-sample-photos.mjs <themes-tools-dir> <out-dir>
//
// <themes-tools-dir> is research/themes/tools (sample-photos.mjs and snap.mjs live there).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const [toolsDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
const { SAMPLE_PHOTOS } = await import(pathToFileURL(join(toolsDir, 'sample-photos.mjs')));
const { snapBinary } = await import(pathToFileURL(join(toolsDir, 'snap.mjs')));
mkdirSync(outDir, { recursive: true });
const tmp = join(tmpdir(), 'photo-album-parity-photos');
mkdirSync(tmp, { recursive: true });

const meta = [];
for (const p of SAMPLE_PHOTOS) {
  const svg = join(tmp, `${p.id}.svg`), png = join(tmp, `${p.id}.png`);
  writeFileSync(svg, p.svg());
  // Half resolution is plenty for 1000-unit previews.
  execFileSync(snapBinary(), [svg, png, String(p.w), String(p.h), '0.5'], { stdio: 'ignore' });
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', png, '--out', join(outDir, `${p.id}.jpg`)], { stdio: 'ignore' });
  meta.push({ id: p.id, w: p.w, h: p.h, focal: p.focal ?? [0.5, 0.5], faces: !!p.faces });
}
writeFileSync(join(outDir, 'photos.json'), JSON.stringify(meta, null, 2) + '\n');
rmSync(tmp, { recursive: true, force: true });
console.log(`${meta.length} photos -> ${outDir}`);
