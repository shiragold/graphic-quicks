# photo-edit

Browser-based auto-crop / deskew for scanned photos, powered by OpenCV.js.

- UI: [index.html](./index.html)
- Pure image-processing logic (extracted as an ES module): [photo-edit.js](./photo-edit.js)
- Ambient TypeScript types for the module: [photo-edit.d.ts](./photo-edit.d.ts)

Open `index.html` directly in a browser (or via GitHub Pages) — no build step.

## Tests

Unit tests run in Node against [`@techstark/opencv-js`](https://www.npmjs.com/package/@techstark/opencv-js) — no browser, no jsdom. Test files are TypeScript, transpiled on the fly by Vitest.

```bash
cd photo-edit
npm install
npm test            # one-shot
npm run test:watch  # TDD loop
npm run typecheck   # strict tsc --noEmit over tests/ + photo-edit.d.ts
```

The suite generates synthetic images in-memory (see [tests/fixtures.ts](./tests/fixtures.ts)): `makePhoto()` returns the input image alongside the three ground-truth outputs the pipeline should produce (`tightCrop`, `deskewedTight`, `deskewedPadded`). Tests compare the pipeline's actual output against those ground-truth images using a tolerant per-pixel diff (`compareImages`, which center-aligns and skips a small edge band to absorb warpAffine anti-aliasing).

## Eyeballing fixtures

To dump PNGs of the inputs and expected outputs for visual inspection:

```bash
npm run fixtures
```

Writes one folder per case under [tests/fixtures/](./tests/fixtures/) (gitignored). Each folder contains:

- `input.png` — what the pipeline receives
- `expected-tight.png` — ground truth for the "Tight crop" output
- `expected-deskewed-tight.png` — ground truth for "Deskewed + tight"
- `expected-deskewed-padded.png` — ground truth for "Deskewed + padded"

The `blank` case only writes `input.png` (no photo, no expected outputs).
