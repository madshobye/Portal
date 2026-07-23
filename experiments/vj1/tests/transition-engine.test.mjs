import test from "node:test";
import assert from "node:assert/strict";

import {
  defineTransitionKernel,
  createTransitionCatalog,
  DissolveTransitionKernel,
  transitionKernelCacheKey,
  transitionParameterValues,
  transitionKernelUniformValues,
  textureTransitionFragmentShaderSource,
} from "../js/libraries/transition-engine/index.js";

test("transition kernels are reusable typed artifacts with host and authored uniforms", () => {
  const kernel = defineTransitionKernel({
    id: "org.example.transition.directional",
    version: "1.2.0",
    name: "Directional",
    uniforms: {
      direction: { type: "vec2", defaultValue: [1, 0] },
      renderSize: { type: "vec2", host: "renderSize", defaultValue: [1, 1] },
    },
    source: `
vec4 vj1Transition(vec4 startColor, vec4 endColor, vec2 uv, float progress) {
  float edge = dot(uv, normalize(direction));
  return mix(startColor, endColor, step(edge, progress));
}`,
  });
  const values = transitionKernelUniformValues(kernel, {
    direction: [0, 1],
    renderSize: [2, 2],
  }, {
    renderSize: [1920, 1080],
  });

  assert.deepEqual(values.direction, [0, 1]);
  assert.deepEqual(values.renderSize, [1920, 1080], "host bindings cannot be shadowed by authored parameters");
  assert.match(kernel.source, /^uniform vec2 direction;/);
  assert.notEqual(transitionKernelCacheKey(kernel), transitionKernelCacheKey(DissolveTransitionKernel));
  assert.throws(() => defineTransitionKernel({
    id: "org.example.transition.invalid",
    source: "void main() {}",
  }), /TRANSITION_KERNEL_ENTRY_MISSING/);
});

test("reusable graph transitions embed the same kernel contract used by Scene mapping", () => {
  const source = textureTransitionFragmentShaderSource(DissolveTransitionKernel);
  assert.match(source, /uniform sampler2D fromTex/);
  assert.match(source, /uniform sampler2D toTex/);
  assert.match(source, /vec4 vj1Transition/);
  assert.match(source, /vj1Transition\(startColor, endColor, uv, clamp\(uTransition/);
});

test("transition catalog parameters normalize editor values into exact GLSL uniforms", () => {
  const kernel = defineTransitionKernel({
    id: "org.example.transition.parameters",
    uniforms: {
      center: { type: "vec2", defaultValue: [0.25, 0.75] },
      tint: { type: "vec4", defaultValue: [1, 1, 1, 1] },
      mode: { type: "int", defaultValue: 2 },
      enabled: { type: "bool", defaultValue: false },
    },
    source: `
vec4 vj1Transition(vec4 startColor, vec4 endColor, vec2 uv, float progress) {
  return enabled ? mix(startColor, endColor * tint, progress + center.x * 0.0 + float(mode) * 0.0) : startColor;
}`,
  });
  const entry = {
    kernel,
    parameters: [
      { id: "centerX", isfUniform: "center", isfVectorIndex: 0, defaultValue: 0.25 },
      { id: "centerY", isfUniform: "center", isfVectorIndex: 1, defaultValue: 0.75 },
      { id: "tint", type: "color", isfUniformType: "color", defaultValue: "#ffffffff" },
      { id: "mode", type: "enum", values: ["Soft", "Hard"], isfValues: [2, 7], isfUniformType: "long" },
      { id: "enabled", type: "boolean", isfUniformType: "bool", defaultValue: false },
    ],
  };
  const values = transitionParameterValues(entry, {
    centerX: 0.4,
    centerY: 0.6,
    tint: "#33669980",
    mode: "Hard",
    enabled: true,
  });

  assert.deepEqual(values.center, [0.4, 0.6]);
  assert.deepEqual(values.tint.map((value) => Math.round(value * 255)), [51, 102, 153, 128]);
  assert.equal(values.mode, 7);
  assert.equal(values.enabled, true);
});

test("transition catalogs retain Dissolve as the fallback and reject accidental ID shadowing", () => {
  const catalog = createTransitionCatalog([{
    id: DissolveTransitionKernel.id,
    kernel: DissolveTransitionKernel,
  }]);

  assert.equal(catalog.get("missing").kernel, DissolveTransitionKernel);
  assert.equal(catalog.list().length, 1);
  assert.deepEqual(catalog.diagnostics, [{
    code: "id-collision",
    id: DissolveTransitionKernel.id,
  }]);
});

test("transition catalogs require an explicit replacement before overriding a built-in", () => {
  const replacement = {
    id: DissolveTransitionKernel.id,
    version: "2.0.0",
    replaces: [`${DissolveTransitionKernel.id}@${DissolveTransitionKernel.version}`],
    kernel: defineTransitionKernel({
      id: DissolveTransitionKernel.id,
      version: "2.0.0",
      source: `
vec4 vj1Transition(vec4 startColor, vec4 endColor, vec2 uv, float progress) {
  return progress < 0.5 ? startColor : endColor;
}`,
    }),
  };
  const catalog = createTransitionCatalog([replacement]);

  assert.equal(catalog.get(DissolveTransitionKernel.id).version, "2.0.0");
  assert.equal(catalog.diagnostics[0].code, "explicit-override");
});
