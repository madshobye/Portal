import test from "node:test";
import assert from "node:assert/strict";

import { createChangeEvent } from "../js/domain/change-event.js";

test("structural component changes are identified separately from control gestures", () => {
  assert.equal(createChangeEvent("add-component").structural, true);
  assert.equal(createChangeEvent("add-chain-source").structural, true);
  assert.equal(createChangeEvent("remove-chain-item").structural, true);
  assert.equal(createChangeEvent("select-component").structural, true);
  assert.equal(createChangeEvent("select-chain-item").structural, true);
  assert.equal(createChangeEvent("select-surface").structural, true);
  assert.equal(createChangeEvent("select-scene").structural, true);
  assert.equal(createChangeEvent("select-live-component").structural, true);
  assert.equal(!!createChangeEvent("update:components.0.opacity").structural, false);
  assert.equal(!!createChangeEvent("scrub:chain-transform").structural, false);
});

test("change events centralize legacy reason phases and topics", () => {
  assert.deepEqual(createChangeEvent("scrub:mapping-state"), {
    reason: "scrub:mapping-state",
    phase: "scrub",
    topic: "mapping-state",
    scope: "project",
    history: "none",
    projectRestore: false,
  });
  assert.equal(createChangeEvent("color:components.0.chain.0.params.tint").phase, "color");
  assert.equal(createChangeEvent("live:update").scope, "live");
  assert.equal(createChangeEvent("scrub:live").scope, "live");
  assert.equal(createChangeEvent("update:components.0.name").history, "record");
  assert.equal(createChangeEvent("workspace").history, "none");
});

test("structured change metadata extends the compatibility reason", () => {
  const event = createChangeEvent({
    reason: "update:component-param",
    type: "component.paramChanged",
    phase: "commit",
    componentId: "component-a",
  });
  assert.equal(event.reason, "update:component-param");
  assert.equal(event.topic, "component-param");
  assert.equal(event.type, "component.paramChanged");
  assert.equal(event.componentId, "component-a");
  assert.equal(Object.isFrozen(event), true);
});

test("project restore classification is shared by state consumers", () => {
  assert.equal(createChangeEvent("project-open-media").projectRestore, true);
  assert.equal(createChangeEvent("project-undo").projectRestore, true);
  assert.equal(createChangeEvent("project-undo").history, "none");
  assert.equal(createChangeEvent("project-autosave").projectRestore, false);
});
