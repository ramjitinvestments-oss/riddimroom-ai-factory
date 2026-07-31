/**
 * Minimal, dependency-free PNG handling: enough to (a) validate that a
 * provider's response is really a PNG and read its dimensions, and (b)
 * synthesize a valid, realistic PNG for the dry-run provider. No image
 * library is added for this — PNG's chunk format is simple and stable
 * enough to hand-roll for these two narrow needs.
 */
import { deflateSync } from "node:zlib";
import { ValidationError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Builds a valid, single-color RGBA PNG of the given dimensions. Used by
 * `DryRunImageProvider` to produce a realistic, fully-decodable image
 * without calling any real image generation API.
 */
export function createSolidPng(width: number, height: number, color: RgbaColor): Buffer {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type: truecolor with alpha
  ihdrData.writeUInt8(0, 10); // compression method
  ihdrData.writeUInt8(0, 11); // filter method
  ihdrData.writeUInt8(0, 12); // interlace method

  const row = Buffer.alloc(1 + width * 4); // leading filter-type byte (0 = None) per row
  for (let x = 0; x < width; x++) {
    const offset = 1 + x * 4;
    row.writeUInt8(color.r, offset);
    row.writeUInt8(color.g, offset + 1);
    row.writeUInt8(color.b, offset + 2);
    row.writeUInt8(color.a, offset + 3);
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idatData = deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk("IHDR", ihdrData),
    buildChunk("IDAT", idatData),
    buildChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** PNG IHDR color type values relevant here (see the PNG spec, section 11.2.2). */
const PNG_COLOR_TYPE_GRAYSCALE_ALPHA = 4;
const PNG_COLOR_TYPE_TRUECOLOR_ALPHA = 6;

export interface PngDimensions {
  readonly width: number;
  readonly height: number;
  /** Raw IHDR color type byte; see `hasAlphaChannel`. */
  readonly colorType: number;
}

/**
 * Validates the PNG signature and reads width, height, and color type from
 * the IHDR chunk. Used to validate provider responses before a generation
 * job is marked complete — a response that isn't a real, well-formed PNG
 * is a validation failure, not something to silently pass downstream.
 */
export function readPngDimensions(buffer: Buffer): Result<PngDimensions, ValidationError> {
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return err(new ValidationError(["response is not a valid PNG (missing PNG signature)"]));
  }

  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    return err(new ValidationError(["response is not a valid PNG (missing IHDR chunk)"]));
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    return err(new ValidationError(["response is not a valid PNG (non-positive dimensions)"]));
  }

  return ok({ width, height, colorType: buffer.readUInt8(25) });
}

/** True if a PNG IHDR color type includes an alpha channel (required for print-ready transparency). */
export function hasAlphaChannel(colorType: number): boolean {
  return colorType === PNG_COLOR_TYPE_GRAYSCALE_ALPHA || colorType === PNG_COLOR_TYPE_TRUECOLOR_ALPHA;
}
