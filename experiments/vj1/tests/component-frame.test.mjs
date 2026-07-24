import test from "node:test";
import assert from "node:assert/strict";

import {
  componentFrameMetrics,
  normalizeComponentFrameShape,
  normalizeComponentResolutionScale,
} from "../js/domain/component-frame.js";
import { createSceneComponent, createDefaultComponent, createDefaultSurface, createInitialState, createMappingFromState, directOutputSurfaceId, normalizeCameraSettings, normalizeComponentPipelineSettings, normalizeProjectionFit, normalizeSamplingSettings, resolveSceneSourceNode, sanitizeState, sceneSourceNodes } from "../js/domain/models.js";

const render = {
  componentAspectRatio: 10 / 7,
  pixelDensity: 0.5,
};

test("generated visual objects use compact default names", () => {
  assert.equal(createDefaultComponent(1).name, "Comp 2");
  assert.equal(createSceneComponent(1).name, "Scene 2");
  assert.equal(createDefaultSurface(1).name, "Srf 2");
});

test("component frame shape derives landscape portrait and square from component dimensions", () => {
  assert.deepEqual(
    pickSize(componentFrameMetrics(render, { frameShape: "landscape", resolutionScale: 1 })),
    { baseWidth: 10000 / 7, baseHeight: 1000, width: 714, height: 500 }
  );
  assert.deepEqual(
    pickSize(componentFrameMetrics(render, { frameShape: "portrait", resolutionScale: 1 })),
    { baseWidth: 1000, baseHeight: 10000 / 7, width: 500, height: 714 }
  );
  assert.deepEqual(
    pickSize(componentFrameMetrics(render, { frameShape: "square", resolutionScale: 1 })),
    { baseWidth: 1000, baseHeight: 1000, width: 500, height: 500 }
  );
});

test("component resolution scale multiplies the global density", () => {
  const low = componentFrameMetrics(render, { frameShape: "landscape", resolutionScale: 0.5 });
  const normal = componentFrameMetrics(render, { frameShape: "landscape", resolutionScale: 1 });
  const high = componentFrameMetrics(render, { frameShape: "landscape", resolutionScale: 2 });

  assert.deepEqual([low.effectiveScale, low.width, low.height], [0.25, 357, 250]);
  assert.deepEqual([normal.effectiveScale, normal.width, normal.height], [0.5, 714, 500]);
  assert.deepEqual([high.effectiveScale, high.width, high.height], [1, 1429, 1000]);

  const highDensity = componentFrameMetrics(
    { ...render, pixelDensity: 4 },
    { frameShape: "landscape", resolutionScale: 1 },
  );
  assert.deepEqual(
    [highDensity.globalDensity, highDensity.effectiveScale, highDensity.width, highDensity.height],
    [4, 4, 5714, 4000],
  );
});

test("component frame settings normalize to backward-compatible defaults", () => {
  assert.equal(normalizeComponentFrameShape("wide"), "landscape");
  assert.equal(normalizeComponentResolutionScale(1.5), 1);

  const created = createDefaultComponent(0);
  assert.equal(created.frameShape, "landscape");
  assert.equal(created.resolutionScale, 1);
  assert.equal(created.syncInstances, true);

  const state = sanitizeState({
    components: [{ ...created, frameShape: "portrait", resolutionScale: 2 }],
  });
  assert.equal(state.components[0].frameShape, "portrait");
  assert.equal(state.components[0].resolutionScale, 2);
  assert.equal(state.components[0].syncInstances, true);

  const independent = sanitizeState({
    components: [{ ...created, syncInstances: false }],
  });
  assert.equal(independent.components[0].syncInstances, false);
});

