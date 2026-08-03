import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatorIcon } from "../js/control/picker-view.js";
import { createAuthoredMediaSource } from "../js/domain/authored-visual-source.js";

import { createSceneComponent, createComponentEffect, createComponentLayer, createDefaultComponent, createInitialState, createLiveComponentView, sanitizeState, sceneSourceNodeId } from "../js/domain/models.js";
import { normalizeParamValue, renderQualityScale } from "../js/libraries/visual-nodes/shared/component-schema.js";
import { getGeneratorNodeComponent as getGeneratorComponent, listGeneratorNodeComponents as listGeneratorComponents } from "../js/libraries/visual-nodes/index.js";
import { RenderNodeRuntime, textureStateKey } from "../js/libraries/render-engine/render-node-contract.js";
import { mediaRenderInvalidation } from "../js/libraries/render-engine/invalidation/index.js";
import { compileComponentPatch } from "../js/graph/legacy-chain-render-projection.js";
import { createOutputInitialStateGate, hasActiveLiveTransition, outputSceneId, queuedSceneTransitionState, retimePreparedSceneTransition, shouldHoldCurrentOutputState, shouldPrepareLiveSceneState, shouldSuspendStableOutputPresentation, transitionTerminalState } from "../js/output/output-app.js";
import { drawMediaFit } from "../js/output/media-utils.js";
import { registerRenderTarget, RENDER_TARGET_KIND } from "../js/output/render-target-contract.js";
import { isReadyMediaItem } from "../js/output/component-render-state.js";
import { advanceRateClock, advanceSpatialScale, modelDepthCutoff, OutputRenderer, parseObjMesh, qualityAdjustedGeneratorParams, qualityScaledRenderRequest, resolutionScaledStrokeWidth, sourceWithNodeParams, terrainExpandedGridWireVertices, terrainExpandedWireVertices, terrainGridSize, terrainSafeNearDistance, terrainSurfaceGridVertices, terrainSurfaceTriangleIndices, terrainTriangleEdgeUvs, transformedModelDepthRange } from "../js/output/output-renderer.js";
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

test("Project Media defaults to native-aspect contain presentation", () => {
  const generator = getGeneratorComponent("mediaImage");
  const fitParam = generator.params.find((param) => param.id === "fit");
  assert.deepEqual(fitParam.values, ["contain", "cover", "stretch"]);
  assert.equal(fitParam.defaultValue, "contain");
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
  assert.equal(source.type, "generator");
  assert.equal(source.generatorId, "mediaImage");
  assert.equal(source.params.start, 1.25);
  assert.equal(source.params.end, 5.5);
  assert.equal(source.params.speed, 0.65);
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
  const generatorRuntimeSource = readFileSync(new URL("../js/output/shader-generator-runtime.js", import.meta.url), "utf8");
  const effectRuntimeSource = readFileSync(new URL("../js/output/shader-effect-runtime.js", import.meta.url), "utf8");
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

  const cloudyTunnel = getGeneratorComponent("cloudyTunnel");
  assert.equal(qualityAdjustedGeneratorParams(cloudyTunnel, { renderQuality: 0.5, raySteps: 72 }).raySteps, 72);
  assert.equal(qualityAdjustedGeneratorParams(cloudyTunnel, { renderQuality: 0, raySteps: 72 }).raySteps, 25);
  assert.equal(qualityAdjustedGeneratorParams(cloudyTunnel, { renderQuality: 1, raySteps: 72 }).raySteps, 108);
  assert.ok(generatorRuntimeSource.includes("shaderRuntime.getTarget(renderRequest, 0)"));
  assert.ok(effectRuntimeSource.includes('shader.setUniform("resolution", [logicalWidth, logicalHeight])'));
  assert.ok(effectRuntimeSource.includes('shader.setUniform("texelSize", [1 / logicalWidth, 1 / logicalHeight])'));
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
  const generatorRuntimeSource = readFileSync(new URL("../js/output/shader-generator-runtime.js", import.meta.url), "utf8");
  const targetRuntimeSource = readFileSync(new URL("../js/output/shader-target-runtime.js", import.meta.url), "utf8");

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
  assert.match(generatorRuntimeSource, /setShaderUniformIfPresent\(shader,\s*"iTime",\s*shaderTime\)/);
  assert.match(generatorRuntimeSource, /shaderDrawingBufferSize\(\s*target,/);
  assert.ok(targetRuntimeSource.includes("gl?.drawingBufferWidth"));
  assert.equal(component.runtime.rateParam, "speed");
});

test("Cellular Circles exposes bounded animated Shadertoy controls", () => {
  const component = getGeneratorComponent("cellularCircles");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

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
  assert.equal(component.runtime.rateParam, "speed");
  assert.deepEqual(params.searchRadius.renderQualityScaling, { minimum: 0.35, maximum: 1.5 });
});

test("Lightning exposes transparent strike and brightness controls", () => {
  const component = getGeneratorComponent("lightning");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Lightning");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "frequency", "duration", "boltWidth", "jaggedness", "positionSpread", "boltLength", "glow", "glare", "brightness", "seed", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Lightning control ${id}`);
  }
  assert.equal(params.strikeColor.type, "color");
  assert.equal(component.runtime.rateParam, "speed");
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
  assert.equal(component.runtime.rateParam, "speed");
  assert.equal(qualityAdjustedGeneratorParams(component, { renderQuality: 0.5, raySteps: 28, detail: 3 }).raySteps, 28);
  assert.equal(qualityAdjustedGeneratorParams(component, { renderQuality: 0, raySteps: 28, detail: 3 }).raySteps, 10);
  assert.equal(qualityAdjustedGeneratorParams(component, { renderQuality: 1, raySteps: 28, detail: 3 }).raySteps, 42);
});

test("Seascape exposes bounded artistic controls", () => {
  const component = getGeneratorComponent("seascape");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

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
  assert.equal(component.runtime.rateParam, "speed");
  assert.deepEqual(params.seaDetail.renderQualityScaling, { minimum: 0.5, maximum: 1.2 });
});

test("Paint Drips exposes self-contained artistic controls", () => {
  const component = getGeneratorComponent("paintDrips");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Paint Drips");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "variation", "dripSpacing", "dripDensity", "dripThickness", "bounceCurve", "cycleLength", "bounceRange", "fallSpeed", "ceilingDepth", "ceilingRoughness", "edgeSoftness", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Paint Drips control ${id}`);
  }
  for (const id of ["paintColor", "backgroundColor"]) {
    assert.equal(params[id].type, "color", `missing Paint Drips color ${id}`);
  }
  assert.equal(component.runtime.rateParam, "speed");
});

test("Cloudy Tunnel exposes bounded self-contained controls", () => {
  const component = getGeneratorComponent("cloudyTunnel");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Cloudy Tunnel");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "raySteps", "cloudDensity", "cloudScale", "cloudDetail", "tunnelRadius", "tunnelSpread", "pathBend", "pathFrequency", "cameraSway", "fieldOfView", "fogStrength", "vignette", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Cloudy Tunnel control ${id}`);
  }
  for (const id of ["tunnelColor", "fogColor"]) {
    assert.equal(params[id].type, "color", `missing Cloudy Tunnel color ${id}`);
  }
  assert.equal(params.raySteps.defaultValue, 72);
  assert.equal(component.runtime.rateParam, "speed");
  assert.deepEqual(params.cloudDetail.renderQualityScaling, { minimum: 0.5, maximum: 1.25 });
});

