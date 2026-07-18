import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOutputUrl,
  getInitialWorkspace,
  persistLiveScenePreference,
  preferredLiveSceneId,
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

test("the last Live Scene preference is durable and project-scoped", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const state = {
    project: { folderName: "show-a", name: "Show A" },
    scenes: [{ id: "scene-a" }, { id: "scene-b" }],
    ui: { live: { selectedSceneId: "scene-b" } },
  };

  assert.equal(persistLiveScenePreference(state, storage), true);
  state.ui.live.selectedSceneId = "scene-a";
  assert.equal(preferredLiveSceneId(state, storage), "scene-b");
  assert.equal(preferredLiveSceneId({ ...state, project: { folderName: "show-b" } }, storage), "");
});

test("a removed Live Scene or malformed preference safely falls back to project state", () => {
  const state = {
    project: { folderName: "show-a" },
    scenes: [{ id: "scene-a" }],
    ui: { live: { selectedSceneId: "scene-a" } },
  };
  const staleStorage = {
    getItem: () => JSON.stringify({ "project:show-a": "scene-deleted" }),
  };
  const malformedStorage = { getItem: () => "not-json" };

  assert.equal(preferredLiveSceneId(state, staleStorage), "");
  assert.equal(preferredLiveSceneId(state, malformedStorage), "");
});
