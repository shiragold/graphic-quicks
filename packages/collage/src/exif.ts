/**
 * Extract a `Date` from JPEG EXIF metadata.
 *
 * Reads `DateTimeOriginal` (tag 0x9003) — falling back to
 * `DateTimeDigitized` (tag 0x9004) — from the EXIF SubIFD of a JPEG's
 * APP1 segment. The caller should pass a preloaded JPEG head; ~256 KiB
 * is more than enough since APP1 always sits near the start of the file.
 *
 * Returns `null` (never throws) if:
 *   - the input isn't a JPEG (no SOI marker),
 *   - there's no APP1 EXIF segment,
 *   - IFD0 has no `ExifOffset` (0x8769) pointer,
 *   - neither date tag is present,
 *   - or the date string doesn't match `YYYY:MM:DD HH:MM:SS`.
 */
export function readExifDate(bytes: Uint8Array): Date | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    const len = view.byteLength;
    while (offset < len) {
      if (view.getUint8(offset) !== 0xff) return null;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2);
      if (marker === 0xe1) {
        // APP1 -- check Exif header
        if (view.getUint32(offset + 4) !== 0x45786966) return null; // "Exif"
        const tiffStart = offset + 10;
        const little = view.getUint16(tiffStart) === 0x4949;
        const get16 = (o: number): number =>
          little ? view.getUint16(o, true) : view.getUint16(o, false);
        const get32 = (o: number): number =>
          little ? view.getUint32(o, true) : view.getUint32(o, false);
        if (get16(tiffStart + 2) !== 0x002a) return null;
        const ifd0 = tiffStart + get32(tiffStart + 4);
        const numEntries = get16(ifd0);
        let exifIfdOffset: number | null = null;
        for (let i = 0; i < numEntries; i++) {
          const e = ifd0 + 2 + i * 12;
          const tag = get16(e);
          if (tag === 0x8769) {
            // ExifOffset
            exifIfdOffset = tiffStart + get32(e + 8);
            break;
          }
        }
        if (!exifIfdOffset) return null;
        const subEntries = get16(exifIfdOffset);
        for (let i = 0; i < subEntries; i++) {
          const e = exifIfdOffset + 2 + i * 12;
          const tag = get16(e);
          // 0x9003 DateTimeOriginal, 0x9004 DateTimeDigitized, 0x0132 DateTime
          if (tag === 0x9003 || tag === 0x9004) {
            const count = get32(e + 4);
            const valOffset = tiffStart + get32(e + 8);
            let str = '';
            for (let j = 0; j < count - 1; j++) {
              str += String.fromCharCode(view.getUint8(valOffset + j));
            }
            // Format: "YYYY:MM:DD HH:MM:SS"
            const m = str.match(
              /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
            );
            if (m) {
              return new Date(
                +m[1],
                +m[2] - 1,
                +m[3],
                +m[4],
                +m[5],
                +m[6],
              );
            }
          }
        }
        return null;
      } else {
        offset += 2 + size;
      }
    }
  } catch {
    return null;
  }
  return null;
}
