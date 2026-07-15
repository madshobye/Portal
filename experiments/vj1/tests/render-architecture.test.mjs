import test from "node:test";
import assert from "node:assert/strict";

import { compileShaderSchedule, fuseLocalShaderSchedule } from "../js/graph/render-scheduler.js";
import { effectTransformUniforms } from "../js/output/output-renderer.js";
import { SharedFramebufferTarget, unwrapRenderTarget } from "../js/output/shared-framebuffer-target.js";
import { mapperFragmentShaderSource, mapperVertexShaderSource, projectionFitMode, surfaceQuadVertices } from "../js/output/vj-mapper.js";
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
  assert.match(featherSource, /smoothstep\(0\.0, uFeather, min\(edgeUv\.x, edgeUv\.y\)\)/);
  assert.match(fragmentSource, /texture2D\(tex, clamp\(sampleUv/);
});

function applyMat3(matrix, [x, y]) {
  return [
    matrix[0] * x + matrix[3] * y + matrix[6],
    matrix[1] * x + matrix[4] * y + matrix[7],
  ];
}
