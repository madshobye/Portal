import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatorIcon } from "../js/control/picker-view.js";

import { createCanvasComponent, createComponentEffect, createComponentLayer, createDefaultComponent, createInitialState, createLiveComponentView, sanitizeState, sceneSourceNodeId } from "../js/domain/models.js?v=world-frame-27";
import { normalizeParamValue, renderQualityScale } from "../js/libraries/visual-nodes/shared/component-schema.js";
import { getGeneratorNodeComponent as getGeneratorComponent, listGeneratorNodeComponents as listGeneratorComponents } from "../js/libraries/visual-nodes/index.js";
import { RenderNodeRuntime, textureStateKey } from "../js/libraries/render-engine/render-node-contract.js";
import { compileComponentPatch } from "../js/graph/render-scheduler.js?v=world-frame-27";
import { hasActiveLiveTransition, outputSceneId, queuedSceneTransitionState, retimePreparedSceneTransition, shouldHoldCurrentOutputState, shouldPrepareLiveSceneState, transitionTerminalState } from "../js/output/output-app.js";
import { drawMediaFit } from "../js/output/media-utils.js?v=surface-media-contract-6";
import { registerRenderTarget, RENDER_TARGET_KIND } from "../js/output/render-target-contract.js?v=render-core-contract-1";
import { isReadyMediaItem } from "../js/output/component-render-state.js";
import { advanceRateClock, advanceSpatialScale, modelDepthCutoff, OutputRenderer, parseObjMesh, qualityAdjustedGeneratorParams, qualityScaledRenderRequest, resolutionScaledStrokeWidth, sourceWithNodeParams, terrainExpandedGridWireVertices, terrainExpandedWireVertices, terrainGridSize, terrainSafeNearDistance, terrainSurfaceGridVertices, terrainSurfaceTriangleIndices, terrainTriangleEdgeUvs, transformedModelDepthRange } from "../js/output/output-renderer.js?v=world-frame-27";
import { terrainCameraView } from "../js/output/specialized/specialized-source-runtime.js";
import { getMediaType, isMediaFile } from "../js/services/media-library-service.js";

test("media drawing keeps p5 wrappers for WebGL and browser elements for Canvas2D", () => {
  const element = { tagName: "VIDEO", videoWidth: 640, videoHeight: 360 };
  const media = { elt: element, width: 640, height: 360, hide() {} };
  const webglCalls = [];
  const canvasCalls = [];
  drawMediaFit({ __vj1SharedFramebuffer: true, image: (...args) => webglCalls.push(args) }, media, 0, 0, 320, 180);
  drawMediaFit({ drawingContext: { drawImage: (...args) => canvasCalls.push(args) } }, media, 0, 0, 320, 180);
  assert.equal(webglCalls[0][0], media);
  assert.equal(canvasCalls[0][0], element);
});

test("raw canvases draw directly into 2D Graphics without entering the p5 image fallback", () => {
  const element = { tagName: "CANVAS", width: 320, height: 180 };
  const canvasCalls = [];
  let p5Calls = 0;
  drawMediaFit({
    drawingContext: { drawImage: (...args) => canvasCalls.push(args) },
    image() { p5Calls++; },
  }, element, 0, 0, 640, 360);
  assert.deepEqual(canvasCalls[0], [element, 0, 0, 640, 360]);
  assert.equal(p5Calls, 0);
});

test("raw canvases use a Graphics canvas context when p5 does not expose drawingContext", () => {
  const element = { tagName: "CANVAS", width: 320, height: 180 };
  const canvasCalls = [];
  const target = {
    canvas: { getContext: () => ({ drawImage: (...args) => canvasCalls.push(args) }) },
    image() { throw new Error("p5 image path must not run"); },
  };
  drawMediaFit(target, element, 0, 0, 640, 360);
  assert.deepEqual(canvasCalls[0], [element, 0, 0, 640, 360]);
});

test("raw browser media is bridged to a p5 image before WebGL texture upload", () => {
  const element = { tagName: "IMG", naturalWidth: 640, naturalHeight: 360 };
  const drawCalls = [];
  const bridge = {
    canvas: { getContext: () => ({ drawImage: (...args) => drawCalls.push(args), clearRect() {} }) },
    loadPixels() {},
    setModified(value) { this.modified = value; },
  };
  const previousCreateImage = globalThis.createImage;
  globalThis.createImage = () => bridge;
  try {
    const webglCalls = [];
    drawMediaFit({ __vj1SharedFramebuffer: true, image: (...args) => webglCalls.push(args) }, element, 0, 0, 320, 180);
    assert.equal(webglCalls[0][0], bridge);
    assert.equal(drawCalls[0][0], element);
    assert.equal(bridge.modified, true);
  } finally {
    globalThis.createImage = previousCreateImage;
  }
});

test("registered p5 WebGL targets bridge raw screen canvases even without private p5 renderer flags", () => {
  const element = { tagName: "CANVAS", width: 1280, height: 720 };
  const bridge = {
    canvas: { getContext: () => ({ drawImage() {}, clearRect() {} }) },
    loadPixels() {},
    setModified() {},
  };
  const target = { imageCalls: [], image(...args) { this.imageCalls.push(args); } };
  registerRenderTarget(target, { kind: RENDER_TARGET_KIND.p5GraphicsWebgl });
  const previousCreateImage = globalThis.createImage;
  globalThis.createImage = () => bridge;
  try {
    drawMediaFit(target, element, 0, 0, 640, 360);
    assert.equal(target.imageCalls[0][0], bridge);
  } finally {
    globalThis.createImage = previousCreateImage;
  }
});

test("screen share is a live generator with native-aspect fit modes", () => {
  const generator = getGeneratorComponent("screenShare");
  assert.equal(generator.name, "Screen Share");
  assert.equal(generator.runtime.timeDependent({}), true);
  const inputParam = generator.params.find((param) => param.id === "inputId");
  assert.equal(inputParam.type, "text");
  assert.equal(inputParam.ui, "screen-input");
  assert.equal(inputParam.defaultValue, "");
  const fitParam = generator.params.find((param) => param.id === "fit");
  assert.deepEqual(fitParam.values, ["contain", "cover", "stretch"]);
  assert.equal(fitParam.defaultValue, "contain");

  const calls = [];
  const video = { tagName: "VIDEO", videoWidth: 1920, videoHeight: 1080, readyState: 4 };
  drawMediaFit({ image: (...args) => calls.push(args) }, video, 0, 0, 400, 400, "contain");
  assert.deepEqual(calls[0].slice(1), [0, 87.5, 400, 225]);
  calls.length = 0;
  drawMediaFit({ image: (...args) => calls.push(args) }, video, 0, 0, 400, 400, "stretch");
  assert.deepEqual(calls[0].slice(1), [0, 0, 400, 400]);
});

test("media sources keep trim and playback speed through normalization and graph compile", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(0, {
      type: "media",
      mediaId: "clips/loop.mov",
      start: 1.25,
      end: 5.5,
      speed: 0.65,
      params: {
        fit: "contain",
      },
    }),
  ];
  state.components = [component];

  const normalized = sanitizeState(state);
  const source = normalized.components[0].chain[0].source;
  assert.equal(source.start, 1.25);
  assert.equal(source.end, 5.5);
  assert.equal(source.speed, 0.65);
  assert.equal(source.params.fit, "contain");

  const patch = compileComponentPatch(normalized.components[0]);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.start, 1.25);
  assert.equal(sourceNode.params.end, 5.5);
  assert.equal(sourceNode.params.speed, 0.65);
  assert.equal(sourceNode.params.fit, "contain");
});

test("generator sources keep personality params through normalization and graph compile", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(0, {
      type: "generator",
      generatorId: "eyeball",
      params: {
        irisSize: 1.2,
        pupilSize: 1.35,
        motionSpeed: 0.45,
        pauseAmount: 0.9,
        jitter: 0.8,
      },
    }),
  ];
  state.components = [component];

  const normalized = sanitizeState(state);
  const source = normalized.components[0].chain[0].source;
  assert.equal(source.generatorId, "eyeball");
  assert.equal(source.params.irisSize, 1.2);
  assert.equal(source.params.pupilSize, 1.35);
  assert.equal(source.params.motionSpeed, 0.45);
  assert.equal(source.params.pauseAmount, 0.9);
  assert.equal(source.params.jitter, 0.8);

  const patch = compileComponentPatch(normalized.components[0]);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.generatorId, "eyeball");
  assert.equal(sourceNode.params.irisSize, 1.2);
  assert.equal(sourceNode.params.pupilSize, 1.35);
  assert.equal(sourceNode.params.motionSpeed, 0.45);
  assert.equal(sourceNode.params.pauseAmount, 0.9);
  assert.equal(sourceNode.params.jitter, 0.8);
});

test("every generator exposes the shared render quality budget at the current midpoint", () => {
  for (const component of listGeneratorComponents()) {
    const quality = component.params.find((param) => param.id === "renderQuality");
    assert.ok(quality, `${component.id} is missing renderQuality`);
    assert.equal(quality.defaultValue, 0.5);
  }
  assert.equal(renderQualityScale({ renderQuality: 0.5 }), 1);
  assert.ok(renderQualityScale({ renderQuality: 0 }) < renderQualityScale({ renderQuality: 0.5 }));
  assert.equal(renderQualityScale({ renderQuality: 1 }), 1);
});

test("unknown generators fail instead of becoming Test Pattern", () => {
  assert.throws(() => getGeneratorComponent("missing-generator"), /VJ1_UNKNOWN_GENERATOR/);
});

