import { test } from "node:test";
import assert from "node:assert/strict";
import { APPAREL_GALLERY_STANDARD, mapMockupsToGallery } from "../../automation/printify/gallery-standard.ts";

/** Builds a fake Printify mockup URL carrying the given camera_label, matching the real query-string shape. */
function mockupUrl(cameraLabel: string, index: number): string {
  return `https://images.printify.com/mockup/fake-product/${index}.png?camera_label=${cameraLabel}`;
}

test("mapMockupsToGallery maps every available slot in the approved gallery order, position 1 = Hero", () => {
  const mockupUrls = [
    mockupUrl("back", 0),
    mockupUrl("front", 1), // Hero
    mockupUrl("lifestyle", 2), // Lifestyle
    mockupUrl("duo", 3), // Lifestyle Alternate
    mockupUrl("front-2", 4), // Studio Front
    mockupUrl("back-2", 5), // Studio Back
    mockupUrl("folded", 6), // Folded
    mockupUrl("front-collar-closeup", 7), // Close-up
    mockupUrl("back-collar-closeup", 8), // Fabric Detail
    mockupUrl("person-1", 9), // not part of the standard — ignored, not accidentally picked up
  ];

  const result = mapMockupsToGallery(mockupUrls, "Test Tee");

  // "Flat Lay" has no camera_label in this blueprint's mockup set (see gallery-standard.ts) — always unmapped.
  assert.equal(result.images.length, 8);
  assert.equal(result.images[0]!.position, 1);
  assert.equal(result.images[0]!.src, mockupUrl("front", 1));
  assert.match(result.images[0]!.altText, /Test Tee.*front view/);

  const slotsInOrder = result.mappedSlots.map((s) => s.slot);
  assert.deepEqual(slotsInOrder, [
    "Hero",
    "Lifestyle",
    "Lifestyle Alternate",
    "Studio Front",
    "Studio Back",
    "Folded",
    "Close-up",
    "Fabric Detail",
  ]);

  // Positions are contiguous 1..8, in the same order as mappedSlots — this is what makes Shopify's
  // featured image (always position 1) the Hero shot, fixing every surface that reads it in one call.
  assert.deepEqual(
    result.images.map((i) => i.position),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );

  assert.deepEqual(result.unmappedSlots, ["Flat Lay"]);
});

test("mapMockupsToGallery reports a slot unmapped, not mislabeled, when its camera_label is missing from this batch", () => {
  // Only Hero and Studio Front are present — everything else, including Lifestyle, must be honestly
  // reported as unmapped rather than silently backfilled with the wrong photo.
  const mockupUrls = [mockupUrl("front", 0), mockupUrl("front-2", 1)];

  const result = mapMockupsToGallery(mockupUrls, "Test Tee");

  assert.equal(result.images.length, 2);
  assert.deepEqual(
    result.mappedSlots.map((s) => s.slot),
    ["Hero", "Studio Front"],
  );
  assert.ok(result.unmappedSlots.includes("Flat Lay"));
  assert.ok(result.unmappedSlots.some((s) => s.startsWith("Lifestyle (expected camera_label=\"lifestyle\"")));
});

test("mapMockupsToGallery returns no images when given an empty mockup list — never fabricates a gallery", () => {
  const result = mapMockupsToGallery([], "Test Tee");

  assert.deepEqual(result.images, []);
  assert.deepEqual(result.mappedSlots, []);
  // Every slot with a real camera_label is reported unmapped; "Flat Lay" (cameraLabel: null) always is too.
  assert.equal(result.unmappedSlots.length, APPAREL_GALLERY_STANDARD.length);
});

test("mapMockupsToGallery ignores a malformed mockup URL instead of throwing", () => {
  const mockupUrls = ["not a url at all", mockupUrl("front", 0)];

  const result = mapMockupsToGallery(mockupUrls, "Test Tee");

  assert.equal(result.images.length, 1);
  assert.equal(result.images[0]!.src, mockupUrl("front", 0));
});
