import test from "node:test";
import assert from "node:assert/strict";

import { getShaderComponent } from "../js/shaders/shader-registry.js";
import { getGeneratorShaderComponent } from "../js/shaders/generator-shaders.js";

test("photo grade exposes common one-pass image tweak controls", () => {
  const component = getShaderComponent("photoGrade");
  const ids = component.params.map((param) => param.id);

  assert.equal(component.name, "Photo Grade");
  assert.equal(component.category, "color");
  assert.ok(ids.includes("amount"));
  assert.ok(ids.includes("exposure"));
  assert.ok(ids.includes("contrast"));
  assert.ok(ids.includes("saturation"));
  assert.ok(ids.includes("vibrance"));
  assert.ok(ids.includes("temperature"));
  assert.ok(ids.includes("grain"));
  assert.ok(ids.includes("distort"));
  assert.ok(ids.includes("invert"));
  assert.ok(ids.includes("seedMode"));
  assert.ok(ids.includes("seed"));
});

test("photo grade skips neutral costly sections with uniform gates", () => {
  const component = getShaderComponent("photoGrade");

  assert.ok(component.code.includes("if (amount <= 0.0001) return color;"));
  assert.ok(component.code.includes("if (abs(gamma) > 0.001)"));
  assert.ok(component.code.includes("if (vignette > 0.001)"));
  assert.ok(component.code.includes("if (grain > 0.001)"));
  assert.ok(component.code.includes("if (noise > 0.001)"));
  assert.ok(component.code.includes("if (abs(vibrance) > 0.001)"));
});

test("alpha-sensitive effects keep transparent pixels premultiplied", () => {
  for (const id of ["invert", "labelGrain", "labelThresholdGrain", "hardBlack", "gray", "plasma"]) {
    const component = getShaderComponent(id);

    assert.ok(component.code.includes("* color.a") || component.code.includes("* alpha"), `${id} should multiply generated RGB by alpha`);
  }
});

test("grain threshold uses a single cheap grain hash", () => {
  const component = getShaderComponent("labelThresholdGrain");

  assert.ok(component.code.includes("fastThresholdGrain"));
  assert.ok(component.code.includes("vec2 grainCell = floor(uv * resolution"));
  assert.ok(!component.code.includes("hash("));
  assert.ok(!component.code.includes("vec3 noisy"));
});

test("noisy effects expose animated or fixed seed controls", () => {
  for (const id of ["photoGrade", "labelGrain", "labelThresholdGrain", "glitchDistort", "heatShimmer", "smear"]) {
    const component = getShaderComponent(id);
    const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

    assert.equal(params.seedMode?.type, "enum", `${id} should expose seed mode`);
    assert.deepEqual(params.seedMode?.values, ["animated", "fixed"]);
    assert.equal(params.seedMode?.defaultValue, "animated");
    assert.equal(params.seed?.type, "number", `${id} should expose numeric seed`);
    assert.ok(component.code.includes("seedMode < 0.5"), `${id} should use seed mode in shader code`);
  }
});

test("smear effect exposes fast stable print texture modes", () => {
  const component = getShaderComponent("smear");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Smear");
  assert.equal(component.category, "texture");
  assert.equal(component.spatial, false);
  assert.equal(params.amount.defaultValue, 1);
  assert.equal(params.cctvAmount.defaultValue, 0.45);
  for (const id of ["screenPrintAmount", "dotMatrixAmount", "receiptAmount", "ditherAmount", "smearAmount"]) {
    assert.equal(params[id].defaultValue, 0);
  }
  assert.equal(params.seedMode.defaultValue, "animated");
  assert.ok(component.code.includes("stableSmearNoise"));
  assert.ok(component.code.includes("dotPattern"));
  assert.ok(component.code.includes("if (cctvAmount > 0.001)"));
  assert.ok(component.code.includes("if (screenPrintAmount > 0.001)"));
  assert.ok(component.code.includes("if (dotMatrixAmount > 0.001)"));
  assert.ok(component.code.includes("if (receiptAmount > 0.001)"));
  assert.ok(component.code.includes("if (ditherAmount > 0.001)"));
  assert.ok(component.code.includes("if (smearAmount > 0.001)"));
  assert.ok(!component.code.includes("if (mode <"));
  assert.ok(component.code.includes("return vec4(effected * alpha, alpha);"));
});

test("heartbeat pulse exposes double-beat radial distortion controls", () => {
  const component = getShaderComponent("heartbeatPulse");
  const ids = component.params.map((param) => param.id);

  assert.equal(component.name, "Heartbeat Pulse");
  assert.equal(component.category, "warp");
  assert.equal(component.spatial, true);
  assert.equal(component.transformSource, false);
  assert.deepEqual(ids, ["amount", "rate", "ringWidth", "spread"]);
  assert.ok(component.code.includes("float cycleDuration = 1.0 / max(rate, 0.001);"));
  assert.ok(component.code.includes("float beatTime = mod(time, cycleDuration);"));
  assert.ok(component.code.includes("beatImpulse(beatTime, 0.08"));
  assert.ok(component.code.includes("beatImpulse(beatTime, 0.27"));
  assert.ok(!component.code.includes("fract(time * max(rate"));
  assert.ok(component.code.includes("vec2 screenUv = effectScreenUv();"));
  assert.ok(component.code.includes("vec2 center = vec2(0.5) + effectTransform.xy * 0.5;"));
  assert.ok(component.code.includes("vec2 dir"));
  assert.ok(component.code.includes("sampleSource(textureUvFromEffectScreenUv(warped))"));
});