test("render quality preserves current work at midpoint and scales expensive work around it", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const request = { role: "component", width: 1280, height: 720 };
  assert.deepEqual(qualityScaledRenderRequest(request, { renderQuality: 0.5 }), request);
  assert.deepEqual(qualityScaledRenderRequest(request, { renderQuality: 1 }), request);
  assert.deepEqual(qualityScaledRenderRequest(request, { renderQuality: 0 }), {
    ...request,
    width: 448,
    height: 252,
    logicalWidth: 1280,
    logicalHeight: 720,
    qualityScale: 0.35,
  });

  assert.equal(qualityAdjustedGeneratorParams("cloudyTunnel", { renderQuality: 0.5, raySteps: 72 }).raySteps, 72);
  assert.equal(qualityAdjustedGeneratorParams("cloudyTunnel", { renderQuality: 0, raySteps: 72 }).raySteps, 25);
  assert.equal(qualityAdjustedGeneratorParams("cloudyTunnel", { renderQuality: 1, raySteps: 72 }).raySteps, 108);
  assert.ok(rendererSource.includes("this.getFxPingPongTarget(renderRequest, 0)"));
  assert.ok(rendererSource.includes('shader.setUniform("resolution", [logicalWidth, logicalHeight])'));
  assert.ok(rendererSource.includes('shader.setUniform("texelSize", [1 / logicalWidth, 1 / logicalHeight])'));
});

test("fireflies generator exposes cost and motion controls", () => {
  const component = getGeneratorComponent("fireflies");
  const ids = component.params.map((param) => param.id);
  const tintParam = component.params.find((param) => param.id === "tintColor");

  assert.deepEqual(ids, ["renderQuality", "count", "glowSize", "speed", "trail", "brightness", "twinkle", "tintColor"]);
  assert.equal(normalizeParamValue(component.params.find((param) => param.id === "count"), undefined), 18);
  assert.equal(normalizeParamValue(component.params.find((param) => param.id === "trail"), undefined), 0.25);
  assert.equal(tintParam.type, "color");
  assert.equal(normalizeParamValue(tintParam, undefined), "#fff06dff");
});

test("gradient generator exposes rgba color stops", () => {
  const component = getGeneratorComponent("gradient");
  const colorParams = component.params.filter((param) => param.type === "color");
  const modeParam = component.params.find((param) => param.id === "mode");

  assert.equal(modeParam.type, "enum");
  assert.deepEqual(modeParam.values, ["linear", "radial", "single"]);
  assert.equal(modeParam.defaultValue, "linear");
  assert.deepEqual(colorParams.map((param) => param.id), ["colorA", "colorB", "colorC", "colorD"]);
  assert.equal(normalizeParamValue(colorParams[3], undefined), "#00000000");
  assert.equal(normalizeParamValue(colorParams[0], "#11223380"), "#11223380");
});

test("Shadertoy base warp is exposed as a generator with clock speed", () => {
  const component = getGeneratorComponent("shadertoyBaseWarp");
  const ids = component.params.map((param) => param.id);
  const speed = component.params.find((param) => param.id === "speed");
  const builderSource = readFileSync(new URL("../js/shaders/shader-builder.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const targetRuntimeSource = readFileSync(new URL("../js/output/shader-target-runtime.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(component.name, "Base Warp");
  assert.equal(component.category, "shadertoy");
  assert.equal(speed.defaultValue, 1);
  assert.deepEqual(ids, ["renderQuality", "speed", "scale", "rotation", "offsetX", "offsetY", "warpAmount", "contrast", "brightness", "paletteShift", "paletteBalance", "shadowColor", "midtoneColor", "highlightColor", "saturation", "amount"]);
  for (const id of ["shadowColor", "midtoneColor", "highlightColor"]) {
    assert.equal(component.params.find((param) => param.id === id).type, "color");
  }
  assert.equal(component.params.find((param) => param.id === "amount").defaultValue, 1);
  assert.ok(builderSource.includes('component?.type === "shadertoy"'));
  assert.ok(builderSource.includes("uniform vec3 iResolution"));
  assert.ok(builderSource.includes("varying vec2 vTexCoord;"));
  assert.ok(builderSource.includes("vec2 baseUv = renderUvRect.xy + vTexCoord * renderUvRect.zw;"));
  assert.ok(builderSource.includes("vec2(shaderUv.x, 1.0 - shaderUv.y) * iResolution.xy"));
  assert.ok(builderSource.includes("vj1MainImage(fragColor, shadertoyFragCoord)"));
  assert.ok(rendererSource.includes('setShaderUniformIfPresent(shader, "iTime", shaderTime)'));
  assert.ok(rendererSource.includes("shaderDrawingBufferSize(target"));
  assert.ok(targetRuntimeSource.includes("gl?.drawingBufferWidth"));
  assert.ok(runtimeSource.includes('generatorId === "shadertoyBaseWarp"'));
});

test("Cellular Circles exposes bounded animated Shadertoy controls", () => {
  const component = getGeneratorComponent("cellularCircles");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(component.name, "Cellular Circles");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "scale", "searchRadius", "orbitRadius", "cellMotion", "rotationSpeed", "offsetX", "offsetY", "circularity", "glowPower", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Cellular Circles control ${id}`);
  }
  assert.equal(params.searchRadius.max, 5);
  assert.equal(params.searchRadius.defaultValue, 5);
  for (const id of ["cellColor", "backgroundColor"]) {
    assert.equal(params[id].type, "color", `missing Cellular Circles color ${id}`);
  }
  assert.ok(runtimeSource.includes('generatorId === "cellularCircles"'));
});

test("Lightning exposes transparent strike and brightness controls", () => {
  const component = getGeneratorComponent("lightning");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(component.name, "Lightning");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "frequency", "duration", "boltWidth", "jaggedness", "positionSpread", "boltLength", "glow", "glare", "brightness", "seed", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Lightning control ${id}`);
  }
  assert.equal(params.strikeColor.type, "color");
  assert.ok(runtimeSource.includes('generatorId === "lightning"'));
});

test("Sun Rays exposes compact animated light controls", () => {
  const component = getGeneratorComponent("sunRays");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Sun Rays");
  assert.equal(component.category, "light");
  for (const id of ["rayCount", "rayWidth", "rayLength", "coreSize", "lengthVariation", "edgeSoftness", "rotation", "rotationSpeed", "shimmer", "shimmerScale", "shimmerSpeed", "speed", "centerX", "centerY", "brightness", "seed", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Sun Rays control ${id}`);
  }
  for (const id of ["rayColorA", "rayColorB", "coreColor", "backgroundColor"]) {
    assert.equal(params[id].type, "color", `missing Sun Rays color ${id}`);
  }
  assert.equal(component.runtime.timeDependent({ speed: 0, rotationSpeed: 1, shimmer: 1, shimmerSpeed: 1 }), false);
  assert.equal(component.runtime.timeDependent({ speed: 1, rotationSpeed: 0, shimmer: 1, shimmerSpeed: 1 }), true);
  assert.equal(generatorIcon("sunRays"), "sunny");
});

test("Fog exposes transparent quality-aware atmosphere controls and a steady mode", () => {
  const component = getGeneratorComponent("fog");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Fog");
  assert.equal(component.category, "atmosphere");
  assert.deepEqual(params.motionMode.values, ["steady", "drift", "billow"]);
  for (const id of ["speed", "density", "coverage", "noisiness", "scale", "detail", "fromBelow", "fromAbove", "billow", "variation", "falloff", "softness", "driftAngle", "seed", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Fog control ${id}`);
  }
  assert.equal(params.fogColor.type, "color");
  assert.equal(params.detail.max, 5);
  assert.equal(params.fromBelow.defaultValue, 0);
  assert.equal(params.fromAbove.defaultValue, 0.08);
  assert.equal(component.runtime.timeDependent({ motionMode: "steady", speed: 1 }), false);
  assert.equal(component.runtime.timeDependent({ motionMode: "drift", speed: 0 }), false);
  assert.equal(component.runtime.timeDependent({ motionMode: "drift", speed: 0.5 }), true);
  assert.equal(generatorIcon("fog"), "foggy");
});

test("Volumetric Clouds exposes a bounded quality-aware transparent volume", () => {
  const component = getGeneratorComponent("volumetricClouds");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(component.name, "Volumetric Clouds");
  assert.equal(component.category, "atmosphere");
  for (const id of ["speed", "density", "coverage", "scale", "detail", "raySteps", "softness", "thickness", "altitude", "cameraTilt", "fieldOfView", "windAngle", "absorption", "brightness", "seed", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Volumetric Clouds control ${id}`);
  }
  for (const id of ["cloudColor", "shadowColor"]) {
    assert.equal(params[id].type, "color", `missing Volumetric Clouds color ${id}`);
  }
  assert.equal(params.raySteps.max, 48);
  assert.equal(params.detail.max, 4);
  assert.equal(component.runtime.timeDependent({ speed: 0 }), false);
  assert.equal(component.runtime.timeDependent({ speed: 0.2 }), true);
  assert.equal(generatorIcon("volumetricClouds"), "filter_drama");
  assert.ok(runtimeSource.includes('generatorId === "volumetricClouds"'));
  assert.equal(qualityAdjustedGeneratorParams("volumetricClouds", { renderQuality: 0.5, raySteps: 28, detail: 3 }).raySteps, 28);
  assert.equal(qualityAdjustedGeneratorParams("volumetricClouds", { renderQuality: 0, raySteps: 28, detail: 3 }).raySteps, 10);
  assert.equal(qualityAdjustedGeneratorParams("volumetricClouds", { renderQuality: 1, raySteps: 28, detail: 3 }).raySteps, 42);
});

test("Seascape exposes bounded artistic controls", () => {
  const component = getGeneratorComponent("seascape");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(component.name, "Seascape");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "waveHeight", "choppiness", "waveScale", "seaDetail", "raySteps", "cameraHeight", "cameraPitch", "cameraMotion", "fieldOfView", "horizonCurve", "skyBrightness", "sunAngle", "sunElevation", "specularStrength", "saturation", "gamma"]) {
    assert.equal(params[id].type, "number", `missing numeric Seascape control ${id}`);
  }
  for (const id of ["waterBaseColor", "waterLightColor", "skyTint"]) {
    assert.equal(params[id].type, "color", `missing Seascape color ${id}`);
  }
  assert.equal(params.seaDetail.max, 5);
  assert.equal(params.raySteps.defaultValue, 18);
  assert.ok(runtimeSource.includes('generatorId === "seascape"'));
});

test("Paint Drips exposes self-contained artistic controls", () => {
  const component = getGeneratorComponent("paintDrips");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(component.name, "Paint Drips");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "variation", "dripSpacing", "dripDensity", "dripThickness", "bounceCurve", "cycleLength", "bounceRange", "fallSpeed", "ceilingDepth", "ceilingRoughness", "edgeSoftness", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Paint Drips control ${id}`);
  }
  for (const id of ["paintColor", "backgroundColor"]) {
    assert.equal(params[id].type, "color", `missing Paint Drips color ${id}`);
  }
  assert.ok(runtimeSource.includes('generatorId === "paintDrips"'));
});

