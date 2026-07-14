import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createCompositionEffect, createCompositionLayer, createDefaultComposition, createInitialState, createLiveCompositionView, sanitizeState } from "../js/domain/models.js?v=world-frame-27";
import { normalizeParamValue, renderQualityScale } from "../js/graph/component-schema.js";
import { getGeneratorComponent, listGeneratorComponents } from "../js/graph/generator-registry.js";
import { RenderNodeRuntime, textureStateKey } from "../js/graph/render-node-runtime.js";
import { compileCompositionPatch } from "../js/graph/render-scheduler.js?v=world-frame-27";
import { shouldHoldCurrentOutputState } from "../js/output/output-app.js";
import { advanceRateClock, advanceSpatialScale, modelDepthCutoff, OutputRenderer, parseObjMesh, qualityAdjustedGeneratorParams, qualityScaledRenderRequest, sourceWithNodeParams, terrainExpandedGridWireVertices, terrainExpandedWireVertices, terrainGridSize, terrainSurfaceGridVertices, terrainSurfaceTriangleIndices, terrainTriangleEdgeUvs, transformedModelDepthRange } from "../js/output/output-renderer.js?v=world-frame-27";
import { getMediaType, isMediaFile } from "../js/services/media-library-service.js";

test("media sources keep trim and playback speed through normalization and graph compile", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, {
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
  state.compositions = [composition];

  const normalized = sanitizeState(state);
  const source = normalized.compositions[0].chain[0].source;
  assert.equal(source.start, 1.25);
  assert.equal(source.end, 5.5);
  assert.equal(source.speed, 0.65);
  assert.equal(source.params.fit, "contain");

  const patch = compileCompositionPatch(normalized.compositions[0]);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.start, 1.25);
  assert.equal(sourceNode.params.end, 5.5);
  assert.equal(sourceNode.params.speed, 0.65);
  assert.equal(sourceNode.params.fit, "contain");
});

test("generator sources keep personality params through normalization and graph compile", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, {
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
  state.compositions = [composition];

  const normalized = sanitizeState(state);
  const source = normalized.compositions[0].chain[0].source;
  assert.equal(source.generatorId, "eyeball");
  assert.equal(source.params.irisSize, 1.2);
  assert.equal(source.params.pupilSize, 1.35);
  assert.equal(source.params.motionSpeed, 0.45);
  assert.equal(source.params.pauseAmount, 0.9);
  assert.equal(source.params.jitter, 0.8);

  const patch = compileCompositionPatch(normalized.compositions[0]);
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

test("render quality preserves current work at midpoint and scales expensive work around it", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const request = { role: "composition", width: 1280, height: 720 };
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
  assert.ok(builderSource.includes("1.0 - gl_FragCoord.y / iResolution.y"));
  assert.ok(builderSource.includes("shadertoyFragCoord = shaderUv * iResolution.xy"));
  assert.ok(builderSource.includes("vj1MainImage(fragColor, shadertoyFragCoord)"));
  assert.ok(rendererSource.includes('setShaderUniformIfPresent(shader, "iTime", shaderTime)'));
  assert.ok(rendererSource.includes("shaderDrawingBufferSize(target"));
  assert.ok(rendererSource.includes("gl?.drawingBufferWidth"));
  assert.ok(rendererSource.includes('generatorId === "shadertoyBaseWarp"'));
});

test("Seascape exposes bounded artistic controls", () => {
  const component = getGeneratorComponent("seascape");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

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
  assert.ok(rendererSource.includes('generatorId === "seascape"'));
});

test("Paint Drips exposes self-contained artistic controls", () => {
  const component = getGeneratorComponent("paintDrips");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.equal(component.name, "Paint Drips");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "variation", "dripSpacing", "dripDensity", "dripThickness", "bounceCurve", "cycleLength", "bounceRange", "fallSpeed", "ceilingDepth", "ceilingRoughness", "edgeSoftness", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Paint Drips control ${id}`);
  }
  for (const id of ["paintColor", "backgroundColor"]) {
    assert.equal(params[id].type, "color", `missing Paint Drips color ${id}`);
  }
  assert.ok(rendererSource.includes('generatorId === "paintDrips"'));
});

test("Cloudy Tunnel exposes bounded self-contained controls", () => {
  const component = getGeneratorComponent("cloudyTunnel");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.equal(component.name, "Cloudy Tunnel");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "raySteps", "cloudDensity", "cloudScale", "cloudDetail", "tunnelRadius", "tunnelSpread", "pathBend", "pathFrequency", "cameraSway", "fieldOfView", "fogStrength", "vignette", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Cloudy Tunnel control ${id}`);
  }
  for (const id of ["tunnelColor", "fogColor"]) {
    assert.equal(params[id].type, "color", `missing Cloudy Tunnel color ${id}`);
  }
  assert.equal(params.raySteps.defaultValue, 72);
  assert.ok(rendererSource.includes('generatorId === "cloudyTunnel"'));
});