test("global visual time stretch defaults to one and stays within its live range", () => {
  assert.equal(sanitizeState({}).global.timeStretch, 0);
  assert.equal(sanitizeState({ global: { timeStretch: -8 } }).global.timeStretch, -4);
  assert.equal(sanitizeState({ global: { timeStretch: 8 } }).global.timeStretch, 4);
  assert.equal(sanitizeState({ global: { timeScale: 4 } }).global.timeStretch, 2);
  assert.equal("timeScale" in sanitizeState({ global: { timeScale: 4 } }).global, false);
});

test("legacy fixed pixel fields are removed in favor of proportions and an optional ceiling", () => {
  const state = sanitizeState({
    render: { frameWidth: 1280, frameHeight: 720, surfaceWidth: 320, surfaceHeight: 180 },
  });
  assert.equal(state.render.outputs[0].aspectRatio, 16 / 9);
  assert.equal(state.render.componentAspectRatio, 16 / 9);
  assert.equal(state.render.resolutionCeiling, "auto");
  assert.equal(Object.hasOwn(state.render, "surfaceTexture"), false);
  assert.equal(Object.hasOwn(state.render, "componentTexture"), false);
  assert.equal(Object.hasOwn(state.render, "surfaceWidth"), false);
  assert.equal(Object.hasOwn(state.render, "surfaceHeight"), false);

  const manual = sanitizeState({
    render: {
      frameWidth: 1280,
      frameHeight: 720,
      surfaceTexture: { mode: "manual", maxWidth: 640, maxHeight: 360 },
    },
  });
  assert.equal(manual.render.resolutionCeiling, "auto");
  assert.equal(Object.hasOwn(manual.render, "surfaceTexture"), false);
});

test("component geometry follows its independent proportion without authored pixels", () => {
  const metrics = componentFrameMetrics({
    outputs: [{ id: "main", aspectRatio: 16 / 9 }],
    componentAspectRatio: 16 / 9,
    pixelDensity: 1,
  }, { frameShape: "landscape", resolutionScale: 1 });
  assert.deepEqual(pickSize(metrics), { baseWidth: 1000 * (16 / 9), baseHeight: 1000, width: 1778, height: 1000 });
});

test("adaptive sampling settings remain independent and accept half scale", () => {
  assert.deepEqual(normalizeSamplingSettings({}), {
    surfaceOverscan: 1,
    surfaceDetailScale: 1,
    limitSceneToLogicalSize: true,
  });
  assert.deepEqual(normalizeSamplingSettings({ surfaceOverscan: 0.5, surfaceDetailScale: 0.5 }), {
    surfaceOverscan: 0.5,
    surfaceDetailScale: 0.5,
    limitSceneToLogicalSize: true,
  });
  assert.deepEqual(normalizeSamplingSettings({ surfaceOverscan: 0.1, surfaceDetailScale: 8, limitSceneToLogicalSize: false }), {
    surfaceOverscan: 0.5,
    surfaceDetailScale: 2,
    limitSceneToLogicalSize: false,
  });
});

test("component upscale and post settings normalize with neutral defaults", () => {
  assert.deepEqual(normalizeComponentPipelineSettings({}), {
    upscaling: { enabled: false, amount: 0.67 },
    postProcessing: {
      noiseEnabled: false,
      noiseAmount: 0.035,
      grayscaleEnabled: false,
      grayscaleAmount: 1,
    },
  });

  const state = sanitizeState({
    render: {
      upscaling: { enabled: true, amount: 0.1 },
      postProcessing: {
        noiseEnabled: true,
        noiseAmount: 4,
        grayscaleEnabled: true,
        grayscaleAmount: 0.4,
      },
    },
  });
  assert.deepEqual(state.render.upscaling, { enabled: true, amount: 0.35 });
  assert.deepEqual(state.render.postProcessing, {
    noiseEnabled: true,
    noiseAmount: 0.2,
    grayscaleEnabled: true,
    grayscaleAmount: 0.4,
  });
});

