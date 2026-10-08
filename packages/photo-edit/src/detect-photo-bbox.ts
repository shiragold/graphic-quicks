import type { Mat, Rect, CV } from '@techstark/opencv-js';
import { sampleBackgroundColor } from './sample-background-color.js';
import type { RGB } from './types.js';

// See detect-skew-angle.ts for the `cv` ambient-global convention.
declare const cv: CV;

export function detectPhotoBBox(src: Mat, bgColor: RGB | null): Rect | null {
  const w = src.cols, h = src.rows;
  if (w === 0 || h === 0) return null;
  const med = bgColor || sampleBackgroundColor(src);

  const threshold = 35;

  const mask = cv.Mat.zeros(h, w, cv.CV_8UC1) as unknown as Mat;
  try {
    const data = src.data;
    const md = mask.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const off = (y * w + x) * 4;
        const dr = data[off] - med[0];
        const dg = data[off + 1] - med[1];
        const db = data[off + 2] - med[2];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist > threshold) md[y * w + x] = 255;
      }
    }

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
    kernel.delete();

    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const centroids = new cv.Mat();
    try {
      const n = cv.connectedComponentsWithStats(
        mask, labels, stats, centroids, 8, cv.CV_32S,
      );
      let bestArea = 0;
      let bestRect: Rect | null = null;
      for (let i = 1; i < n; i++) {
        const x = stats.intAt(i, cv.CC_STAT_LEFT);
        const y = stats.intAt(i, cv.CC_STAT_TOP);
        const ww = stats.intAt(i, cv.CC_STAT_WIDTH);
        const hh = stats.intAt(i, cv.CC_STAT_HEIGHT);
        const area = stats.intAt(i, cv.CC_STAT_AREA);
        if (area > bestArea) {
          bestArea = area;
          bestRect = new cv.Rect(x, y, ww, hh);
        }
      }
      if (!bestRect || bestArea < w * h * 0.01) return null;
      return bestRect;
    } finally {
      labels.delete(); stats.delete(); centroids.delete();
    }
  } finally {
    mask.delete();
  }
}