test("Cherenkov Volume exposes bounded volumetric controls", () => {
  const component = getGeneratorComponent("cherenkovVolume");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.equal(component.name, "Cherenkov Volume");
  assert.equal(component.category, "shadertoy");
  for (const id of ["speed", "raySteps", "zoom", "rotationSpeed", "verticalOffset", "patternScale", "emissionStrength", "absorption", "brightness", "amount"]) {
    assert.equal(params[id].type, "number", `missing numeric Cherenkov Volume control ${id}`);
  }
  for (const id of ["farColor", "nearColor", "backgroundColor"]) {
    assert.equal(params[id].type, "color", `missing Cherenkov Volume color ${id}`);
  }
  assert.equal(params.raySteps.defaultValue, 96);
  assert.ok(rendererSource.includes('generatorId === "cherenkovVolume"'));
});

test("Biomine Lite exposes performance and material controls", () => {
  const component = getGeneratorComponent("biomineLite");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

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
  assert.ok(rendererSource.includes('generatorId === "biomineLite"'));
});

test("low poly anatomy generator exposes body part and stl-style 3d controls", () => {
  const component = getGeneratorComponent("anatomy");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

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
  assert.ok(rendererSource.includes('source.generatorId === "anatomy"'));
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
  assert.ok(controllerSource.includes("anatomy: \"accessibility_new\""));
});

test("terrain flyover exposes flight, terrain, wire, and biome controls", () => {
  const component = getGeneratorComponent("terrainFlyover");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

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
  assert.ok(controllerSource.includes("terrainFlyover: \"landscape\""));
  assert.ok(rendererSource.includes("source.generatorId === \"terrainFlyover\""));
  assert.ok(rendererSource.includes("this.terrainTargets = new Map()"));
  assert.ok(rendererSource.includes("this.getTerrainTarget(renderRequest.width, renderRequest.height, this.requestPixelDensity(renderRequest))"));
  assert.ok(rendererSource.includes("disposeGraphicsMap(this.terrainTargets)"));
  assert.ok(rendererSource.includes("this.terrainSurfaceResources = new Map()"));
  assert.ok(rendererSource.includes("drawTerrainSurface(target, this.terrainSurfaceResources"));
  assert.ok(rendererSource.includes("updateTerrainSurfaceBuffers(gl, resources, widthCells, depthCells, baseRow)"));
  assert.ok(rendererSource.includes("gl.drawElements(gl.TRIANGLES, resources.count, gl.UNSIGNED_SHORT, 0)"));
  assert.ok(rendererSource.includes("terrainSurfaceGridVertices(widthCells, depthCells)"));
  assert.ok(rendererSource.includes("terrainSurfaceTriangleIndices(widthCells, depthCells, baseRow)"));
  assert.ok(!rendererSource.includes("function drawTerrainSurfaceMesh("));
  assert.ok(rendererSource.includes("continuousRateTime(`${source.instanceId || source.generatorId || \"terrain\"}:flight`"));
  assert.ok(rendererSource.includes("gl.drawArrays(gl.TRIANGLES, 0, resources.count)"));
  assert.ok(rendererSource.includes("if (style === 2)"));
  assert.ok(rendererSource.includes("gl.polygonOffset(1, 2)"));
  assert.ok(rendererSource.includes("if (style !== 1) target.background"));
  assert.ok(rendererSource.includes("const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM)"));
  assert.ok(rendererSource.includes("gl.useProgram(previousProgram)"));
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
  assert.ok(rendererSource.includes("measureCompositionProfile(meta, fn)"));
  assert.ok(rendererSource.includes("const outermost = this.compositionProfileDepth === 0"));
  assert.ok(rendererSource.includes("if (outermost) this.frameProfile.compositionWallMs += ms"));
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
  assert.equal(params.nearClip.defaultValue, 0.1);
  assert.equal(params.farClip.defaultValue, 20000);
  assert.ok(controllerSource.includes('data-number-scale="log"'));
  assert.ok(rendererSource.includes("float focalLength = 1.0 / tan(radians(clamp(fieldOfView"));
  assert.ok(rendererSource.includes("worldLateral * focalLength / max(aspectRatio, 0.01)"));
  assert.ok(rendererSource.includes("(meshUv.x - 0.5) * gridCells.x * cellScale * 1.44"));
  assert.ok(rendererSource.includes("terrainTessellationSize(widthCells, params.gridDensity)"));
  assert.ok(rendererSource.includes("-cameraY * focalLength"));
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

test("random generator speed controls use phase-continuous clocks", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('generatorId === "fireflies" || generatorId === "bezierStrokes"'));
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
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.equal(component.name, "Bezier Strokes");
  assert.deepEqual(params.style.values, ["pen", "crayon", "brush"]);
  assert.equal(params.count.max, 8);
  for (const id of ["count", "speed", "lifetime", "fade", "width", "strokeLength", "curve", "direction", "spread", "roughness"]) {
    assert.equal(params[id].type, "number", `missing bezier stroke param ${id}`);
  }
  assert.equal(params.strokeColor.type, "color");
  assert.ok(controllerSource.includes("bezierStrokes: \"gesture\""));
});

