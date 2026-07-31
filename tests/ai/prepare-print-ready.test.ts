import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createSolidPng, hasAlphaChannel, readPngDimensions } from "../../automation/ai/png.ts";
import { PRINT_HEIGHT, PRINT_WIDTH, toPrintReadyPng } from "../../automation/ai/prepare-print-ready.ts";

test("toPrintReadyPng produces exactly PRINT_WIDTHxPRINT_HEIGHT with an alpha channel", async () => {
  const source = createSolidPng(1024, 1024, { r: 200, g: 50, b: 50, a: 255 });
  const result = await toPrintReadyPng(source);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.width, PRINT_WIDTH);
  assert.equal(result.value.height, PRINT_HEIGHT);

  const info = readPngDimensions(result.value.buffer);
  assert.ok(info.ok && hasAlphaChannel(info.value.colorType));
});

test("toPrintReadyPng letterboxes a square source instead of stretching it", async () => {
  const color = { r: 10, g: 200, b: 30, a: 255 };
  const source = createSolidPng(500, 500, color);
  const result = await toPrintReadyPng(source);
  assert.ok(result.ok);
  if (!result.ok) {
    return;
  }

  const { data, info } = await sharp(result.value.buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);

  const pixelAt = (x: number, y: number): [number, number, number, number] => {
    const offset = (y * info.width + x) * info.channels;
    return [data[offset] ?? -1, data[offset + 1] ?? -1, data[offset + 2] ?? -1, data[offset + 3] ?? -1];
  };

  // A square source scaled to fit a taller-than-wide canvas matches the
  // canvas width and is centered vertically, leaving transparent padding
  // above and below — so the very top-left corner must be transparent...
  const [, , , cornerAlpha] = pixelAt(0, 0);
  assert.equal(cornerAlpha, 0);

  // ...while the center must be the original artwork color, fully opaque.
  const [r, g, b, centerAlpha] = pixelAt(Math.floor(PRINT_WIDTH / 2), Math.floor(PRINT_HEIGHT / 2));
  assert.deepEqual([r, g, b, centerAlpha], [color.r, color.g, color.b, color.a]);
});

test("toPrintReadyPng reports invalid image data as a ValidationError", async () => {
  const result = await toPrintReadyPng(Buffer.from("this is not an image"));
  assert.equal(result.ok, false);
});