test("Cloudy Tunnel exposes bounded self-contained controls", () => {
  const component = getGeneratorComponent("cloudyTunnel");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(component.name, "Cloudy Tunnel");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "raySteps", "cloudDensity", "cloudScale", "cloudDetail", "tunnelRadius", "tunnelSpread", "pathBend", "pathFrequency", "cameraSway", "fieldOfView", "fogStrength", "vignette", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Cloudy Tunnel control ${id}`);
  }
  for (const id of ["tunnelColor", "fogColor"]) {
    assert.equal(params[id].type, "color", `missing Cloudy Tunnel color ${id}`);
  }
  assert.equal(params.raySteps.defaultValue, 72);
  assert.ok(runtimeSource.includes('generatorId === "cloudyTunnel"'));
});

test("Cherenkov Volume exposes bounded volumetric controls", () => {
  const component = getGeneratorComponent("cherenkovVolume");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(component.name, "Cherenkov Volume");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "raySteps", "zoom", "rotationSpeed", "verticalOffset", "patternScale", "emissionStrength", "absorption", "brightness", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Cherenkov Volume control ${id}`);
  }
  for (const id of ["farColor", "nearColor", "backgroundColor"]) {
    assert.equal(params[id].type, "color", `missing Cherenkov Volume color ${id}`);
  }
  assert.equal(params.raySteps.defaultValue, 96);
  assert.ok(runtimeSource.includes('generatorId === "cherenkovVolume"'));
});

test("Biomine Lite exposes performance and material controls", () => {
  const component = getGeneratorComponent("biomineLite");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(component.name, "Biomine Lite");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "raySteps", "viewDistance", "fieldOfView", "pathAmount", "organicMotion", "gyroidScale", "tubeThickness", "tunnelRadius", "surfaceDetail", "specularStrength", "fogStrength", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Biomine Lite control ${id}`);
  }
  for (const id of ["tubeColor", "wallColor", "glowColor", "skyColor"]) {
    assert.equal(params[id].type, "color", `missing Biomine Lite color ${id}`);
  }
  assert.equal(params.raySteps.defaultValue, 36);
  assert.equal(params.surfaceDetail.defaultValue, 1);
  assert.ok(runtimeSource.includes('generatorId === "biomineLite"'));
});

test("low poly anatomy generator exposes body part and stl-style 3d controls", () => {
  const component = getGeneratorComponent("anatomy");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const rendererSource = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/generators/anatomy/runtime.js", import.meta.url), "utf8"),
  ].join("\n");

  assert.equal(component.name, "Low Poly Anatomy");
  assert.equal(component.category, "character");
  assert.deepEqual(params.part.values, ["face", "body", "hand", "arm", "leg", "heart"]);
  assert.deepEqual(params.renderMode.values, ["surface", "wireframe", "surfaceWire", "points"]);
  assert.equal(params.renderMode.defaultValue, "surface");
  assert.equal(params.detail.defaultValue, 8);
  for (const id of ["surfaceColor", "wireColor", "modelScale", "rotationX", "rotationY", "rotationZ", "spinX", "spinY", "spinZ", "depth", "wireThickness", "detail"]) {
    assert.ok(params[id], `missing ${id}`);
  }
  for (const id of ["expression", "mouthOpen", "brow", "eyeSquint", "fingerBend", "limbBend", "heartPulse"]) {
    assert.ok(params[id], `missing anatomy behavior param ${id}`);
  }
  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "output/specialized:anatomy");
  assert.equal(component.nodeDefinition.metadata.nodeOwnedNativeModule, true);
  assert.ok(rendererSource.includes('"output/specialized:anatomy": "drawAnatomyGenerator"'));
  assert.ok(rendererSource.includes("drawProceduralAnatomy("));
  assert.ok(rendererSource.includes("anatomyTaperedSegment("));
  assert.ok(rendererSource.includes("anatomyProfileVolume("));
  assert.ok(rendererSource.includes("anatomyPathVolume("));
  assert.ok(rendererSource.includes("anatomyPartFitScale("));
  assert.ok(rendererSource.includes("target.scale(scale, -scale, scale * depth);"));
  assert.ok(rendererSource.includes("drawAnatomyFinger("));
  assert.ok(rendererSource.includes("drawAnatomyArmChain("));
  assert.ok(rendererSource.includes("drawAnatomyLegChain("));
  assert.ok(rendererSource.includes("drawLowPolyHeart("));
  assert.equal(generatorIcon("anatomy"), "accessibility_new");
});

test("terrain flyover exposes flight, terrain, wire, and biome controls", () => {
  const component = getGeneratorComponent("terrainFlyover");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");
  const rendererSource = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/terrain-mesh.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/terrain-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/generators/terrain-flyover/runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/generators/terrain-flyover/shaders.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/render-engine/raw-webgl-state.js", import.meta.url), "utf8"),
  ].join("\n");
  const profileSource = readFileSync(new URL("../js/output/output-render-profile.js", import.meta.url), "utf8");

  assert.equal(component.name, "Terrain Flyover");
  assert.equal(component.category, "organic");
  assert.deepEqual(params.style.values, ["biome", "wire", "hybrid"]);
  assert.deepEqual(params.flightMode.values, ["free", "terrainFollow"]);
  assert.equal(params.style.defaultValue, "hybrid");
  for (const id of ["flightSpeed", "turn", "altitude", "pitch", "fieldOfView", "nearClip", "farClip", "lookAhead", "noseFollow", "mountainHeight", "terrainScale", "textureGrain", "textureDepth", "colorDirection", "lakeLevel", "viewDistance", "globeRadius", "gridWidth", "gridDepth", "gridDensity", "gridScale", "gridJitter", "wireWidth"]) {
    assert.equal(params[id].type, "number", `missing numeric terrain param ${id}`);
  }
  for (const id of ["waterColor", "grassColor", "rockColor", "snowColor", "downSlopeColor", "directionColor", "wireColor", "skyColor"]) {
    assert.equal(params[id].type, "color", `missing terrain color ${id}`);
  }
  assert.equal(generatorIcon("terrainFlyover"), "landscape");
  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "output/specialized:terrainFlyover");
  assert.equal(component.nodeDefinition.metadata.nodeOwnedNativeModule, true);
  assert.ok(rendererSource.includes('"output/specialized:terrainFlyover": "drawTerrainGenerator"'));
  assert.ok(rendererSource.includes("this.targets = new Map()"));
  assert.ok(rendererSource.includes("this.getTerrainTarget(renderRequest.width, renderRequest.height, renderRequest.pixelDensity)"));
  assert.ok(rendererSource.includes("disposeGraphicsMap(this.targets)"));
  assert.ok(rendererSource.includes("this.terrainSurfaceResources = new Map()"));
  assert.ok(rendererSource.includes("drawTerrainSurface(target, this.terrainSurfaceResources"));
  assert.ok(rendererSource.includes("updateTerrainSurfaceBuffers(gl, resources, widthCells, depthCells, baseRow, terrainModule, moduleRevision)"));
  assert.ok(rendererSource.includes("gl.drawElements(gl.TRIANGLES, resources.count, gl.UNSIGNED_SHORT, 0)"));
  assert.ok(rendererSource.includes("terrainSurfaceGridVertices(widthCells, depthCells)"));
  assert.ok(rendererSource.includes("terrainSurfaceTriangleIndices(widthCells, depthCells, baseRow)"));
  assert.ok(!rendererSource.includes("function drawTerrainSurfaceMesh("));
  assert.ok(rendererSource.includes("continuousRateTime(`${source.instanceId || source.generatorId || \"terrain\"}:flight`"));
  assert.ok(rendererSource.includes("gl.drawArrays(gl.TRIANGLES, 0, resources.count)"));
  assert.ok(rendererSource.includes("if (style === 2)"));
  assert.ok(rendererSource.includes("gl.polygonOffset(1, 2)"));
  assert.ok(rendererSource.includes("if (style !== 1) target.background"));
  assert.ok(rendererSource.includes("markRenderTargetOrientation(target, RENDER_TEXTURE_ORIENTATION.topLeft)"));
  assert.ok(rendererSource.includes("program: gl.getParameter(gl.CURRENT_PROGRAM)"));
  assert.ok(rendererSource.includes("gl.useProgram(state.program)"));
  assert.ok(!rendererSource.includes("previousLiveSceneId !== nextLiveSceneId"));
  assert.ok(rendererSource.includes("terrainSurfaceResourcesValid(gl, resources)"));
  assert.ok(rendererSource.includes("disposeTerrainSurfaceResources(gl, resources)"));
  assert.ok(rendererSource.includes("terrainWireResourcesValid(gl, resources)"));
  assert.ok(rendererSource.includes("disposeTerrainWireResources(gl, resources)"));
  assert.ok(rendererSource.includes("captureVertexAttributeState(gl, location)"));
  assert.ok(rendererSource.includes("restoreVertexAttributeState(gl, state)"));
  assert.ok(rendererSource.includes("function terrainIrregularMesh("));
  assert.ok(rendererSource.includes("terrainExpandedGridWireVertices(widthCells, depthCells)"));
  assert.ok(rendererSource.includes("gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)"));
  assert.ok(rendererSource.includes("measureComponentProfile(meta, fn)"));
  assert.ok(profileSource.includes("const outermost = this.componentDepth === 0"));
  assert.ok(profileSource.includes("if (outermost) this.frameProfile.componentWallMs += ms"));
  assert.ok(!rendererSource.includes("float rowTravel = fract("));
  assert.ok(rendererSource.includes("float distance = meshUv.y * rowSpacing - cameraTravel"));
  assert.ok(rendererSource.includes("travel * (cameraTravel + distance) + right * worldLateral"));
  assert.ok(rendererSource.includes("planetRadius - sqrt(max(planetRadius * planetRadius - radialDistance * radialDistance"));
  assert.equal(params.altitude.max, 10000);
  assert.equal(params.altitude.scale, "log");
  assert.equal(params.flightSpeed.max, 3);
  assert.equal(params.globeRadius.max, 10000);
  assert.equal(params.mountainHeight.max, 100);
  assert.equal(params.lakeLevel.min, -100);
  assert.equal(params.lakeLevel.max, 100);
  assert.equal(params.gridWidth.defaultValue, 48);
  assert.equal(params.gridDepth.defaultValue, 48);
  assert.equal(params.gridDensity.defaultValue, 1);
  assert.equal(params.gridScale.max, 20);
  assert.equal(terrainGridSize(2), 8);
  assert.equal(terrainGridSize(48), 48);
  assert.equal(terrainGridSize(200), 144);
  assert.equal(params.pitch.min, -1.4);
  assert.equal(params.fieldOfView.defaultValue, 60);
  assert.equal(params.nearClip.label, "Near clip minimum");
  assert.equal(params.nearClip.defaultValue, 0.1);
  assert.equal(params.farClip.defaultValue, 20000);
  assert.ok(parameterSource.includes('data-number-scale="log"'));
  assert.ok(rendererSource.includes("float focalLength = 1.0 / tan(radians(clamp(fieldOfView"));
  assert.ok(rendererSource.includes("worldLateral * focalLength / max(aspectRatio, 0.01)"));
  assert.ok(rendererSource.includes("(meshUv.x - 0.5) * gridCells.x * cellScale * 1.44"));
  assert.ok(rendererSource.includes("terrainTessellationSize(widthCells, params.gridDensity)"));
  assert.ok(rendererSource.includes("terrainClipYFromWorldUp(cameraY) * focalLength"));
  assert.ok(rendererSource.includes("terrainSafeNearDistance(params)"));
  assert.ok(rendererSource.includes("return max(nearClip, 0.01)"));
  assert.equal((rendererSource.match(/terrainSafeNearPlane\(\)/g) || []).length, 4, "surface depth and wire clipping share one mesh-safe near plane");
  assert.ok(rendererSource.includes("vec3 screenUvH = vec3("));
  assert.ok(rendererSource.includes("vec3 placedUvH = contentPlacementMatrix * screenUvH"));
  assert.ok(rendererSource.includes("vec3 roiUvH = vec3("));
  assert.ok(rendererSource.includes("clip.w = roiUvH.z"));
  assert.ok(!rendererSource.includes("max(abs(clip.w)"));
  assert.ok(rendererSource.includes("float verticalWorld = relativeSurfaceHeight - globeDrop - max(altitude, 0.0)"));
  assert.ok(rendererSource.includes("float alpha = water ? waterColor.a : terrainAlpha"));
  assert.ok(rendererSource.includes("if (textureDepth > 0.001)"));
  assert.ok(rendererSource.includes("if (textureGrain > 0.001)"));
  assert.ok(rendererSource.includes("float downSlopeBlend = smoothstep"));
  assert.ok(rendererSource.includes("dot(surfaceAspect, colorHeading)"));
  assert.ok(rendererSource.includes("terrainAlpha = mix(terrainAlpha, snowColor.a, snowBand)"));
  assert.ok(rendererSource.includes("float relativeSurfaceHeight = surfaceHeight - cameraSurfaceHeight * followAmount"));
  assert.ok(rendererSource.includes("float slopePitch = atan((aheadSurfaceHeight - cameraSurfaceHeight) / aheadDistance) * noseFollow"));
  assert.ok(rendererSource.includes("* thickness * 0.5 * aSide * clip.w"));
  assert.ok(rendererSource.includes("if (startClip.w < clipNear && endClip.w < clipNear)"));
  assert.ok(!rendererSource.includes("surfaceHeight * mix(0.0, 0.50, nearAmount) * horizonRelief / max(altitude"));
  assert.ok(!rendererSource.includes("vTerrainUv * 40.0"));
});

