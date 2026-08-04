import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildArcPath,
  buildCurvedTextElements,
  buildTextSvg,
  escapeXml,
  pointOnCircle,
} from "../../../automation/ai/typography/svg-text.ts";

test("escapeXml escapes all five XML-significant characters", () => {
  assert.equal(escapeXml(`&<>"'`), "&amp;&lt;&gt;&quot;&apos;");
});

test("escapeXml leaves ordinary text untouched", () => {
  assert.equal(escapeXml("RIDDIMROOM 2026"), "RIDDIMROOM 2026");
});

test("pointOnCircle: -90deg is straight up from center", () => {
  const p = pointOnCircle(100, 100, 50, -90);
  assert.ok(Math.abs(p.x - 100) < 1e-9);
  assert.ok(Math.abs(p.y - 50) < 1e-9);
});

test("pointOnCircle: 0deg is directly right of center", () => {
  const p = pointOnCircle(100, 100, 50, 0);
  assert.ok(Math.abs(p.x - 150) < 1e-9);
  assert.ok(Math.abs(p.y - 100) < 1e-9);
});

test("pointOnCircle: 90deg is straight down from center", () => {
  const p = pointOnCircle(100, 100, 50, 90);
  assert.ok(Math.abs(p.x - 100) < 1e-9);
  assert.ok(Math.abs(p.y - 150) < 1e-9);
});

test("buildArcPath: endpoints match pointOnCircle at the sweep's start/end angles", () => {
  const arc = buildArcPath(100, 100, 50, 90, "test-arc");
  const start = pointOnCircle(100, 100, 50, -135); // -90 - 90/2
  const end = pointOnCircle(100, 100, 50, -45); // -90 + 90/2
  assert.match(arc.d, new RegExp(`^M ${start.x} ${start.y} A 50 50 0 0 1 ${end.x} ${end.y}$`));
});

test("buildArcPath: sets the large-arc-flag when sweep exceeds 180 degrees", () => {
  const small = buildArcPath(0, 0, 10, 170, "a");
  const large = buildArcPath(0, 0, 10, 200, "b");
  assert.match(small.d, /A 10 10 0 0 1/);
  assert.match(large.d, /A 10 10 0 1 1/);
});

test("buildCurvedTextElements: empty text produces nothing", () => {
  assert.equal(buildCurvedTextElements("", 0, 0, 100, 90, []), "");
});

test("buildCurvedTextElements: a single character sits upright at the top of the arc (0deg rotation)", () => {
  const markup = buildCurvedTextElements("A", 100, 100, 50, 90, ['fill="#000"']);
  const top = pointOnCircle(100, 100, 50, -90);
  assert.match(markup, new RegExp(`x="${top.x}" y="${top.y}" text-anchor="middle" transform="rotate\\(0 ${top.x} ${top.y}\\)"`));
  assert.match(markup, />A</);
});

test("buildCurvedTextElements: produces one <text> element per character", () => {
  const markup = buildCurvedTextElements("ABC", 0, 0, 100, 90, []);
  const matches = markup.match(/<text /g);
  assert.equal(matches?.length, 3);
});

test("buildTextSvg: straight text includes escaped content and requested position", () => {
  const svg = buildTextSvg({
    text: "Rum & Riddim",
    canvasWidthPx: 500,
    canvasHeightPx: 200,
    xPx: 250,
    yPx: 100,
    fontSizePx: 60,
  });
  assert.match(svg, /<text x="250" y="100" text-anchor="middle"/);
  assert.match(svg, /Rum &amp; Riddim/);
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="500" height="200">/);
});

test("buildTextSvg: an outline adds stroke attributes", () => {
  const svg = buildTextSvg({
    text: "X",
    canvasWidthPx: 100,
    canvasHeightPx: 100,
    xPx: 50,
    yPx: 50,
    fontSizePx: 40,
    outline: { color: "#ff0000", widthPx: 3 },
  });
  assert.match(svg, /stroke="#ff0000"/);
  assert.match(svg, /stroke-width="3"/);
});

test("buildTextSvg: a shadow adds a filter definition and references it", () => {
  const svg = buildTextSvg({
    text: "X",
    canvasWidthPx: 100,
    canvasHeightPx: 100,
    xPx: 50,
    yPx: 50,
    fontSizePx: 40,
    shadow: { color: "#000000", offsetXPx: 2, offsetYPx: 2, blurPx: 1 },
  });
  assert.match(svg, /<defs><filter id="text-shadow"/);
  assert.match(svg, /filter="url\(#text-shadow\)"/);
});

test("buildTextSvg: curved text wraps per-character elements in a group instead of using <text> at xPx/yPx directly", () => {
  const svg = buildTextSvg({
    text: "AB",
    canvasWidthPx: 500,
    canvasHeightPx: 500,
    xPx: 250,
    yPx: 250,
    fontSizePx: 40,
    curve: { radiusPx: 100, sweepDeg: 60 },
  });
  assert.match(svg, /<g>/);
  const matches = svg.match(/<text /g);
  assert.equal(matches?.length, 2);
});
