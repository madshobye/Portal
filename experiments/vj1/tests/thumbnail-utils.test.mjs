import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { componentThumbnailSignature, fittedThumbnailSize, graphicsToPngBlob } from "../js/output/thumbnail-utils.js";

test("thumbnail utilities own sizing signatures and PNG conversion", async () => {
  assert.deepEqual(fittedThumbnailSize(1920, 1080), { width: 768, height: 432 });
  assert.equal(componentThumbnailSignature({ id: "a", chain: [] }), componentThumbnailSignature({ id: "a", chain: [] }));
  assert.equal(await graphicsToPngBlob({}), null);
});

test("thumbnail runtime delegates image conversion to thumbnail utilities", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('from "./output-thumbnail-runtime.js?v=output-assets-runtime-extraction-1"'));
  assert.doesNotMatch(rendererSource, /function graphicsToThumbnail\(/);
  assert.doesNotMatch(rendererSource, /function componentThumbnailSignature\(/);
  assert.ok(runtimeSource.includes("graphicsToThumbnail(thumbnailSource"));
});