test("terrain near clipping has one numeric mesh-footprint contract", () => {
  const defaultFloor = terrainSafeNearDistance({
    nearClip: 0.1,
    gridWidth: 48,
    gridDepth: 48,
    gridDensity: 1,
    gridScale: 1,
  });
  assert.ok(Math.abs(defaultFloor - Math.hypot(2.16, 1.5)) < 1e-9);
  assert.equal(terrainSafeNearDistance({ nearClip: 10, gridWidth: 48, gridDepth: 48 }), 10);
  assert.ok(terrainSafeNearDistance({ gridDensity: 2 }) < defaultFloor, "denser meshes permit a closer stable near plane");
  assert.ok(terrainSafeNearDistance({ gridScale: 4 }) > defaultFloor, "larger cells move the safe near plane outward");
});

test("terrain flight speed changes preserve travel phase", () => {
  const first = advanceRateClock(null, 10, 1);
  const beforeChange = advanceRateClock(first, 11, 1);
  const changed = advanceRateClock(beforeChange, 11, 4);
  const afterChange = advanceRateClock(changed, 11.25, 4);

  assert.equal(beforeChange.time, 11);
  assert.equal(changed.time, beforeChange.time);
  assert.equal(afterChange.time, 12);
});

test("terrain scale changes preserve noise phase at the camera anchor", () => {
  const anchor = [18, 42];
  const first = advanceSpatialScale(null, 0.5, anchor);
  const changed = advanceSpatialScale(first, 1.25, anchor);

  assert.deepEqual(first.phase, [0, 0]);
  assert.equal(anchor[0] * first.scale + first.phase[0], anchor[0] * changed.scale + changed.phase[0]);
  assert.equal(anchor[1] * first.scale + first.phase[1], anchor[1] * changed.scale + changed.phase[1]);
});

test("terrain camera space is independent from generic chain transforms", () => {
  const view = terrainCameraView({ altitude: 6, turn: 0.25 }, 2);
  const runtimeSource = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const drawTerrainSource = runtimeSource.slice(runtimeSource.indexOf("  drawTerrain("), runtimeSource.indexOf("  drawModel("));

  assert.equal(view.altitude, 6);
  assert.equal(view.turn, 0.25);
  assert.equal(view.cameraAnchor.length, 2);
  assert.match(drawTerrainSource, /terrainCameraView\(params, flightTime\)/);
  const cameraRenderSource = drawTerrainSource.slice(0, drawTerrainSource.indexOf("const flightParams"));
  assert.doesNotMatch(cameraRenderSource, /source\.contentTransform/);
  assert.match(drawTerrainSource, /markRenderTargetOrientation\(target, RENDER_TEXTURE_ORIENTATION\.bottomLeft\)/);
  assert.match(drawTerrainSource, /contentPlacementMatrix: contentTransformUvMatrices\(source\.contentTransform\)\.placement/);
  assert.match(drawTerrainSource, /presentGeneratedTarget\(pg, target\)/);
});

test("random generator speed controls use phase-continuous clocks", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.ok(runtimeSource.includes('generatorId === "fireflies" || generatorId === "bezierStrokes"'));
  assert.ok(rendererSource.includes("this.continuousRateTime(`${instanceId || generatorId}:${rateParam}`"));
  assert.ok(rendererSource.includes("const shaderParams = rateParam ? { ...qualityParams, [rateParam]: 1 } : qualityParams"));
});

test("terrain wireframe contains every real grid and triangle edge", () => {
  const cells = 2;
  const edges = Array.from(terrainTriangleEdgeUvs(cells));
  const horizontalEdges = (cells + 1) * cells;
  const verticalEdges = (cells + 1) * cells;
  const diagonalEdges = cells * cells;

  assert.equal(edges.length, (horizontalEdges + verticalEdges + diagonalEdges) * 4);
  const regularEdges = Array.from(terrainTriangleEdgeUvs(cells, 0));
  assert.notDeepEqual(edges, regularEdges);
  assert.equal(edges.every((value) => value >= 0 && value <= 1), true);
  const expanded = terrainExpandedWireVertices(cells);
  assert.equal(expanded.length, (horizontalEdges + verticalEdges + diagonalEdges) * 6 * 6);
  assert.deepEqual(Array.from(expanded.slice(4, 6)), [-1, 0]);
});

