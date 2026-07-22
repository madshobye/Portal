import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createInitialState } from "../js/domain/models.js";
import { planSurfaceRoutes } from "../js/output/surface-render-planner.js";
import {
  OutputSurfaceRuntime,
  surfaceRouteBlend,
  surfaceRouteOpacity,
} from "../js/output/output-surface-runtime.js";

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
    frameById: new Map(),
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

test("a region-safe recording frame renders at mapped demand instead of its share of a full Canvas", () => {
  const state = createInitialState();
  const canvas = { ...state.components[0], id: "canvas-a", type: "scene", chain: [], canvas: { frameThumbnails: {} } };
  const frame = { id: "frame-a", x: 0.45, y: 0.45, width: 0.1, height: 0.1 };
  const surface = {
    ...state.surfaces[0],
    id: "surface-a",
    enabled: true,
    componentId: canvas.id,
    outputFrameId: frame.id,
    sourceNodeId: `recording-frame:${canvas.id}:${frame.id}`,
  };
  state.components = [canvas];
  state.frames = [frame];
  state.surfaces = [surface];
  const mapperSurface = {
    name: surface.id,
    corners: [{ x: 0, y: 0 }, { x: 1270, y: 0 }, { x: 1270, y: 855 }, { x: 0, y: 855 }],
  };
  const { routes, metrics } = planSurfaceRoutes({
    state,
    mapperSurfaces: new Map([[surface.id, { mapperSurface, direct: true }]]),
    componentById: new Map([[canvas.id, canvas]]),
    frameById: new Map([[frame.id, frame]]),
    viewport: { width: 1270, height: 855 },
    pixelScale: 1,
    resolveRouteSourceNode: () => ({ id: surface.sourceNodeId, componentId: canvas.id, outputFrameId: frame.id }),
    isComponentRegionSafe: () => true,
  });

  assert.equal(routes[0].componentRequest.role, "scene-region");
  assert.equal(routes[0].componentRequest.regionView, true);
  assert.deepEqual(
    { width: routes[0].componentRequest.width, height: routes[0].componentRequest.height },
    routes[0].demand.surfaceSize
  );
  assert.equal(metrics.componentRasterPixels, routes[0].componentRequest.width * routes[0].componentRequest.height);
});

test("independent Canvas children do not multiply across multiple recording-frame routes", () => {
  const state = createInitialState();
  const canvas = { ...state.components[0], id: "canvas-a", type: "scene", chain: [], canvas: { frameThumbnails: {} } };
  const frames = [
    { id: "frame-a", x: 0, y: 0, width: 0.5, height: 1 },
    { id: "frame-b", x: 0.5, y: 0, width: 0.5, height: 1 },
  ];
  const surfaces = frames.map((frame, index) => ({
    ...state.surfaces[0],
    id: `surface-${index}`,
    enabled: true,
    componentId: canvas.id,
    outputFrameId: frame.id,
    sourceNodeId: `recording-frame:${canvas.id}:${frame.id}`,
  }));
  state.components = [canvas];
  state.frames = frames;
  state.surfaces = surfaces;
  const mapperSurfaces = new Map(surfaces.map((surface) => [surface.id, {
    direct: true,
    mapperSurface: {
      name: surface.id,
      corners: [{ x: 0, y: 0 }, { x: 960, y: 0 }, { x: 960, y: 540 }, { x: 0, y: 540 }],
    },
  }]));

  const { routes } = planSurfaceRoutes({
    state,
    mapperSurfaces,
    componentById: new Map([[canvas.id, canvas]]),
    frameById: new Map(frames.map((frame) => [frame.id, frame])),
    viewport: { width: 960, height: 540 },
    pixelScale: 1,
    resolveRouteSourceNode: (surface) => ({ id: surface.sourceNodeId, componentId: canvas.id, outputFrameId: surface.outputFrameId }),
    isComponentRegionSafe: () => true,
    isComponentFrameFanoutSafe: () => false,
  });

  assert.equal(routes.length, 2);
  assert.notEqual(routes[0].componentRequest.role, "scene-region");
  assert.strictEqual(routes[0].componentRequest, routes[1].componentRequest);
});

test("surface planner consumes the compiled Scene surface program as routing authority", () => {
  const state = createInitialState();
  const surface = state.surfaces[0];
  surface.enabled = true;
  surface.componentId = state.components[0].id;
  const result = planSurfaceRoutes({
    state,
    surfaceProgram: [],
    mapperSurfaces: new Map(),
    componentById: new Map(),
    frameById: new Map(),
  });

  assert.equal(state.surfaces.length > 0, true);
  assert.equal(result.metrics.candidates, 0);
  assert.deepEqual(result.routes, []);
});

