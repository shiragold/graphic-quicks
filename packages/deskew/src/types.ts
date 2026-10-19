import type { Mat, Rect } from '@techstark/opencv-js';

export type RGB = [number, number, number];

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ProcessResult {
  theta: number;
  bgColor: RGB;
  rotated: Mat;
  bboxRotated: Rect | null;
  bboxOriginal: Rect | null;
  margins: Margins | null;
}
