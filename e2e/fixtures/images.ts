// Tiny deterministic image encoders for fixture bytes. Images are made of flat 16×16 tiles, which
// keeps the JPEG encoder to DC coefficients only (every AC coefficient is zero) and the output
// small, while still giving decoders, video encoders and SSIM real pictures with edges and motion.

import { zlibSync } from 'fflate';

export type Rgb = readonly [number, number, number];
/** Color of the 16×16 tile at tile column `tx`, tile row `ty`. */
export type TileColor = (tx: number, ty: number) => Rgb;

export const TILE = 16;

class ByteWriter {
  readonly #bytes: number[] = [];

  u8(value: number): void {
    this.#bytes.push(value & 0xff);
  }

  u16(value: number): void {
    this.u8(value >> 8);
    this.u8(value);
  }

  u32(value: number): void {
    this.u16(value >>> 16);
    this.u16(value);
  }

  bytes(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.u8(values[i] ?? 0);
  }

  toArray(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

// ── PNG (8-bit RGB, filter 0, zlib via fflate so the bytes are identical on every platform) ──

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(out: ByteWriter, type: string, data: Uint8Array): void {
  const typed = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) typed[i] = type.charCodeAt(i);
  typed.set(data, 4);
  out.u32(data.length);
  out.bytes(typed);
  out.u32(crc32(typed));
}

export function encodePng(width: number, height: number, color: TileColor): Uint8Array {
  const stride = 1 + width * 3;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = color(Math.floor(x / TILE), Math.floor(y / TILE));
      raw.set([r, g, b], y * stride + 1 + x * 3);
    }
  }
  const header = new ByteWriter();
  header.u32(width);
  header.u32(height);
  header.bytes([8, 2, 0, 0, 0]); // bit depth 8, color type RGB, deflate, filter 0, no interlace

  const out = new ByteWriter();
  out.bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  pngChunk(out, 'IHDR', header.toArray());
  pngChunk(out, 'IDAT', zlibSync(raw, { level: 9 }));
  pngChunk(out, 'IEND', new Uint8Array(0));
  return out.toArray();
}

// ── JPEG (baseline, YCbCr 4:2:0, one MCU per tile) ──

/** Standard luminance DC table (ITU T.81 Annex K.3): code counts per length 1..16, then symbols. */
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** Every block is flat, so the AC table holds only EOB (0x00) as the 1-bit code `0`, as libjpeg's optimizer would emit. */
const AC_BITS = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const AC_VALUES = [0];
/** With every quantizer at 8, a flat block's quantized DC equals its level-shifted sample exactly. */
const QUANT = 8;

interface HuffCode {
  code: number;
  length: number;
}

function canonicalCodes(bits: readonly number[], values: readonly number[]): Map<number, HuffCode> {
  const codes = new Map<number, HuffCode>();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < (bits[length - 1] ?? 0); i++) {
      codes.set(values[k++] ?? 0, { code: code++, length });
    }
    code <<= 1;
  }
  return codes;
}

const DC_CODES = canonicalCodes(DC_BITS, DC_VALUES);
const EOB = canonicalCodes(AC_BITS, AC_VALUES).get(0) ?? { code: 0, length: 1 };

class BitWriter {
  readonly bytes: number[] = [];
  #acc = 0;
  #count = 0;

  write(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.#acc = (this.#acc << 1) | ((value >> i) & 1);
      if (++this.#count === 8) this.#emit();
    }
  }

  flush(): void {
    while (this.#count !== 0) this.write(1, 1);
  }

  #emit(): void {
    this.bytes.push(this.#acc);
    if (this.#acc === 0xff) this.bytes.push(0x00); // byte stuffing
    this.#acc = 0;
    this.#count = 0;
  }
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function toYCbCr([r, g, b]: Rgb): [number, number, number] {
  return [
    clampByte(0.299 * r + 0.587 * g + 0.114 * b),
    clampByte(128 - 0.168736 * r - 0.331264 * g + 0.5 * b),
    clampByte(128 + 0.5 * r - 0.418688 * g - 0.081312 * b),
  ];
}

function writeFlatBlock(bits: BitWriter, diff: number): void {
  const magnitude = Math.abs(diff);
  const category = magnitude === 0 ? 0 : Math.floor(Math.log2(magnitude)) + 1;
  const dc = DC_CODES.get(category);
  if (!dc) throw new Error(`DC difference ${diff} out of range`);
  bits.write(dc.code, dc.length);
  if (category > 0) bits.write(diff > 0 ? diff : diff - 1 + (1 << category), category);
  bits.write(EOB.code, EOB.length);
}

export function encodeJpeg(width: number, height: number, color: TileColor): Uint8Array {
  const out = new ByteWriter();
  out.u16(0xffd8); // SOI
  out.u16(0xffe0); // APP0 JFIF 1.1, no density units
  out.u16(16);
  out.bytes([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0]);
  out.u16(1);
  out.u16(1);
  out.bytes([0, 0]);
  out.u16(0xffdb); // DQT: table 0, 8-bit
  out.u16(67);
  out.u8(0);
  out.bytes(new Array<number>(64).fill(QUANT));
  out.u16(0xffc0); // SOF0: 3 components, Y sampled 2×2, Cb and Cr 1×1, all on quant table 0
  out.u16(17);
  out.u8(8);
  out.u16(height);
  out.u16(width);
  out.bytes([3, 1, 0x22, 0, 2, 0x11, 0, 3, 0x11, 0]);
  out.u16(0xffc4); // DHT: DC table 0
  out.u16(3 + 16 + DC_VALUES.length);
  out.u8(0x00);
  out.bytes(DC_BITS);
  out.bytes(DC_VALUES);
  out.u16(0xffc4); // DHT: AC table 0
  out.u16(3 + 16 + AC_VALUES.length);
  out.u8(0x10);
  out.bytes(AC_BITS);
  out.bytes(AC_VALUES);
  out.u16(0xffda); // SOS: all components on DC/AC table 0, full spectral range
  out.u16(12);
  out.bytes([3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]);

  const bits = new BitWriter();
  const predictor = [0, 0, 0];
  const tilesX = Math.ceil(width / TILE);
  const tilesY = Math.ceil(height / TILE);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const levels = toYCbCr(color(tx, ty)).map((v) => v - 128);
      // One MCU: four Y blocks, then Cb, then Cr. DC is coded as the difference from the previous block of the component.
      for (const component of [0, 0, 0, 0, 1, 2]) {
        const level = levels[component] ?? 0;
        writeFlatBlock(bits, level - (predictor[component] ?? 0));
        predictor[component] = level;
      }
    }
  }
  bits.flush();
  out.bytes(bits.bytes);
  out.u16(0xffd9); // EOI
  return out.toArray();
}