test("Cherenkov Volume exposes bounded volumetric controls", () => {
  const component = getGeneratorComponent("cherenkovVolume");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Cherenkov Volume");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "raySteps", "zoom", "rotationSpeed", "verticalOffset", "patternScale", "emissionStrength", "absorption", "brightness", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Cherenkov Volume control ${id}`);
  }
  for (const id of ["farColor", "nearColor", "backgroundColor"]) {
    assert.equal(params[id].type, "color", `missing Cherenkov Volume color ${id}`);
  }
  assert.equal(params.raySteps.defaultValue, 96);
  assert.equal(component.runtime.rateParam, "speed");
});

test("Biomine Lite exposes performance and material controls", () => {
  const component = getGeneratorComponent("biomineLite");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

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
  assert.equal(component.runtime.rateParam, "speed");
  assert.deepEqual(params.surfaceDetail.renderQualityScaling, { minimum: 0.5, maximum: 1.25 });
});

test("low poly anatomy generator exposes body part and stl-style 3d controls", () => {
  const component = getGeneratorComponent("anatomy");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const rendererSource = [
    readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/scene-render/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/providers/anatomy-geometry/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/providers/anatomy-motion-transform/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/providers/anatomy-material-palette/index.js", import.meta.url), "utf8"),
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
  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "");
  assert.equal(component.nodeDefinition.metadata.visualCompilerHook.id, "vj1.visual.compound");
  assert.equal(component.nodeDefinition.parts.some((part) => part.kind === "javascript"), false);
  const graph = component.nodeDefinition.parts.find((part) => part.kind === "graph");
  assert.deepEqual(graph.nodes.map((node) => node.id), [
    "geometry", "motion", "materials", "objects", "camera", "scene", "render",
  ]);
  assert.equal(graph.nodes.find((node) => node.id === "render").type, "core.scene3d.render");
  assert.equal(graph.nodes.find((node) => node.id === "render").role, "source");
  assert.ok(rendererSource.includes("executeCompiledVisualNodeProcess("));
  assert.ok(rendererSource.includes("renderMeshNodeProcess("));
  assert.ok(rendererSource.includes("createAnatomyMeshCollection("));
  assert.ok(rendererSource.includes("anatomyMotionTransform3dProcess("));
  assert.ok(rendererSource.includes("anatomyMaterialPaletteProcess("));
  assert.equal(generatorIcon("anatomy"), "accessibility_new");
});

