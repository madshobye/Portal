import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOutputUrl,
  getInitialWorkspace,
  persistLivePreference,
  persistLiveSession,
  preferredLivePreference,
  preferredLiveSession,
} from "../js/view-routing.js";

test("legacy compose URLs and sessions route to the Component workspace", () => {
  const previousWindow = globalThis.window;
  const previousSessionStorage = globalThis.sessionStorage;
  globalThis.window = { location: { search: "?workspace=compose" } };
  globalThis.sessionStorage = { getItem: () => "scene" };
  try {
    assert.equal(getInitialWorkspace(), "component");
  } finally {
    globalThis.window = previousWindow;
    globalThis.sessionStorage = previousSessionStorage;
  }
});

test("legacy standalone Composition URLs route to Component preview mode", async () => {
  const previousWindow = globalThis.window;
  const previousSessionStorage = globalThis.sessionStorage;
  globalThis.window = { location: { search: "?composition=1" } };
  globalThis.sessionStorage = { getItem: () => null };
  try {
    const { getClientMode } = await import(`../js/view-routing.js?legacy-component=${Date.now()}`);
    assert.equal(getClientMode(), "component");
  } finally {
    globalThis.window = previousWindow;
    globalThis.sessionStorage = previousSessionStorage;
  }
});

test("output URLs discard obsolete private Scene startup state", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { href: "https://example.test/vj1/?workspace=scene&initialSceneId=scn-old" } };
  try {
    const url = new URL(buildOutputUrl("output", { outputId: "output-2" }));
    assert.equal(url.searchParams.get("output"), "1");
    assert.equal(url.searchParams.get("outputId"), "output-2");
    assert.equal(url.searchParams.has("initialSceneId"), false);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("the last Live Scene and projection selection are durable and project-scoped", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const state = {
    project: { folderName: "show-a", name: "Show A" },
    components: [{ id: "scene-a", type: "scene" }, { id: "scene-b", type: "scene" }],
    mappings: [{ id: "mapping-a", surfaces: [{ id: "surface-a" }] }],
    ui: {
      selectedMappingId: "mapping-a",
      live: { selectedSceneId: "scene-b", previewSurfaceId: "surface-a" },
    },
  };

  assert.equal(persistLivePreference(state, storage), true);
  state.ui.live.selectedSceneId = "scene-a";
  state.ui.live.previewSurfaceId = "__mapping__";
  assert.deepEqual(preferredLivePreference(state, storage), {
    sceneId: "scene-b",
    previewSurfaceId: "surface-a",
  });
  assert.deepEqual(
    preferredLivePreference(
      { ...state, project: { folderName: "show-b" } },
      storage,
    ),
    { sceneId: "", previewSurfaceId: "" },
  );
});

test("a removed Live Scene or malformed preference safely falls back to project state", () => {
  const state = {
    project: { folderName: "show-a" },
    components: [{ id: "scene-a", type: "scene" }],
    mappings: [{ id: "mapping-a", surfaces: [{ id: "surface-a" }] }],
    ui: {
      selectedMappingId: "mapping-a",
      live: { selectedSceneId: "scene-a" },
    },
  };
  const staleStorage = {
    getItem: () => JSON.stringify({
      "project:show-a": {
        sceneId: "scene-deleted",
        previewSurfaceId: "surface-deleted",
      },
    }),
  };
  const malformedStorage = { getItem: () => "not-json" };

  assert.deepEqual(preferredLivePreference(state, staleStorage), {
    sceneId: "",
    previewSurfaceId: "",
  });
  assert.deepEqual(preferredLivePreference(state, malformedStorage), {
    sceneId: "",
    previewSurfaceId: "",
  });
});

