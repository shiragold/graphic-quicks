import type { Mat, CV } from '@techstark/opencv-js';
import type { RGB } from './types.js';

// See detect-skew-angle.ts for the `cv` ambient-global convention.
declare const cv: CV;

export function rotateImage(
  src: Mat,
  dst: Mat,
  angleDeg: number,
  bgColor: RGB | null,
): void {
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
