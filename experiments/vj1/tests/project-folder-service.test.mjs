import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProjectPayload,
  historyGroupForReason,
  projectHistorySignature,
  shouldCoalesceHistoryRevision,
  persistedRenderSettings,
} from "../js/services/project-folder-service.js";

test("project payload preserves the selected component chain item", () => {
  const state = {
    version: 5,
    project: {},
    recordingFrames: [{ id: "frame-a", x: 10, y: 20, width: 640, height: 360 }],
    ui: {
      selectedSceneId: "scene-a",
      selectedSurfaceId: "surface-a",
      selectedComponentId: "component-a",
      selectedChainItemId: "chain-effect-b",
      workspaceSelectionIds: { component: "component-a", canvas: "canvas-b" },
      catalogSortModes: { component: "name", scene: "created" },
      previewQualities: { scene: "low", live: "full" },
      live: {
        selectedSceneId: "scene-live",
        sceneSnapshot: { surfaces: [{ id: "surface-a", componentId: "component-a" }] },
        componentOverrides: { "component-a": { opacity: 0.5 } },
        transitionDuration: 2.5,
        transition: { id: "runtime-only" },
      },
    },
  };

  const payload = buildProjectPayload(state, "2026-07-12T00:00:00.000Z");
  assert.equal(payload.version, 18);
  assert.equal(payload.ui.selectedChainItemId, "chain-effect-b");
  assert.deepEqual(payload.ui.workspaceSelectionIds, state.ui.workspaceSelectionIds);
  assert.deepEqual(payload.ui.catalogSortModes, state.ui.catalogSortModes);
  assert.deepEqual(payload.ui.previewQualities, state.ui.previewQualities);
  assert.equal(payload.ui.live.selectedSceneId, "scene-live");
  assert.deepEqual(payload.ui.live.sceneSnapshot, state.ui.live.sceneSnapshot);
  assert.equal(payload.ui.live.transitionDuration, 2.5);
  assert.equal(payload.ui.live.transition, undefined);
  assert.equal(payload.ui.live.componentOverrides, undefined);
  assert.deepEqual(payload.recordingFrames, state.recordingFrames);
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  assert.ok(source.includes("selectedChainItemId: projectUi?.selectedChainItemId || currentUi.selectedChainItemId"));
  assert.ok(source.includes("workspaceSelectionIds: projectUi?.workspaceSelectionIds || currentUi.workspaceSelectionIds"));
  assert.ok(source.includes("catalogSortModes: projectUi?.catalogSortModes || currentUi.catalogSortModes"));
  assert.ok(source.includes("previewQualities: projectUi?.previewQualities || currentUi.previewQualities"));
  assert.ok(!source.includes("legacyRecordingFrames"));
  assert.ok(source.includes("data = migrateProjectData(data)"));
  assert.ok(source.includes("projectLoadBlocked = true"));
  assert.ok(source.includes("if (projectLoadBlocked) return false"));
});

test("Live scene selection is autosaved so reload restores user truth", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const skipBlock = source.match(/const skipAutosaveReasons = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";

  assert.doesNotMatch(skipBlock, /"live:scene"/);
  assert.match(skipBlock, /"live:update"/);
  assert.match(source, /const delay = immediate \|\| reason === "live:scene" \? 0 : autosaveDelayMs;/);
});

test("project payload persists canonical render settings without derived geometry aliases", () => {
  const render = {
    outputs: [{ id: "main", width: 1920, height: 1080 }],
    componentTexture: { width: 1300, height: 1000 },
    surfaceTexture: { mode: "auto", maxWidth: 1920, maxHeight: 1080 },
    pixelDensity: 1.5,
    width: 1920,
    height: 1080,
    frameWidth: 1920,
    frameHeight: 1080,
    worldScale: 1.5,
    worldWidth: 2880,
    worldHeight: 1620,
    outputGap: 0,
  };
  const persisted = persistedRenderSettings(render);
  assert.deepEqual(persisted.outputs, render.outputs);
  assert.deepEqual(persisted.componentTexture, render.componentTexture);
  assert.equal(persisted.pixelDensity, 1.5);
  for (const key of ["width", "height", "frameWidth", "frameHeight", "worldScale", "worldWidth", "worldHeight", "outputGap"]) {
    assert.equal(Object.hasOwn(persisted, key), false);
  }
});

test("folder permission prompt does not discard a project recovered from output", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.ok(source.includes("const recoveredFromOutput = !!draft.project.folderName"));
  assert.ok(source.includes("if (!recoveredFromOutput)"));
});

test("media import refreshes assets without replacing live project state", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const importExternalFiles = source.slice(
    source.indexOf("  async function importExternalFiles"),
    source.indexOf("\n  async function closeProject", source.indexOf("  async function importExternalFiles"))
  );

  assert.ok(importExternalFiles.includes("await refreshFolder({ force: true })"));
  assert.doesNotMatch(importExternalFiles, /loadDirectory\(/);
});

test("project history signature ignores UI-only save noise", () => {
  const base = {
    version: 5,
    project: { name: "Show", savedAt: "2026-07-11T10:00:00.000Z", warnings: ["temporary"] },
    ui: {
      selectedSceneId: "scene-a",
      selectedSurfaceId: "surface-a",
      selectedComponentId: "component-a",
    },
    global: { showLabels: true },
    render: { frameWidth: 1280, frameHeight: 720 },
    scheduler: {},
    media: [],
    components: [{ id: "component-a", name: "A" }],
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
      selectedComponentId: "component-b",
    },
  };
  const material = {
    ...selectedOnly,
    components: [{ id: "component-a", name: "Renamed" }],
  };

  assert.equal(projectHistorySignature(base), projectHistorySignature(selectedOnly));
  assert.notEqual(projectHistorySignature(base), projectHistorySignature(material));
});

test("history grouping coalesces repeated commits to the same control path", () => {
  const first = historyGroupForReason("update:components.0.chain.1.params.amount");
  const sameColor = historyGroupForReason("color:components.0.chain.1.params.tintColor");

  assert.equal(first, "update:components.0.chain.1.params.amount");
  assert.equal(sameColor, "color:components.0.chain.1.params.tintColor");
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
