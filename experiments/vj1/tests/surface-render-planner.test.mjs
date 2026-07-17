import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createInitialState } from "../js/domain/models.js";
import { planSurfaceRoutes } from "../js/output/surface-render-planner.js";
import { OutputSurfaceRuntime } from "../js/output/output-surface-runtime.js";

test("surface planner resolves visible routes and their shared component demand", () => {
  const state = createInitialState();
  const component = state.components[0];
  const surface = state.surfaces[0];
  state.surfaces = [surface];
  surface.enabled = true;
  surface.componentId = component.id;
  const mapperSurface = {
    name: surface.id,
    corners: [
      { x: 0, y: 0 },
      { x: 960, y: 0 },
      { x: 960, y: 540 },
      { x: 0, y: 540 },
    ],
  };
  const { routes, metrics } = planSurfaceRoutes({
    state,
    mapperSurfaces: new Map([[surface.id, { mapperSurface, direct: true }]]),
    componentById: new Map([[component.id, component]]),
    recordingFrameById: new Map(),
    viewport: { width: 960, height: 540 },
    pixelScale: 1,
    resolveRouteSourceNode: () => ({ id: `component:${component.id}`, componentId: component.id, outputFrameId: "" }),
  });

  assert.equal(metrics.candidates, 1);
  assert.equal(metrics.visible, 1);
  assert.equal(metrics.culled, 0);
  assert.equal(routes[0].surface.componentId, component.id);
  assert.ok(routes[0].componentRequest.width > 0);
  assert.ok(routes[0].surfaceRequest.width > 0);
  assert.ok(metrics.componentRasterPixels > 0);
});

test("output renderer delegates surface demand planning", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const mapperSource = readFileSync(new URL("../js/output/vj-mapper.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('from "./output-surface-runtime.js?v=transition-route-scope-1"'));
  assert.ok(runtimeSource.includes('from "./surface-render-planner.js?v=surface-runtime-extraction-1"'));
  assert.ok(runtimeSource.includes("const { routes, metrics } = planSurfaceRoutes({"));
  assert.doesNotMatch(rendererSource, /sourceRenderDemand\(\{/);
  assert.doesNotMatch(rendererSource, /manualSurfaceTextureLimit\(/);
  assert.ok(mapperSource.includes("shaderProgram !== activeShader || texture !== activeTexture"));
  assert.ok(mapperSource.includes("if (activeShader) resetShader();"));
});

test("surface runtime derives transition progress without owning wall-clock state", () => {
  const renderer = {
    state: {
      liveTransition: {
        id: "transition-a",
        fromState: { surfaces: [] },
        startedAtMs: 1000,
        durationMs: 2000,
      },
    },
  };
  const runtime = new OutputSurfaceRuntime(renderer);

  assert.equal(runtime.currentLiveTransition(1500).progress, 0.25);
  assert.equal(runtime.currentLiveTransition(3000), null);
});

test("surface runtime restores temporary render state and identity scopes", () => {
  const originalState = { id: "current" };
  const originalLookups = {
    componentById: new Map([["current-component", {}]]),
    recordingFrameById: new Map([["current-frame", {}]]),
    routeSourceNodeById: new Map([["current-node", {}]]),
    routeSourceNodeByLegacyKey: new Map([["current-legacy", {}]]),
  };
  const renderer = {
    state: originalState,
    ...originalLookups,
    rebuildRouteLookups() {
      const id = this.state.id;
      this.componentById = new Map([[`${id}-component`, {}]]);
      this.recordingFrameById = new Map([[`${id}-frame`, {}]]);
      this.routeSourceNodeById = new Map([[`${id}-node`, {}]]);
      this.routeSourceNodeByLegacyKey = new Map([[`${id}-legacy`, {}]]);
    },
  };
  const runtime = new OutputSurfaceRuntime(renderer);

  assert.equal(runtime.withRenderState({ id: "temporary" }, () => {
    assert.equal(renderer.componentById.has("temporary-component"), true);
    assert.equal(renderer.recordingFrameById.has("temporary-frame"), true);
    assert.equal(renderer.routeSourceNodeById.has("temporary-node"), true);
    assert.equal(renderer.routeSourceNodeByLegacyKey.has("temporary-legacy"), true);
    return renderer.state.id;
  }), "temporary");
  assert.equal(renderer.state, originalState);
  assert.equal(renderer.componentById, originalLookups.componentById);
  assert.equal(renderer.recordingFrameById, originalLookups.recordingFrameById);
  assert.equal(renderer.routeSourceNodeById, originalLookups.routeSourceNodeById);
  assert.equal(renderer.routeSourceNodeByLegacyKey, originalLookups.routeSourceNodeByLegacyKey);
  assert.equal(runtime.withSurfaceRenderIdentityPrefix("from:", () => runtime.renderIdentityPrefix), "from:");
  assert.equal(runtime.renderIdentityPrefix, "");
});