test("terrain GPU buffers keep vertex data static while world-row topology advances", () => {
  const width = 2;
  const depth = 3;
  const vertices = terrainSurfaceGridVertices(width, depth);
  const firstIndices = terrainSurfaceTriangleIndices(width, depth, -1);
  const nextIndices = terrainSurfaceTriangleIndices(width, depth, 0);
  const expandedWire = terrainExpandedGridWireVertices(width, depth);
  const edgeCount = width * (depth + 2) + (width + 1) * (depth + 1) + width * (depth + 1) * 2;

  assert.equal(vertices.length, (width + 1) * (depth + 2) * 2);
  assert.equal(firstIndices.length, width * (depth + 1) * 6);
  assert.equal(Math.max(...firstIndices), (width + 1) * (depth + 2) - 1);
  assert.notDeepEqual(Array.from(firstIndices), Array.from(nextIndices));
  assert.equal(expandedWire.length, edgeCount * 6 * 6);
});

test("bezier strokes exposes bounded curve, timing, material, and alpha controls", () => {
  const component = getGeneratorComponent("bezierStrokes");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Bezier Strokes");
  assert.deepEqual(params.style.values, ["pen", "crayon", "brush"]);
  assert.equal(params.count.max, 8);
  for (const id of ["count", "speed", "lifetime", "fade", "width", "strokeLength", "curve", "direction", "spread", "roughness"]) {
    assert.equal(params[id].type, "number", `missing bezier stroke param ${id}`);
  }
  assert.equal(params.strokeColor.type, "color");
  assert.equal(generatorIcon("bezierStrokes"), "gesture");
});

test("live source param overrides compile through node params", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(0, {
      type: "generator",
      generatorId: "gradient",
      params: {
        colorA: "#111111ff",
        colorB: "#222222ff",
      },
    }),
  ];
  state.components = [component];
  state.ui.live = {
    selectedSceneId: "",
    componentOverrides: {
      [component.id]: {
        transform: { x: 0.25, y: -0.4, scale: 1.75, rotation: 0.3 },
        chain: [{
          source: {
            params: {
              colorA: "#ff000080",
              mode: "single",
            },
          },
        }],
      },
    },
  };

  const liveView = createLiveComponentView(component, state);
  assert.deepEqual(liveView.transform, { x: 0.25, y: -0.4, scale: 1.75, rotation: 0.3 });
  assert.equal(liveView.chain[0].source.params.colorA, "#ff000080");
  assert.equal(liveView.chain[0].source.params.mode, "single");
  assert.equal(liveView.chain[0].params, undefined);

  const patch = compileComponentPatch(liveView);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.colorA, "#ff000080");
  assert.equal(sourceNode.params.mode, "single");

  const renderedSource = sourceWithNodeParams(liveView.chain[0].source, {}, liveView.chain[0].id);
  assert.equal(renderedSource.params.colorA, "#ff000080");
  assert.equal(renderedSource.params.mode, "single");

  const terrainSource = sourceWithNodeParams({
    type: "generator",
    generatorId: "terrainFlyover",
    params: { altitude: 2.5, style: "hybrid" },
  }, { altitude: 900, style: "wire" }, "terrain-live");
  assert.equal(terrainSource.params.altitude, 900);
  assert.equal(terrainSource.params.style, "wire");
});

test("3d model media is detected and keeps render params", () => {
  assert.equal(isMediaFile("models/head.stl"), true);
  assert.equal(isMediaFile("models/head.obj"), true);
  assert.equal(isMediaFile("vectors/logo.svg"), true);
  assert.equal(getMediaType("models/head.stl"), "model");
  assert.equal(getMediaType("vectors/logo.svg"), "image");

  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(0, {
      type: "media",
      mediaId: "models/head.stl",
      params: {
        renderMode: "wireframe",
        rotationX: 0.4,
        rotationY: -0.25,
        rotationZ: 0.1,
        modelScale: 1.4,
        visibleDepth: 0.42,
        pointBudget: 8000,
        wireThickness: 3.5,
        spinY: 0.2,
        surfaceColor: "#3366ccaa",
        wireColor: "#ffcc00ff",
      },
    }),
  ];
  state.components = [component];
  state.media = [{ id: "models/head.stl", name: "head.stl", path: "models/head.stl", type: "model" }];

  const normalized = sanitizeState(state);
  const source = normalized.components[0].chain[0].source;
  assert.equal(source.params.renderMode, "wireframe");
  assert.equal(source.params.rotationX, 0.4);
  assert.equal(source.params.modelScale, 1.4);
  assert.equal(source.params.visibleDepth, 0.42);
  assert.equal(source.params.pointBudget, 8000);
  assert.equal(source.params.wireThickness, 3.5);
  assert.equal(source.params.surfaceColor, "#3366ccaa");
  assert.equal(source.params.wireColor, "#ffcc00ff");

  const patch = compileComponentPatch(normalized.components[0]);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.mediaId, "models/head.stl");
  assert.equal(sourceNode.params.renderMode, "wireframe");
  assert.equal(sourceNode.params.spinY, 0.2);
  assert.equal(sourceNode.params.pointBudget, 8000);
  assert.equal(sourceNode.params.visibleDepth, 0.42);
  assert.equal(sourceNode.params.wireThickness, 3.5);
  assert.equal(sourceNode.params.surfaceColor, "#3366ccaa");
  assert.equal(sourceNode.params.wireColor, "#ffcc00ff");
});

test("source params are canonical and chain-level params are discarded", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const item = createComponentLayer(0, {
    type: "media",
    mediaId: "models/head.stl",
    params: { surfaceColor: "#3366ccff" },
  });
  item.params = {
    surfaceColor: "#ff0000ff",
    wireColor: "#00ff00ff",
  };
  component.chain = [item];
  state.components = [component];
  state.media = [{ id: "models/head.stl", type: "model" }];

  const normalized = sanitizeState(state);
  const normalizedItem = normalized.components[0].chain[0];
  assert.equal(normalizedItem.params, undefined);
  assert.equal(normalizedItem.source.params.surfaceColor, "#3366ccff");
  assert.equal(normalizedItem.source.params.wireColor, undefined);

  const sourceNode = compileComponentPatch(normalized.components[0]).nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.surfaceColor, "#3366ccff");
  assert.equal(sourceNode.params.wireColor, undefined);
});

test("obj parser triangulates polygon faces and supports negative indices", () => {
  const mesh = parseObjMesh(`
v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
vn 0 0 1
f -4//1 -3//1 -2//1 -1//1
`);
  assert.equal(mesh.triangles.length, 2);
  assert.equal(mesh.triangles.every((triangle) => triangle.vertices.length === 3), true);
  assert.equal(mesh.triangles.every((triangle) => triangle.normal[2] > 0.99), true);
  assert.deepEqual(mesh.bounds.min, [-50, -50, 0]);
  assert.deepEqual(mesh.bounds.max, [50, 50, 0]);
});

test("3d model visible depth follows transformed normalized model bounds", () => {
  const bounds = { min: [-10, -20, -5], max: [10, 20, 15] };
  const modelMatrix = new Float32Array([
    2, 0, 0, 0,
    0, 3, 0, 0,
    0, 0, 2, 0,
    0, 0, 7, 1,
  ]);

  assert.deepEqual(transformedModelDepthRange(bounds, modelMatrix), { min: -3, max: 37 });
  assert.equal(modelDepthCutoff({ visibleDepth: 1 }, bounds, modelMatrix), -3);
  assert.equal(modelDepthCutoff({ visibleDepth: 0.5 }, bounds, modelMatrix), 17);
  assert.equal(modelDepthCutoff({ visibleDepth: 0.25 }, bounds, modelMatrix), 27);
});

test("3d model point mode uses cached bounded point clouds", () => {
  const source = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/output-media-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render-cache.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8"),
  ].join("\n");

  assert.ok(source.includes("drawRawParsedModelMode(target, item"));
  assert.ok(source.includes("gl.drawArrays(gl.TRIANGLES, 0, resources.count);"));
  assert.ok(source.includes("ensureParsedModelPointCloud(item, pointBudget, modelMesh)"));
  assert.ok(source.includes("ensureParsedModelWireLines(item, budget, mesh)"));
  assert.ok(source.includes("ensureParsedModelThickWireVertices(item, budget, mesh)"));
  assert.ok(source.includes("ensureParsedModelPerceptualWireVertices(item, budget, mesh)"));
  assert.ok(source.includes("ensureP5ModelPointCloud(item, pointBudget)"));
  assert.ok(source.includes("uniform float uThickness;"));
  assert.ok(source.includes("resolutionScaledStrokeWidth("));
  assert.ok(source.includes("Math.min(50000"));
  assert.ok(!source.includes("function drawModelPoints"));
});

test("specialized wire thickness is scaled once from logical to raster resolution", () => {
  const request = { width: 650, height: 500, logicalWidth: 1300, logicalHeight: 1000 };

  assert.equal(resolutionScaledStrokeWidth(2, request), 1);
  assert.equal(resolutionScaledStrokeWidth(2, request, { width: 1300, height: 1000 }), 2);
  assert.equal(resolutionScaledStrokeWidth(2, { width: 1300, height: 1000 }), 2);
  assert.equal(resolutionScaledStrokeWidth(0.5, { width: 32, height: 32, logicalWidth: 1000, logicalHeight: 1000 }), 0.125);

  const source = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/terrain-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8"),
  ].join("\n");
  assert.ok(source.includes("drawTerrainWireframe(target, this.terrainWireResources"));
  assert.ok(source.includes("const viewportSize = renderTargetPixelSize(target);"));
  assert.ok(source.includes("gl.uniform2f(resources.resolution, viewportSize.width, viewportSize.height);"));
  assert.ok(source.includes("{ width: drawingWidth, height: drawingHeight }"));
  assert.ok(source.includes("max(0.125, uThickness)"));
});

