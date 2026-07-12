import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProjectPayload,
  historyGroupForReason,
  projectHistorySignature,
  shouldCoalesceHistoryRevision,
} from "../js/services/project-folder-service.js";

test("project payload preserves the selected composition chain item", () => {
  const state = {
    version: 5,
    project: {},
    ui: {
      selectedSceneId: "scene-a",
      selectedSurfaceId: "surface-a",
      selectedCompositionId: "composition-a",
      selectedChainItemId: "chain-effect-b",
    },
  };

  assert.equal(buildProjectPayload(state, "2026-07-12T00:00:00.000Z").ui.selectedChainItemId, "chain-effect-b");
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  assert.ok(source.includes("selectedChainItemId: projectUi?.selectedChainItemId || currentUi.selectedChainItemId"));
});

test("folder permission prompt does not discard a project recovered from output", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.ok(source.includes("const recoveredFromOutput = !!draft.project.folderName"));
  assert.ok(source.includes("if (!recoveredFromOutput)"));
});

test("project history signature ignores UI-only save noise", () => {
  const base = {
    version: 5,
    project: { name: "Show", savedAt: "2026-07-11T10:00:00.000Z", warnings: ["temporary"] },
    ui: {
      selectedSceneId: "scene-a",
      selectedSurfaceId: "surface-a",
      selectedCompositionId: "composition-a",
    },
    global: { showLabels: true },
    render: { frameWidth: 1280, frameHeight: 720 },
    scheduler: {},
    media: [],
    compositions: [{ id: "composition-a", name: "A" }],
    surfaces: [],
    scenes: [],
    mappings: {},
    shaders: {},
  };
  const selectedOnly = {
    ...base,
    project: { ...base.project, savedAt: "2026-07-11T10:05:00.000Z", warnings: [] },
    ui: {
      selectedSceneId: "scene-b",
      selectedSurfaceId: "surface-b",
      selectedCompositionId: "composition-b",
    },
  };
  const material = {
    ...selectedOnly,
    compositions: [{ id: "composition-a", name: "Renamed" }],
  };

  assert.equal(projectHistorySignature(base), projectHistorySignature(selectedOnly));
  assert.notEqual(projectHistorySignature(base), projectHistorySignature(material));
});

test("history grouping coalesces repeated commits to the same control path", () => {
  const first = historyGroupForReason("update:compositions.0.chain.1.params.amount");
  const sameColor = historyGroupForReason("color:compositions.0.chain.1.params.tintColor");

  assert.equal(first, "update:compositions.0.chain.1.params.amount");
  assert.equal(sameColor, "color:compositions.0.chain.1.params.tintColor");
  assert.equal(shouldCoalesceHistoryRevision({ key: first, at: 1000 }, first, 6500, 6000), true);
  assert.equal(shouldCoalesceHistoryRevision({ key: first, at: 1000 }, first, 8000, 6000), false);
  assert.equal(shouldCoalesceHistoryRevision({ key: first, at: 1000 }, sameColor, 2000, 6000), false);
  assert.equal(shouldCoalesceHistoryRevision({ key: "history-checkpoint", at: 1000 }, "history-checkpoint", 2000, 6000), false);
});

test("project folder service initializes empty folders and can close the active project", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.ok(source.includes("ensureProjectScaffold(dirHandle)"));
  for (const folder of ['"media"', '"shaders"', '"scenes"', '"mappings"']) {
    assert.ok(source.includes(folder), `missing scaffold folder ${folder}`);
  }
  assert.ok(source.includes("async function closeProject()"));
  assert.ok(source.includes("store.replace(createInitialState(), \"project-close\")"));
  assert.ok(source.includes("clearProjectDirectoryHandle"));
});
