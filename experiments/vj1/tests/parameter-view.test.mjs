import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  componentParamViews,
  retainedParameterControlEligible,
} from "../js/control/parameter-view.js";
import { parameterUiNodes } from "../js/libraries/ui-engine/parameter-graph.js";
import {
  ButtonNode,
  ColorPickerNode,
  RangeUiNode,
  SelectUiNode,
  SliderUiNode,
  TextInputNode,
  ToggleNode,
} from "../js/libraries/ui-engine/nodes/control-nodes.js";

function controlNode(control) {
  return parameterUiNodes({ id: "parameters", controls: [control] })
    .find((node) => node.id === control.id);
}

test("parameter views tolerate a file-backed node while its definition is pending", () => {
  assert.deepEqual(componentParamViews(null), { primary: [], details: [] });
});

test("parameter projection omits internal seed and render-quality declarations", () => {
  const views = componentParamViews({ params: [
    { id: "seed", type: "number" },
    { id: "renderQuality", type: "number" },
    { id: "gain", type: "number" },
  ] });
  assert.deepEqual(views.primary.map((param) => param.id), ["gain"]);
  assert.equal(retainedParameterControlEligible({ id: "seed", type: "number" }), false);
  assert.equal(retainedParameterControlEligible({ id: "gain", type: "number" }), true);
});

test("parameter declarations map to explicit reusable UI nodes", () => {
  assert.equal(controlNode({ id: "gain", kind: "number", value: 0.5 }).type, SliderUiNode.id);
  assert.equal(controlNode({ id: "enabled", kind: "boolean", value: true }).type, ToggleNode.id);
  assert.equal(controlNode({ id: "mode", kind: "enum", value: "a", options: ["a"] }).type, SelectUiNode.id);
  assert.equal(controlNode({ id: "color", kind: "color", value: "#ffffffff" }).type, ColorPickerNode.id);
  assert.equal(controlNode({ id: "name", kind: "text", value: "Visual" }).type, TextInputNode.id);
  assert.equal(controlNode({ id: "trigger", kind: "event" }).type, ButtonNode.id);
  assert.equal(controlNode({ id: "range", kind: "range", value: { min: 0.2, max: 0.8 } }).type, RangeUiNode.id);
});

test("parameter commands carry authored addresses and reset metadata without DOM attributes", () => {
  const node = controlNode({
    id: "gain",
    label: "Gain",
    kind: "number",
    address: "nodes.groups.0.nodes.1.configuration.params.gain",
    value: 1,
    defaultValue: 0.75,
    action: "project.set-value",
    contextTarget: {
      mode: "state",
      path: "nodes.groups.0.nodes.1.configuration.params.gain",
      defaultValue: 0.75,
    },
  });
  assert.equal(node.stateAddress, "nodes.groups.0.nodes.1.configuration.params.gain");
  assert.equal(node.commands.change.action, "project.set-value");
  assert.deepEqual(node.commands.context.target, {
    mode: "state",
    path: "nodes.groups.0.nodes.1.configuration.params.gain",
    defaultValue: 0.75,
  });
});

test("paired ranges keep one atomic value and one semantic command", () => {
  const node = controlNode({
    id: "hue",
    label: "Hue",
    kind: "range",
    value: { min: 200, max: 260 },
    min: 0,
    max: 360,
    step: 1,
    display: "degrees",
    rangeKind: "hue",
    action: "project.set-range",
  });
  assert.deepEqual(node.inputs.value, { min: 200, max: 260 });
  assert.equal(node.inputs.display, "degrees");
  assert.equal(node.commands.change.action, "project.set-range");
});

test("the VJ parameter projection contains no HTML or DOM presentation APIs", () => {
  const source = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<\w|innerHTML|createElement|querySelector|addEventListener|className|data-/);
});