test("3d model scale uses logical render viewport instead of backing pixels", () => {
  const source = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render-math.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8"),
  ].join("\n");

  assert.ok(source.includes("const viewport = modelViewportMetrics(target, renderRequest);"));
  assert.ok(source.includes("target.camera?.(0, 0, viewport.cameraZ"));
  assert.ok(source.includes("const scale = viewport.unitScale * modelScale;"));
  assert.ok(source.includes("const { width: drawingWidth, height: drawingHeight } = rawModelTargetPixelSize(target);"));
  assert.ok(source.includes("(Number(target?.width) || 1) * density"));
  assert.ok(source.includes("gl.viewport(0, 0, drawingWidth, drawingHeight);"));
  assert.ok(source.includes("rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform, modelCameraFov(params), metrics.uvRect)"));
  assert.ok(source.includes("applyModelViewportProjection(target, modelCameraFov(params), viewport)"));
  assert.ok(source.includes("const cameraZ = Math.max(1, height) * 0.92;"));
  assert.ok(!source.includes("Math.max(width, height) * 0.92"));
});

test("parsed STL and OBJ models use one clipped raw WebGL renderer family", () => {
  const source = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/output-media-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-geometry.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8"),
  ].join("\n");

  assert.ok(source.includes("drawRawParsedModelMode(target, item, params"));
  assert.ok(source.includes("function drawRawParsedSurface("));
  assert.ok(source.includes("function ensureRawSurfaceResources("));
  assert.ok(source.includes("function createRawSurfaceProgram("));
  assert.ok(source.includes("function buildParsedModelSurfaceVertices("));
  assert.ok(source.includes("const stride = 6 * 4;"));
  assert.ok(source.includes("pruneRawModelBufferVariants(gl, contextResources"));
  assert.ok(source.includes("function disposeRawModelContextResources("));
  assert.ok(source.includes("onContextDiscard: (gl) => this.resetModelResources(gl)"));
  assert.ok(!source.includes("modelRawRenderers ||= new WeakMap()"));
  assert.ok(source.includes("return processObjModelBuffer(buffer, { cacheKey: `${item.id}:${item.sourceRevision}` });"));
  assert.ok(source.includes("item.modelData = mesh;"));
  assert.ok(source.includes("if (vModelDepth < uDepthCutoff) discard;"));
  assert.ok(source.includes("modelDepthCutoff(params, mesh.bounds, matrices.model)"));
  assert.ok(source.includes('if (drewSurface && renderMode === "surfaceWire")'));
  assert.ok(source.includes('renderMode === "outline" || renderMode === "surfaceOutline"'));
  assert.ok(source.includes('if (renderMode === "xrayOutline")'));
  assert.ok(source.includes("if (!depthTest) gl.disable(gl.DEPTH_TEST)"));
  assert.ok(source.includes("float silhouette ="));
  assert.ok(source.includes("float crease ="));
});

test("renderer source extraction merges source node params", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const adapterSource = readFileSync(new URL("../js/output/component-patch-adapter.js", import.meta.url), "utf8");

  assert.ok(adapterSource.includes("sourceWithNodeParams(node.state.source, node.params || {}"));
  assert.ok(source.includes("sourceWithNodeParams(item.source, {}, item.id)"));
  assert.doesNotMatch(source, /component\.source/);
  assert.ok(adapterSource.includes("...generatorParams"));
  assert.ok(adapterSource.includes("...mediaParams"));
});

test("live source controls use dynamic param metadata", () => {
  const source = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");

  assert.ok(source.includes("liveSourceParamControlsTemplate(item, componentId, path, viewParams)"));
  assert.ok(source.includes("getGeneratorComponent(source.generatorId).params"));
  assert.ok(source.includes("mediaSourceParams(source, media)"));
  assert.ok(source.includes("paramControlsTemplate(params,"));
  assert.ok(parameterSource.includes("export function paramControlTemplate"));
  assert.ok(!source.includes("function liveParamControlTemplate"));
});

test("color picker exposes color and opacity without redundant hsv sliders", () => {
  const source = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('change.phase === "color"'));
  assert.ok(source.includes('control.dataset.colorMode === "live" ? (phase === "scrub" ? "scrub:live" : "live:update")'));
  assert.ok(source.includes('rgbInput?.addEventListener("change", () => updateColorParamFromControl(control, reason("color")));'));
  assert.ok(source.includes('alphaInput?.addEventListener("change", () => updateColorParamFromControl(control, reason("color")));'));
  assert.ok(!source.includes("data-color-hue"));
  assert.ok(!source.includes("data-color-sat"));
  assert.ok(!source.includes("data-color-val"));
});

test("output renderer blackouts while active media sources are missing or loading", () => {
  const previousMillis = globalThis.millis;
  globalThis.millis = () => 2000;
  try {
    const state = createInitialState();
    const component = createDefaultComponent(0);
    component.chain = [
      createComponentLayer(0, { type: "media", mediaId: "clips/loop.mov" }),
    ];
    state.components = [component];
    state.surfaces = [{ ...state.surfaces[0], enabled: true, componentId: component.id, sourceNodeId: sceneSourceNodeId(component.id) }];
    const requested = [];
    const renderer = new OutputRenderer({
      mode: "output",
      requestMediaFiles: (ids) => requested.push(ids),
    });
    renderer.state = sanitizeState(state);

    let status = renderer.outputMediaReadiness();
    renderer.outputMediaStatus = status;
    assert.equal(status.blocked, true);
    assert.equal(status.missingIds.has("clips/loop.mov"), true);
    assert.deepEqual(requested, [["clips/loop.mov"]]);
    assert.equal(renderer.isOutputBlackout(), true);

    renderer.media.set("clips/loop.mov", { id: "clips/loop.mov", video: null, image: null, ready: false });
    status = renderer.outputMediaReadiness();
    renderer.outputMediaStatus = status;
    assert.equal(status.blocked, true);
    assert.equal(status.loadingIds.has("clips/loop.mov"), true);
    assert.equal(renderer.shouldHoldOutputFrameForMedia(), true, "loading retains the last complete output frame");

    const previewRenderer = new OutputRenderer({ mode: "preview" });
    previewRenderer.state = renderer.state;
    previewRenderer.media.set("clips/loop.mov", { id: "clips/loop.mov", video: null, image: null, ready: false });
    assert.equal(previewRenderer.prepareOutputState(renderer.state).blocked, false, "ordinary editor previews do not globally blackout");
    assert.equal(previewRenderer.prepareOutputState(renderer.state, { requireMedia: true }).blocked, true, "Live preparation explicitly waits for drawable media");

    renderer.media.set("clips/loop.mov", { id: "clips/loop.mov", image: { width: 64, height: 64 }, ready: true });
    status = renderer.outputMediaReadiness();
    renderer.outputMediaStatus = status;
    assert.equal(status.blocked, false);
    assert.equal(renderer.isOutputBlackout(), false);
    assert.equal(renderer.shouldHoldOutputFrameForMedia(), false);
  } finally {
    if (previousMillis === undefined) delete globalThis.millis;
    else globalThis.millis = previousMillis;
  }
});

test("video readiness stays latched through temporary decoder readyState dips", () => {
  const element = { tagName: "VIDEO", videoWidth: 1920, videoHeight: 1080, readyState: 2 };
  const item = { ready: true, video: { elt: element } };
  assert.equal(isReadyMediaItem(item), true);
  element.readyState = 1;
  assert.equal(isReadyMediaItem(item), true);
});

test("decoded video frames invalidate render caches instead of renderer ticks", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const source = { type: "media", mediaId: "clips/loop.mov" };
  component.chain = [createComponentLayer(0, source)];
  state.components = [component];
  state.media = [{ id: "clips/loop.mov", path: "clips/loop.mov", type: "video", size: 42 }];
  renderer.state = state;
  const runtimeItem = {
    ready: true,
    video: { elt: { tagName: "VIDEO", videoWidth: 640, videoHeight: 360, readyState: 4 } },
    videoFrameDriven: true,
    videoFrameRevision: 3,
  };
  renderer.media.set("clips/loop.mov", runtimeItem);

  assert.equal(renderer.sourceIsFrameDynamic(source), false);
  assert.equal(renderer.sourceRuntimeTimeKey(source, component.chain[0], { frame: 100 }), 3);
  const first = renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 });
  assert.ok(first);

  runtimeItem.videoFrameRevision = 4;
  const next = renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 });
  assert.ok(next);
  assert.notEqual(next, first, "a newly presented video frame invalidates the retained component");

  runtimeItem.videoFrameDriven = false;
  assert.equal(renderer.sourceIsFrameDynamic(source), true, "older browsers retain renderer-frame invalidation");
  assert.equal(renderer.sourceRuntimeTimeKey(source, component.chain[0], { frame: 100 }), 100);
});

test("retained video components renew playback ownership without rerendering", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const child = createDefaultComponent(1);
  child.speed = 0.5;
  child.chain = [createComponentLayer(0, {
    type: "media",
    mediaId: "clips/loop.mov",
    start: 1,
    end: 4,
    speed: 2,
  })];
  const parent = createCanvasComponent(0, child.id);
  state.components = [child, parent];
  state.media = [{ id: "clips/loop.mov", path: "clips/loop.mov", type: "video", size: 42 }];
  renderer.state = state;
  renderer.media.set("clips/loop.mov", { video: { elt: {} } });
  const claims = [];
  renderer.acquireMedia = (id, options) => claims.push({ id, options });

  renderer.claimRetainedComponentMedia(parent);

  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, "clips/loop.mov");
  assert.deepEqual(claims[0].options.playback, { start: 1, end: 4, speed: 1 });
});

