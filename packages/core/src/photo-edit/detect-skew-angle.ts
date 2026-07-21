import type { Mat, CV } from '@techstark/opencv-js';

// `cv` is a free identifier at runtime — it resolves to `globalThis.cv`, which
// callers must set to the initialized OpenCV.js module before calling us.
// See src/photo-edit/README.md (or the top-level README) for the init pattern.
declare const cv: CV;

export function detectSkewAngle(src: Mat): number {
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const lines = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);

    const minLen = Math.max(20, Math.min(src.cols, src.rows) * 0.2);
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 80, minLen, 20);

    const bins: number[] = new Array(90).fill(0);
    const weights: number[] = new Array(90).fill(0);
    for (let i = 0; i < lines.rows; i++) {
      const x1 = lines.data32S[i * 4 + 0];
      const y1 = lines.data32S[i * 4 + 1];
      const x2 = lines.data32S[i * 4 + 2];
      const y2 = lines.data32S[i * 4 + 3];
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < minLen) continue;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      let a = ((angle % 90) + 90) % 90;
      if (a > 45) a -= 90;
      const bin = Math.round(a) + 45;
      const idx = Math.max(0, Math.min(89, bin));
      bins[idx] += 1;
      weights[idx] += len;
    }

    let bestIdx = -1, bestW = 0;
    for (let i = 0; i < 90; i++) {
      if (weights[i] > bestW) { bestW = weights[i]; bestIdx = i; }
    }
    if (bestIdx < 0) return 0;
    return bestIdx - 45;
  } finally {
    gray.delete(); blurred.delete(); edges.delete(); lines.delete();
  }
}
