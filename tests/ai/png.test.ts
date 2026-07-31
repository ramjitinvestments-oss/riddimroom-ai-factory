import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { createSolidPng, hasAlphaChannel, readPngDimensions } from "../../automation/ai/png.ts";

test("createSolidPng produces a buffer starting with the PNG signature", () => {
  const png = createSolidPng(4, 4, { r: 1, g: 2, b: 3, a: 255 });
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
});

test("readPngDimensions reads back the exact width/height/colorType createSolidPng was given", () => {
  const png = createSolidPng(64, 96, { r: 10, g: 20, b: 30, a: 255 });
  const result = readPngDimensions(png);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value : null, { width: 64, height: 96, colorType: 6 });
});

test("hasAlphaChannel recognizes the color types that carry an alpha channel", () => {
  assert.equal(hasAlphaChannel(6), true); // truecolor + alpha
  assert.equal(hasAlphaChannel(4), true); // grayscale + alpha
  assert.equal(hasAlphaChannel(2), false); // truecolor, no alpha
  assert.equal(hasAlphaChannel(0), false); // grayscale, no alpha
  assert.equal(hasAlphaChannel(3), false); // palette
});

test("readPngDimensions reports createSolidPng's output as having an alpha channel", () => {
  const png = createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 });
  const result = readPngDimensions(png);
  assert.ok(result.ok && hasAlphaChannel(result.value.colorType));
});

test("createSolidPng's pixel data round-trips through zlib to the requested color", () => {
  const color = { r: 20, g: 120, b: 130, a: 255 };
  const width = 3;
  const height = 2;
  const png = createSolidPng(width, height, color);

  // IDAT is the third chunk: signature(8) + IHDR chunk(4+4+13+4=25) = offset 33.
  const idatLength = png.readUInt32BE(33);
  const idatData = png.subarray(33 + 8, 33 + 8 + idatLength);
  const raw = inflateSync(idatData);

  const rowLength = 1 + width * 4;
  assert.equal(raw.length, rowLength * height);
  for (let row = 0; row < height; row++) {
    const rowStart = row * rowLength;
    assert.equal(raw[rowStart], 0); // filter byte
    for (let x = 0; x < width; x++) {
      const offset = rowStart + 1 + x * 4;
      assert.deepEqual(
        [raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3]],
        [color.r, color.g, color.b, color.a],
      );
    }
  }
});

test("readPngDimensions rejects a buffer with no PNG signature", () => {
  const result = readPngDimensions(Buffer.from("not a png at all, just text"));
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error.message, /PNG signature/);
});

test("readPngDimensions rejects a truncated buffer", () => {
  const png = createSolidPng(8, 8, { r: 1, g: 1, b: 1, a: 255 });
  const result = readPngDimensions(png.subarray(0, 10));
  assert.equal(result.ok, false);
});

test("readPngDimensions rejects a buffer with the right signature but a bogus IHDR", () => {
  const bogus = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(20, 0), // no real IHDR chunk type here
  ]);
  const result = readPngDimensions(bogus);
  assert.equal(result.ok, false);
});
