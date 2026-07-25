import test from "node:test";
import assert from "node:assert/strict";

import {
  chainItemToShaderPass,
  drawShaderTarget,
  effectNeedsComposite,
  effectParamNumber,
  nextFxTargetSlot,
  setDynamicShaderUniformIfPresent,
  shaderDrawingBufferSize,
} from "../js/output/shader-target-runtime.js";

test("shader target runtime owns effect normalization and pass adaptation", () => {
  const component = {
    params: [{ id: "amount", type: "number", min: 0, max: 1, defaultValue: 0.5 }],
  };
  assert.equal(effectParamNumber(component, { amount: 2 }, "amount", 0.2), 1);
  assert.equal(effectParamNumber(component, { amount: "bad" }, "amount", 0.2), 0.5);
  assert.deepEqual(chainItemToShaderPass({ id: "fx-1", componentId: "blur", opacity: 0.5 }), {
    id: "blur",
    instanceId: "fx-1",
    enabled: true,
    params: {},
    amount: undefined,
    transform: {},
    opacity: 0.5,
    blend: "normal",
  });
  assert.equal(effectNeedsComposite({ opacity: 0.5 }), true);
  assert.equal(effectNeedsComposite({ opacity: 1, blend: "normal" }), false);
  assert.equal(nextFxTargetSlot(["a", "b"], "a"), 1);
  assert.equal(nextFxTargetSlot(["a", "b"], "b"), 0);
});

test("shader target runtime updates dynamic uniforms without allocating cached arrays", () => {
  const uniform = { _cachedData: [0, 0, 0] };
  const updates = [];
  const shader = {
    uniforms: { direction: uniform },
    _renderer: {
      updateUniformValue(owner, target, value) {
        updates.push({ owner, target, value });
      },
    },
  };
  const value = [1, 2];
  setDynamicShaderUniformIfPresent(shader, "direction", value);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].value, value);
  assert.deepEqual(uniform._cachedData, value);

  assert.deepEqual(shaderDrawingBufferSize({ drawingContext: { drawingBufferWidth: 1920, drawingBufferHeight: 1080 } }, 1, 1), {
    width: 1920,
    height: 1080,
  });
});

test("shader targets replace complete premultiplied output and restore normal blending", () => {
  const calls = [];
  const target = {
    push() { calls.push("push"); },
    pop() { calls.push("pop"); },
    blendMode(mode) { calls.push(`blend:${mode}`); },
  };
  const previousReplace = globalThis.REPLACE;
  const previousBlend = globalThis.BLEND;
  globalThis.REPLACE = "replace";
  globalThis.BLEND = "normal";
  try {
    const result = drawShaderTarget(target, () => {
      calls.push("draw");
      return "complete";
    });
    assert.equal(result, "complete");
    assert.deepEqual(calls, [
      "push",
      "blend:replace",
      "draw",
      "blend:normal",
      "pop",
    ]);
  } finally {
    if (previousReplace === undefined) delete globalThis.REPLACE;
    else globalThis.REPLACE = previousReplace;
    if (previousBlend === undefined) delete globalThis.BLEND;
    else globalThis.BLEND = previousBlend;
  }
});
