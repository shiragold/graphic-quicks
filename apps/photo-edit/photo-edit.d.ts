// Ambient types for photo-edit.js so TypeScript tests get full type info
// without converting the source module to .ts (which would require a build
// step for the static GitHub Pages deploy).

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

export function sampleBackgroundColor(src: Mat): RGB;
export function detectSkewAngle(src: Mat): number;
export function rotateImage(src: Mat, dst: Mat, angleDeg: number, bgColor: RGB | null): void;
export function detectPhotoBBox(src: Mat, bgColor: RGB | null): Rect | null;
export function processMat(src: Mat): ProcessResult;
