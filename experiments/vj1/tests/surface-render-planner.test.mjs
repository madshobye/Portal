import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createInitialState } from "../js/domain/models.js";
import { orderedSurfaceProgram, planSurfaceRoutes } from "../js/output/surface-render-planner.js";
import { unifyTransitionComponentRenderRequests } from "../js/output/component-render-layout.js";
import {
  OutputSurfaceRuntime,
  surfaceRouteBlend,
  surfaceRouteOpacity,
  transitionRouteSourceKey,
} from "../js/output/output-surface-runtime.js";

test("transition endpoints share the larger component demand", () => {
  const fromRequest = { timingId: "overall", width: 1920, height: 1080, demandScale: 1 };
  const toRequest = { timingId: "overall", width: 960, height: 540, demandScale: 0.5 };
  const fromRoutes = [{ componentRequest: fromRequest }];
  const toRoutes = [{ componentRequest: toRequest }, { componentRequest: null }];

  unifyTransitionComponentRenderRequests(fromRoutes, toRoutes);

  assert.strictEqual(fromRoutes[0].componentRequest, fromRequest);
  assert.strictEqual(toRoutes[0].componentRequest, fromRequest);
});

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

  const baselineRequest = {
    width: routes[0].componentRequest.width,
    height: routes[0].componentRequest.height,
  };
  component.transform = { ...(component.transform || {}), scale: 8 };
  const scaled = planSurfaceRoutes({
    state,
    mapperSurfaces: new Map([[surface.id, { mapperSurface, direct: true }]]),
    componentById: new Map([[component.id, component]]),
    viewport: { width: 960, height: 540 },
    pixelScale: 1,
    resolveRouteSourceNode: () => ({ id: `component:${component.id}`, componentId: component.id, outputFrameId: "" }),
  });
  assert.deepEqual(
    {
      width: scaled.routes[0].componentRequest.width,
      height: scaled.routes[0].componentRequest.height,
    },
    baselineRequest,
    "root Content scale changes placement, not the routed output texture demand",
  );
});

test("a Surface route renders its source at mapped demand without a parallel Frame model", () => {
  const state = createInitialState();
  const canvas = { ...state.components[0], id: "canvas-a", type: "scene", chain: [] };
  const surface = {
    ...state.surfaces[0],
    id: "surface-a",
    enabled: true,
    componentId: canvas.id,
    sourceNodeId: `component:${canvas.id}`,
  };
  state.components = [canvas];
  state.surfaces = [surface];
  const mapperSurface = {
    name: surface.id,
    corners: [{ x: 0, y: 0 }, { x: 1270, y: 0 }, { x: 1270, y: 855 }, { x: 0, y: 855 }],
  };
  const { routes, metrics } = planSurfaceRoutes({
    state,
    mapperSurfaces: new Map([[surface.id, { mapperSurface, direct: true }]]),
    componentById: new Map([[canvas.id, canvas]]),
    viewport: { width: 1270, height: 855 },
    pixelScale: 1,
    resolveRouteSourceNode: () => ({ id: surface.sourceNodeId, componentId: canvas.id }),
    isComponentRegionSafe: () => true,
  });

  assert.equal(routes[0].componentRequest.role, "texture");
  assert.equal(routes[0].componentRequest.regionView, undefined);
  assert.ok(routes[0].componentRequest.width > 0);
  assert.ok(routes[0].componentRequest.height > 0);
  assert.equal(metrics.componentRasterPixels, routes[0].componentRequest.width * routes[0].componentRequest.height);
});