test("output readiness includes images referenced by media-backed generators", () => {
  const previousMillis = globalThis.millis;
  globalThis.millis = () => 4000;
  try {
    const state = createInitialState();
    const component = createDefaultComponent(0);
    component.chain = [
      createComponentLayer(0, { type: "generator", generatorId: "tileTexture", params: { imageId: "tiles.png" } }),
      createComponentLayer(1, { type: "generator", generatorId: "featureMorph", params: { imageAId: "a.png", imageBId: "b.png" } }),
      createComponentLayer(2, { type: "generator", generatorId: "featureMorphV2", params: { imageAId: "c.png", imageBId: "d.png" } }),
    ];
    state.components = [component];
    state.surfaces = [{ ...state.surfaces[0], enabled: true, componentId: component.id, sourceNodeId: sceneSourceNodeId(component.id) }];
    const requested = [];
    const renderer = new OutputRenderer({ mode: "output", requestMediaFiles: (ids) => requested.push(ids) });
    renderer.state = sanitizeState(state);

    const status = renderer.outputMediaReadiness();
    assert.equal(status.blocked, true);
    assert.deepEqual(Array.from(status.missingIds), ["tiles.png", "a.png", "b.png", "c.png", "d.png"]);
    assert.deepEqual(requested, [["tiles.png", "a.png", "b.png", "c.png", "d.png"]]);
  } finally {
    if (previousMillis === undefined) delete globalThis.millis;
    else globalThis.millis = previousMillis;
  }
});

test("output client holds current project state during control window refresh boot state", () => {
  const outputAppSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");
  assert.ok(outputAppSource.includes("renderer.importFiles(acceptedFiles);"));
  const current = createInitialState();
  current.project.folderName = "Loaded show";
  current.media = [{ id: "media/a.png", name: "a.png", type: "image" }];
  const boot = createInitialState();

  assert.equal(shouldHoldCurrentOutputState(boot, current), true);

  const restored = createInitialState();
  restored.project.folderName = "Loaded show";
  restored.media = [{ id: "media/a.png", name: "a.png", type: "image" }];
  assert.equal(shouldHoldCurrentOutputState(restored, current), false);
  assert.equal(shouldHoldCurrentOutputState(boot, null), false);
});

test("output defers a requested Live Scene and starts its transition at activation time", () => {
  const current = createInitialState();
  current.ui.selectedSceneId = "scene-a";
  current.ui.live.selectedSceneId = "scene-a";
  const requested = structuredClone(current);
  requested.ui.selectedSceneId = "scene-b";
  requested.ui.live.selectedSceneId = "scene-b";
  requested.liveTransition = { id: "transition", startedAtMs: 10, durationMs: 1000 };

  assert.equal(outputSceneId(requested), "scene-b");
  assert.equal(shouldPrepareLiveSceneState(requested, current, "output"), true);
  assert.equal(shouldPrepareLiveSceneState(requested, current, "preview"), false);
  assert.equal(shouldPrepareLiveSceneState(current, current, "output"), false);
  const activated = retimePreparedSceneTransition(requested, 5000);
  assert.equal(activated.liveTransition.startedAtMs, 5000);
  assert.equal(requested.liveTransition.startedAtMs, 10);
});

test("output accepts an immediate Live Scene cut without waiting behind media preparation", () => {
  const current = createInitialState();
  current.ui.selectedSceneId = "scene-a";
  current.ui.live.selectedSceneId = "scene-a";
  const requested = structuredClone(current);
  requested.ui.selectedSceneId = "scene-b";
  requested.ui.live.selectedSceneId = "scene-b";
  requested.liveTransition = undefined;

  assert.equal(shouldPrepareLiveSceneState(requested, current, "output"), false);
});

test("output Scene identity follows Live rather than editor selection", () => {
  const state = createInitialState();
  state.ui.selectedSceneId = "scene-being-edited";
  state.ui.live.selectedSceneId = "scene-on-air";

  assert.equal(outputSceneId(state), "scene-on-air");
});

test("output Scene identity has no editor fallback during recovery", () => {
  const state = createInitialState();
  state.ui.selectedSceneId = "scene-being-edited";
  state.ui.live.selectedSceneId = "";

  assert.equal(outputSceneId(state), "");
});

test("a one-slot Scene queue transitions from the completed program target", () => {
  const sceneA = createInitialState();
  sceneA.ui.selectedSceneId = "scene-a";
  sceneA.ui.live.selectedSceneId = "scene-a";
  const sceneB = structuredClone(sceneA);
  sceneB.ui.selectedSceneId = "scene-b";
  sceneB.ui.live.selectedSceneId = "scene-b";
  sceneB.liveTransition = {
    id: "a-to-b",
    startedAtMs: 1000,
    durationMs: 1000,
    fromState: sceneA,
  };
  const latestRequested = structuredClone(sceneB);
  latestRequested.ui.selectedSceneId = "scene-d";
  latestRequested.ui.live.selectedSceneId = "scene-d";
  latestRequested.ui.live.transitionDuration = 2;
  latestRequested.liveTransition = {
    id: "c-to-d",
    startedAtMs: 1200,
    durationMs: 2000,
    fromState: { ...sceneB, ui: { ...sceneB.ui, selectedSceneId: "scene-c" } },
  };

  assert.equal(hasActiveLiveTransition(sceneB, 1500), true);
  assert.equal(hasActiveLiveTransition(sceneB, 2000), false);
  const completedB = transitionTerminalState(sceneB);
  const queued = queuedSceneTransitionState(latestRequested, completedB, 2050);
  assert.equal(outputSceneId(queued.liveTransition.fromState), "scene-b");
  assert.equal(outputSceneId(queued), "scene-d");
  assert.equal(queued.liveTransition.startedAtMs, 2050);
  assert.equal(queued.liveTransition.durationMs, 2000);
  assert.equal(queued.liveTransition.componentsShared, false);
  assert.equal(queued.liveTransition.fromState.liveTransition, undefined);
});

test("active output can return project state and files to a refreshed control window", () => {
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");
  const outputSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");

  assert.ok(bridgeSource.includes('channel.postMessage({ type: "control-hello", sessionId })'));
  assert.ok(bridgeSource.includes('msg.sessionId !== controlSessionId'));
  assert.ok(bridgeSource.includes('msg.type === "recovery-state"'));
  assert.ok(bridgeSource.includes('store.replace(recoveredState, "project-output-recovery")'));
  assert.ok(bridgeSource.includes('type: "recovery-media-files"'));
  assert.ok(outputSource.includes("bridge?.recoveryState(acceptedState, acceptedFiles)"));
  assert.ok(outputSource.includes('sessionId !== receivedSessionId'));
});

test("component preview follows the shared preview toggle", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const thumbnailSource = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('(this.mode === "preview" || this.mode === "component") && this.state?.ui?.debugPreview === false'));
  assert.ok(rendererSource.includes("this.thumbnailRuntime.invalidateSelectedComponent()"));
  assert.ok(thumbnailSource.includes("if (!this.sendThumbnail || !this.canCapture() || this.shouldUseThumbnailPreview())"));
  assert.ok(rendererSource.includes("this.renderSelectedChainTransformOverlay()"));
  assert.ok(rendererSource.includes("renderCanvasThumbnailSnapshotPreview(component)"));
  assert.ok(rendererSource.includes("renderCanvasThumbnailEditPreview(component)"));
  assert.ok(rendererSource.includes("renderFlattenedThumbnailEditPreview(component)"));
});

test("output playback control pauses output clocks while the editor preview remains live", () => {
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");
  const paused = createInitialState();
  paused.global.playing = false;

  assert.equal(sanitizeState(paused).global.playing, false);
  assert.ok(shellSource.includes('id="toggle-output-playback"'));
  assert.ok(controllerSource.includes("refs.toggleOutputPlayback.disabled = !outputConnected"));
  assert.ok(controllerSource.includes('outputPlaying ? "pause" : "play_arrow"'));
  assert.ok(rendererSource.includes("this.visualDeltaSeconds = playing ? dt * timeScale : 0"));
  assert.ok(rendererSource.includes("if (!playing) return"));
  assert.ok(rendererSource.includes('return this.mode !== "output" || this.state?.global?.playing !== false'));
  assert.ok(rendererSource.includes("this.isPlaybackActive() ? 1 : 0"));
  const playbackOptions = rendererSource.slice(
    rendererSource.indexOf("  videoPlaybackOptions("),
    rendererSource.indexOf("  claimRetainedComponentMedia(")
  );
  assert.ok(playbackOptions.includes("globalVisualTimeScale(this.state?.global)"));
  assert.ok(playbackOptions.includes("Number(source.speed)"));
  assert.equal((rendererSource.match(/this\.videoPlaybackOptions\(source, component\)/g) || []).length, 3);
  assert.ok(bridgeSource.includes("const clientWatchdog = setInterval"));
});