test("legacy pixel output settings migrate to one relative output and multiple outputs persist", () => {
  const legacy = sanitizeState({ render: { frameWidth: 1280, frameHeight: 720 } });
  assert.deepEqual(legacy.render.outputs, [{ id: "output-main", name: "Output 1", aspectRatio: 16 / 9 }]);

  const multi = sanitizeState({
    render: {
      outputs: [
        { id: "left", name: "Left projector", width: 1920, height: 1080 },
        { id: "right", name: "Right projector", width: 1280, height: 800 },
      ],
    },
  });
  assert.equal(multi.render.outputs.length, 2);
  assert.deepEqual(multi.render.outputs.map((output) => output.aspectRatio), [16 / 9, 8 / 5]);
  assert.equal(Object.hasOwn(multi.render, "frameWidth"), false);
  assert.equal(Object.hasOwn(multi.render, "worldWidth"), false);
});

test("configured outputs derive locked direct surfaces without enabling new routes", () => {
  const state = createInitialState();
  state.render.outputs = [
    { id: "output-main", name: "Output 1", width: 1920, height: 1080 },
    { id: "output-2", name: "Output 2", width: 1920, height: 1080 },
  ];
  const normalized = sanitizeState(state);
  const direct = normalized.surfaces.filter((surface) => surface.destination?.type === "direct");
  assert.deepEqual(direct.map((surface) => surface.id), [
    directOutputSurfaceId("all"),
    directOutputSurfaceId("output-main"),
    directOutputSurfaceId("output-2"),
  ]);
  assert.ok(direct.every((surface) => surface.enabled === false));
  assert.deepEqual(direct[0].destination.outputIds, ["output-main", "output-2"]);
  assert.equal(direct[0].destination.parentSurfaceId, "");
  assert.equal(direct[1].destination.parentSurfaceId, directOutputSurfaceId("all"));
  assert.equal(direct[2].destination.parentSurfaceId, directOutputSurfaceId("all"));
  assert.equal(direct[0].projectionFit, "contain");
  assert.equal(direct[0].calibrationLocked, true);

  direct[1].enabled = true;
  direct[1].feather = 0.2;
  const selectedMapping = normalized.mappings.find((mapping) => mapping.id === normalized.ui.selectedMappingId);
  selectedMapping.surfaces = normalized.surfaces;
  const reduced = sanitizeState({
    ...normalized,
    render: { ...normalized.render, outputs: [normalized.render.outputs[0]] },
  });
  const reducedDirect = reduced.surfaces.filter((surface) => surface.destination?.type === "direct");
  assert.deepEqual(reducedDirect.map((surface) => surface.id), [directOutputSurfaceId("output-main")]);
  assert.equal(reducedDirect[0].destination.parentSurfaceId, "");
  assert.equal(reducedDirect[0].enabled, true);
  assert.equal(reducedDirect[0].feather, 0.2);
});

test("camera capture settings normalize resolution direction mirror and maximum mode", () => {
  assert.deepEqual(normalizeCameraSettings({}, 1280, 720), {
    facingMode: "user",
    mirrored: false,
    maxResolution: false,
  });
  assert.deepEqual(normalizeCameraSettings({
    width: 1920,
    height: 1080,
    facingMode: "environment",
    mirrored: true,
    maxResolution: true,
  }), {
    facingMode: "environment",
    mirrored: true,
    maxResolution: true,
  });
});

test("surface projection fit defaults to cover and persists in its Mapping", () => {
  assert.equal(createDefaultSurface(0).projectionFit, "cover");
  assert.equal(createDefaultSurface(0).feather, 0);
  assert.equal(normalizeProjectionFit("contain"), "contain");
  assert.equal(normalizeProjectionFit("stretch"), "stretch");
  assert.equal(normalizeProjectionFit("invalid"), "cover");

  const initial = createInitialState();
  initial.mappings[0].surfaces = [{ id: "surface-a", projectionFit: "contain" }];
  const state = sanitizeState(initial);
  const scene = createMappingFromState(state, "Fit scene");
  assert.equal(state.surfaces[0].projectionFit, "contain");
  assert.equal(scene.surfaces[0].projectionFit, "contain");
});