test("output renderer delegates surface demand planning", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const mapperSource = readFileSync(new URL("../js/libraries/mapping-engine/mapping-engine/index.js", import.meta.url), "utf8");

  assert.match(rendererSource, /from "\.\/output-surface-runtime\.js\?v=[^"]+"/);
  assert.match(runtimeSource, /from "\.\/surface-render-planner\.js\?v=[^"]+"/);
  assert.ok(runtimeSource.includes("const { routes, metrics } = planSurfaceRoutes({"));
  assert.ok(runtimeSource.includes("surfaceProgram: surfaceProgram || renderer.mappingProgramSurfaces(renderer.state)"));
  assert.ok(runtimeSource.includes("transformDemandCorners,"));
  assert.ok(runtimeSource.includes('preserveDirectFootprint: renderer.mode === "output"'));
  assert.doesNotMatch(runtimeSource, /outputSpanFitScale/);
  assert.doesNotMatch(rendererSource, /sourceRenderDemand\(\{/);
  assert.doesNotMatch(rendererSource, /manualSurfaceTextureLimit\(/);
  assert.ok(mapperSource.includes("shaderProgram !== activeShader || texture !== activeTexture"));
  assert.ok(mapperSource.includes("if (activeShader) resetShader();"));
});

test("surface routes compose component placement opacity and blend at the parent boundary", () => {
  const route = {
    component: { opacity: 0.5, blend: "screen" },
    surface: { opacity: 0.4, finalBlend: "normal" },
  };

  assert.equal(surfaceRouteOpacity(route), 0.2);
  assert.equal(surfaceRouteBlend(route), "screen");
  assert.equal(surfaceRouteBlend({
    ...route,
    surface: { ...route.surface, finalBlend: "multiply" },
  }), "multiply");
  assert.equal(surfaceRouteOpacity({ component: {}, surface: {} }), 1);
});

test("direct recording-frame views stay in the mapper shader instead of p5 sub-texture copies", () => {
  const calls = [];
  const renderer = {
    mapper: {
      drawTexture(...args) { calls.push(args); },
    },
  };
  const runtime = new OutputSurfaceRuntime(renderer);
  const texture = { width: 1000, height: 500 };
  const mapperSurface = { id: "direct", corners: [] };
  runtime.drawDirectSurfaceView({
    texture,
    sourceRect: { x: 650, y: 100, width: 250, height: 300 },
  }, {
    surface: { projectionFit: "cover" },
    mapped: { mapperSurface },
  }, 0.75);

  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0][0], texture);
  assert.strictEqual(calls[0][1], mapperSurface);
  assert.equal(calls[0][2], "cover");
  assert.equal(calls[0][3], 0);
  assert.deepEqual(calls[0][4], {
    sourceRect: { x: 650, y: 100, width: 250, height: 300 },
    opacity: 0.75,
  });
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
    frameById: new Map([["current-frame", {}]]),
    routeSourceNodeById: new Map([["current-node", {}]]),
    routeSourceNodeByLegacyKey: new Map([["current-legacy", {}]]),
  };
  const renderer = {
    state: originalState,
    ...originalLookups,
    rebuildRouteLookups() {
      const id = this.state.id;
      this.componentById = new Map([[`${id}-component`, {}]]);
      this.frameById = new Map([[`${id}-frame`, {}]]);
      this.routeSourceNodeById = new Map([[`${id}-node`, {}]]);
      this.routeSourceNodeByLegacyKey = new Map([[`${id}-legacy`, {}]]);
    },
  };
  const runtime = new OutputSurfaceRuntime(renderer);

  assert.equal(runtime.withRenderState({ id: "temporary" }, () => {
    assert.equal(renderer.componentById.has("temporary-component"), true);
    assert.equal(renderer.frameById.has("temporary-frame"), true);
    assert.equal(renderer.routeSourceNodeById.has("temporary-node"), true);
    assert.equal(renderer.routeSourceNodeByLegacyKey.has("temporary-legacy"), true);
    return renderer.state.id;
  }), "temporary");
  assert.equal(renderer.state, originalState);
  assert.equal(renderer.componentById, originalLookups.componentById);
  assert.equal(renderer.frameById, originalLookups.frameById);
  assert.equal(renderer.routeSourceNodeById, originalLookups.routeSourceNodeById);
  assert.equal(renderer.routeSourceNodeByLegacyKey, originalLookups.routeSourceNodeByLegacyKey);
  assert.equal(runtime.withSurfaceRenderIdentityPrefix("from:", () => runtime.renderIdentityPrefix), "from:");
  assert.equal(runtime.renderIdentityPrefix, "");
});
