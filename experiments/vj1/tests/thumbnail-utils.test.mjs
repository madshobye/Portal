import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  componentThumbnailSignature,
  fittedThumbnailSize,
  graphicsToPngBlob,
  graphicsToThumbnailBlob,
} from "../js/output/thumbnail-utils.js";
import { OutputThumbnailRuntime } from "../js/output/output-thumbnail-runtime.js";

test("thumbnail utilities own sizing signatures and PNG conversion", async () => {
  assert.deepEqual(fittedThumbnailSize(1920, 1080), { width: 768, height: 432 });
  assert.equal(componentThumbnailSignature({ id: "a", chain: [] }), componentThumbnailSignature({ id: "a", chain: [] }));
  assert.equal(await graphicsToPngBlob({}), null);
  assert.equal(await graphicsToThumbnailBlob({}), null);
  const webp = new Blob(["thumbnail"], { type: "image/webp" });
  assert.equal(await graphicsToThumbnailBlob({ canvas: { toBlob: (resolve) => resolve(webp) } }), webp);
});

test("thumbnail runtime delegates image conversion to thumbnail utilities", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('from "./output-thumbnail-runtime.js?v=runtime-diagnostics-1"'));
  assert.doesNotMatch(rendererSource, /function graphicsToThumbnail\(/);
  assert.doesNotMatch(rendererSource, /function componentThumbnailSignature\(/);
  assert.ok(runtimeSource.includes("graphicsToThumbnailBlob(readback)"));
  assert.ok(runtimeSource.includes("createSharedFramebufferTarget(width, height)"));
});

test("thumbnail invalidation is latest-wins and retains the published image while dirty", () => {
  const component = { id: "component-a", thumbnail: "blob:previous", chain: [{ id: "source", value: 1 }] };
  const state = { components: [component], recordingFrames: [], render: {}, ui: { selectedComponentId: component.id } };
  const runtime = new OutputThumbnailRuntime({
    getState: () => state,
    sendThumbnail: () => true,
  });
  runtime.setInteractionActive(true);
  assert.equal(runtime.invalidateSelectedComponent(), true);
  const firstSignature = runtime.pending.get(component.id).signature;
  component.chain[0].value = 2;
  assert.equal(runtime.invalidateSelectedComponent(), true);

  assert.equal(component.thumbnail, "blob:previous");
  assert.equal(runtime.pending.size, 1);
  assert.notEqual(runtime.pending.get(component.id).signature, firstSignature);
  runtime.dispose();
});