test("terrain flyover exposes flight, terrain, wire, and biome controls", () => {
  const component = getGeneratorComponent("terrainFlyover");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");
  const rendererSource = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/output-frame-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/shader-effect-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/specialized-target-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/terrain-render-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/terrain-mesh.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/terrain-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/visual-plan-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/composition-engine/shared/visual-render-plan.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/generators/terrain-flyover/runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/generators/terrain-flyover/shaders.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/terrain-engine/flight-controller/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/terrain-engine/kernel-topology/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/providers/terrain-height-field/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/providers/terrain-biome-material/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/visual-nodes/providers/terrain-wire-material/index.js", import.meta.url), "utf8"),
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
  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "");
  assert.equal(component.nodeDefinition.metadata.renderAuthority, "compiled-graph");
  assert.match(rendererSource, /registerNativeRenderer\(\s*"output\/specialized:terrainSurface"/);
  assert.match(rendererSource, /registerNativeRenderer\(\s*"output\/specialized:terrainWire"/);
  assert.ok(rendererSource.includes("renderFramebufferPassSequence("));
  assert.ok(rendererSource.includes("VISUAL_FRAMEBUFFER_PASS_ALIAS_UNSAFE"));
  assert.ok(rendererSource.includes("input && input !== output"));
  assert.ok(rendererSource.includes("this.surfaceResources = new Map()"));
  assert.ok(rendererSource.includes("drawTerrainSurface("));
  assert.ok(rendererSource.includes("this.surfaceResources,"));
  assert.ok(rendererSource.includes("updateTerrainSurfaceBuffers(gl, resources, widthCells, depthCells, baseRow, terrainModule, moduleRevision)"));
  assert.ok(rendererSource.includes("gl.drawElements(gl.TRIANGLES, resources.count, gl.UNSIGNED_SHORT, 0)"));
  assert.ok(rendererSource.includes("terrainSurfaceGridVertices(widthCells, depthCells)"));
  assert.ok(rendererSource.includes("terrainSurfaceTriangleIndices(widthCells, depthCells, baseRow)"));
  assert.ok(!rendererSource.includes("function drawTerrainSurfaceMesh("));
  assert.ok(rendererSource.includes('kernel === "terrain-surface"'));
  assert.ok(rendererSource.includes('kernel === "terrain-wire"'));
  assert.ok(rendererSource.includes('runtimeValueInputs?.get?.("controller")'));
  assert.ok(rendererSource.includes('runtimeValueInputs?.get?.("geometry")'));
  assert.ok(rendererSource.includes('runtimeValueInputs?.get?.("camera")'));
  assert.ok(rendererSource.includes('runtimeValueInputs?.get?.("material")'));
  assert.ok(rendererSource.includes('id: "core.terrain.flight-controller"'));
  assert.ok(rendererSource.includes("gl.drawArrays(gl.TRIANGLES, 0, resources.count)"));
  assert.ok(rendererSource.includes("if (style === 2)"));
  assert.ok(rendererSource.includes("gl.polygonOffset(1, 2)"));
  assert.ok(rendererSource.includes('style === "wire"'));
  assert.ok(rendererSource.includes('style === "biome"'));
  assert.ok(rendererSource.includes("markRenderTargetOrientation("));
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
  assert.ok(rendererSource.includes("host.profileRuntime.finishFrame(this.frameStart)"));
  assert.ok(rendererSource.includes("profile.activeComponentIdentity()"));
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
  const drawTerrainSource = readFileSync(new URL("../js/output/specialized/terrain-render-runtime.js", import.meta.url), "utf8");

  assert.equal(view.altitude, 6);
  assert.equal(view.turn, 0.25);
  assert.equal(view.cameraAnchor.length, 2);
  assert.match(drawTerrainSource, /runtimeValueInputs\?\.get\?\.\("controller"\)/);
  assert.match(drawTerrainSource, /runtimeValueInputs\?\.get\?\.\("camera"\)/);
  const cameraRenderSource = drawTerrainSource.slice(0, drawTerrainSource.indexOf("const flightParams"));
  assert.doesNotMatch(cameraRenderSource, /source\.contentTransform/);
  assert.match(drawTerrainSource, /markRenderTargetOrientation\(/);
  assert.match(drawTerrainSource, /contentPlacementMatrix: contentTransformUvMatrices\(\s*source\.contentTransform,?\s*\)\.placement/);
  assert.doesNotMatch(drawTerrainSource, /this\.targets\.present\(/);
});

test("parsed mesh rendering uses the canonical Scene-to-Image process", () => {
  const sceneRender = readFileSync(new URL("../js/libraries/mesh-engine/scene-render/index.js", import.meta.url), "utf8");
  const meshRender = readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");

  assert.match(sceneRender, /renderMeshNodeProcess\(/);
  assert.match(meshRender, /export function renderMeshNodeProcess\(/);
  assert.doesNotMatch(sourceRuntime, /drawMediaSource|VJ1_DIRECT_MODEL_SOURCE_UNSUPPORTED/);
  assert.doesNotMatch(sourceRuntime, /specializedSources\.model|model-render-runtime/);
});

test("random generator speed controls use phase-continuous clocks", () => {
  const generatorSource = readFileSync(new URL("../js/output/shader-generator-runtime.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.equal(getGeneratorComponent("fireflies").runtime.rateParam, "speed");
  assert.equal(getGeneratorComponent("bezierStrokes").runtime.rateParam, "speed");
  assert.doesNotMatch(runtimeSource, /generatorId ===/);
  assert.ok(generatorSource.includes("this.rateTime("));
  assert.ok(generatorSource.includes("`${instanceId || generatorId}:${rateParam}`"));
  assert.match(generatorSource, /const shaderParams = rateParam\s*\?\s*\{ \.\.\.qualityParams, \[rateParam\]: 1 \}/);
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
    selectedComponentId: component.id,
    parameterDiffs: {
      [component.id]: {
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
        frontCut: 0.18,
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
  assert.equal(source.params.frontCut, 0.18);
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
  assert.equal(sourceNode.params.frontCut, 0.18);
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
  assert.equal(normalizedItem.source.params.wireColor, "#141414dd");

  const sourceNode = compileComponentPatch(normalized.components[0]).nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.surfaceColor, "#3366ccff");
  assert.equal(sourceNode.params.wireColor, "#141414dd");
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
  assert.ok(modelDepthCutoff({ visibleDepth: 1 }, bounds, modelMatrix) < -3);
  assert.equal(modelDepthCutoff({ visibleDepth: 0.5 }, bounds, modelMatrix), 17);
  assert.equal(modelDepthCutoff({ visibleDepth: 0.25 }, bounds, modelMatrix), 27);
});

test("3d model point mode uses cached bounded point clouds", () => {
  const meshRender = readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8");
  const source = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/output-media-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render-cache.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-resolution/index.js", import.meta.url), "utf8"),
  ].join("\n");

  assert.ok(source.includes("drawRawParsedModelMode(target, item"));
  assert.ok(source.includes("gl.drawArrays(gl.TRIANGLES, 0, resources.count);"));
  assert.ok(source.includes("ensureParsedModelPointCloud(item, budget, mesh)"));
  assert.ok(source.includes("ensureParsedModelWireLines(item, budget, mesh)"));
  assert.ok(source.includes("ensureParsedModelThickWireVertices(item, budget, mesh)"));
  assert.ok(source.includes("ensureParsedModelPerceptualWireVertices(item, budget, mesh)"));
  assert.ok(!meshRender.includes("ensureP5ModelPointCloud("), "model media has no duplicate p5 rendering fallback");
  assert.ok(!source.includes("specializedSources.model"), "model media has no compatibility renderer");
  assert.ok(source.includes("uniform float uThickness;"));
  assert.ok(source.includes("resolutionScaledStrokeWidth("));
  assert.match(source, /Math\.min\(75000/);
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
    readFileSync(new URL("../js/output/specialized/terrain-render-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/terrain-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8"),
  ].join("\n");
  assert.ok(source.includes("drawTerrainWireframe("));
  assert.ok(source.includes("this.wireResources,"));
  assert.ok(source.includes("const viewportSize = renderTargetPixelSize(target);"));
  assert.ok(source.includes("gl.uniform2f(resources.resolution, viewportSize.width, viewportSize.height);"));
  assert.ok(source.includes("{ width: drawingWidth, height: drawingHeight }"));
  assert.ok(source.includes("max(0.125, uThickness)"));
});

test("3d model scale uses logical render viewport instead of backing pixels", () => {
  const source = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render-math.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8"),
  ].join("\n");

  assert.ok(source.includes("const metrics = modelViewportMetrics(target, viewport);"));
  assert.ok(source.includes("gl.uniform3f(resources.cameraPosition, 0, 0, metrics.cameraZ)"));
  assert.ok(source.includes("const scale = metrics.unitScale * modelScale;"));
  assert.ok(source.includes("const { width: drawingWidth, height: drawingHeight } = rawModelTargetPixelSize(target);"));
  assert.ok(source.includes("(Number(target?.width) || 1) * density"));
  assert.ok(source.includes("gl.viewport(0, 0, drawingWidth, drawingHeight);"));
  assert.ok(source.includes("rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform, modelCameraFov(params), metrics.uvRect, params.__sceneTransform, params.__sceneCamera)"));
  assert.ok(source.includes(": [0, 0, verticalUnit * 0.92];"));
  assert.ok(!source.includes("Math.max(width, height) * 0.92"));
});

test("parsed STL and OBJ models use one clipped raw WebGL renderer family", () => {
  const source = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/output-media-runtime.js", import.meta.url), "utf8"),
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
  assert.ok(!source.includes("specializedSources.model"));
  assert.ok(!source.includes("modelRawRenderers ||= new WeakMap()"));
  assert.ok(source.includes("return processObjModelBuffer(buffer, { cacheKey: `${item.id}:${item.sourceRevision}` });"));
  assert.ok(source.includes("item.modelData = mesh;"));
  assert.ok(source.includes("if (uDepthSliceEnabled > 0.5 && vModelDepth < uDepthCutoff) discard;"));
  assert.ok(source.includes("if (uFrontDepthSliceEnabled > 0.5 && vModelDepth > uFrontDepthCutoff) discard;"));
  assert.ok(source.includes("gl.uniform1f(resources.depthSliceEnabled, modelDepthSliceEnabled(params) ? 1 : 0);"));
  assert.ok(source.includes("gl.uniform1f(resources.frontDepthSliceEnabled, modelFrontDepthSliceEnabled(params) ? 1 : 0);"));
  assert.ok(source.includes("setDepthSliceUniforms(gl, resources, params, mesh.bounds, matrices.model)"));
  assert.ok(source.includes('if (drewSurface && renderMode === "surfaceWire")'));
  assert.ok(source.includes('renderMode === "outline" || renderMode === "surfaceOutline"'));
  assert.ok(source.includes('if (renderMode === "xrayOutline")'));
  assert.ok(source.includes("if (!depthTest) gl.disable(gl.DEPTH_TEST)"));
  assert.ok(source.includes("float silhouette ="));
  assert.ok(source.includes("float crease ="));
});

test("renderer source extraction merges source node params", () => {
  const source = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const adapterSource = readFileSync(new URL("../js/output/component-patch-adapter.js", import.meta.url), "utf8");

  assert.ok(adapterSource.includes("sourceWithNodeParams(node.state.source, node.params || {}"));
  assert.ok(source.includes("sourceWithNodeParams(item.source, {}, item.id)"));
  assert.doesNotMatch(source, /component\.source/);
  assert.ok(adapterSource.includes("...generatorParams"));
  assert.ok(adapterSource.includes("...mediaParams"));
});

test("live source controls use dynamic param metadata", () => {
  const source = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");

  assert.ok(source.includes("liveSourceParamControlsTemplate(item, componentId, path, viewParams)"));
  assert.ok(source.includes("visualGeneratorComponent(state, source.generatorId)?.params"));
  assert.ok(source.includes("listProjectIsfVisualComponents(state)"));
  assert.ok(source.includes("paramControlsTemplate(params,"));
  assert.ok(!source.includes("source-control-schema"));
  assert.ok(!source.includes("source.type === \"media\""));
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
    const route = { ...state.surfaces[0], enabled: true, componentId: component.id, sourceNodeId: sceneSourceNodeId(component.id) };
    const requested = [];
    const renderer = new OutputRenderer({
      mode: "output",
      requestMediaFiles: (ids) => requested.push(ids),
    });
    renderer.state = { ...sanitizeState(state), surfaces: [route] };
    renderer.componentProgramRuntime.rebuild();

    let status = renderer.readinessRuntime.refresh();
    assert.equal(status.blocked, true);
    assert.equal(status.missingIds.has("clips/loop.mov"), true);
    assert.deepEqual(requested, [["clips/loop.mov"]]);
    assert.equal(renderer.readinessRuntime.isBlackout(), true);

    renderer.media.set("clips/loop.mov", { id: "clips/loop.mov", video: null, image: null, ready: false });
    status = renderer.readinessRuntime.refresh();
    assert.equal(status.blocked, true);
    assert.equal(status.loadingIds.has("clips/loop.mov"), true);
    assert.equal(renderer.readinessRuntime.shouldHoldFrame(), true, "loading retains the last complete output frame");

    const previewRenderer = new OutputRenderer({ mode: "preview" });
    previewRenderer.state = renderer.state;
    previewRenderer.componentProgramRuntime.rebuild();
    previewRenderer.media.set("clips/loop.mov", { id: "clips/loop.mov", video: null, image: null, ready: false });
    assert.equal(previewRenderer.readinessRuntime.prepare(renderer.state).blocked, false, "ordinary editor previews do not globally blackout");
    assert.equal(previewRenderer.readinessRuntime.prepare(renderer.state, { requireMedia: true }).blocked, true, "Live preparation explicitly waits for drawable media");

    renderer.media.set("clips/loop.mov", { id: "clips/loop.mov", image: { width: 64, height: 64 }, ready: true });
    status = renderer.readinessRuntime.refresh();
    assert.equal(status.blocked, false);
    assert.equal(renderer.readinessRuntime.isBlackout(), false);
    assert.equal(renderer.readinessRuntime.shouldHoldFrame(), false);
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

test("video loop seek retains the last decoded texture until the start frame is ready", () => {
  const element = {
    tagName: "VIDEO",
    currentTime: 1,
    readyState: 1,
    seeking: true,
  };
  const item = {
    ready: true,
    video: { elt: element },
    videoFrameDriven: true,
    videoFrameRevision: 8,
    videoFrameMediaTime: 4,
    revision: 2,
  };
  assert.deepEqual(mediaRenderInvalidation(item).key, {
    asset: 2,
    frame: 8,
    timeMs: 4000,
  }, "the seek does not invalidate the retained last good frame with an undecoded currentTime");
  element.seeking = false;
  element.readyState = 4;
  element.currentTime = 1.5;
  assert.deepEqual(mediaRenderInvalidation(item).key, {
    asset: 2,
    frame: 8,
    timeMs: 4000,
  }, "currentTime alone is never treated as evidence of a decoded texture");
  item.videoFrameRevision = 9;
  item.videoFrameMediaTime = 1;
  assert.deepEqual(mediaRenderInvalidation(item).key, {
    asset: 2,
    frame: 9,
    timeMs: 1000,
  }, "the first decoded loop-start frame advances the texture normally");
});

test("decoded video frames invalidate render caches instead of renderer ticks", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const source = createAuthoredMediaSource("clips/loop.mov", { type: "video" });
  component.chain = [createComponentLayer(0, source)];
  state.components = [component];
  state.media = [{ id: "clips/loop.mov", path: "clips/loop.mov", type: "video", size: 42 }];
  state.ui.selectedComponentId = component.id;
  state.ui.debugPreview = true;
  renderer.state = state;
  renderer.componentProgramRuntime.rebuild();
  const videoElement = {
    tagName: "VIDEO",
    videoWidth: 640,
    videoHeight: 360,
    readyState: 4,
    currentTime: 1.25,
  };
  const runtimeItem = {
    ready: true,
    video: { elt: videoElement },
    videoFrameDriven: true,
    videoFrameRevision: 3,
    videoFrameMediaTime: 1.25,
  };
  renderer.media.set("clips/loop.mov", runtimeItem);

  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), false);
  assert.equal(renderer.frameRuntime.presentationMode(), "continuous", "video presentation cadence is independent from decoded-frame callback cadence");
  assert.equal(
    renderer.sourceRuntime.runtimeTimeKey(source, component.chain[0], { frame: 100 }),
    null,
    "decoded media revisions belong to the compiled resource dependency, not the visual clock",
  );
  const first = renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 });
  assert.ok(first);

  videoElement.currentTime = 1.3;
  const next = renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 });
  assert.equal(next, first, "a fresh decoded-frame callback avoids rerendering at renderer cadence");

  videoElement.currentTime = 1.6;
  const stalled = renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 });
  assert.equal(stalled, first, "media time cannot publish a texture the decoder has not confirmed");

  runtimeItem.videoFrameRevision = 4;
  runtimeItem.videoFrameMediaTime = 1.6;
  const callbackNext = renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 });
  assert.notEqual(callbackNext, stalled, "a decoded-frame callback publishes the next retained texture revision");

  runtimeItem.videoFrameDriven = false;
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), true, "older browsers retain renderer-frame invalidation");
  assert.equal(renderer.sourceRuntime.runtimeTimeKey(source, component.chain[0], { frame: 100 }), null);
});

