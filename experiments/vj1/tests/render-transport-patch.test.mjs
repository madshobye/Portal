import test from "node:test";
import assert from "node:assert/strict";
import {
  componentRenderPatchesForChange,
  outputRenderPatchesForChange,
} from "../js/domain/render-transport-patch.js";

test("Component project paths become stable-id render patches", () => {
  const state = {
    components: [{ id: "component-a", chain: [{ params: { amount: 0.75 } }] }],
  };
  assert.deepEqual(componentRenderPatchesForChange(state, {
    topic: "components.0.chain.0.params.amount",
  }), [{
    componentId: "component-a",
    path: "chain.0.params.amount",
    value: 0.75,
  }]);
});

test("non-render and non-Component changes do not become render patches", () => {
  const state = { components: [{ id: "component-a", thumbnail: "blob:test", activity: {} }] };
  assert.deepEqual(componentRenderPatchesForChange(state, { topic: "components.0.thumbnail" }), []);
  assert.deepEqual(componentRenderPatchesForChange(state, { topic: "render.maxFrameRate" }), []);
});

test("Output transport never substitutes an editor-preview projection", () => {
  const previewPatches = [{ target: "state", path: "surfaces", value: [{ componentId: "editor-scene" }] }];
  const outputPatches = [{ target: "state", path: "surfaces", value: [{ componentId: "live-component" }] }];

  assert.strictEqual(outputRenderPatchesForChange({}, {
    renderPatches: previewPatches,
    outputRenderPatches: outputPatches,
  }), outputPatches);
  assert.deepEqual(
    outputRenderPatchesForChange({}, {
      renderPatches: previewPatches,
      outputRenderPatches: [],
    }),
    [],
    "an explicit empty Output projection must suppress editor-only patches",
  );
  assert.strictEqual(
    outputRenderPatchesForChange({}, { renderPatches: previewPatches }),
    previewPatches,
    "ordinary shared projections remain backward compatible",
  );
});
