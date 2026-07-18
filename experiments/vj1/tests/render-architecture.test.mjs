import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compileShaderSchedule, fuseLocalShaderSchedule } from "../js/graph/render-scheduler.js";
import { effectTransformUniforms } from "../js/output/output-renderer.js";
import {
  CONTENT_COORDINATE_CONVENTION,
  markRenderTargetOrientation,
  RENDER_TARGET_ORIENTATION,
  renderTargetNeedsPresentationFlip,
  contentTransformCanvasPlacement,
  contentTransformUvMatrices,
  localContentDragDelta,
} from "../js/output/content-coordinate-space.js";
import { SharedFramebufferTarget, unwrapRenderTarget } from "../js/output/shared-framebuffer-target.js";
import { mapperFragmentShaderSource, mapperTransitionFragmentShaderSource, mapperVertexShaderSource, normalizedSourceRect, projectedSurfaceAspect, projectionFitMode, surfaceQuadVertices } from "../js/output/vj-mapper.js";
import { createShaderBuilder } from "../js/shaders/shader-builder.js";
import { getShaderComponent } from "../js/shaders/shader-registry.js";

test("shader components declare sampling cost and safe fusion metadata", () => {
  const invert = getShaderComponent("invert");
  const ripple = getShaderComponent("ripple");
  const heartbeat = getShaderComponent("heartbeatPulse");

  assert.equal(invert.sampling, "local");
  assert.equal(invert.fusible, true);
  assert.equal(ripple.sampling, "neighborhood");
  assert.equal(ripple.fusible, false);
  assert.equal(heartbeat.requiresBaseSample, false);
});

test("consecutive local effects compile into one physical shader job", () => {
  const logical = compileShaderSchedule([
    { id: "invert", amount: 0.8 },
    { id: "gray", amount: 0.6 },
    { id: "ripple", amount: 0.4 },
  ]);
  const physical = fuseLocalShaderSchedule(logical);

  assert.equal(logical.length, 3);
  assert.equal(physical.length, 2);
  assert.equal(physical[0].fused, true);
  assert.deepEqual(physical[0].jobs.map((job) => job.pass.id), ["invert", "gray"]);
  assert.equal(physical[1].pass.id, "ripple");
});

test("fused local shader samples the source once and namespaces uniforms", () => {
  const jobs = compileShaderSchedule([
    { id: "invert", amount: 0.8 },
    { id: "gray", amount: 0.6 },
  ]);
  let fragment = "";
  const builder = createShaderBuilder({ getCustomCode: () => "", onStatus: () => {} });
  const target = {
    __vj1ShaderContextId: "test",
    createShader(_vertex, source) {
      fragment = source;
      return { source };
    },
  };

  assert.ok(builder.getFusedShader(jobs, target));
  assert.match(fragment, /f0_runEffect/);
  assert.match(fragment, /f1_runEffect/);
  assert.match(fragment, /uniform float f0_amount/);
  assert.equal((fragment.match(/color = sampleSource\(vTexCoord\)/g) || []).length, 1);
});

test("precomputed effect matrices are inverse transforms", () => {
  const matrices = effectTransformUniforms({ x: 0.2, y: -0.15, scale: 1.7, rotation: 0.63 });
  const point = [0.23, 0.81];
  const transformed = applyMat3(matrices.forward, point);
  const restored = applyMat3(matrices.inverse, transformed);

  assert.ok(Math.abs(restored[0] - point[0]) < 1e-9);
  assert.ok(Math.abs(restored[1] - point[1]) < 1e-9);
});