test("root Content scale uses transformed ROI detail without enlarging Surface allocation", () => {
  const state = createInitialState();
  const component = {
    ...state.components[0],
    id: "component-scaled",
    transform: { x: 0, y: 0, scale: 8, rotation: 0 },
  };
  const surface = {
    ...state.surfaces[0],
    id: "surface-scaled",
    enabled: true,
    componentId: component.id,
  };
  state.components = [component];
  state.surfaces = [surface];
  const mapperSurface = {
    name: surface.id,
    corners: [{ x: 0, y: 0 }, { x: 960, y: 0 }, { x: 960, y: 540 }, { x: 0, y: 540 }],
  };
  const plan = (regionSafe) => planSurfaceRoutes({
    state,
    mapperSurfaces: new Map([[surface.id, { mapperSurface, direct: true }]]),
    componentById: new Map([[component.id, component]]),
    viewport: { width: 960, height: 540 },
    pixelScale: 1,
    resolveRouteSourceNode: () => ({ id: `component:${component.id}`, componentId: component.id }),
    isComponentRegionSafe: () => regionSafe,
  });

  const safe = plan(true);
  const route = safe.routes[0];
  assert.equal(route.componentRequest.regionView, true);
  assert.equal(route.componentRequest.role, "scene-region");
  assert.deepEqual(route.componentRequest.uvRect, [0.4375, 0.4375, 0.125, 0.125]);
  assert.equal(route.componentRequest.width, 960);
  assert.equal(route.componentRequest.height, 544);
  assert.equal(route.surfaceRequest.width, 960);
  assert.equal(route.surfaceRequest.height, 544);
  assert.equal(route.componentRequest.width / route.componentRequest.uvRect[2], 7680);
  assert.deepEqual(safe.metrics.rootTransformDetailLimited, []);

  const unsafe = plan(false);
  assert.equal(unsafe.routes[0].componentRequest.regionView, undefined);
  assert.deepEqual(unsafe.metrics.rootTransformDetailLimited, [component.id]);

  const runtimeSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  assert.match(runtimeSource, /\[VJ1_ROOT_CONTENT_DETAIL_LIMITED\]/);
});

test("Scene root Content scale uses a physical regional request beyond the full-Scene cap", () => {
  const state = createInitialState();
  const scene = {
    ...state.components[0],
    id: "scene-scaled",
    type: "scene",
    transform: { x: 0, y: 0, scale: 8, rotation: 0 },
    canvas: { frameThumbnails: {} },
  };
  const surface = {
    ...state.surfaces[0],
    id: "scene-surface-scaled",
    enabled: true,
    componentId: scene.id,
  };
  state.components = [scene];
  state.surfaces = [surface];
  const mapperSurface = {
    name: surface.id,
    corners: [{ x: 0, y: 0 }, { x: 960, y: 0 }, { x: 960, y: 540 }, { x: 0, y: 540 }],
  };
  const { routes } = planSurfaceRoutes({
    state,
    mapperSurfaces: new Map([[surface.id, { mapperSurface, direct: true }]]),
    componentById: new Map([[scene.id, scene]]),
    viewport: { width: 960, height: 540 },
    pixelScale: 1,
    resolveRouteSourceNode: () => ({ id: `component:${scene.id}`, componentId: scene.id }),
    isComponentRegionSafe: () => true,
  });

  const route = routes[0];
  assert.equal(route.componentRequest.regionView, true);
  assert.deepEqual(route.componentRequest.uvRect, [0.4375, 0.4375, 0.125, 0.125]);
  assert.equal(route.componentRequest.width, route.surfaceRequest.width);
  assert.ok(
    route.componentRequest.width / route.componentRequest.uvRect[2] > route.sourceView.maxRasterSize.width,
    "the logical detail represented by the ROI can exceed the capped full Scene without allocating a full-size target",
  );
  assert.ok(route.componentRequest.width <= 960);
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
  });

  assert.equal(state.surfaces.length > 0, true);
  assert.equal(result.metrics.candidates, 0);
  assert.deepEqual(result.routes, []);
});

test("direct output backplanes composite below mapped Surfaces", () => {
  const mappedA = { id: "mapped-a", destination: { type: "mapped" } };
  const directMain = { id: "direct-main", destination: { type: "direct", outputIds: ["main"] } };
  const mappedB = { id: "mapped-b", destination: { type: "mapped" } };
  const directAll = { id: "direct-all", destination: { type: "direct", outputIds: ["main", "second"] } };

  assert.deepEqual(
    orderedSurfaceProgram([mappedA, directMain, mappedB, directAll]).map((surface) => surface.id),
    ["direct-all", "direct-main", "mapped-a", "mapped-b"]
  );
});