test("retained video components renew playback ownership without rerendering", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const child = createDefaultComponent(1);
  child.speed = 0.5;
  child.chain = [createComponentLayer(0, createAuthoredMediaSource(
    "clips/loop.mov",
    { type: "video" },
  ))];
  child.chain[0].source.params = {
    ...child.chain[0].source.params,
    start: 1,
    end: 4,
    speed: 2,
  };
  const parent = createSceneComponent(0, child.id);
  state.components = [child, parent];
  state.media = [{ id: "clips/loop.mov", path: "clips/loop.mov", type: "video", size: 42 }];
  renderer.state = state;
  renderer.componentProgramRuntime.rebuild();
  renderer.media.set("clips/loop.mov", { video: { elt: {} } });
  const claims = [];
  renderer.mediaRuntime.acquireMediaById = (id, options) => claims.push({ id, options });

  renderer.sourceRuntime.claimRetainedComponentMedia(parent);

  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, "clips/loop.mov");
  assert.deepEqual(claims[0].options.playback, { start: 1, end: 4, speed: 1 });
});

test("retained compiled media compounds renew playback from their typed resource input", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.speed = 0.5;
  state.components = [component];
  state.media = [{
    id: "clips/compiled.mov",
    path: "clips/compiled.mov",
    type: "video",
    size: 42,
  }];
  renderer.state = state;
  renderer.media.set("clips/compiled.mov", {
    ready: true,
    video: { elt: {} },
  });
  renderer.componentProgramRuntime.programs.set(component.id, {
    inspect: () => ({
      dependencies: { components: [] },
      mediaDemand: { ids: ["clips/compiled.mov"] },
    }),
    forEachOperation(visitor) {
      visitor({
        opcode: "source",
        configuration: {
          enabled: true,
          source: {
            type: "generator",
            generatorId: "core.visual.media-resource-to-image",
            params: { fit: "contain" },
          },
        },
        runtimeValueInputs: new Map([[
          "resource",
          {
            kind: "project-media-resource",
            mediaId: "clips/compiled.mov",
            start: 1,
            end: 4,
            speed: 2,
            ready: true,
            resourceIdentity: "project-media:clips/compiled.mov",
          },
        ]]),
      });
    },
  });
  const claims = [];
  renderer.mediaRuntime.acquireMediaById = (id, options) => {
    claims.push({ id, options });
  };

  renderer.sourceRuntime.claimRetainedComponentMedia(component);

  assert.deepEqual(claims, [{
    id: "clips/compiled.mov",
    options: {
      playback: { start: 1, end: 4, speed: 1 },
    },
  }]);
});