test("surface feather is a physical surface property and is clamped", () => {
  const initial = createInitialState();
  initial.mappings[0].surfaces = [{ id: "surface-a", feather: 0.75 }];
  const state = sanitizeState(initial);
  assert.equal(state.surfaces[0].feather, 0.5);
  const scene = createMappingFromState(state, "Feather scene");
  assert.equal(scene.surfaces[0].feather, 0.5);
});

test("legacy canvas layers migrate into ordinary Groups without retaining a parallel layer model", () => {
  const source = createDefaultComponent(0);
  source.id = "component-source";
  const state = sanitizeState({
    components: [source, {
      id: "legacy-canvas",
      type: "canvas",
      name: "Legacy Canvas",
      chain: [],
      canvas: {
        width: 2000,
        height: 1000,
        layers: [{
          id: "legacy-layer",
          componentId: source.id,
          name: "Hero",
          x: 120,
          y: 80,
          width: 640,
          height: 360,
          opacity: 0.7,
          blend: "screen",
        }],
      },
    }],
  });
  const scene = state.components.find((component) => component.id === "legacy-canvas");
  assert.equal("layers" in scene.scene, false);
  assert.equal(scene.chain.length, 1);
  assert.equal(scene.chain[0].role, "group");
  assert.equal("layout" in scene.chain[0], false);
  assert.equal(scene.chain[0].opacity, 0.7);
  assert.equal(scene.chain[0].blend, "screen");
  assert.equal(scene.chain[0].chain[0].source.componentId, source.id);
  assert.deepEqual(scene.chain[0].chain[0].source.placement, { scale: 0.48 });
  assert.equal(state.render.sceneAspectRatio, 2);
});

test("Scene source catalogs expose Components through one stable source-node abstraction", () => {
  const component = createDefaultComponent(0);
  component.id = "component-a";
  component.name = "Visual A";
  const scene = createSceneComponent(0, component.id);
  scene.id = "scene-a";
  scene.name = "Spatial Scene";
  const state = sanitizeState({
    version: createInitialState().version,
    components: [component, scene],
  });
  const nodes = sceneSourceNodes(state);
  assert.deepEqual(nodes.map((node) => ({ type: node.type, name: node.name })), [
    { type: "component", name: "Visual A" },
    { type: "component", name: "Spatial Scene" },
  ]);
  assert.equal(resolveSceneSourceNode(state, nodes[1].id).componentId, scene.id);
});

test("stable Scene source IDs are the only runtime routing authority", () => {
  const first = createDefaultComponent(0);
  first.id = "component-first";
  const second = createDefaultComponent(1);
  second.id = "component-second";
  const state = sanitizeState({ components: [first, second] });
  const selectedId = `component:${encodeURIComponent(second.id)}`;

  assert.equal(resolveSceneSourceNode(state, selectedId).componentId, second.id);
  assert.equal(resolveSceneSourceNode(state, "missing-source"), null);
});

test("Surface ownership replaces the removed global Frame registry", () => {
  const state = createInitialState();
  const authored = state.mappings[0].surfaces[0];
  Object.assign(authored, { x: 0.1, y: 0.2, width: 0.5, height: 0.4, projectionFit: "contain" });
  const normalized = sanitizeState(state);
  const surface = normalized.mappings[0].surfaces.find((candidate) => candidate.id === authored.id);

  assert.equal(Object.hasOwn(normalized, "frames"), false);
  assert.deepEqual(
    { x: surface.x, y: surface.y, width: surface.width, height: surface.height, projectionFit: surface.projectionFit },
    { x: 0.1, y: 0.2, width: 0.5, height: 0.4, projectionFit: "contain" }
  );
});

function pickSize(metrics) {
  return {
    baseWidth: metrics.baseWidth,
    baseHeight: metrics.baseHeight,
    width: metrics.width,
    height: metrics.height,
  };
}