test("live source param overrides compile through node params", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, {
      type: "generator",
      generatorId: "gradient",
      params: {
        colorA: "#111111ff",
        colorB: "#222222ff",
      },
    }),
  ];
  state.compositions = [composition];
  state.ui.live = {
    selectedSceneId: "",
    compositionOverrides: {
      [composition.id]: {
        chain: [{
          params: {
            colorA: "#ff000080",
            mode: "single",
          },
        }],
      },
    },
  };

  const liveView = createLiveCompositionView(composition, state);
  assert.equal(liveView.chain[0].params.colorA, "#ff000080");
  assert.equal(liveView.chain[0].params.mode, "single");

  const patch = compileCompositionPatch(liveView);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.colorA, "#ff000080");
  assert.equal(sourceNode.params.mode, "single");

  const renderedSource = sourceWithNodeParams(liveView.chain[0].source, liveView.chain[0].params, liveView.chain[0].id);
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
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, {
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
  state.compositions = [composition];
  state.media = [{ id: "models/head.stl", name: "head.stl", path: "models/head.stl", type: "model" }];

  const normalized = sanitizeState(state);
  const source = normalized.compositions[0].chain[0].source;
  assert.equal(source.params.renderMode, "wireframe");
  assert.equal(source.params.rotationX, 0.4);
  assert.equal(source.params.modelScale, 1.4);
  assert.equal(source.params.visibleDepth, 0.42);
  assert.equal(source.params.pointBudget, 8000);
  assert.equal(source.params.wireThickness, 3.5);
  assert.equal(source.params.surfaceColor, "#3366ccaa");
  assert.equal(source.params.wireColor, "#ffcc00ff");

  const patch = compileCompositionPatch(normalized.compositions[0]);
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
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("drawRawParsedModel(target, item, params, compositionTime, \"points\""));
  assert.ok(source.includes("drawRawParsedWire(target, item, params, compositionTime, wireColor, pointBudget, viewport, contentTransform)"));
  assert.ok(source.includes("gl.drawArrays(gl.TRIANGLES, 0, resources.count);"));
  assert.ok(source.includes("ensureParsedModelPointCloud(item, pointBudget)"));
  assert.ok(source.includes("ensureParsedModelWireLines(item, budget)"));
  assert.ok(source.includes("ensureParsedModelThickWireVertices(item, budget)"));
  assert.ok(source.includes("ensureP5ModelPointCloud(item, pointBudget)"));
  assert.ok(source.includes("uniform float uThickness;"));
  assert.ok(source.includes("gl.uniform1f(resources.thickness, modelWireThickness(params));"));
  assert.ok(source.includes("Math.min(50000"));
  assert.ok(!source.includes("function drawModelPoints"));
});

test("3d model scale uses logical render viewport instead of backing pixels", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("const viewport = modelViewportMetrics(target, renderRequest);"));
  assert.ok(source.includes("target.camera?.(0, 0, viewport.cameraZ"));
  assert.ok(source.includes("const scale = viewport.unitScale * modelScale;"));
  assert.ok(source.includes("const drawingWidth = Math.max(1, gl.drawingBufferWidth || target.width || 1);"));
  assert.ok(source.includes("gl.viewport(0, 0, drawingWidth, drawingHeight);"));
  assert.ok(source.includes("const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform);"));
  assert.ok(source.includes("const cameraZ = Math.max(1, height) * 0.92;"));
  assert.ok(!source.includes("Math.max(width, height) * 0.92"));
});

