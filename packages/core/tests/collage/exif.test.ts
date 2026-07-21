import { describe, expect, it } from 'vitest';
import { readExifDate } from '../../src/collage/index.js';

/**
 * Build a minimal, valid JPEG that carries a single APP1/EXIF segment with
 * a `DateTimeOriginal` (0x9003) ASCII tag containing `dateStr`. Uses
 * little-endian TIFF byte order.
 *
 * Layout (offsets in bytes):
 *   0-1     SOI                                    (0xFFD8, BE)
 *   2-3     APP1 marker                            (0xFFE1, BE)
 *   4-5     APP1 size (payload + this field)       (BE)
 *   6-11    "Exif\0\0"
 *   12+     TIFF header + IFD0 + Exif SubIFD + data
 *
 *   TIFF (little-endian):
 *     +0  0x4949                                   (byte order)
 *     +2  0x002A                                   (magic)
 *     +4  IFD0 offset = 8
 *     +8  IFD0: 1 entry
 *          tag=0x8769 (ExifOffset), type=LONG, count=1, value=SubIFD offset=26
 *     +22 next IFD = 0
 *     +26 Exif SubIFD: 1 entry
 *          tag=0x9003 (DateTimeOriginal), type=ASCII, count=20, offset=44
 *     +40 next IFD = 0
 *     +44 date string "YYYY:MM:DD HH:MM:SS\0"     (20 bytes)
 */
function buildMinimalExifJpeg(dateStr: string): Uint8Array {
  if (!/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    throw new Error(`dateStr must be YYYY:MM:DD HH:MM:SS, got ${dateStr}`);
  }
  const bytes = new Uint8Array(76);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0xffd8); // SOI
  view.setUint16(2, 0xffe1); // APP1 marker
  view.setUint16(4, 72); // APP1 size (BE)

  // "Exif\0\0"
  bytes[6] = 0x45;
  bytes[7] = 0x78;
  bytes[8] = 0x69;
  bytes[9] = 0x66;
  bytes[10] = 0x00;
  bytes[11] = 0x00;

  // TIFF header: little-endian
  bytes[12] = 0x49;
  bytes[13] = 0x49;
  view.setUint16(14, 0x002a, true);
  view.setUint32(16, 8, true);

  // IFD0 at TIFF+8 = byte 20
  view.setUint16(20, 1, true); // 1 entry
  // Entry: ExifOffset (0x8769)
  view.setUint16(22, 0x8769, true);
  view.setUint16(24, 4, true); // type LONG
  view.setUint32(26, 1, true); // count
  view.setUint32(30, 26, true); // value = SubIFD offset from TIFF = 26
  view.setUint32(34, 0, true); // next IFD

  // Exif SubIFD at TIFF+26 = byte 38
  view.setUint16(38, 1, true); // 1 entry
  // Entry: DateTimeOriginal
  view.setUint16(40, 0x9003, true);
  view.setUint16(42, 2, true); // ASCII
  view.setUint32(44, 20, true); // count (19 chars + null)
  view.setUint32(48, 44, true); // offset to string from TIFF = 44
  view.setUint32(52, 0, true); // next IFD

  // Date string at TIFF+44 = byte 56 (20 bytes incl. trailing null)
  const s = `${dateStr}\0`;
  for (let i = 0; i < 20; i++) bytes[56 + i] = s.charCodeAt(i);

  return bytes;
}

describe('readExifDate', () => {
  it('parses DateTimeOriginal from a minimal EXIF JPEG', () => {
    const bytes = buildMinimalExifJpeg('2024:01:15 10:30:45');
    const d = readExifDate(bytes);
    expect(d).not.toBeNull();
    // Constructor: new Date(2024, 0, 15, 10, 30, 45) — Jan is month 0.
    expect(d?.getFullYear()).toBe(2024);
    expect(d?.getMonth()).toBe(0);
    expect(d?.getDate()).toBe(15);
    expect(d?.getHours()).toBe(10);
    expect(d?.getMinutes()).toBe(30);
    expect(d?.getSeconds()).toBe(45);
  });

  it('returns null for a buffer that isn\'t a JPEG (no SOI)', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(readExifDate(bytes)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    // getUint16 on a 0- or 1-byte buffer throws -- the parser catches it.
    expect(readExifDate(new Uint8Array(0))).toBeNull();
    expect(readExifDate(new Uint8Array(1))).toBeNull();
  });

  it('returns null when APP1 exists but has no EXIF header', () => {
    // JPEG with SOI + APP1 whose first 4 bytes aren't "Exif".
    const bytes = new Uint8Array(20);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0xffd8);
    view.setUint16(2, 0xffe1);
    view.setUint16(4, 16);
    bytes[6] = 0x4a; // "J"
    bytes[7] = 0x46; // "F"
    bytes[8] = 0x49; // "I"
    bytes[9] = 0x46; // "F"
    expect(readExifDate(bytes)).toBeNull();
  });

  it('honors the Uint8Array byteOffset (subarray view)', () => {
    const full = buildMinimalExifJpeg('2024:01:15 10:30:45');
    const backing = new Uint8Array(full.length + 32);
    backing.set(full, 32);
    const view = backing.subarray(32);
    const d = readExifDate(view);
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2024);
  });
});
