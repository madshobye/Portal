import test from "node:test";
import assert from "node:assert/strict";
import { componentRenderPatchesForChange } from "../js/domain/render-transport-patch.js";

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
