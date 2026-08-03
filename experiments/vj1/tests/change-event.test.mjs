import test from "node:test";
import assert from "node:assert/strict";

import {
  changeEffectPlan,
  controlInvalidationForPaths,
  createChangeEvent,
} from "../js/libraries/state-engine/state-command/index.js";

test("structural component changes are identified separately from control gestures", () => {
  assert.equal(createChangeEvent("add-component").effects.graph.mode, "recompile");
  assert.equal(createChangeEvent("add-chain-source").effects.graph.mode, "recompile");
  assert.equal(createChangeEvent("remove-chain-item").effects.graph.mode, "recompile");
  assert.equal(createChangeEvent("select-component").effects.graph.mode, "recompile");
  assert.equal(createChangeEvent("select-chain-item").effects.graph.mode, "recompile");
  assert.equal(createChangeEvent("select-surface").effects.graph.mode, "recompile");
  assert.equal(createChangeEvent("select-scene").effects.graph.mode, "recompile");
  assert.equal(createChangeEvent("select-live-component").effects.graph.mode, "recompile");
  assert.equal(createChangeEvent("update:components.0.opacity").effects.graph.mode, "configuration");
  assert.equal(createChangeEvent("scrub:chain-transform").effects.graph.mode, "configuration");
});

test("change events publish one canonical command and effect contract", () => {
  const mappingScrub = createChangeEvent("scrub:mapping-state");
  assert.equal(mappingScrub.reason, "scrub:mapping-state");
  assert.deepEqual(mappingScrub.command, { phase: "scrub", topic: "mapping-state", domain: "project" });
  assert.equal(mappingScrub.effects.persistence.history, undefined);
  assert.equal(mappingScrub.effects.lifecycle.project, "unchanged");
  assert.equal(createChangeEvent("color:components.0.chain.0.params.tint").command.phase, "color");
  assert.equal(createChangeEvent("live:update").command.domain, "live");
  assert.equal(createChangeEvent("scrub:live").command.domain, "live");
  assert.equal(createChangeEvent("update:components.0.name").effects.persistence.history, true);
  assert.equal(createChangeEvent("workspace").effects.persistence.history, false);
  assert.equal(createChangeEvent("select-mapping").effects.persistence.history, false);
  assert.equal(createChangeEvent("select-chain-item").effects.persistence.history, false);
});

test("asset catalog changes invalidate only asset-dependent Control regions", () => {
  const event = createChangeEvent({
    reason: "project-refresh-assets",
    command: { domain: "assets" },
    projection: { kind: "asset-catalog" },
  });

  assert.deepEqual(event.effects.control, {
    regions: ["project-rail", "live-projection-rail", "studio", "inspector"],
    preview: "assets",
  });
  assert.equal(event.effects.preview.mode, "assets");
});

test("typed effects replace downstream reason/scope policy duplication", () => {
  const mapping = createChangeEvent("scrub:mapping-state");
  assert.deepEqual(mapping.effects.persistence, { mode: "none" });
  assert.deepEqual(mapping.effects.output, { mode: "mapping-patch", coalesce: true });
  assert.deepEqual(mapping.effects.preview, { mode: "mapping", coalesce: true });

  const live = createChangeEvent({
    reason: "live:update",
    livePatches: [{ path: "components.0.opacity", value: 0.5 }],
  });
  assert.deepEqual(live.effects.output, { mode: "live-patches", coalesce: false });
  assert.deepEqual(live.effects.preview, { mode: "live-patches" });
  assert.equal(Object.isFrozen(live.effects), true);
  assert.equal(Object.isFrozen(live.effects.output), true);

  assert.deepEqual(
    changeEffectPlan({ reason: "preview-pan", command: { domain: "ui", phase: "commit", topic: "preview-pan" } }).persistence,
    { mode: "checkpoint", history: false },
  );
});

test("structured change metadata extends the compatibility reason", () => {
  const event = createChangeEvent({
    reason: "update:component-param",
    type: "component.paramChanged",
    command: { phase: "commit" },
    componentId: "component-a",
  });
  assert.equal(event.reason, "update:component-param");
  assert.equal(event.command.topic, "component-param");
  assert.equal(event.type, "component.paramChanged");
  assert.equal(event.componentId, "component-a");
  assert.equal(Object.isFrozen(event), true);
});

test("change events retain explicit Output transport ownership", () => {
  const event = createChangeEvent({
    reason: "update:significant-param",
    outputState: "unchanged",
    effects: { control: { regions: ["live-projection-rail", "inspector"] } },
  });

  assert.equal(event.command.domain, "project");
  assert.equal(event.effects.persistence.history, true);
  assert.equal(event.outputState, "unchanged");
  assert.deepEqual(event.effects.control, {
    regions: ["live-projection-rail", "inspector"],
  });
});

test("project restore classification is shared by state consumers", () => {
  assert.equal(createChangeEvent("project-open-media").effects.lifecycle.project, "restore");
  assert.equal(createChangeEvent("project-undo").effects.lifecycle.project, "restore");
  assert.equal(createChangeEvent("project-undo").effects.persistence.history, false);
  assert.equal(createChangeEvent("project-autosave").effects.lifecycle.project, "unchanged");
});

test("control invalidation is derived centrally from semantic changed paths", () => {
  assert.deepEqual(
    controlInvalidationForPaths(["ui.selectedChainItemId"]),
    {
      regions: ["inspector"],
      preview: "ui",
    },
  );
  assert.deepEqual(
    controlInvalidationForPaths(["ui.selectedSurfaceId", "ui.selectedChainItemId"]),
    {
      regions: ["project-selection", "inspector"],
      preview: "ui",
    },
  );
  assert.deepEqual(
    controlInvalidationForPaths(["components.2.chain.1.enabled"]),
    {
      regions: ["inspector"],
      requiresRenderPatch: true,
    },
  );
  assert.deepEqual(
    controlInvalidationForPaths(["mappings.0.surfaces.1.enabled"]),
    {
      regions: ["project-selection", "inspector"],
      preview: "mapping",
    },
  );
  assert.deepEqual(
    createChangeEvent({
      reason: "toggle:components.2.chain.1.enabled",
      changedPaths: ["components.2.chain.1.enabled"],
    }).effects.control,
    {
      regions: ["inspector"],
      requiresRenderPatch: true,
    },
  );
});
