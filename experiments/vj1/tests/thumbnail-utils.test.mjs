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
  assert.equal(
    componentThumbnailSignature({ id: "a" }, {}, []),
    componentThumbnailSignature({ id: "a" }, {}, []),
  );
  assert.equal(await graphicsToPngBlob({}), null);
  assert.equal(await graphicsToThumbnailBlob({}), null);
  const webp = new Blob(["thumbnail"], { type: "image/webp" });
  assert.equal(await graphicsToThumbnailBlob({ canvas: { toBlob: (resolve) => resolve(webp) } }), webp);
});

test("thumbnail runtime delegates image conversion to thumbnail utilities", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('from "./output-thumbnail-runtime.js"'));
  assert.doesNotMatch(rendererSource, /function graphicsToThumbnail\(/);
  assert.doesNotMatch(rendererSource, /function componentThumbnailSignature\(/);
  assert.ok(runtimeSource.includes("graphicsToThumbnailBlob(readback)"));
  assert.ok(runtimeSource.includes("createSharedFramebufferTarget(width, height)"));
  assert.ok(runtimeSource.includes("this.scheduleTimer?.unref?.()"));
});

test("thumbnail invalidation is latest-wins and retains the published image while dirty", () => {
  const component = { id: "component-a", thumbnail: "blob:previous", chain: [{ id: "source", value: 1 }] };
  const state = { components: [component], frames: [], render: {}, ui: { selectedComponentId: component.id } };
  const runtime = new OutputThumbnailRuntime({
    getState: () => state,
    getComponentProgram: () => ({
      configurationState: () => component.chain,
    }),
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

test("an unavailable media render never replaces the last valid thumbnail", async () => {
  const component = {
    id: "component-media",
    thumbnail: "blob:last-valid",
    chain: [{ id: "media", value: 1 }],
  };
  const state = {
    components: [component],
    frames: [],
    render: {},
    ui: { selectedComponentId: component.id },
  };
  let publications = 0;
  const runtime = new OutputThumbnailRuntime({
    getState: () => state,
    getComponentOutput: () => ({ width: 640, height: 360 }),
    getComponentProgram: () => ({
      configurationState: () => component.chain,
    }),
    isComponentReady: () => false,
    sendThumbnail: () => {
      publications++;
      return true;
    },
  });
  const signature = runtime.componentSignature(component, state.render);

  assert.equal(await runtime.captureJob({
    key: component.id,
    componentId: component.id,
    signature,
    generation: 1,
  }), false);
  assert.equal(publications, 0);
  assert.equal(component.thumbnail, "blob:last-valid");
  runtime.dispose();
});