test("retained components renew image and model leases without decoding", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(
      0,
      createAuthoredMediaSource("media/photo.png", { type: "image" }),
    ),
    createComponentLayer(
      1,
      createAuthoredMediaSource("media/mesh.stl", { type: "model" }),
    ),
  ];
  state.components = [component];
  state.media = [
    { id: "media/photo.png", path: "media/photo.png", type: "image", size: 42 },
    { id: "media/mesh.stl", path: "media/mesh.stl", type: "model", size: 84 },
  ];
  renderer.state = state;
  renderer.componentProgramRuntime.rebuild();
  renderer.media.set("media/photo.png", { image: {} });
  renderer.media.set("media/mesh.stl", { modelData: {} });
  const retained = [];
  renderer.mediaRuntime.retainMediaById = (id) => retained.push(id);
  renderer.mediaRuntime.acquireMediaById = () => {
    throw new Error("retained non-video media must not be decoded again");
  };

  renderer.sourceRuntime.claimRetainedComponentMedia(component);

  assert.deepEqual(retained.sort(), [
    "media/mesh.stl",
    "media/photo.png",
  ]);
});

test("an executing compiled plan retains media while its source operation is cached", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const retained = [];
  let inspections = 0;
  renderer.mediaRuntime.retainMediaById = (id) => retained.push(id);
  renderer.visualPlanRuntime.renderOperations = () => ({ buffer: {} });
  const plan = {
    format: "vj1.visual-render-plan@1",
    executionModel: "chain",
    operations: [],
    controlProgram: null,
    inspect() {
      inspections++;
      return {
        mediaDemand: {
          ids: ["media/photo.png", "media/mesh.stl"],
        },
      };
    },
  };
  const component = { id: "component-a" };
  const request = { role: "component", width: 640, height: 360 };

  renderer.visualPlanRuntime.execute(plan, component, 0, request);
  renderer.visualPlanRuntime.execute(plan, component, 1, request);

  assert.equal(inspections, 1, "stable compiled topology is not introspected in every frame");
  assert.deepEqual(retained, [
    "media/photo.png",
    "media/mesh.stl",
    "media/photo.png",
    "media/mesh.stl",
  ]);

  plan.operations = [];
  renderer.visualPlanRuntime.execute(plan, component, 2, request);
  assert.equal(inspections, 2, "configuration replacement refreshes declared ownership");
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
    const route = { ...state.surfaces[0], enabled: true, componentId: component.id, sourceNodeId: sceneSourceNodeId(component.id) };
    const requested = [];
    const renderer = new OutputRenderer({ mode: "output", requestMediaFiles: (ids) => requested.push(ids) });
    renderer.state = { ...sanitizeState(state), surfaces: [route] };
    renderer.componentProgramRuntime.rebuild();

    const status = renderer.readinessRuntime.refresh();
    assert.equal(status.blocked, true);
    assert.deepEqual(Array.from(status.missingIds), ["a.png", "b.png", "c.png", "d.png", "tiles.png"]);
    assert.deepEqual(requested, [["a.png", "b.png", "c.png", "d.png", "tiles.png"]]);
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

test("standalone Output waits for one authoritative initial state before renderer setup", async () => {
  const gate = createOutputInitialStateGate();
  const state = createInitialState();
  let activated = false;
  gate.ready.then(() => {
    activated = true;
  });

  await Promise.resolve();
  assert.equal(activated, false, "loading p5 cannot activate a null project");
  assert.equal(gate.accept(state), true);
  assert.equal(await gate.ready, state);
  assert.equal(activated, true);
  assert.equal(gate.accept(createInitialState()), false, "later states use normal revisioned activation");
});

test("standalone Output cannot suspend before its first complete presentation", () => {
  assert.equal(shouldSuspendStableOutputPresentation({
    presentationMode: "on-change",
    hasPresentedCompleteFrame: false,
  }), false, "a readiness-held startup frame must not leave the new popup black");
  assert.equal(shouldSuspendStableOutputPresentation({
    presentationMode: "on-change",
    hasPresentedCompleteFrame: true,
  }), true, "a stable Output may suspend after it has produced one complete frame");
  assert.equal(shouldSuspendStableOutputPresentation({
    presentationMode: "continuous",
    hasPresentedCompleteFrame: true,
  }), false);
  assert.equal(shouldSuspendStableOutputPresentation({
    preparing: true,
    presentationMode: "on-change",
    hasPresentedCompleteFrame: true,
  }), false);
  assert.equal(shouldSuspendStableOutputPresentation({
    idleSuspended: true,
    presentationMode: "on-change",
    hasPresentedCompleteFrame: true,
  }), false);
});

test("output defers a requested Live Scene and starts its transition at activation time", () => {
  const current = createInitialState();
  current.ui.selectedMappingId = "scene-a";
  current.ui.live.selectedSceneId = "scene-a";
  const requested = structuredClone(current);
  requested.ui.selectedMappingId = "scene-b";
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
  current.ui.selectedMappingId = "scene-a";
  current.ui.live.selectedSceneId = "scene-a";
  const requested = structuredClone(current);
  requested.ui.selectedMappingId = "scene-b";
  requested.ui.live.selectedSceneId = "scene-b";
  requested.liveTransition = undefined;

  assert.equal(shouldPrepareLiveSceneState(requested, current, "output"), false);
});

test("output prepares an incoming Live Scene with that Scene's compiled program", () => {
  const child = createDefaultComponent(0, { empty: true });
  const currentScene = createSceneComponent(0, child.id);
  const incomingScene = createSceneComponent(1, child.id);
  const current = createInitialState();
  current.components = [child, currentScene, incomingScene];
  current.surfaces = [{
    ...current.surfaces[0],
    enabled: true,
    componentId: currentScene.id,
    sourceNodeId: sceneSourceNodeId(currentScene.id),
  }];
  const incoming = structuredClone(current);
  incoming.ui.live.selectedSceneId = incomingScene.id;
  incoming.ui.live.selectedComponentId = incomingScene.id;
  incoming.surfaces = [{
    ...incoming.surfaces[0],
    componentId: incomingScene.id,
    sourceNodeId: sceneSourceNodeId(incomingScene.id),
  }];

  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = current;
  renderer.visualNodeRuntime.rebuild();
  renderer.componentProgramRuntime.rebuild();
  renderer.componentProgramRuntime.rebuildLookups();

  assert.equal(renderer.componentProgramRuntime.programs.has(currentScene.id), true);
  assert.equal(renderer.componentProgramRuntime.programs.has(incomingScene.id), false);
  assert.doesNotThrow(() => renderer.readinessRuntime.prepare(incoming));
  renderer.readinessRuntime.clearPrepared();
  renderer.dispose();
});

test("output Scene identity follows Live rather than editor selection", () => {
  const state = createInitialState();
  state.ui.selectedMappingId = "scene-being-edited";
  state.ui.live.selectedSceneId = "scene-on-air";

  assert.equal(outputSceneId(state), "scene-on-air");
});

test("output Scene identity has no editor fallback during recovery", () => {
  const state = createInitialState();
  state.ui.selectedMappingId = "scene-being-edited";
  state.ui.live.selectedSceneId = "";

  assert.equal(outputSceneId(state), "");
});

test("a one-slot Scene queue transitions from the completed program target", () => {
  const sceneA = createInitialState();
  sceneA.ui.selectedMappingId = "scene-a";
  sceneA.ui.live.selectedSceneId = "scene-a";
  const sceneB = structuredClone(sceneA);
  sceneB.ui.selectedMappingId = "scene-b";
  sceneB.ui.live.selectedSceneId = "scene-b";
  sceneB.liveTransition = {
    id: "a-to-b",
    startedAtMs: 1000,
    durationMs: 1000,
    fromState: sceneA,
  };
  const latestRequested = structuredClone(sceneB);
  latestRequested.ui.selectedMappingId = "scene-d";
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

  assert.ok(bridgeSource.includes('type: "control-hello"'));
  assert.ok(bridgeSource.includes("controlId"));
  assert.ok(bridgeSource.includes('msg.type === "control-conflict"'));
  assert.ok(bridgeSource.includes('msg.type === "control-goodbye"'));
  assert.ok(bridgeSource.includes("OUTPUT_BRIDGE_PROTOCOL_VERSION"));
  assert.ok(bridgeSource.includes('msg.type === "protocol-mismatch"'));
  assert.ok(bridgeSource.includes('msg.sessionId !== controlSessionId'));
  assert.ok(bridgeSource.includes('msg.type === "recovery-state"'));
  assert.ok(bridgeSource.includes("store.replace(recoveredOutputProjectState("));
  assert.ok(bridgeSource.includes('), "project-output-recovery")'));
  assert.ok(bridgeSource.includes('type: "recovery-media-files"'));
  assert.ok(outputSource.includes("bridge?.recoveryState(acceptedState, acceptedFiles)"));
  assert.ok(outputSource.includes('sessionId !== receivedSessionId'));
});

test("Component Scene and Live previews follow the shared thumbnail toggle", () => {
  const stateRuntimeSource = readFileSync(new URL("../js/output/output-state-runtime.js", import.meta.url), "utf8");
  const presentationSource = readFileSync(new URL("../js/output/output-presentation-runtime.js", import.meta.url), "utf8");
  const thumbnailSource = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");

  assert.ok(presentationSource.includes('host.mode === "preview"'));
  assert.ok(presentationSource.includes('host.mode === "component"'));
  assert.ok(presentationSource.includes('host.mode === "live"'));
  assert.ok(presentationSource.includes('host.state?.ui?.debugPreview === false'));
  assert.ok(stateRuntimeSource.includes("host.thumbnailRuntime.invalidateSelectedComponent()"));
  assert.ok(thumbnailSource.includes("if (!this.sendThumbnail || !this.canCapture() || this.shouldUseThumbnailPreview())"));
  assert.ok(presentationSource.includes("host.previewInteraction.renderSelectedChainTransformOverlay()"));
  assert.ok(presentationSource.includes("renderSceneThumbnailSnapshotPreview(component)"));
  assert.doesNotMatch(presentationSource, /renderSceneThumbnailEditPreview\(/);
  assert.ok(presentationSource.includes("renderFlattenedThumbnailEditPreview(component)"));
});

test("playback control pauses the shared preview and output transport", () => {
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const frameRuntimeSource = readFileSync(new URL("../js/output/output-frame-runtime.js", import.meta.url), "utf8");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");
  const paused = createInitialState();
  paused.global.playing = false;

  assert.equal(sanitizeState(paused).global.playing, false);
  assert.ok(shellSource.includes('id="toggle-output-playback"'));
  assert.ok(controllerSource.includes("refs.toggleOutputPlayback.disabled = !hasProject"));
  assert.ok(controllerSource.includes("if (!hasOpenProject(latestState)) return"));
  assert.doesNotMatch(controllerSource, /if \(latestState\.metrics\.clients <= 0\) return/);
  assert.ok(controllerSource.includes('outputPlaying ? "pause" : "play_arrow"'));
  assert.ok(frameRuntimeSource.includes("this.presentationClock = advancePresentationClock("));
  assert.ok(frameRuntimeSource.includes("this.visualDeltaSeconds = this.presentationClock.presentationDeltaSeconds * timeScale"));
  assert.ok(frameRuntimeSource.includes("if (!playing) return"));
  assert.ok(frameRuntimeSource.includes("return this.host.state?.global?.playing !== false"));
  assert.doesNotMatch(frameRuntimeSource, /this\.mode !== "output" \|\| this\.state\?\.global\?\.playing/);
  assert.ok(sourceRuntime.includes("host.frameRuntime.isPlaybackActive() ? 1 : 0"));
  const playbackOptions = sourceRuntime.slice(
    sourceRuntime.indexOf("  videoPlaybackOptions("),
    sourceRuntime.indexOf("  componentContainsVideo(")
  );
  assert.ok(playbackOptions.includes("globalVisualTimeScale(host.state?.global)"));
  assert.ok(playbackOptions.includes("Number(source.speed)"));
  assert.doesNotMatch(sourceRuntime, /source\.type === "media"/);
  assert.ok(sourceRuntime.includes("this.videoPlaybackOptions(params, component)"));
  assert.ok(bridgeSource.includes("const clientWatchdog = setInterval"));
});

test("dirty cache classifier keeps static photo chains cacheable and animated noise dynamic", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  state.media = [{ id: "media/a.png", path: "media/a.png", type: "image", size: 42 }];
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(0, createAuthoredMediaSource("media/a.png", { type: "image" })),
    createComponentEffect("photoGrade"),
  ];
  component.chain[1].params = { exposure: 0.25, contrast: 0.15 };
  state.components = [component];
  renderer.state = state;
  renderer.componentProgramRuntime.rebuild();
  renderer.media.set("media/a.png", { ready: true });

  assert.ok(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain[1].params = { grain: 0.5, seedMode: "animated" };
  renderer.componentProgramRuntime.rebuild();
  assert.equal(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }), "");

  component.chain[1].params = { grain: 0.5, seedMode: "fixed", seed: 9 };
  renderer.componentProgramRuntime.rebuild();
  assert.ok(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }));

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
  renderer.componentProgramRuntime.rebuild();
  assert.ok(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain[1].params = { cctvAmount: 0.35, seedMode: "animated" };
  renderer.componentProgramRuntime.rebuild();
  assert.equal(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }), "");

  component.chain[1].params = { cctvAmount: 0.35, screenPrintAmount: 0.25, seedMode: "fixed", seed: 4 };
  renderer.componentProgramRuntime.rebuild();
  assert.ok(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain = [createComponentLayer(0, { type: "generator", generatorId: "anatomy" })];
  component.chain[0].source.params = { part: "arm", spinY: 0 };
  renderer.componentProgramRuntime.rebuild();
  assert.ok(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain[0].source.params = { part: "arm", spinY: 0.2 };
  renderer.componentProgramRuntime.rebuild();
  assert.equal(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }), "");

  component.chain[0].source.params = { part: "heart", heartPulse: 0 };
  renderer.componentProgramRuntime.rebuild();
  assert.ok(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }));

  component.chain[0].source.params = { part: "heart", heartPulse: 0.35 };
  renderer.componentProgramRuntime.rebuild();
  assert.equal(renderer.componentRenderRuntime.stableSignature(component, { role: "component", width: 640, height: 360 }), "");
});

