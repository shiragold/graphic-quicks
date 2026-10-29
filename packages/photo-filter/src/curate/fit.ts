import sharp from 'sharp';

/** Jev rejects a short side under ~288 px (257 fails, 288 passes) and a long side over 1568. */
export const DECISION_MIN_SIDE = 320;
export const DECISION_MAX_SIDE = 1568;

/** Upscale/pad or downscale a JPEG so every side is within Jev's accepted range. */
export async function fitForDecision(
  jpeg: Buffer,
  { minSide = DECISION_MIN_SIDE, maxSide = DECISION_MAX_SIDE } = {},
): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(jpeg).metadata();
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short >= minSide && long <= maxSide) return jpeg;
  const scale = Math.min(Math.max(1, minSide / short), maxSide / long);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const resized = sharp(jpeg).resize(w, h);
  const padX = Math.max(0, minSide - w);
  const padY = Math.max(0, minSide - h);
  return (padX || padY
    ? resized.extend({
        left: padX >> 1,
        right: padX - (padX >> 1),
        top: padY >> 1,
        bottom: padY - (padY >> 1),
        background: '#000',
      })
    : resized
  )
    .jpeg({ quality: 85 })
    .toBuffer();
}
