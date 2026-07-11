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
});

test("fireflies generator keeps the background transparent", () => {
  const component = getGeneratorShaderComponent("fireflies");

  for (const id of ["count", "glowSize", "speed", "trail", "brightness", "twinkle"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing fireflies uniform ${id}`);
  }
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
