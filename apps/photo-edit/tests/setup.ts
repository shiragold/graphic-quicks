import { beforeAll } from 'vitest';
import { createRequire } from 'node:module';

// @techstark/opencv-js 5.x exports a Promise from `require()` (async factory
// that resolves once WASM is initialized). We use createRequire to bypass
// vitest 4.x's ESM handling — an ordinary `import cv from ...` fails with
// "Method Promise.prototype.then called on incompatible receiver" because
// vitest tries to await the module namespace itself. Publishing to globalThis
// lets photo-edit.js (which references `cv` as a free identifier) find it.
// The `globalThis.cv` typing comes from opencv-js's own global declaration.
const requireCJS = createRequire(import.meta.url);

beforeAll(async () => {
  const cv = await requireCJS('@techstark/opencv-js');
  globalThis.cv = cv;
});