test("content coordinates preserve right and down across drag Canvas and UV boundaries", () => {
  assert.deepEqual(CONTENT_COORDINATE_CONVENTION, { x: "right", y: "down", rotation: "clockwise" });
  assert.deepEqual(localContentDragDelta(20, 10, {}, 200, 100), { x: 0.2, y: 0.2 });
  const placed = contentTransformCanvasPlacement({ x: 0.2, y: 0.2 }, 200, 100);
  assert.equal(placed.centerX, 120);
  assert.equal(placed.centerY, 60);

  const sampling = contentTransformUvMatrices({ x: 0.2, y: 0.2 }).sampling;
  const sourceCenter = applyMat3(sampling, [0.6, 0.6]);
  assert.ok(Math.abs(sourceCenter[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(sourceCenter[1] - 0.5) < 1e-9);
});

test("raw WebGL storage orientation is explicit and separate from Composition coordinates", () => {
  const target = {};
  assert.equal(renderTargetNeedsPresentationFlip(target), false);
  assert.equal(markRenderTargetOrientation(target, RENDER_TARGET_ORIENTATION.rawWebGL), target);
  assert.equal(renderTargetNeedsPresentationFlip(target), true);
  markRenderTargetOrientation(target, RENDER_TARGET_ORIENTATION.composition);
  assert.equal(renderTargetNeedsPresentationFlip(target), false);
});

test("terrain preserves world-up camera Y until Composition placement converts it once", () => {
  const source = readFileSync(new URL("../js/output/specialized/terrain-renderer.js", import.meta.url), "utf8");
  const specializedSource = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  assert.match(source, /float terrainClipYFromWorldUp\(float worldUpY\)/);
  assert.match(source, /return worldUpY;/);
  assert.equal((source.match(/terrainClipYFromWorldUp\(cameraY\) \* focalLength/g) || []).length, 2);
  assert.doesNotMatch(source, /terrainClipYFromScreenDown/);
  assert.match(source, /uniform mat3 contentPlacementMatrix/);
  assert.equal((source.match(/placeTerrainInComposition\(vec4\(/g) || []).length, 2);
  assert.match(source, /clip\.w \* 0\.5 - clip\.y \* 0\.5/);
  assert.match(source, /gl\.uniformMatrix3fv\(resources\.contentPlacementMatrix/);
  const terrainDraw = specializedSource.slice(
    specializedSource.indexOf("  drawTerrain("),
    specializedSource.indexOf("  drawModel(")
  );
  assert.match(terrainDraw, /markRenderTargetOrientation\(target, RENDER_TEXTURE_ORIENTATION\.bottomLeft\)/);
  assert.doesNotMatch(terrainDraw, /markRenderTargetOrientation\(target, RENDER_TEXTURE_ORIENTATION\.topLeft\)/);
});

test("terrain raw WebGL passes are isolated from the shared p5 renderer", () => {
  const source = readFileSync(new URL("../js/output/specialized/terrain-renderer.js", import.meta.url), "utf8");
  const rawWebGlSource = readFileSync(new URL("../js/output/specialized/raw-webgl-utils.js", import.meta.url), "utf8");
  const stateSource = readFileSync(new URL("../js/output/specialized/raw-webgl-state.js", import.meta.url), "utf8");
  assert.match(source, /beginRawWebGlState\(gl, "terrain-surface"\)/);
  assert.match(source, /beginRawWebGlState\(gl, "terrain-wire"\)/);
  assert.match(stateSource, /VERTEX_ARRAY_BINDING/);
  assert.match(stateSource, /OES_vertex_array_object/);
  assert.doesNotMatch(stateSource, /FRAMEBUFFER_BINDING|DEPTH_WRITEMASK|COLOR_WRITEMASK|BLEND_EQUATION_RGB/);
  assert.equal((source.match(/restoreRawWebGlState\(gl, passState, attributeStates\)/g) || []).length, 2);
  assert.equal((source.match(/\} finally \{/g) || []).length >= 2, true);
  assert.match(rawWebGlSource, /\[VJ1_RAW_SHADER_COMPILE_FAILED\]/);
  assert.match(rawWebGlSource, /\[VJ1_RAW_PROGRAM_LINK_FAILED\]/);
});

test("render recovery paths are observable and mapper overlays restore depth state", () => {
  const framebufferSource = readFileSync(new URL("../js/output/shared-framebuffer-target.js", import.meta.url), "utf8");
  const drawSource = readFileSync(new URL("../js/output/render-draw-utils.js", import.meta.url), "utf8");
  const specializedSource = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const mapperSource = readFileSync(new URL("../js/output/vj-mapper.js", import.meta.url), "utf8");

  assert.match(framebufferSource, /\[VJ1_FRAMEBUFFER_UNAVAILABLE\]/);
  assert.match(drawSource, /\[VJ1_SAMPLE_DRAW_FALLBACK\]/);
  assert.match(drawSource, /\[VJ1_SAMPLE_DRAW_FAILED\]/);
  assert.match(specializedSource, /\[VJ1_PRESENTATION_SHADER_FAILED\]/);
  assert.match(specializedSource, /\[VJ1_SPECIALIZED_TARGET_RESIZE_FAILED\]/);
  assert.match(mapperSource, /const depthWasEnabled = .*gl\.isEnabled\(gl\.DEPTH_TEST\)/);
  assert.match(mapperSource, /if \(depthWasEnabled\) gl\.enable\?\.\(gl\.DEPTH_TEST\)/);
});

test("selected grain effects use the shared cached noise texture", () => {
  assert.match(getShaderComponent("photoGrade").code, /cachedNoise\(/);
  assert.match(getShaderComponent("labelGrain").code, /cachedNoise\(/);
});

test("shared framebuffer facade re-establishes the top-left 2D contract", () => {
  const calls = [];
  const names = ["push", "translate", "imageMode", "rectMode", "pop"];
  const previous = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = (...args) => calls.push([name, ...args]);
  const framebuffer = {
    width: 640,
    height: 360,
    begin: () => calls.push(["begin"]),
    end: () => calls.push(["end"]),
  };
  try {
    const target = new SharedFramebufferTarget(framebuffer);
    assert.equal(target.__vj1ShaderContextId, "shared-main-context");
    target.push();
    target.pop();
    assert.deepEqual(calls, [
      ["begin"],
      ["push"],
      ["translate", -320, -180],
      ["imageMode", "corner"],
      ["rectMode", "corner"],
      ["pop"],
      ["end"],
    ]);
    assert.equal(unwrapRenderTarget(target), framebuffer);
    assert.equal(unwrapRenderTarget(framebuffer), framebuffer);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete globalThis[name];
      else globalThis[name] = previous[name];
    }
  }
});

test("shared framebuffer shader draws undo an active top-left translation", () => {
  const calls = [];
  const names = ["push", "translate", "imageMode", "rectMode", "pop"];
  const previous = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = (...args) => calls.push([name, ...args]);
  const framebuffer = {
    width: 640,
    height: 360,
    begin: () => calls.push(["begin"]),
    end: () => calls.push(["end"]),
  };
  try {
    const target = new SharedFramebufferTarget(framebuffer);
    target.push();
    target.drawWebGL(() => calls.push(["draw"]));
    target.pop();
    assert.deepEqual(calls, [
      ["begin"],
      ["push"],
      ["translate", -320, -180],
      ["imageMode", "corner"],
      ["rectMode", "corner"],
      ["push"],
      ["translate", 320, 180],
      ["draw"],
      ["pop"],
      ["pop"],
      ["end"],
    ]);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete globalThis[name];
      else globalThis[name] = previous[name];
    }
  }
});

test("mapper applies homography per vertex and draws centered projective quads", () => {
  const vertexSource = mapperVertexShaderSource();
  const fragmentSource = mapperFragmentShaderSource();
  assert.match(vertexSource, /vProjectiveUv\s*=\s*uHinv\s*\*/);
  assert.doesNotMatch(fragmentSource, /uHinv\s*\*/);
  assert.deepEqual(surfaceQuadVertices([
    { x: 0, y: 0 },
    { x: 640, y: 0 },
    { x: 640, y: 360 },
    { x: 0, y: 360 },
  ], 640, 360), [
    { x: -320, y: -180 },
    { x: 320, y: -180 },
    { x: -320, y: 180 },
    { x: 320, y: 180 },
  ]);
});

test("projection mapping exposes cover contain and stretch without another render pass", () => {
  const fragmentSource = mapperFragmentShaderSource();
  const featherSource = mapperFragmentShaderSource({ feather: true });
  assert.equal(projectionFitMode(), 1);
  assert.equal(projectionFitMode("cover"), 1);
  assert.equal(projectionFitMode("contain"), 2);
  assert.equal(projectionFitMode("stretch"), 0);
  assert.match(fragmentSource, /uniform float uSourceAspect/);
  assert.match(fragmentSource, /uniform float uTargetAspect/);
  assert.match(fragmentSource, /uniform float uProjectionFit/);
  assert.doesNotMatch(fragmentSource, /uFeather/);
  assert.match(featherSource, /uniform float uFeather/);
  assert.match(featherSource, /float cornerRadius = min\(0\.08, max\(0\.012, uFeather \* 0\.35\)\)/);
  assert.match(featherSource, /length\(max\(roundedDelta, 0\.0\)\)/);
  assert.match(featherSource, /return smoothstep\(0\.0, uFeather, -roundedDistance\)/);
  assert.match(featherSource, /vec2 featherUv = uProjectionFit >= 1\.5 \? sampleUv : uv/);
  assert.match(featherSource, /float featherAspect = uProjectionFit >= 1\.5 \? uSourceAspect : uTargetAspect/);
  assert.match(featherSource, /color \*= featherMask/);
  assert.match(fragmentSource, /uniform vec4 uSourceRect/);
  assert.match(fragmentSource, /textureUv = uSourceRect\.xy \+ clamp\(sampleUv/);
  assert.match(fragmentSource, /texture2D\(tex, textureUv\)/);
  assert.deepEqual(normalizedSourceRect(
    { width: 1000, height: 500 },
    { x: 250, y: 100, width: 500, height: 200 }
  ), [0.25, 0.2, 0.5, 0.4]);
});

test("projection fit follows the mapped quadrilateral rather than stored surface dimensions", () => {
  assert.equal(projectedSurfaceAspect([
    { x: 20, y: 30 },
    { x: 820, y: 30 },
    { x: 820, y: 430 },
    { x: 20, y: 430 },
  ], 16 / 9), 2);
  assert.ok(Math.abs(projectedSurfaceAspect([
    { x: 0, y: 0 },
    { x: 800, y: 0 },
    { x: 600, y: 400 },
    { x: 200, y: 400 },
  ]) - (3 / Math.sqrt(5))) < 1e-9);
  assert.equal(projectedSurfaceAspect([], 16 / 9), 16 / 9);
});

test("scene dissolve mixes premultiplied surface routes inside one projection shader", () => {
  const source = mapperTransitionFragmentShaderSource({ feather: true });
  assert.match(source, /uniform sampler2D fromTex/);
  assert.match(source, /uniform sampler2D toTex/);
  assert.match(source, /vec4 color = mix\(fromColor, toColor/);
  assert.match(source, /fromColor \*= roundedFeatherMask\(fromFeatherUv, fromFeatherAspect\)/);
  assert.match(source, /toColor \*= roundedFeatherMask\(toFeatherUv, toFeatherAspect\)/);
  assert.ok(source.indexOf("fromColor *= roundedFeatherMask") < source.indexOf("vec4 color = mix"));
});

function applyMat3(matrix, [x, y]) {
  return [
    matrix[0] * x + matrix[3] * y + matrix[6],
    matrix[1] * x + matrix[4] * y + matrix[7],
  ];
}
