import test from "node:test";
import assert from "node:assert/strict";

import {
  boundedProfileValue,
  captureControlLiveProfileDiagnostic,
} from "../js/control/live-profile-diagnostics.js";

test("control event diagnostics omit projected graphs and bound large values", () => {
  const state = {
    ui: {
      workspace: "live",
      live: {
        selectedComponentId: "fire",
        parameterDiffs: { fire: { fire: { source: { code: "x".repeat(20000) } } } },
        transitionCoordinator: {},
      },
    },
  };
  const event = captureControlLiveProfileDiagnostic(state, {
    components: [{ id: "fire", chain: [{ code: "unreachable".repeat(20000) }] }],
  }, {
    kind: "event",
    reason: "scrub:live",
    change: {
      livePatches: [{ componentId: "fire", path: "chain.0.source.params.geometryDetail", value: 0.75 }],
    },
  });

  assert.equal(event.projection, undefined);
  assert.match(event.parameterDiffBank.values.fire.source.code, /\[truncated/);
  assert.ok(event.parameterDiffBank.values.fire.source.code.length < 8300);
  assert.equal(event.event.livePatches[0].path, "chain.0.source.params.geometryDetail");
});

test("control sample diagnostics prioritize the selected target and omit executable graph source", () => {
  const selected = {
    id: "selected",
    name: "Selected STL",
    chain: [{
      id: "stl",
      kind: "source",
      source: { generatorId: "modelMedia", params: { geometryDetail: 0.5 }, code: "x".repeat(20000) },
    }],
  };
  const state = {
    ui: { live: { selectedComponentId: "selected", parameterDiffs: { selected: {} } } },
  };
  const components = Array.from({ length: 30 }, (_, index) => ({ id: `other-${index}`, chain: [] }));
  components.push(selected);

  const diagnostic = captureControlLiveProfileDiagnostic(state, { components, surfaces: [] }, { kind: "sample" });

  assert.equal(diagnostic.projection.components[0].id, "selected");
  assert.equal(diagnostic.projection.components[0].chain[0].source.params.geometryDetail, 0.5);
  assert.equal(Object.hasOwn(diagnostic.projection.components[0].chain[0].source, "code"), false);
  assert.equal(Object.hasOwn(diagnostic.projection, "nodeGroups"), false);
});

test("the final download serializer bounds arrays, strings, depth, and cycles", () => {
  const cyclic = { large: "x".repeat(20000), values: Array.from({ length: 200 }, (_, index) => index) };
  cyclic.self = cyclic;
  const bounded = boundedProfileValue(cyclic);
  const json = JSON.stringify(bounded);
  assert.match(bounded.large, /\[truncated/);
  assert.equal(bounded.values.length, 129);
  assert.equal(bounded.self, "[circular]");
  assert.ok(json.length < 12000);
});