test("Canvas and ordinary components share dependency-aware static caching", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const child = createDefaultComponent(1);
  child.chain = [createComponentLayer(0, { type: "generator", generatorId: "gradient", params: {} })];
  const canvas = createSceneComponent(0, child.id);
  state.components = [child, canvas];
  renderer.state = state;
  renderer.componentProgramRuntime.rebuild();
  const request = { role: "component", width: 640, height: 360 };

  const first = renderer.componentRenderRuntime.stableSignature(canvas, request);
  assert.ok(first);

  child.chain[0].source.params.colorA = "#ff0000ff";
  renderer.componentProgramRuntime.rebuild();
  const changed = renderer.componentRenderRuntime.stableSignature(canvas, request);
  assert.ok(changed);
  assert.notEqual(changed, first);

  child.chain[0] = createComponentLayer(0, { type: "generator", generatorId: "cloudyTunnel", params: { speed: 0.2 } });
  renderer.componentProgramRuntime.rebuild();
  assert.equal(renderer.componentRenderRuntime.stableSignature(canvas, request), "");
});

test("retained Component identity includes only its declared control-signal revisions", () => {
  let midiRevision = 0;
  const controlSignals = {
    resolve: () => ({ value: 0, sequence: midiRevision }),
    revisionFor: (requirements) =>
      requirements.map(({ signalKind, address }) =>
        `${signalKind}:${address}:${midiRevision}`).join("|"),
    beginFrame() {},
    endFrame() {},
    dispose() {},
  };
  const renderer = new OutputRenderer({
    mode: "component",
    controlSignals,
  });
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(0, {
      type: "generator",
      generatorId: "gradient",
      params: {},
    }),
  ];
  state.components = [component];
  renderer.state = state;
  renderer.componentProgramRuntime.rebuild();
  const program = renderer.componentProgramRuntime.programs.get(component.id);
  const inspect = program.inspect.bind(program);
  program.inspect = () => {
    const inspection = inspect();
    return {
      ...inspection,
      readiness: {
        ...inspection.readiness,
        requirements: [
          ...(inspection.readiness?.requirements || []),
          {
            kind: "control-signal",
            signalKind: "midi",
            address: "1:cc:7",
            required: false,
          },
        ],
      },
    };
  };
  const request = { role: "component", width: 640, height: 360 };

  const first = renderer.componentRenderRuntime.stableSignature(
    component,
    request,
  );
  assert.ok(first);
  midiRevision++;
  const changed = renderer.componentRenderRuntime.stableSignature(
    component,
    request,
  );
  assert.ok(changed);
  assert.notEqual(changed, first);

  renderer.dispose();
});

