import test from "node:test";
import assert from "node:assert/strict";

import { buildOutputUrl, getInitialWorkspace } from "../js/view-routing.js";

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
