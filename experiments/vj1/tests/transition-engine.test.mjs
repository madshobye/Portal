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
import {
  DefaultBuiltInTransition,
} from "../js/libraries/visual-nodes/catalog.js";
import {
  VjMapper,
} from "../js/libraries/mapping-engine/mapping-engine/index.js";

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
  assert.throws(() => defineTransitionKernel({
    id: "org.example.transition.raw-endpoint",
    source: `
vec4 vj1Transition(vec4 startColor, vec4 endColor, vec2 uv, float progress) {
  return texture(fromTex, uv);
}`,
  }), /TRANSITION_KERNEL_RAW_ENDPOINT_ACCESS/);
});

test("reusable graph transitions embed the same kernel contract used by Scene mapping", () => {
  const source = textureTransitionFragmentShaderSource(DissolveTransitionKernel);
  assert.match(source, /vec4 vj1SampleTransitionStart\(vec2 uv\)/);
  assert.match(source, /vec4 startColor = vj1SampleTransitionStart\(uv\)/);
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

test("the normal Dissolve catalog path is the file-backed ISF kernel", () => {
  const catalog = createTransitionCatalog([DefaultBuiltInTransition]);
  const resolved = catalog.get("");

  assert.equal(resolved.id, DissolveTransitionKernel.id);
  assert.equal(resolved.version, DissolveTransitionKernel.version);
  assert.equal(resolved.origin.kind, "built-in");
  assert.equal(resolved.kernel.implementation, "isf");
  assert.notStrictEqual(
    resolved.kernel,
    DissolveTransitionKernel,
    "the native kernel is not the normal catalog implementation",
  );
  assert.match(
    textureTransitionFragmentShaderSource(resolved.kernel),
    /vj1Transition\(startColor, endColor, uv, clamp\(uTransition/,
  );
  assert.deepEqual(catalog.diagnostics, []);
});

test("the mapper retains native Dissolve only beside active kernels as its emergency fallback", () => {
  const mapper = new VjMapper();
  const nativeKey = `${transitionKernelCacheKey(DissolveTransitionKernel)}:plain`;
  const fileBackedKey =
    `${transitionKernelCacheKey(DefaultBuiltInTransition.kernel)}:plain`;
  const staleKey = "stale:transition:plain";
  mapper.transitionShaders.set(nativeKey, {});
  mapper.transitionShaders.set(fileBackedKey, {});
  mapper.transitionShaders.set(staleKey, {});

  mapper.retainTransitionKernels([DefaultBuiltInTransition.kernel]);

  assert.equal(mapper.transitionShaders.has(nativeKey), true);
  assert.equal(mapper.transitionShaders.has(fileBackedKey), true);
  assert.equal(mapper.transitionShaders.has(staleKey), false);
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