test("a Live Canvas element scale patch updates compiled placement demand and retained cache identity", () => {
  const renderer = new OutputRenderer({ mode: "live" });
  const state = createInitialState();
  const child = createDefaultComponent(0, { empty: true });
  const canvas = createSceneComponent(0, child.id);
  state.components = [child, canvas];
  renderer.state = state;
  renderer.componentProgramRuntime.rebuild();

  let compiledPlacement = null;
  renderer.componentProgramRuntime.programs.get(canvas.id).forEachOperation((operation) => {
    if (operation.configuration?.id === canvas.chain[0].id) compiledPlacement = operation.configuration;
  });
  assert.equal(compiledPlacement, canvas.chain[0], "the compiled Canvas operation owns the live materialized element by identity");

  const outputRequest = { role: "component", width: 1000, height: 500 };
  const signatureBefore = renderer.componentRenderRuntime.stableSignature(canvas, outputRequest);
  let childRequest = null;
  renderer.componentRenderRuntime.render = (_component, _time, request) => {
    childRequest = request;
    return { width: request.width, height: request.height };
  };
  const resolvePlacement = () => renderer.sourceRuntime.resolvePlacedSourceResult(
    { width: outputRequest.width, height: outputRequest.height },
    {
      ...compiledPlacement.source,
      contentTransform: compiledPlacement.transform,
      instanceId: compiledPlacement.id,
    },
    canvas,
    0,
    outputRequest,
  );
  resolvePlacement();
  const widthBefore = childRequest.width;

  const result = renderer.livePatchRuntime.apply([{
    target: "component",
    componentId: canvas.id,
    path: "chain.0.transform.scale",
    value: 2,
  }], 0, 0);
  assert.equal(result.applied, true);
  assert.equal(compiledPlacement.transform.scale, 2);
  assert.notEqual(renderer.componentRenderRuntime.stableSignature(canvas, outputRequest), signatureBefore);

  resolvePlacement();
  assert.ok(childRequest.width > widthBefore, "Content scale raises the nested Component raster demand through the shared placement contract");
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
  renderer.componentProgramRuntime.rebuild();
  assert.ok(renderer.componentRenderRuntime.stableSignature(component, request));

  cloudy.source.params.speed = 0.1;
  renderer.componentProgramRuntime.rebuild();
  assert.equal(renderer.componentRenderRuntime.stableSignature(component, request), "");

  cloudy.source.params.speed = 0;
  grain.params.seedMode = "animated";
  renderer.componentProgramRuntime.rebuild();
  assert.equal(renderer.componentRenderRuntime.stableSignature(component, request), "");
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
  renderer.renderTargetRuntime.gpu = (id) => {
    if (!buffers.has(id)) buffers.set(id, { id });
    return buffers.get(id);
  };
  let sourceRenders = 0;
  let gradeRenders = 0;
  let tailRenders = 0;
  const evaluate = (sourceSignature, gradeSignature = "grade:a", tailSignature = "tail:a") => {
    const source = renderer.renderEvaluationRuntime.evaluate("source", sourceSignature, request, () => { sourceRenders++; }, "source");
    const grade = renderer.renderEvaluationRuntime.evaluate("grade", `${textureStateKey(source)}|${gradeSignature}`, request, () => { gradeRenders++; }, "effect");
    const tail = renderer.renderEvaluationRuntime.evaluate("tail", `${textureStateKey(grade)}|${tailSignature}`, request, () => { tailRenders++; }, "effect");
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
  assert.equal(renderer.profileRuntime.frameProfile.stageRenders, 7);
  assert.equal(renderer.profileRuntime.frameProfile.stageCacheHits, 5);
});

test("instance-invariant node states share one retained evaluation across async identities", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const buffers = new Map();
  renderer.renderTargetRuntime.gpu = (id, request) => {
    const key = `${id}:${request.width}x${request.height}:${request.renderIdentity || "shared"}`;
    if (!buffers.has(key)) buffers.set(key, { id: key });
    return buffers.get(key);
  };
  const requestA = { role: "component", width: 320, height: 180, renderIdentity: "instance:a" };
  const requestB = { role: "component", width: 320, height: 180, renderIdentity: "instance:b" };
  let sharedRenders = 0;
  const first = renderer.renderEvaluationRuntime.evaluate("static-prefix", "same", requestA, () => { sharedRenders++; }, "source", { instanceInvariant: true });
  const second = renderer.renderEvaluationRuntime.evaluate("static-prefix", "same", requestB, () => { sharedRenders++; }, "source", { instanceInvariant: true });
  assert.equal(sharedRenders, 1);
  assert.equal(first.buffer, second.buffer);
  assert.equal(first.nodeKey, second.nodeKey);
  assert.equal(second.instanceInvariant, true);

  let dynamicRenders = 0;
  const dynamicA = renderer.renderEvaluationRuntime.evaluate("dynamic-tail", "same", requestA, () => { dynamicRenders++; }, "source");
  const dynamicB = renderer.renderEvaluationRuntime.evaluate("dynamic-tail", "same", requestB, () => { dynamicRenders++; }, "source");
  assert.equal(dynamicRenders, 2);
  assert.notEqual(dynamicA.nodeKey, dynamicB.nodeKey);
});