test("parsed STL and OBJ models use one clipped raw WebGL renderer family", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("drawRawParsedModelMode(target, item, params"));
  assert.ok(source.includes("function drawRawParsedSurface("));
  assert.ok(source.includes("function ensureRawSurfaceResources("));
  assert.ok(source.includes("function createRawSurfaceProgram("));
  assert.ok(source.includes("function ensureParsedModelSurfaceArrays("));
  assert.ok(source.includes("item.modelData = parseObjMesh(text);"));
  assert.ok(source.includes("if (vModelDepth < uDepthCutoff) discard;"));
  assert.ok(source.includes("modelDepthCutoff(params, mesh.bounds, matrices.model)"));
  assert.ok(source.includes('if (drewSurface && renderMode === "surfaceWire")'));
  assert.ok(source.includes('drawWithPolygonOffset(target, renderMode === "surfaceWire"'));
});

test("renderer source extraction merges source node params", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("sourceWithNodeParams(node.state.source, node.params || {}"));
  assert.ok(source.includes("sourceWithNodeParams(item.source || composition.source, item.params || {}, item.id)"));
  assert.ok(source.includes("...generatorParams"));
  assert.ok(source.includes("...mediaParams"));
});

test("live source controls use dynamic param metadata", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(source.includes("liveSourceParamControlsTemplate(item, compositionId, path)"));
  assert.ok(source.includes("getGeneratorComponent(source.generatorId || \"testPattern\").params"));
  assert.ok(source.includes("MODEL_SOURCE_PARAMS"));
  assert.ok(source.includes("paramControlTemplate(param,"));
  assert.ok(!source.includes("function liveParamControlTemplate"));
});

test("color picker exposes color and opacity without redundant hsv sliders", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(source.includes("reason.startsWith(\"color:\")"));
  assert.ok(source.includes("rgbInput?.addEventListener(\"change\", () => updateColorParamFromControl(control, `color:${control.dataset.colorPath}`));"));
  assert.ok(source.includes("alphaInput?.addEventListener(\"change\", () => updateColorParamFromControl(control, `color:${control.dataset.colorPath}`));"));
  assert.ok(!source.includes("data-color-hue"));
  assert.ok(!source.includes("data-color-sat"));
  assert.ok(!source.includes("data-color-val"));
});

test("output renderer blackouts while active media sources are missing or loading", () => {
  const previousMillis = globalThis.millis;
  globalThis.millis = () => 2000;
  try {
    const state = createInitialState();
    const composition = createDefaultComposition(0);
    composition.chain = [
      createCompositionLayer(0, { type: "media", mediaId: "clips/loop.mov" }),
    ];
    state.compositions = [composition];
    state.surfaces = [{ ...state.surfaces[0], enabled: true, compositionId: composition.id }];
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

    renderer.media.set("clips/loop.mov", { id: "clips/loop.mov", image: { width: 64, height: 64 }, ready: true });
    status = renderer.outputMediaReadiness();
    renderer.outputMediaStatus = status;
    assert.equal(status.blocked, false);
    assert.equal(renderer.isOutputBlackout(), false);
  } finally {
    if (previousMillis === undefined) delete globalThis.millis;
    else globalThis.millis = previousMillis;
  }
});

test("output client holds current project state during control window refresh boot state", () => {
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

test("active output can return project state and files to a refreshed control window", () => {
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");
  const outputSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");

  assert.ok(bridgeSource.includes('channel.postMessage({ type: "control-hello" })'));
  assert.ok(bridgeSource.includes('msg.type === "recovery-state"'));
  assert.ok(bridgeSource.includes('store.replace(msg.state, "project-output-recovery")'));
  assert.ok(outputSource.includes("bridge?.recoveryState(acceptedState, acceptedFiles)"));
});

test("composition preview follows the shared preview toggle", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('(this.mode === "preview" || this.mode === "composition") && this.state?.ui?.debugPreview === false'));
  assert.ok(rendererSource.includes("if (!this.shouldUseThumbnailPreview()) this.captureSelectedCompositionThumbnail()"));
  assert.ok(rendererSource.includes("if (!this.shouldUseThumbnailPreview()) this.renderSelectedChainTransformOverlay()"));
});

test("output playback control is persistent and pauses renderer and video clocks", () => {
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
  assert.ok(rendererSource.includes("if (this.state?.global?.playing === false) return"));
  assert.ok(rendererSource.includes("this.state?.global?.playing === false ? 0 : 1"));
  assert.ok(bridgeSource.includes("const clientWatchdog = setInterval"));
});

