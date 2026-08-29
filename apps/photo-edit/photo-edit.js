// Pure OpenCV.js helpers extracted from index.html.
// Functions reference the `cv` global, which is set by:
//   - opencv.js (CDN) in the browser, once Module.onRuntimeInitialized fires.
//   - tests/setup.ts in Node, once @techstark/opencv-js WASM init completes.

export function sampleBackgroundColor(src) {
  const w = src.cols, h = src.rows;
  const s = Math.min(5, w, h);
  const samples = [];
  const corners = [
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
    const arr = samples.map((sample) => sample[c]).sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  });
}

export function detectSkewAngle(src) {
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

    const bins = new Array(90).fill(0);
    const weights = new Array(90).fill(0);
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

export function rotateImage(src, dst, angleDeg, bgColor) {
  const w = src.cols, h = src.rows;
  const center = new cv.Point(w / 2, h / 2);
  const M = cv.getRotationMatrix2D(center, angleDeg, 1);
  const rad = (Math.abs(angleDeg) * Math.PI) / 180;
  const newW = Math.ceil(w * Math.cos(rad) + h * Math.sin(rad));
  const newH = Math.ceil(w * Math.sin(rad) + h * Math.cos(rad));
  M.data64F[2] += (newW - w) / 2;
  M.data64F[5] += (newH - h) / 2;
  const fill = bgColor
    ? new cv.Scalar(bgColor[0], bgColor[1], bgColor[2], 255)
    : new cv.Scalar(255, 255, 255, 255);
  cv.warpAffine(
    src, dst, M, new cv.Size(newW, newH),
    cv.INTER_LINEAR, cv.BORDER_CONSTANT, fill,
  );
  M.delete();
}

export function detectPhotoBBox(src, bgColor) {
  const w = src.cols, h = src.rows;
  if (w === 0 || h === 0) return null;
  const med = bgColor || sampleBackgroundColor(src);

  const threshold = 35;

  const mask = new cv.Mat.zeros(h, w, cv.CV_8UC1);
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
      let bestArea = 0, bestRect = null;
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

// Orchestrator that mirrors process(img) in index.html but returns Mats/Rects
// instead of drawing to canvases. Caller owns `rotated` and must call .delete()
// on it once done.
export function processMat(src) {
  const bgColor = sampleBackgroundColor(src);
  const theta = detectSkewAngle(src);
  const rotated = new cv.Mat();
  rotateImage(src, rotated, theta, bgColor);
  const bboxRotated = detectPhotoBBox(rotated, bgColor);
  const bboxOriginal = detectPhotoBBox(src, bgColor);
  const margins = bboxRotated
    ? {
        top: bboxRotated.y,
        left: bboxRotated.x,
        right: rotated.cols - (bboxRotated.x + bboxRotated.width),
        bottom: rotated.rows - (bboxRotated.y + bboxRotated.height),
      }
    : null;
  return { theta, bgColor, rotated, bboxRotated, bboxOriginal, margins };
}