test("static semantic media textures repaint only when their own resource state changes", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const restoreFramebuffer = installFakeSharedFramebuffer();
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  state.media = [{ id: "media/a.png", path: "media/a.png", type: "image", size: 42 }];
  renderer.state = state;
  renderer.media.set("media/a.png", { ready: true });
  renderer.applyGraphicsFont = () => {};
  let paints = 0;
  renderer.sourceRuntime.safeDrawSourceToGraphics = () => { paints++; };
  globalThis.createGraphics = (width, height) => ({
    width,
    height,
    push() {},
    pop() {},
    clear() {},
  });

  try {
    const item = createComponentLayer(
      0,
      createAuthoredMediaSource("media/a.png", { type: "image" }),
    );
    item.source.params.fit = "contain";
    const request = { role: "component", width: 640, height: 360, renderIdentity: "instance:a" };
    renderer.sourceRuntime.renderItem(state.components[0], item, 0, request);
    renderer.sourceRuntime.renderItem(state.components[0], item, 1, { ...request, renderIdentity: "instance:b" });
    assert.equal(paints, 1);

    item.source.params.fit = "cover";
    renderer.sourceRuntime.renderItem(state.components[0], item, 2, request);
    assert.equal(paints, 2);
  } finally {
    restoreFramebuffer();
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});

test("retained video source nodes renew playback ownership on a cache hit", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const restoreFramebuffer = installFakeSharedFramebuffer();
  const renderer = new OutputRenderer({ mode: "output" });
  const state = createInitialState();
  const component = state.components[0];
  component.speed = 0.5;
  state.media = [{ id: "clips/loop.mov", path: "clips/loop.mov", type: "video", size: 42 }];
  renderer.state = state;
  renderer.media.set("clips/loop.mov", {
    ready: true,
    video: { elt: {} },
    videoFrameDriven: true,
    videoFrameRevision: 1,
  });
  renderer.applyGraphicsFont = () => {};
  renderer.sourceRuntime.safeDrawSourceToGraphics = () => {};
  const claims = [];
  renderer.mediaRuntime.acquireMediaById = (id, options) => claims.push({ id, options });
  globalThis.createGraphics = (width, height) => ({
    width,
    height,
    push() {},
    pop() {},
    clear() {},
  });

  try {
    const item = createComponentLayer(
      0,
      createAuthoredMediaSource("clips/loop.mov", { type: "video" }),
    );
    Object.assign(item.source.params, { start: 1, end: 4, speed: 2 });
    const request = { role: "component", width: 640, height: 360 };
    renderer.sourceRuntime.renderItem(component, item, 0, request);
    assert.equal(claims.length, 0, "a dirty source owns playback through its draw callback");

    renderer.sourceRuntime.renderItem(component, item, 0, request);
    assert.equal(claims.length, 1, "a retained source renews the decoder lease without repainting");
    assert.equal(claims[0].id, "clips/loop.mov");
    assert.deepEqual(claims[0].options.playback, { start: 1, end: 4, speed: 1 });
    assert.equal(claims[0].options.width, 640);
  } finally {
    restoreFramebuffer();
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});

test("retained image source nodes renew resource ownership on a cache hit", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const restoreFramebuffer = installFakeSharedFramebuffer();
  const renderer = new OutputRenderer({ mode: "output" });
  const state = createInitialState();
  const component = state.components[0];
  state.media = [{
    id: "media/a.png",
    path: "media/a.png",
    type: "image",
    size: 42,
  }];
  renderer.state = state;
  renderer.media.set("media/a.png", {
    ready: true,
    image: { width: 640, height: 360 },
    revision: 1,
  });
  renderer.applyGraphicsFont = () => {};
  renderer.sourceRuntime.safeDrawSourceToGraphics = () => {};
  const retained = [];
  renderer.mediaRuntime.retainMediaById = (id) => retained.push(id);
  globalThis.createGraphics = (width, height) => ({
    width,
    height,
    push() {},
    pop() {},
    clear() {},
  });

  try {
    const item = createComponentLayer(
      0,
      createAuthoredMediaSource("media/a.png", { type: "image" }),
    );
    const request = { role: "component", width: 640, height: 360 };
    renderer.sourceRuntime.renderItem(component, item, 0, request);
    assert.deepEqual(retained, []);

    renderer.sourceRuntime.renderItem(component, item, 0, request);
    assert.deepEqual(
      retained,
      ["media/a.png"],
      "the retained framebuffer keeps its decoded image resident",
    );
  } finally {
    restoreFramebuffer();
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});

test("media readiness invalidates a cached loading placeholder", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const restoreFramebuffer = installFakeSharedFramebuffer();
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  state.media = [{ id: "media/a.png", path: "media/a.png", type: "image", size: 42 }];
  renderer.state = state;
  const runtimeMedia = { ready: false };
  renderer.media.set("media/a.png", runtimeMedia);
  renderer.applyGraphicsFont = () => {};
  let paints = 0;
  renderer.sourceRuntime.safeDrawSourceToGraphics = () => { paints++; };
  globalThis.createGraphics = (width, height) => ({
    width,
    height,
    push() {},
    pop() {},
    clear() {},
  });

  try {
    const item = createComponentLayer(
      0,
      createAuthoredMediaSource("media/a.png", { type: "image" }),
    );
    const request = { role: "component", width: 640, height: 360 };
    renderer.sourceRuntime.renderItem(state.components[0], item, 0, request);
    renderer.sourceRuntime.renderItem(state.components[0], item, 1, request);
    assert.equal(paints, 1);

    runtimeMedia.ready = true;
    renderer.sourceRuntime.renderItem(state.components[0], item, 2, request);
    renderer.sourceRuntime.renderItem(state.components[0], item, 3, request);
    assert.equal(paints, 2);
  } finally {
    restoreFramebuffer();
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});

test("retained sources track runtime time and external resource revisions independently", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const restoreFramebuffer = installFakeSharedFramebuffer();
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  renderer.state = state;
  renderer.applyGraphicsFont = () => {};
  let paints = 0;
  let externalRevision = "loading:1";
  let clockDriven = true;
  renderer.sourceRuntime.safeDrawSourceToGraphics = () => { paints++; };
  renderer.sourceRuntime.runtimeTimeKey = (_source, _owner, context) => context.time;
  renderer.sourceRuntime.runtimeExternalKey = () => externalRevision;
  globalThis.createGraphics = (width, height) => ({
    width,
    height,
    push() {},
    pop() {},
    clear() {},
  });

  try {
    const item = createComponentLayer(0, {
      type: "generator",
      generatorId: "gradient",
      params: { speed: 1 },
    });
    const operation = {
      id: "async-render",
      backend: "source-runtime",
      configuration: item,
      renderInvalidation: { mode: "revision" },
      externalResourceDependent: true,
      runtimePolicy: {
        timeDependent: () => clockDriven,
        timeKey: (_params, context = {}) => context.time,
      },
    };
    const request = { role: "component", width: 640, height: 360 };
    const render = (time) => renderer.sourceRuntime.renderItemState(
      state.components[0],
      item,
      time,
      request,
      "async-render",
      operation,
    );

    render(0);
    render(1);
    assert.equal(
      paints,
      2,
      "a runtime policy remains clock-driven even when a typed dependency declares revision invalidation",
    );

    clockDriven = false;
    render(2);
    render(3);
    assert.equal(paints, 3, "a stopped source retains its current output");

    externalRevision = "ready:2";
    render(3);
    render(3);
    assert.equal(
      paints,
      4,
      "an external resource revision repaints a retained source without an authored edit or time change",
    );
  } finally {
    restoreFramebuffer();
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});

function installFakeSharedFramebuffer() {
  const names = ["createFramebuffer", "push", "pop", "translate", "imageMode", "rectMode", "clear"];
  const previous = new Map(names.map((name) => [name, globalThis[name]]));
  globalThis.createFramebuffer = ({ width, height }) => ({
    width,
    height,
    begin() {},
    end() {},
    remove() {},
    resize(nextWidth, nextHeight) {
      this.width = nextWidth;
      this.height = nextHeight;
    },
    get() {},
  });
  for (const name of names.slice(1)) globalThis[name] = () => {};
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  };
}