test("dirty cache classifier keeps static photo chains cacheable and animated noise dynamic", () => {
  const renderer = new OutputRenderer({ mode: "composition" });
  const state = createInitialState();
  state.media = [{ id: "media/a.png", path: "media/a.png", type: "image", size: 42 }];
  renderer.state = state;
  renderer.media.set("media/a.png", { ready: true });
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, { type: "media", mediaId: "media/a.png" }),
    createCompositionEffect("photoGrade"),
  ];
  composition.chain[1].params = { exposure: 0.25, contrast: 0.15 };

  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));

  composition.chain[1].params = { grain: 0.5, seedMode: "animated" };
  assert.equal(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }), "");

  composition.chain[1].params = { grain: 0.5, seedMode: "fixed", seed: 9 };
  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));

  composition.chain[1] = createCompositionEffect("smear");
  composition.chain[1].params = {
    cctvAmount: 0,
    screenPrintAmount: 0,
    dotMatrixAmount: 0,
    receiptAmount: 0,
    ditherAmount: 0,
    smearAmount: 0,
    seedMode: "animated",
  };
  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));

  composition.chain[1].params = { cctvAmount: 0.35, seedMode: "animated" };
  assert.equal(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }), "");

  composition.chain[1].params = { cctvAmount: 0.35, screenPrintAmount: 0.25, seedMode: "fixed", seed: 4 };
  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));

  composition.chain = [createCompositionLayer(0, { type: "generator", generatorId: "anatomy" })];
  composition.chain[0].params = { part: "arm", spinY: 0 };
  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));

  composition.chain[0].params = { part: "arm", spinY: 0.2 };
  assert.equal(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }), "");

  composition.chain[0].params = { part: "heart", heartPulse: 0 };
  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));

  composition.chain[0].params = { part: "heart", heartPulse: 0.35 };
  assert.equal(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }), "");
});

test("component runtime policies decide whether generators and effects need time", () => {
  const renderer = new OutputRenderer({ mode: "composition" });
  const state = createInitialState();
  renderer.state = state;
  const composition = state.compositions[0];
  const request = { role: "composition", width: 640, height: 360 };

  const cloudy = createCompositionLayer(0, { type: "generator", generatorId: "cloudyTunnel" });
  cloudy.params = { speed: 0 };
  const grain = createCompositionEffect("labelThresholdGrain");
  grain.params = { amount: 0.6, seedMode: "fixed", seed: 37 };
  composition.chain = [cloudy, grain];
  assert.ok(renderer.stableCompositionSignature(composition, request));

  cloudy.params.speed = 0.1;
  assert.equal(renderer.stableCompositionSignature(composition, request), "");

  cloudy.params.speed = 0;
  grain.params.seedMode = "animated";
  assert.equal(renderer.stableCompositionSignature(composition, request), "");
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
  const renderer = new OutputRenderer({ mode: "composition" });
  const request = { role: "composition", width: 640, height: 360 };
  const buffers = new Map();
  renderer.getCompositionBuffer = (id) => {
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

test("static source textures repaint only when their own source state changes", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const renderer = new OutputRenderer({ mode: "composition" });
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
    const item = createCompositionLayer(0, { type: "media", mediaId: "media/a.png", params: { fit: "contain" } });
    const request = { role: "composition", width: 640, height: 360 };
    renderer.renderCompositionSourceItem(state.compositions[0], item, 0, request);
    renderer.renderCompositionSourceItem(state.compositions[0], item, 1, request);
    assert.equal(paints, 1);

    item.params = { fit: "cover" };
    renderer.renderCompositionSourceItem(state.compositions[0], item, 2, request);
    assert.equal(paints, 2);
  } finally {
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});

test("media readiness invalidates a cached loading placeholder", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const renderer = new OutputRenderer({ mode: "composition" });
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
    const item = createCompositionLayer(0, { type: "media", mediaId: "media/a.png" });
    const request = { role: "composition", width: 640, height: 360 };
    renderer.renderCompositionSourceItem(state.compositions[0], item, 0, request);
    renderer.renderCompositionSourceItem(state.compositions[0], item, 1, request);
    assert.equal(paints, 1);

    runtimeMedia.ready = true;
    renderer.renderCompositionSourceItem(state.compositions[0], item, 2, request);
    renderer.renderCompositionSourceItem(state.compositions[0], item, 3, request);
    assert.equal(paints, 2);
  } finally {
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});
