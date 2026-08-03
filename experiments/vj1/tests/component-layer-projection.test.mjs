import assert from "node:assert/strict";
import test from "node:test";

import {
  componentLayerProjection,
  selectedComponentLayer,
} from "../js/domain/component-layer-projection.js";
import { COMPONENT_PROGRAM_GENERATOR } from "../js/libraries/composition-engine/shared/component-program-compiler.js";

test("layer editor order and nesting are projected from the Component graph", () => {
  const source = { id: "source", kind: "source", source: { type: "black" } };
  const effect = { id: "effect", kind: "effect", componentId: "blur" };
  const component = { id: "component-a", chain: [source, effect] };
  const state = {
    components: [component],
    nodes: {
      groups: [{
        componentId: component.id,
        generatedBy: COMPONENT_PROGRAM_GENERATOR,
        nodes: [
          { id: effect.id, role: "effect", configuration: effect },
          { id: "generated-control", role: "control" },
          { id: source.id, role: "source", configuration: source },
        ],
      }],
    },
  };

  const layers = componentLayerProjection(state, component);
  assert.deepEqual(layers.map((layer) => layer.nodeId), [effect.id, source.id]);
  assert.equal(layers[0].item, effect);
  assert.equal(layers[0].path, "nodes.groups.0.nodes.0.configuration");
  assert.equal(selectedComponentLayer(state, component, source.id).nodeId, source.id);
});
