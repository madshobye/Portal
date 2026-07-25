import test from "node:test";
import assert from "node:assert/strict";
import { RenderTargetRuntime } from "../js/output/render-target-runtime.js";

test("render targets reuse exact request identities without duplicate allocation", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const cpuTargets = new Map();
  const gpuTargets = new Map();
  const touches = [];
  const createdCpu = [];
  const createdGpu = [];
  globalThis.createGraphics = (width, height) => {
    const target = {
      width,
      height,
      density: 0,
      fontApplied: false,
      draws: [],
      pixelDensity(value) {
        this.density = value;
      },
      push() {},
      translate() {},
      scale() {},
      clear() {},
      pop() {},
      image(source, x, y, drawWidth, drawHeight) {
        this.draws.push({ source, x, y, drawWidth, drawHeight });
      },
    };
    createdCpu.push(target);
    return target;
  };
  const host = {
    frameRuntime: { frameIndex: 7 },
    resourceRuntime: {
      renderCache: {
        buffers: cpuTargets,
        gpuBuffers: gpuTargets,
        touch(kind, key, frame) {
          touches.push({ kind, key, frame });
        },
      },
      applyGraphicsPixelDensity(target, density) {
        target.pixelDensity(density);
      },
      applyGraphicsFont(target) {
        target.fontApplied = true;
      },
    },
    renderRequestRuntime: {
      normalize(request, role) {
        return { role, ...request };
      },
      pixelDensity: (request) => request.pixelDensity,
    },
  };
  const runtime = new RenderTargetRuntime(host);
  const request = {
    width: 320,
    height: 180,
    pixelDensity: 2,
    renderIdentity: "instance:a",
  };
  const createGpu = (width, height) => {
    const target = { width, height };
    createdGpu.push(target);
    return target;
  };

  try {
    const cpuA = runtime.cpu("source", request);
    const cpuB = runtime.cpu("source", request);
    assert.strictEqual(cpuA, cpuB);
    assert.equal(createdCpu.length, 1);
    assert.equal(cpuA.density, 2);
    assert.equal(cpuA.fontApplied, true);

    const gpuA = runtime.gpu("node", request, { createTarget: createGpu });
    const gpuB = runtime.gpu("node", request, { createTarget: createGpu });
    assert.strictEqual(gpuA, gpuB);
    assert.equal(createdGpu.length, 1);

    const shaderSource = { __vj1ShaderBuffer: true };
    assert.equal(runtime.isShaderBuffer(shaderSource), true);
    assert.equal(runtime.isShaderBuffer({}), false);
    assert.strictEqual(runtime.materialize(shaderSource, "materialized", request).draws[0].source, shaderSource);
    assert.strictEqual(runtime.materialize({ shader: false }, "unused", request).shader, false);
    assert.deepEqual(
      touches.map(({ kind, frame }) => ({ kind, frame })),
      [
        { kind: "buffer", frame: 7 },
        { kind: "buffer", frame: 7 },
        { kind: "gpu-buffer", frame: 7 },
        { kind: "gpu-buffer", frame: 7 },
        { kind: "buffer", frame: 7 },
      ],
    );
  } finally {
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
  }
});

test("custom retained targets release context state before replacement", () => {
  const gpuTargets = new Map();
  const released = [];
  const disposed = [];
  const host = {
    frameRuntime: { frameIndex: 1 },
    resourceRuntime: {
      renderCache: {
        buffers: new Map(),
        gpuBuffers: gpuTargets,
        touch() {},
      },
    },
    renderRequestRuntime: {
      normalize(request, role) {
        return { role, ...request };
      },
    },
  };
  const runtime = new RenderTargetRuntime(host);
  const request = { width: 64, height: 64, renderIdentity: "shared" };
  const first = runtime.gpu("pipeline", request, {
    createTarget: (width, height) => ({ width, height, generation: 1 }),
  });
  first.width = 32;
  const replacement = runtime.gpu("pipeline", request, {
    createTarget: (width, height) => ({ width, height, generation: 2 }),
    beforeDispose: (target) => released.push(target),
    disposeTarget: (target) => disposed.push(target),
  });

  assert.notStrictEqual(replacement, first);
  assert.deepEqual(released, [first]);
  assert.deepEqual(disposed, [first]);
  assert.equal(replacement.generation, 2);
});
