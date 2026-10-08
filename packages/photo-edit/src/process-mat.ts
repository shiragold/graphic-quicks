import type { Mat, CV } from '@techstark/opencv-js';
import { sampleBackgroundColor } from './sample-background-color.js';
import { detectSkewAngle } from './detect-skew-angle.js';
import { rotateImage } from './rotate-image.js';
import { detectPhotoBBox } from './detect-photo-bbox.js';
import type { ProcessResult } from './types.js';

// See detect-skew-angle.ts for the `cv` ambient-global convention.
declare const cv: CV;

// Orchestrator that mirrors process(img) in index.html but returns Mats/Rects
// instead of drawing to canvases. Caller owns `rotated` and must call .delete()
// on it once done.
export function processMat(src: Mat): ProcessResult {
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