test("the complete multi-Surface Live session and temporary params survive reload", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const state = {
    project: { folderName: "show-a" },
    global: { timeStretch: -1.25 },
    components: [
      { id: "scene-a", type: "scene" },
      { id: "scene-b", type: "scene" },
      { id: "part-a", type: "component" },
    ],
    mappings: [{
      id: "mapping-a",
      surfaces: [{ id: "surface-a" }, { id: "surface-b" }],
    }],
    ui: {
      selectedMappingId: "mapping-a",
      live: {
        selectedSceneId: "scene-a",
        selectedComponentId: "scene-a",
        overallSourceCleared: false,
        sceneMappingVisible: false,
        previewSurfaceId: "surface-b",
        surfacePatches: { "surface-a": "scene-b", "surface-b": "part-a" },
        surfaceVisibility: { "surface-a": false, "surface-b": true },
        parameterDiffs: {
          "scene-a": { "part-a": { opacity: 0.35 } },
          "scene-b": { "part-a": { scale: 1.4 } },
        },
        transitionId: "org.vj1.transition.soft-wipe",
        transitionParameters: { softness: 0.2 },
        transitionDuration: 1.5,
        paramFadeDuration: 0.4,
        transition: { id: "must-not-survive" },
      },
    },
  };

  assert.equal(persistLiveSession(state, storage), true);
  const restored = preferredLiveSession(state, storage);

  assert.equal(restored.selectedMappingId, "mapping-a");
  assert.equal(restored.timeStretch, -1.25);
  assert.equal(restored.live.previewSurfaceId, "surface-b");
  assert.deepEqual(restored.live.surfacePatches, {
    "surface-a": "scene-b",
    "surface-b": "part-a",
  });
  assert.deepEqual(restored.live.surfaceVisibility, {
    "surface-a": false,
    "surface-b": true,
  });
  assert.deepEqual(restored.live.parameterDiffs["scene-a"], {
    "part-a": { opacity: 0.35 },
  });
  assert.deepEqual(restored.live.parameterDiffs["scene-b"], {
    "part-a": { scale: 1.4 },
  });
  assert.equal(Object.hasOwn(restored.live, "transition"), false);
  assert.equal(restored.live.transitionId, "org.vj1.transition.soft-wipe");
});

test("Live session restore prunes deleted targets and Surfaces before activation", () => {
  const storage = {
    getItem: () => JSON.stringify({
      "project:show-a": {
        version: 1,
        selectedMappingId: "mapping-a",
        live: {
          selectedSceneId: "scene-deleted",
          selectedComponentId: "part-a",
          previewSurfaceId: "surface-deleted",
          surfacePatches: {
            "surface-a": "part-a",
            "surface-deleted": "part-a",
            "surface-b": "part-deleted",
          },
          surfaceVisibility: {
            "surface-a": false,
            "surface-deleted": true,
          },
          sceneOverrides: {
            "part-a": {
              "part-a": { opacity: 0.5 },
              "part-deleted": { opacity: 1 },
            },
            "part-deleted": { "part-a": { opacity: 1 } },
          },
        },
      },
    }),
  };
  const state = {
    project: { folderName: "show-a" },
    components: [{ id: "part-a", type: "component" }],
    mappings: [{
      id: "mapping-a",
      surfaces: [{ id: "surface-a" }, { id: "surface-b" }],
    }],
    ui: {
      selectedMappingId: "mapping-a",
      live: { sceneMappingInLive: true },
    },
    global: { timeStretch: 0 },
  };

  const restored = preferredLiveSession(state, storage);
  assert.equal(restored.live.selectedSceneId, "");
  assert.equal(restored.live.selectedComponentId, "part-a");
  assert.equal(restored.live.previewSurfaceId, "");
  assert.deepEqual(restored.live.surfacePatches, { "surface-a": "part-a" });
  assert.deepEqual(restored.live.surfaceVisibility, { "surface-a": false });
  assert.deepEqual(Object.keys(restored.live.parameterDiffs), ["part-a"]);
  assert.deepEqual(restored.live.parameterDiffs["part-a"], {
    "part-a": { opacity: 0.5 },
  });
});

test("Live session storage failures keep the current project usable", () => {
  const state = {
    project: { folderName: "show-a" },
    components: [],
    mappings: [],
    ui: { live: {} },
  };
  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(persistLiveSession(state, {
      getItem: () => "{}",
      setItem: () => { throw new Error("quota"); },
    }), false);
    assert.equal(preferredLiveSession(state, {
      getItem: () => { throw new Error("blocked"); },
    }), null);
  } finally {
    console.warn = previousWarn;
  }
});

test("unknown Live session versions fail closed", () => {
  const state = {
    project: { folderName: "show-a" },
    components: [{ id: "part-a", type: "component" }],
    mappings: [{ id: "mapping-a", surfaces: [] }],
    ui: { selectedMappingId: "mapping-a", live: {} },
  };
  const storage = {
    getItem: () => JSON.stringify({
      "project:show-a": {
        version: 99,
        selectedMappingId: "mapping-a",
        live: { selectedComponentId: "part-a" },
      },
    }),
  };

  assert.equal(preferredLiveSession(state, storage), null);
});