test("flip effect exposes whole-image x and y controls", () => {
  const component = getShaderComponent("flip");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Flip");
  assert.equal(component.category, "geometry");
  assert.equal(component.spatial, false);
  assert.deepEqual(component.params.map((param) => param.id), ["amount", "flipX", "flipY"]);
  assert.equal(params.flipX.type, "boolean");
  assert.equal(params.flipX.defaultValue, true);
  assert.equal(params.flipY.type, "boolean");
  assert.equal(params.flipY.defaultValue, false);
  assert.ok(component.code.includes("flipX ? 1.0 - uv.x : uv.x"));
  assert.ok(component.code.includes("flipY ? 1.0 - uv.y : uv.y"));
  assert.ok(component.code.includes("return mix(color, flipped, amount);"));
});

test("spatial field effects place the effect without transforming the source image", () => {
  for (const id of ["ripple", "kaleido", "pixelate", "plasma", "glitchDistort", "spinRotate", "echoFade", "mirrorFold", "heatShimmer", "heartbeatPulse"]) {
    const component = getShaderComponent(id);

    assert.equal(component.spatial, true, `${id} should expose transform handles`);
    assert.equal(component.transformSource, false, `${id} should keep source sampling in screen space`);
  }

  for (const id of ["ripple", "kaleido", "pixelate", "glitchDistort", "spinRotate", "echoFade", "mirrorFold", "heatShimmer"]) {
    const component = getShaderComponent(id);

    assert.ok(component.code.includes("inverseTransformEffectUv("), `${id} should map local effect coordinates back to source space`);
  }
});

test("spatial field effects use screen-oriented y coordinates for handle translation", () => {
  for (const id of ["ripple", "kaleido", "pixelate", "plasma", "glitchDistort", "spinRotate", "echoFade", "mirrorFold", "heatShimmer"]) {
    const component = getShaderComponent(id);

    assert.ok(component.code.includes("transformEffectUv(effectScreenUv())"), `${id} should transform screen-oriented uv`);
  }

  for (const id of ["ripple", "kaleido", "pixelate", "glitchDistort", "spinRotate", "echoFade", "mirrorFold", "heatShimmer", "heartbeatPulse"]) {
    const component = getShaderComponent(id);

    assert.ok(component.code.includes("textureUvFromEffectScreenUv("), `${id} should flip transformed screen uv back before sampling`);
  }
});

test("echo fade masks delayed taps to the transformed effect field", () => {
  const component = getShaderComponent("echoFade");

  assert.ok(component.code.includes("float tapField = effectFieldMask(shifted);"));
  assert.ok(component.code.includes("* tapField"));
  assert.ok(!component.code.includes("echoed.a = max"));
});

test("heat shimmer uses screen-oriented y coordinates for handle translation", () => {
  const component = getShaderComponent("heatShimmer");

  assert.ok(component.code.includes("transformEffectUv(effectScreenUv())"));
  assert.ok(component.code.includes("textureUvFromEffectScreenUv(inverseTransformEffectUv(warped))"));
  assert.ok(component.code.includes("float waveA = sin"));
  assert.ok(!component.code.includes("hash(floor(localUv"));
});

test("fireflies generator keeps the background transparent and uses one tint color", () => {
  const component = getGeneratorShaderComponent("fireflies");

  for (const id of ["count", "glowSize", "speed", "trail", "brightness", "twinkle"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing fireflies uniform ${id}`);
  }
  assert.ok(component.code.includes("uniform vec4 tintColor;"));
  assert.ok(component.code.includes("color += tintColor.rgb * light;"));
  assert.ok(component.code.includes("* tintColor.a"));
  assert.ok(!component.code.includes("mix(vec3(0.35, 0.9, 0.62)"));
  assert.ok(component.code.includes("float alpha = 0.0"));
  assert.ok(component.code.includes("gl_FragColor = vec4(color * alpha, alpha)"));
});

test("gradient generator supports efficient linear radial and single modes", () => {
  const component = getGeneratorShaderComponent("gradient");

  assert.ok(component.code.includes("uniform float mode;"));
  assert.ok(component.code.includes("if (mode > 1.5)"));
  assert.ok(component.code.includes("gl_FragColor = vec4(colorA.rgb * colorA.a, colorA.a);"));
  assert.ok(component.code.includes("float maxRadius = max(length(vec2(0.5 * aspect.x, 0.5)), 0.0001);"));
  assert.ok(component.code.includes("t = length(uv) / maxRadius + offset;"));
  assert.ok(component.code.includes("vec2 dir = vec2(cos(angle), sin(angle));"));
});