test("dirty cache classifier keeps static photo chains cacheable and animated noise dynamic", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  state.media = [{ id: "media/a.png", path: "media/a.png", type: "image", size: 42 }];
  renderer.state = state;
  renderer.media.set("media/a.png", { ready: true });
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(0, { type: "media", mediaId: "media/a.png" }),
    createComponentEffect("photoGrade"),
  ];
  component.chain[1].params = { exposure: 0.25, contrast: 0.15 };

  assert.ok(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain[1].params = { grain: 0.5, seedMode: "animated" };
  assert.equal(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }), "");

  component.chain[1].params = { grain: 0.5, seedMode: "fixed", seed: 9 };
  assert.ok(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain[1] = createComponentEffect("smear");
  component.chain[1].params = {
    cctvAmount: 0,
    screenPrintAmount: 0,
    dotMatrixAmount: 0,
    receiptAmount: 0,
    ditherAmount: 0,
    smearAmount: 0,
    seedMode: "animated",
  };
  assert.ok(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain[1].params = { cctvAmount: 0.35, seedMode: "animated" };
  assert.equal(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }), "");

  component.chain[1].params = { cctvAmount: 0.35, screenPrintAmount: 0.25, seedMode: "fixed", seed: 4 };
  assert.ok(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain = [createComponentLayer(0, { type: "generator", generatorId: "anatomy" })];
  component.chain[0].source.params = { part: "arm", spinY: 0 };
  assert.ok(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain[0].source.params = { part: "arm", spinY: 0.2 };
  assert.equal(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }), "");

  component.chain[0].source.params = { part: "heart", heartPulse: 0 };
  assert.ok(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain[0].source.params = { part: "heart", heartPulse: 0.35 };
  assert.equal(renderer.stableComponentSignature(component, { role: "component", width: 640, height: 360 }), "");
});

test("Canvas and ordinary components share dependency-aware static caching", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const child = createDefaultComponent(1);
  child.chain = [createComponentLayer(0, { type: "generator", generatorId: "gradient", params: {} })];
  const canvas = createCanvasComponent(0, child.id);
  state.components = [child, canvas];
  renderer.state = state;
  const request = { role: "component", width: 640, height: 360 };

  const first = renderer.stableComponentSignature(canvas, request);
  assert.ok(first);

  child.chain[0].source.params.colorA = "#ff0000ff";
  const changed = renderer.stableComponentSignature(canvas, request);
  assert.ok(changed);
  assert.notEqual(changed, first);

  child.chain[0] = createComponentLayer(0, { type: "generator", generatorId: "cloudyTunnel", params: { speed: 0.2 } });
  assert.equal(renderer.stableComponentSignature(canvas, request), "");
});

test("component runtime policies decide whether generators and effects need time", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  renderer.state = state;
  const component = state.components[0];
  const request = { role: "component", width: 640, height: 360 };

  const cloudy = createComponentLayer(0, { type: "generator", generatorId: "cloudyTunnel" });
  cloudy.source.params = { speed: 0 };
  const grain = createComponentEffect("labelThresholdGrain");
  grain.params = { amount: 0.6, seedMode: "fixed", seed: 37 };
  component.chain = [cloudy, grain];
  assert.ok(renderer.stableComponentSignature(component, request));

  cloudy.source.params.speed = 0.1;
  assert.equal(renderer.stableComponentSignature(component, request), "");

  cloudy.source.params.speed = 0;
  grain.params.seedMode = "animated";
  assert.equal(renderer.stableComponentSignature(component, request), "");
});

test("render node runtime keeps its output version stable until its signature changes", () => {
  const output = { id: "buffer-a" };
  const runtime = new RenderNodeRuntime("node-a");
  runtime.bindOutput(output);
  let renders = 0;

  const first = runtime.evaluate("input@1|params:a", () => { renders++; return output; });
  const clean = runtime.evaluate("input@1|params:a", () => { renders++; return output; });
  const changed = runtime.evaluate("input@2|params:a", () => { renders++; return output; });

  assert.equal(first.rendered, true);
  assert.equal(first.outputVersion, 1);
  assert.equal(clean.rendered, false);
  assert.equal(clean.outputVersion, 1);
  assert.equal(changed.rendered, true);
  assert.equal(changed.outputVersion, 2);
  assert.equal(renders, 2);
});

test("node output versions propagate dirtiness only to downstream nodes", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const request = { role: "component", width: 640, height: 360 };
  const buffers = new Map();
  renderer.getComponentBuffer = (id) => {
    if (!buffers.has(id)) buffers.set(id, { id });
    return buffers.get(id);
  };
  let sourceRenders = 0;
  let gradeRenders = 0;
  let tailRenders = 0;
  const evaluate = (sourceSignature, gradeSignature = "grade:a", tailSignature = "tail:a") => {
    const source = renderer.evaluateChainNode("source", sourceSignature, request, () => { sourceRenders++; }, "source");
    const grade = renderer.evaluateChainNode("grade", `${textureStateKey(source)}|${gradeSignature}`, request, () => { gradeRenders++; }, "effect");
    const tail = renderer.evaluateChainNode("tail", `${textureStateKey(grade)}|${tailSignature}`, request, () => { tailRenders++; }, "effect");
    return { source, grade, tail };
  };

  const first = evaluate("source:a");
  const clean = evaluate("source:a");
  const tailOnly = evaluate("source:a", "grade:a", "tail:b");
  const sourceChanged = evaluate("source:b", "grade:a", "tail:b");

  assert.deepEqual([sourceRenders, gradeRenders, tailRenders], [2, 2, 3]);
  assert.equal(clean.source.outputVersion, first.source.outputVersion);
  assert.equal(clean.grade.outputVersion, first.grade.outputVersion);
  assert.equal(tailOnly.grade.outputVersion, first.grade.outputVersion);
  assert.equal(tailOnly.tail.outputVersion, first.tail.outputVersion + 1);
  assert.equal(sourceChanged.source.outputVersion, first.source.outputVersion + 1);
  assert.equal(sourceChanged.grade.outputVersion, first.grade.outputVersion + 1);
  assert.equal(sourceChanged.tail.outputVersion, tailOnly.tail.outputVersion + 1);
  assert.equal(renderer.frameProfile.stageRenders, 7);
  assert.equal(renderer.frameProfile.stageCacheHits, 5);
});

test("instance-invariant node states share one retained evaluation across async identities", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const buffers = new Map();
  renderer.getComponentGpuBuffer = (id, request) => {
    const key = `${id}:${request.width}x${request.height}:${request.renderIdentity || "shared"}`;
    if (!buffers.has(key)) buffers.set(key, { id: key });
    return buffers.get(key);
  };
  const requestA = { role: "component", width: 320, height: 180, renderIdentity: "instance:a" };
  const requestB = { role: "component", width: 320, height: 180, renderIdentity: "instance:b" };
  let sharedRenders = 0;
  const first = renderer.evaluateChainNode("static-prefix", "same", requestA, () => { sharedRenders++; }, "source", { instanceInvariant: true });
  const second = renderer.evaluateChainNode("static-prefix", "same", requestB, () => { sharedRenders++; }, "source", { instanceInvariant: true });
  assert.equal(sharedRenders, 1);
  assert.equal(first.buffer, second.buffer);
  assert.equal(first.nodeKey, second.nodeKey);
  assert.equal(second.instanceInvariant, true);

  let dynamicRenders = 0;
  const dynamicA = renderer.evaluateChainNode("dynamic-tail", "same", requestA, () => { dynamicRenders++; }, "source");
  const dynamicB = renderer.evaluateChainNode("dynamic-tail", "same", requestB, () => { dynamicRenders++; }, "source");
  assert.equal(dynamicRenders, 2);
  assert.notEqual(dynamicA.nodeKey, dynamicB.nodeKey);
});

test("static source textures repaint only when their own source state changes", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  state.media = [{ id: "media/a.png", path: "media/a.png", type: "image", size: 42 }];
  renderer.state = state;
  renderer.media.set("media/a.png", { ready: true });
  renderer.applyGraphicsFont = () => {};
  let paints = 0;
  renderer.safeDrawSourceToGraphics = () => { paints++; };
  globalThis.createGraphics = (width, height) => ({
    width,
    height,
    push() {},
    pop() {},
    clear() {},
  });

  try {
    const item = createComponentLayer(0, { type: "media", mediaId: "media/a.png", params: { fit: "contain" } });
    const request = { role: "component", width: 640, height: 360, renderIdentity: "instance:a" };
    renderer.renderComponentSourceItem(state.components[0], item, 0, request);
    renderer.renderComponentSourceItem(state.components[0], item, 1, { ...request, renderIdentity: "instance:b" });
    assert.equal(paints, 1);

    item.source.params.fit = "cover";
    renderer.renderComponentSourceItem(state.components[0], item, 2, request);
    assert.equal(paints, 2);
  } finally {
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});

test("media readiness invalidates a cached loading placeholder", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  state.media = [{ id: "media/a.png", path: "media/a.png", type: "image", size: 42 }];
  renderer.state = state;
  const runtimeMedia = { ready: false };
  renderer.media.set("media/a.png", runtimeMedia);
  renderer.applyGraphicsFont = () => {};
  let paints = 0;
  renderer.safeDrawSourceToGraphics = () => { paints++; };
  globalThis.createGraphics = (width, height) => ({
    width,
    height,
    push() {},
    pop() {},
    clear() {},
  });

  try {
    const item = createComponentLayer(0, { type: "media", mediaId: "media/a.png" });
    const request = { role: "component", width: 640, height: 360 };
    renderer.renderComponentSourceItem(state.components[0], item, 0, request);
    renderer.renderComponentSourceItem(state.components[0], item, 1, request);
    assert.equal(paints, 1);

    runtimeMedia.ready = true;
    renderer.renderComponentSourceItem(state.components[0], item, 2, request);
    renderer.renderComponentSourceItem(state.components[0], item, 3, request);
    assert.equal(paints, 2);
  } finally {
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});
