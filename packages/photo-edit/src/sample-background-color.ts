import type { Mat } from '@techstark/opencv-js';
import type { RGB } from './types.js';

export function sampleBackgroundColor(src: Mat): RGB {
  const w = src.cols, h = src.rows;
  const s = Math.min(5, w, h);
  const samples: RGB[] = [];
  const corners: Array<[number, number]> = [
    [0, 0],
    [w - s, 0],
    [0, h - s],
    [w - s, h - s],
  ];
  for (const [cx, cy] of corners) {
    for (let yy = 0; yy < s; yy++) {
      for (let xx = 0; xx < s; xx++) {
        const off = ((cy + yy) * w + (cx + xx)) * 4;
        if (src.data[off + 3] === 0) continue;
        samples.push([src.data[off], src.data[off + 1], src.data[off + 2]]);
      }
    }
  }
  if (samples.length === 0) return [255, 255, 255];
  return [0, 1, 2].map((c) => {
    const arr = samples.map((sample) => sample[c as 0 | 1 | 2]).sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  }) as RGB;
}
