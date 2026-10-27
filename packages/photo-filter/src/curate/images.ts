import sharp from 'sharp';

export interface SheetItem {
  path: string;
  label: string;
}

export interface SheetOptions {
  cols: number;
  cell: number;
}

/** Image operations the curation pipeline needs; injectable so tests need no real files. */
export interface ImageTools {
  /** JPEG whose long edge is at most `size` px, EXIF-rotated. */
  thumbnail(path: string, size: number): Promise<Buffer>;
  /** 64-bit difference hash of an image file or encoded buffer, for near-duplicate detection. */
  dhash(input: string | Buffer): Promise<bigint>;
  /** JPEG grid of square cells, each stamped with its label in the top-left corner. */
  contactSheet(items: SheetItem[], opts: SheetOptions): Promise<Buffer>;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function labelSvg(label: string, cell: number): Buffer {
  const font = Math.max(12, Math.round(cell / 9));
  const width = Math.min(cell, Math.round(font * 0.62 * label.length + font));
  const height = Math.round(font * 1.5);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="#000" fill-opacity="0.75"/>` +
      `<text x="${font / 2}" y="${font * 1.1}" font-family="Helvetica, Arial, sans-serif" font-size="${font}" font-weight="bold" fill="#fff">${escapeXml(label)}</text>` +
      `</svg>`,
  );
}

export const sharpImageTools: ImageTools = {
  thumbnail: (path, size) =>
    sharp(path).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),

  async dhash(input) {
    const px = await sharp(input).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let hash = 0n;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        hash = (hash << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
      }
    }
    return hash;
  },

  async contactSheet(items, { cols, cell }) {
    const rows = Math.ceil(items.length / cols);
    const tiles = await Promise.all(
      items.map(async (item, i) => {
        const tile = await sharp(item.path)
          .rotate()
          .resize(cell, cell, { fit: 'contain', background: '#222' })
          .composite([{ input: labelSvg(item.label, cell), top: 0, left: 0 }])
          .toBuffer();
        return { input: tile, left: (i % cols) * cell, top: Math.floor(i / cols) * cell };
      }),
    );
    return sharp({
      create: { width: cols * cell, height: Math.max(rows, 1) * cell, channels: 3, background: '#222' },
    })
      .composite(tiles)
      .jpeg({ quality: 80 })
      .toBuffer();
  },
};
