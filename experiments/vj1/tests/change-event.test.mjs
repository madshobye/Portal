import test from "node:test";
import assert from "node:assert/strict";

import { createChangeEvent } from "../js/domain/change-event.js";

test("change events centralize legacy reason phases and topics", () => {
  assert.deepEqual(createChangeEvent("scrub:mapping-state"), {
    reason: "scrub:mapping-state",
    phase: "scrub",
    topic: "mapping-state",
    scope: "project",
    projectRestore: false,
  });
  assert.equal(createChangeEvent("color:components.0.chain.0.params.tint").phase, "color");
  assert.equal(createChangeEvent("live:update").scope, "live");
  assert.equal(createChangeEvent("scrub:live").scope, "live");
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
  assert.equal(createChangeEvent("project-autosave").projectRestore, false);
});
