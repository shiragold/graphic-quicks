import cv from '@techstark/opencv-js';

declare global {
  // eslint-disable-next-line no-var
  var cv: typeof import('@techstark/opencv-js').default;
}

// @techstark/opencv-js initializes WASM asynchronously. Wait until Mat is
// available, then publish to globalThis so photo-edit.js (which references
// `cv` as a free identifier) can find it.
await new Promise<void>((resolve) => {
  const ready = cv as unknown as { Mat?: unknown; onRuntimeInitialized?: () => void };
  if (ready.Mat) return resolve();
  ready.onRuntimeInitialized = () => resolve();
});

globalThis.cv = cv;