test("transition compositor uses the same direct-backplane ordering", () => {
  const runtimeSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  assert.ok(runtimeSource.includes("for (const route of [...toRoutes, ...fromRoutes])"));
  assert.ok(runtimeSource.includes("orderedSurfaceProgram(transitionSurfaces).map((surface) => surface.id)"));
});

test("embedded Live outlines the selected projection without exposing Mapping handles", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(rendererSource.includes('const liveSelection = workspace === "live"'));
  assert.ok(rendererSource.includes("const revealHandles = mappingSelection && calibrating"));
  assert.ok(rendererSource.includes("if (mapped?.direct)"));
  assert.ok(rendererSource.includes("if (liveSelection) this.renderSelectedDirectOutputFrameOverlay(surfaceId)"));
  assert.ok(rendererSource.includes("outputFramesForIds("));
});

test("output renderer delegates surface demand planning", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const mapperSource = readFileSync(new URL("../js/libraries/mapping-engine/mapping-engine/index.js", import.meta.url), "utf8");

  assert.match(rendererSource, /from "\.\/output-surface-runtime\.js\?v=[^"]+"/);
  assert.match(runtimeSource, /from "\.\/surface-render-planner\.js\?v=[^"]+"/);
  assert.ok(runtimeSource.includes("const { routes, metrics } = planSurfaceRoutes({"));
  assert.ok(runtimeSource.includes("surfaceProgram: orderedSurfaceProgram(surfaceProgram || renderer.mappingProgramSurfaces(renderer.state))"));
  assert.ok(runtimeSource.includes("transformDemandCorners,"));
  assert.ok(runtimeSource.includes('preserveDirectFootprint: renderer.mode === "output"'));
  assert.ok(runtimeSource.includes("renderer.componentRegionSafe?.(component) === true"));
  assert.ok(!runtimeSource.includes("renderer.sceneComponentRegionSafe?.(component) === true"));
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

test("transition route identity ignores Surface geometry but detects source changes", () => {
  const route = {
    surface: {
      id: "surface-1",
      x: 0.1,
      width: 0.4,
      componentId: "component-a",
      sourceNodeId: "source:component-a",
      sourceFit: "cover",
      sourceFitActive: true,
      sourceAspect: 16 / 9,
    },
  };
  const moved = { surface: { ...route.surface, x: 0.5, width: 0.2 } };
  const replaced = { surface: { ...route.surface, componentId: "component-b", sourceNodeId: "source:component-b" } };

  assert.equal(transitionRouteSourceKey(route), transitionRouteSourceKey(moved));
  assert.notEqual(transitionRouteSourceKey(route), transitionRouteSourceKey(replaced));
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
    routeSourceNodeById: new Map([["current-node", {}]]),
  };
  const renderer = {
    state: originalState,
    ...originalLookups,
    rebuildRouteLookups() {
      const id = this.state.id;
      this.componentById = new Map([[`${id}-component`, {}]]);
      this.routeSourceNodeById = new Map([[`${id}-node`, {}]]);
    },
  };
  const runtime = new OutputSurfaceRuntime(renderer);

  assert.equal(runtime.withRenderState({ id: "temporary" }, () => {
    assert.equal(renderer.componentById.has("temporary-component"), true);
    assert.equal(renderer.routeSourceNodeById.has("temporary-node"), true);
    return renderer.state.id;
  }), "temporary");
  assert.equal(renderer.state, originalState);
  assert.equal(renderer.componentById, originalLookups.componentById);
  assert.equal(renderer.routeSourceNodeById, originalLookups.routeSourceNodeById);
  assert.equal(runtime.withSurfaceRenderIdentityPrefix("from:", () => runtime.renderIdentityPrefix), "from:");
  assert.equal(runtime.renderIdentityPrefix, "");
});
