import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getEffectNodeComponent as getShaderComponent, listEffectNodeComponents as listShaderComponents, getGeneratorNodeComponent as getGeneratorComponent, getGeneratorNodeShader, listGeneratorNodeComponents } from "../js/libraries/visual-nodes/index.js";
import { getGeneratorShaderComponent } from "../js/libraries/visual-nodes/index.js";
import { createShaderBuilder } from "../js/shaders/shader-builder.js";

function generatorShaderCatalogSource() {
  return listGeneratorNodeComponents().map((component) => component.code || "").join("\n");
}

test("every rasterizing effect exposes the shared render quality budget", () => {
  for (const component of listShaderComponents().filter(({ processor }) =>
    processor !== "observer"
  )) {
    const quality = component.params.find((param) => param.id === "renderQuality");
    assert.ok(quality, `${component.id} is missing renderQuality`);
    assert.equal(quality.defaultValue, 0.5);
  }
  const probe = getShaderComponent("probe");
  assert.equal(probe.processor, "observer");
  assert.equal(probe.params.some(({ id }) => id === "renderQuality"), false);
});

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
  assert.ok(ids.includes("ditherAmount"));
  assert.ok(ids.includes("ditherStyle"));
  assert.ok(ids.includes("ditherDotSize"));
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
  assert.ok(component.code.includes("if (ditherAmount > 0.001)"));
  assert.ok(component.code.includes("photoGradePrintDither"));
  assert.ok(component.code.includes("if (abs(vibrance) > 0.001)"));
  assert.ok(component.code.includes("rgb = mix(rgb, 1.0 - rgb, invert)"));
});

test("label chromatic uses a cheap default path", () => {
  const component = getShaderComponent("labelChromatic");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.category, "color");
  assert.equal(params.amount.defaultValue, 0.35);
  assert.equal(params.fullSplit.type, "boolean");
  assert.equal(params.fullSplit.defaultValue, false);
  assert.ok(component.code.includes("if (amount <= 0.0001) return color;"));
  assert.ok(component.code.includes("if (!fullSplit) return vec4(redColor.r, color.g, color.b, color.a);"));
});

test("zero amount shader passes are skipped before drawing", () => {
  const source = readFileSync(new URL("../js/output/shader-effect-runtime.js", import.meta.url), "utf8");

  assert.ok(source.includes("if (pass.amount <= 0.0001) continue;"));
});

test("alpha-sensitive effects keep transparent pixels premultiplied", () => {
  for (const id of ["invert", "labelGrain", "labelThresholdGrain", "hardBlack", "gray", "plasma"]) {
    const component = getShaderComponent(id);

    assert.ok(
      component.code.includes("* color.a") ||
      component.code.includes("* alpha") ||
      component.code.includes("vj1IsfOutput.rgb * vj1IsfOutput.a"),
      `${id} should multiply generated RGB by alpha`,
    );
  }
});

test("Broken Fluorescent exposes bounded coherent flicker and glow controls", () => {
  const component = getShaderComponent("brokenFluorescent");
  const ids = component.params.map((param) => param.id);

  assert.equal(component.name, "Broken Fluorescent");
  assert.equal(component.category, "motion");
  assert.equal(component.spatial, false);
  for (const id of ["amount", "brightness", "glow", "flicker", "speed", "threshold", "glowSize", "noiseScale", "tubeColor"]) {
    assert.ok(ids.includes(id), `${id} should be controllable`);
  }
  assert.ok(component.code.includes("float fluorescentSimplex(vec2 v)"));
  assert.ok(component.code.includes("smoothstep(threshold - edge, threshold + edge"));
  assert.ok(component.code.includes("if (renderQuality > 0.55"));
  assert.equal((component.code.match(/sampleSource\(/g) || []).length, 8);
  assert.ok(component.code.includes("vec4 lit = vec4(litRgb, litAlpha);"));
  assert.equal(component.runtime.timeDependent({ flicker: 1, speed: 2, seedMode: "animated" }), true);
  assert.equal(component.runtime.timeDependent({ flicker: 0, speed: 2, seedMode: "animated" }), false);
  assert.equal(component.runtime.timeDependent({ flicker: 1, speed: 2, seedMode: "fixed" }), false);
});

test("Power Flicker hard-cuts the whole previous layer with one irregular electrical state", () => {
  const component = getShaderComponent("powerFlicker");
  const ids = component.params.map((param) => param.id);

  assert.equal(component.name, "Power Flicker");
  assert.equal(component.category, "motion");
  assert.equal(component.spatial, false);
  for (const id of ["amount", "speed", "threshold", "offLevel", "brightness", "coldWash", "chatter", "lightColor"]) {
    assert.ok(ids.includes(id), `${id} should be controllable`);
  }
  assert.ok(component.code.includes("float powerFlickerNoise(float coordinate"));
  assert.ok(component.code.includes("float powered = step(threshold, supply);"));
  assert.ok(component.code.includes("powered = mix(powered, chatterBit, chatterGate);"));
  assert.ok(component.code.includes("vec3 flickered = mix(offColor, onColor, powered) * alpha;"));
  assert.ok(!component.code.includes("sampleSource("));
  assert.equal(component.sampling, "local");
  assert.equal(component.fusible, true);
  assert.equal(component.runtime.timeDependent({ amount: 1, speed: 4, seedMode: "animated" }), true);
  assert.equal(component.runtime.timeDependent({ amount: 0, speed: 4, seedMode: "animated" }), false);
  assert.equal(component.runtime.timeDependent({ amount: 1, speed: 4, seedMode: "fixed" }), false);
});

test("HSV alpha key exposes paired color ranges and preserves premultiplied alpha", () => {
  const component = getShaderComponent("hsvAlphaKey");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "HSV Alpha Key");
  assert.equal(component.category, "key");
  assert.equal(params.hueMin.rangePair, "hue");
  assert.equal(params.hueMin.rangeRole, "min");
  assert.equal(params.hueMax.rangeRole, "max");
  assert.equal(params.hueMin.defaultValue, 200);
  assert.equal(params.hueMax.defaultValue, 260);
  assert.equal(params.saturationMin.defaultValue, 0.4);
  assert.equal(params.valueMax.defaultValue, 0.45);
  assert.equal(params.feather.defaultValue, 0.08);
  assert.match(component.code, /rgbToHsv/);
  assert.match(component.code, /color\.rgb \* keep, color\.a \* keep/);
});

test("Alpha Feather uses a continuous alpha-distance gradient with a neutral fast path", () => {
  const component = getShaderComponent("alphaFeather");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Alpha Feather");
  assert.equal(component.category, "key");
  assert.equal(component.sampling, "neighborhood");
  assert.equal(component.fusible, false);
  assert.deepEqual(component.runtime.roi, {
    mode: "neighborhood",
    halo: 64,
    coordinateSpace: "boundary",
    pixelEquivalentToFullFrame: true,
  });
  assert.equal(params.amount.defaultValue, 1);
  assert.equal(params.cut.defaultValue, 1);
  assert.equal(params.feather.defaultValue, 3);
  assert.equal(params.cut.max, 32);
  assert.equal(component.runtime.isNeutral({ cut: 0, feather: 0 }), true);
  assert.equal(component.runtime.isNeutral({ cut: 0, feather: 0.25 }), false);
  assert.equal(component.runtime.isNeutral({ cut: 0.25, feather: 0 }), false);
  assert.match(component.code, /float erodedAlpha8/);
  assert.match(component.code, /float alphaEdgeDistance/);
  assert.match(component.code, /alphaSum \/ 32\.0/);
  assert.match(component.code, /smoothstep\(cutRadius, outerRadius, edgeDistance\)/);
  assert.doesNotMatch(component.code, /middleAlpha/);
  assert.match(component.code, /color\.rgb \* alphaScale, outputAlpha/);
});

test("grain threshold interpolates its slider-scaled random field", () => {
  const component = getShaderComponent("labelThresholdGrain");

  assert.ok(component.code.includes("fastThresholdGrain"));
  assert.ok(component.code.includes("smoothThresholdGrain"));
  assert.ok(component.code.includes("vec2 grainCoord = uv * resolution"));
  assert.ok(!component.code.includes("fastThresholdGrain(grainCell"));
  assert.ok(!component.code.includes("hash("));
  assert.ok(!component.code.includes("vec3 noisy"));
});

test("procedural scale controls interpolate random fields instead of rehashing floored coordinates", () => {
  const smear = getShaderComponent("smear").code;
  const crayon = getShaderComponent("crayonStroke").code;
  const glitch = getShaderComponent("glitchDistort").code;
  const strokes = getGeneratorShaderComponent("bezierStrokes").code;

  assert.ok(smear.includes("smoothSmearNoise(uv * resolution * mix(0.45, 1.8, scale)"));
  assert.ok(smear.includes("smoothSmearNoise(uv * resolution * mix(0.55, 1.7, scale)"));
  assert.ok(crayon.includes("smoothCrayonNoise(uv * resolution * mix(0.48, 1.8, strokeScale)"));
  assert.ok(!crayon.includes("crayonHash(floor(uv * resolution"));
  assert.ok(glitch.includes("smoothGlitchNoise(rowCoord"));
  assert.ok(!glitch.includes("float row = floor(localUv.y * blocks)"));
  assert.ok(strokes.includes("smoothStrokeNoise((p + seed) * resolution.y"));
  assert.ok(!strokes.includes("strokeHash2(floor((p + seed)"));
});

test("noisy effects expose animated or fixed seed controls", () => {
  for (const id of ["photoGrade", "labelGrain", "labelThresholdGrain", "brokenFluorescent", "powerFlicker", "glitchDistort", "heatShimmer", "smear"]) {
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
  assert.ok(component.code.includes("dot(cell, cell)"));
  assert.ok(!component.code.includes("length(cell)"));
  assert.ok(component.code.includes("if (cctvAmount > 0.001)"));
  assert.ok(component.code.includes("if (screenPrintAmount > 0.001)"));
  assert.ok(component.code.includes("if (dotMatrixAmount > 0.001)"));
  assert.ok(component.code.includes("if (receiptAmount > 0.001)"));
  assert.ok(component.code.includes("if (ditherAmount > 0.001)"));
  assert.ok(component.code.includes("if (smearAmount > 0.001)"));
  assert.ok(!component.code.includes("if (mode <"));
  assert.ok(component.code.includes("return vec4(effected * alpha, alpha);"));
});

test("shared procedural hashes avoid shader trig", () => {
  const shaderBuilderSource = readFileSync(new URL("../js/shaders/shader-builder.js", import.meta.url), "utf8");
  const generatorShaderSource = generatorShaderCatalogSource();
  const diagnosticGeneratorSource = readFileSync(new URL("../js/output/generators.js", import.meta.url), "utf8");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");

  assert.ok(shaderBuilderSource.includes("p3 += dot(p3, p3.yzx + 33.33);"));
  assert.ok(generatorShaderSource.includes("p3 += dot(p3, p3.yzx + 33.33);"));
  assert.ok(sourceRuntime.includes("VJ1_GENERATOR_IMPLEMENTATION_MISSING"));
  assert.ok(!diagnosticGeneratorSource.includes("function drawGenerator"));
  assert.ok(!diagnosticGeneratorSource.includes("function drawNoise"));
  assert.ok(!shaderBuilderSource.includes("fract(sin"));
  for (const id of ["waves", "noise", "plasma", "gradient", "bezierStrokes", "fireflies", "swayingTrees"]) {
    assert.ok(!getGeneratorShaderComponent(id).code.includes("fract(sin"), `${id} regressed to a trig hash`);
  }
  const eyeballCode = getGeneratorShaderComponent("eyeballRender").code;
  assert.ok(!eyeballCode.includes("fract(sin"), "eyeball regressed to a trig hash");
  assert.ok(!diagnosticGeneratorSource.includes("Math.sin(x * 127.1"));
});

test("Plasma generator and effect expose graph-owned editable motion", () => {
  const generator = getGeneratorComponent("plasma");
  const effect = getShaderComponent("plasma");
  const generatorShader = getGeneratorShaderComponent("plasma").code;
  const expected = ["speed", "phase", "direction", "frequency", "complexity", "distortion", "hueShift"];

  for (const component of [generator, effect]) {
    const ids = component.params.map((param) => param.id);
    for (const id of expected) assert.ok(ids.includes(id), `${component.id} is missing ${id}`);
    assert.ok(!ids.includes("motionMode"));
    assert.ok(!ids.includes("colorSpeed"));
    assert.ok(component.params.find((param) => param.id === "phase")?.defaultAnimation);
  }
  assert.ok(generator.params.some((param) => param.id === "frequency" && param.label === "Cell scale"));
  assert.doesNotMatch(generatorShader, /\btime\b/);
  assert.doesNotMatch(effect.code, /\btime\b/);
  assert.ok(generatorShader.includes("vec2 orbit = vec2(cos(phase), sin(phase));"));
  assert.ok(effect.code.includes("vec2 orbit = vec2(cos(phase), sin(phase));"));
});

test("eyeball keeps frame-constant animation out of per-pixel work", () => {
  const code = getGeneratorShaderComponent("eyeballRender").code;

  assert.ok(code.includes("uniform float gazeX;"));
  assert.ok(code.includes("uniform float blink;"));
  assert.ok(code.includes("vec3 eyeGazeDir = vec3(gazeX, gazeY, gazeZ);"));
  assert.ok(code.includes("float eyeBlink = blink;"));
  assert.ok(code.includes("if (irisMask > 0.001)"));
  assert.ok(code.includes("if (eyeBlink > 0.02)"));
  assert.ok(!code.includes("randomGaze"));
  assert.ok(!code.includes("shutterBlink"));
  assert.ok(!code.includes("atan("));
  assert.ok(!code.includes("pow("));
});

test("heartbeat pulse exposes double-beat radial distortion controls", () => {
  const component = getShaderComponent("heartbeatPulse");
  const ids = component.params.map((param) => param.id);

  assert.equal(component.name, "Heartbeat Pulse");
  assert.equal(component.category, "warp");
  assert.equal(component.spatial, true);
  assert.equal(component.transformSource, false);
  assert.deepEqual(ids, ["renderQuality", "amount", "rate", "ringWidth", "spread"]);
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
  assert.deepEqual(component.params.map((param) => param.id), ["renderQuality", "amount", "flipX", "flipY"]);
  assert.equal(params.flipX.type, "boolean");
  assert.equal(params.flipX.defaultValue, true);
  assert.equal(params.flipY.type, "boolean");
  assert.equal(params.flipY.defaultValue, false);
  assert.ok(component.code.includes("flipX ? 1.0 - uv.x : uv.x"));
  assert.ok(component.code.includes("flipY ? 1.0 - uv.y : uv.y"));
  assert.ok(component.code.includes("return mix(color, flipped, amount);"));
});

test("spatial field effects place the effect without transforming the source image", () => {
  for (const id of ["ripple", "kaleido", "pixelate", "plasma", "alphaVignette", "glitchDistort", "spinRotate", "echoFade", "mirrorFold", "heatShimmer", "heartbeatPulse"]) {
    const component = getShaderComponent(id);

    assert.equal(component.spatial, true, `${id} should expose transform handles`);
    assert.equal(component.transformSource, false, `${id} should keep source sampling in screen space`);
  }

  for (const id of ["ripple", "kaleido", "pixelate", "glitchDistort", "spinRotate", "echoFade", "mirrorFold", "heatShimmer"]) {
    const component = getShaderComponent(id);

    assert.ok(component.code.includes("inverseTransformEffectUv("), `${id} should map local effect coordinates back to source space`);
  }
});

test("every spatial effect uses the field-transform contract", () => {
  const spatialEffects = listShaderComponents().filter((component) => component.spatial);

  assert.ok(spatialEffects.some((component) => component.id === "alphaVignette"));
  for (const component of spatialEffects) {
    assert.equal(component.transformSource, false, `${component.id} must not transform its source image`);
    assert.equal(component.fusible, false, `${component.id} requires its own spatial field pass`);
  }
});

test("effects using local field coordinates expose transform handles", () => {
  for (const component of listShaderComponents()) {
    if (!component.code?.includes("transformEffectUv(effectScreenUv())")) continue;
    assert.equal(component.spatial, true, `${component.id} uses a local field and should expose handles`);
  }
});

test("spatial effect transforms keep the effect boundary on the component frame", () => {
  const builderSource = readFileSync(new URL("../js/shaders/shader-builder.js", import.meta.url), "utf8");
  const maskSource = builderSource.slice(
    builderSource.indexOf("float effectFieldMask("),
    builderSource.indexOf("${effectCode}")
  );

  assert.ok(maskSource.includes("abs(renderUvFromLocal(vTexCoord) - vec2(0.5))"));
  assert.ok(!maskSource.includes("abs(uv - vec2(0.5))"));
});

test("generator transforms change UV coordinates without changing the render target", () => {
  const builderSource = readFileSync(new URL("../js/shaders/shader-builder.js", import.meta.url), "utf8");

  assert.ok(builderSource.includes("uniform mat3 contentUvMatrix;"));
  assert.ok(builderSource.includes("contentUvMatrix * vec3(componentUv, 1.0)"));
  assert.ok(!builderSource.includes("vec2 compositionUv = vec2(vTexCoord.x, 1.0 - vTexCoord.y)"));
  assert.ok(builderSource.includes("return mix(componentUv, transformedUv"));
  assert.ok(builderSource.includes("contentUvMatrix * vec3(baseUv, 1.0)"));
  assert.ok(builderSource.includes("vTexCoord = aTexCoord;"));
  assert.ok(!builderSource.includes("contentUvMatrix * vec3(aTexCoord, 1.0)"));
  const standaloneAdapter = builderSource.slice(
    builderSource.indexOf("function standaloneFragmentSource("),
    builderSource.indexOf("function shadertoyFragmentSource(")
  );
  assert.ok(!standaloneAdapter.includes("gl_FragCoord"));
  const shadertoyAdapter = builderSource.slice(
    builderSource.indexOf("function shadertoyFragmentSource("),
    builderSource.indexOf("function hasRenderQualityParam(")
  );
  assert.ok(shadertoyAdapter.includes("varying vec2 vTexCoord;"));
  assert.ok(shadertoyAdapter.includes("vec2 baseUv = renderUvRect.xy + vTexCoord * renderUvRect.zw;"));
  assert.doesNotMatch(shadertoyAdapter, /vec2 baseUv\s*=.*gl_FragCoord/);
});

test("spatial field effects use screen-oriented y coordinates for handle translation", () => {
  for (const id of ["ripple", "kaleido", "pixelate", "plasma", "alphaVignette", "glitchDistort", "spinRotate", "echoFade", "mirrorFold", "heatShimmer"]) {
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

test("pixel art upscale preserves its license and adapts texelFetch to the source sampler", () => {
  const component = getShaderComponent("pixelArtUpscale");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Pixel Art Upscale");
  assert.equal(component.category, "texture");
  assert.ok(component.code.includes("Copyright 2020 Ethan Alexander Shulman"));
  assert.ok(component.code.includes("Permission is hereby granted, free of charge"));
  assert.ok(component.code.includes("https://www.shadertoy.com/view/tsdcRM"));
  for (const id of ["amount", "upscale", "colorThreshold", "lineThickness", "antiAlias"]) {
    assert.equal(params[id].type, "number", `missing Pixel Art Upscale control ${id}`);
  }
  assert.ok(component.code.includes("bool pixelArtDiagonal("));
  assert.ok(component.code.includes("sampleSource((floor(logicalPixel) + 0.5) / grid)"));
  assert.ok(component.code.includes("return mix(color, result, amount)"));
  assert.ok(!component.code.includes("texelFetch("));
  assert.ok(!component.code.includes("iMouse"));
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

test("terrain flyover does not expose the obsolete full-frame fallback shader", () => {
  const source = generatorShaderCatalogSource();
  assert.equal(getGeneratorShaderComponent("terrainFlyover"), null);
  assert.ok(!source.includes("simplexLikeNoise"));
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

test("node-owned standalone generator shaders are not wrapped as effects", () => {
  const component = getGeneratorNodeShader("gradient");
  let fragmentSource = "";
  const target = {
    createShader(_vertex, fragment) {
      fragmentSource = fragment;
      return {};
    },
  };

  createShaderBuilder({}).getShader({ id: component.id, component }, target);

  assert.equal(component.type, "fragment");
  for (const declaration of [
    "uniform vec2 resolution;",
    "uniform float time;",
    "uniform float mode;",
    "varying vec2 vTexCoord;",
  ]) {
    assert.equal(fragmentSource.split(declaration).length - 1, 1, `${declaration} must be declared once`);
  }
  assert.doesNotMatch(fragmentSource, /vec4\s+runEffect\s*\(/);
});

test("Shadertoy generator keeps mainImage source behind the compatibility wrapper", () => {
  const rawComponent = getGeneratorShaderComponent("shadertoyBaseWarp");
  const component = { ...rawComponent, params: getGeneratorComponent("shadertoyBaseWarp").params };
  let fragmentSource = "";
  const target = {
    createShader(_vertex, fragment) {
      fragmentSource = fragment;
      return {};
    },
  };
  createShaderBuilder({}).getShader({ id: component.id, component }, target);

  assert.equal(component.type, "shadertoy");
  assert.equal(component.name, "Base Warp Generator");
  assert.ok(component.code.includes("https://www.shadertoy.com/view/tdG3Rd"));
  assert.ok(component.code.includes("void mainImage(out vec4 fragColor, in vec2 fragCoord)"));
  assert.ok(component.code.includes("fragCoord / iResolution.x"));
  assert.ok(component.code.includes("noise(p + iTime)"));
  for (const id of ["scale", "rotation", "offsetX", "offsetY", "warpAmount", "contrast", "brightness", "paletteShift", "paletteBalance", "saturation", "amount"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing Base Warp uniform ${id}`);
  }
  for (const id of ["shadowColor", "midtoneColor", "highlightColor"]) {
    assert.ok(component.code.includes(`uniform vec4 ${id};`), `missing Base Warp color uniform ${id}`);
  }
  assert.ok(component.code.includes("secondWarp * warpAmount"));
  assert.ok(component.code.includes("* contrast + 0.5 + brightness"));
  assert.ok(component.code.includes("0.38 + paletteBalance"));
  assert.ok(component.code.includes("shade * amount"));
  assert.ok(!component.code.includes("void main()"));
  assert.ok(fragmentSource.includes("void main()"));
  assert.ok(fragmentSource.includes("void vj1MainImage(out vec4 fragColor, in vec2 fragCoord)"));
  assert.ok(fragmentSource.includes("varying vec2 vTexCoord;"));
  assert.ok(fragmentSource.includes("uniform vec4 renderUvRect;"));
  assert.ok(fragmentSource.includes("vec2 baseUv = renderUvRect.xy + vTexCoord * renderUvRect.zw;"));
  assert.ok(fragmentSource.includes("shadertoyFragCoord = vec2(shaderUv.x, 1.0 - shaderUv.y) * iResolution.xy"));
  assert.ok(fragmentSource.includes("vj1MainImage(fragColor, shadertoyFragCoord)"));
  assert.ok(fragmentSource.includes("uniform float renderQuality;"));
  assert.ok(!fragmentSource.includes("void mainImage"));
  const [beforeP5Main, afterP5Main] = fragmentSource.split("void main");
  const p5PreprocessedSource = `${beforeP5Main}void main${afterP5Main}`;
  assert.ok(p5PreprocessedSource.includes("void main()"), "p5 hook preprocessing must retain the real entry point");

  fragmentSource = "";
  createShaderBuilder({}).getShader({
    id: `${component.id}.detected`,
    component: { ...component, type: "fragment" },
  }, target);
  assert.ok(fragmentSource.includes("void main()"), "mainImage source should be detected even without type metadata");
});

test("Cellular Circles preserves attribution and computes both nearest cells in one bounded pass", () => {
  const component = getGeneratorShaderComponent("cellularCircles");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("Jan Mróz (jaszunio15)"));
  assert.ok(component.code.includes("Creative Commons Attribution 3.0"));
  assert.ok(component.code.includes("https://www.shadertoy.com/view/tsfGDM"));
  assert.ok(component.code.includes("for (int x = -5; x <= 5; x++)"));
  assert.ok(component.code.includes("secondDistance = nearestDistance"));
  assert.ok(component.code.includes("fragColor = vec4(clamp(color.rgb, 0.0, 1.0) * alpha, alpha)"));
  assert.equal((component.code.match(/for \(int x = -5/g) || []).length, 1, "nearest and second-nearest cells share one pass");
});

test("2D Mesh Patterns exposes topology families and is not a faux fragment shader", () => {
  const registry = getGeneratorComponent("meshPatterns");
  const params = Object.fromEntries(registry.params.map((param) => [param.id, param]));

  assert.equal(getGeneratorShaderComponent("meshPatterns"), null);
  assert.deepEqual(params.drawMode.values, ["fill", "wire", "fill + wire"]);
  assert.deepEqual(params.palette.values, ["custom", "analogous", "complementary", "triadic", "split complementary", "tetradic", "monochrome"]);
  assert.equal(params.colorCount.min, 2);
  assert.equal(params.colorCount.max, 4);
  for (const family of ["cells", "veins", "mountains", "soap", "cracks", "coral", "fabric", "rivers", "magnetic fields", "bone"]) {
    assert.ok(params.pattern.values.includes(family), `missing ${family}`);
  }
  assert.equal(registry.runtime.timeDependent({ speed: 0 }), false);
  assert.equal(registry.runtime.timeDependent({ speed: 0.1 }), true);
});

test("Lightning keeps only a premultiplied transparent strike and flash", () => {
  const component = getGeneratorShaderComponent("lightning");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("https://www.shadertoy.com/view/fsdGWf"));
  assert.ok(component.code.includes("float boltEnergy = strike * 0.4 + localGlow * 0.15 + wideGlow * 0.3"));
  assert.ok(component.code.includes("fragColor = vec4(color * alpha, alpha)"));
  assert.ok(!component.code.includes("mountain("));
  assert.ok(!component.code.includes("cloud("));
  assert.ok(!component.code.includes("uniform vec4 backgroundColor"));
  assert.ok(!component.code.includes("vec3 background ="));
});

test("Sun Rays uses one compact polar pass with transparent premultiplied output", () => {
  const component = getGeneratorShaderComponent("sunRays");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("uv.y = 1.0 - uv.y"));
  assert.ok(component.code.includes("float acrossRay = abs(fract(angular) - 0.5) * 2.0"));
  assert.ok(component.code.includes("float shimmerWave = sin("));
  assert.ok(component.code.includes("vec3 combinedPremultiplied"));
  assert.ok(component.code.includes("fragColor = vec4(combinedPremultiplied * amount, combinedAlpha * amount)"));
  assert.equal((component.code.match(/for \(/g) || []).length, 0, "ray count changes frequency without adding loop work");
  assert.ok(!component.code.includes("texture("));
  assert.ok(!component.code.includes("texture2D("));
});

test("Fog preserves simplex attribution and emits bounded transparent premultiplied fog", () => {
  const component = getGeneratorShaderComponent("fog");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("https://www.shadertoy.com/view/XtfSW4"));
  assert.ok(component.code.includes("Ian McEwan / Ashima Arts"));
  assert.ok(component.code.includes("for (int octave = 0; octave < 5; octave++)"));
  assert.ok(component.code.includes("float octaveBudget"));
  assert.ok(component.code.includes("float lowerMask = smoothstep("));
  assert.ok(component.code.includes("float upperMask = 1.0 - smoothstep("));
  assert.ok(component.code.includes("float macroNoise = 0.5 + 0.5 * fogSimplex3("));
  assert.ok(component.code.includes("vec2 billowWarp ="));
  assert.ok(component.code.includes("fragColor = vec4(fogColor.rgb * alpha, alpha)"));
  assert.ok(!component.code.includes("octave < 8"));
  assert.ok(!component.code.includes("fragColor = vec4(q,q,q, 1.0)"));
});

test("Volumetric Clouds keeps the supplied volume technique but removes the sky and sun", () => {
  const component = getGeneratorShaderComponent("volumetricClouds");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("https://www.shadertoy.com/view/Xttcz2"));
  assert.ok(component.code.includes("for (int stepIndex = 0; stepIndex < 48; stepIndex++)"));
  assert.ok(component.code.includes("for (int octave = 0; octave < 4; octave++)"));
  assert.ok(component.code.includes("float transmittance = 1.0"));
  assert.ok(component.code.includes("float sampleAlpha = 1.0 - exp("));
  assert.ok(component.code.includes("fragColor = vec4(premultiplied * amount, alpha)"));
  assert.ok(component.code.includes("fragColor = vec4(0.0)"));
  assert.ok(!component.code.includes("render_sky_color"));
  assert.ok(!component.code.includes("backgroundColor"));
  for (const id of ["speed", "density", "coverage", "scale", "detail", "raySteps", "softness", "thickness", "altitude", "cameraTilt", "fieldOfView", "windAngle", "absorption", "brightness", "seed", "amount"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing Volumetric Clouds uniform ${id}`);
  }
  for (const id of ["cloudColor", "shadowColor"]) {
    assert.ok(component.code.includes(`uniform vec4 ${id};`), `missing Volumetric Clouds color uniform ${id}`);
  }
});

test("Galaxy preserves attribution and replaces Shadertoy channels with procedural noise and stars", () => {
  const component = getGeneratorShaderComponent("galaxy");
  const registry = getGeneratorComponent("galaxy");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("FabriceNeyret2"));
  assert.ok(component.code.includes("Fabrice NEYRET"));
  assert.ok(component.code.includes("https://www.shadertoy.com/view/MdBSDc"));
  assert.ok(component.code.includes("float galaxyValueNoise"));
  assert.ok(component.code.includes("float galaxyStars"));
  assert.ok(component.code.includes("float galaxyFastProfile"));
  assert.ok(component.code.includes("if (renderQuality < 0.34) return coarse"));
  assert.equal((component.code.match(/galaxyValueNoise\(/g) || []).length, 3, "definition plus two samples replaces the seven-octave path");
  assert.ok(!component.code.includes("for (int octave"));
  assert.ok(!component.code.includes("exp("));
  assert.ok(!component.code.includes("pow("));
  assert.ok(component.code.includes("fragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha)"));
  assert.ok(!component.code.includes("iChannel0"));
  assert.ok(!component.code.includes("iChannel1"));
  assert.ok(!component.code.includes("iChannel2"));
  assert.ok(registry.params.some((param) => param.id === "arms" && param.max === 12));
  assert.equal(registry.runtime.timeDependent({ speed: 0 }), false);
  assert.equal(registry.runtime.timeDependent({ speed: 0.1 }), true);
});

test("standalone generator shaders receive the shared quality uniform", () => {
  const rawComponent = getGeneratorShaderComponent("fireflies");
  const component = { ...rawComponent, params: getGeneratorComponent("fireflies").params };
  let fragmentSource = "";
  const target = {
    createShader(_vertex, fragment) {
      fragmentSource = fragment;
      return {};
    },
  };
  createShaderBuilder({}).getShader({ id: component.id, component }, target);

  assert.ok(fragmentSource.includes("precision mediump float;\nuniform float renderQuality;"));
  assert.equal((fragmentSource.match(/uniform float renderQuality;/g) || []).length, 1);
  assert.ok(fragmentSource.includes("vec2 vj1CompositionUv()"));
  assert.ok(fragmentSource.includes("contentUvMatrix * vec3(componentUv, 1.0)"));
  assert.ok(fragmentSource.includes("vec2 uv = vj1CompositionUv()"));
  assert.ok(fragmentSource.includes("varying vec2 vTexCoord;"));
});

test("Seascape preserves attribution and maps artistic controls into bounded shader work", () => {
  const component = getGeneratorShaderComponent("seascape");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("Alexander Alekseev aka TDM"));
  assert.ok(component.code.includes("Creative Commons Attribution-NonCommercial-ShareAlike 3.0"));
  assert.ok(component.code.includes("https://www.shadertoy.com/view/Ms2SD1"));
  for (const id of ["waveHeight", "choppiness", "waveScale", "seaDetail", "raySteps", "cameraHeight", "cameraPitch", "cameraMotion", "fieldOfView", "horizonCurve", "skyBrightness", "sunAngle", "sunElevation", "specularStrength", "saturation", "gamma"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing Seascape uniform ${id}`);
  }
  for (const id of ["waterBaseColor", "waterLightColor", "skyTint"]) {
    assert.ok(component.code.includes(`uniform vec4 ${id};`), `missing Seascape color uniform ${id}`);
  }
  assert.ok(component.code.includes("const int NUM_STEPS = 32"));
  assert.ok(component.code.includes("const int ITER_FRAGMENT = 5"));
  assert.ok(component.code.includes("if (float(i) >= raySteps) break"));
  assert.ok(component.code.includes("if (float(i) >= seaDetail) break"));
  assert.ok(component.code.includes("if (seaBlend <= 0.0001) return sky"));
});

test("Paint Drips preserves attribution and avoids texture-channel dependencies", () => {
  const component = getGeneratorShaderComponent("paintDrips");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("https://www.shadertoy.com/view/WdBXD1"));
  for (const id of ["variation", "dripSpacing", "dripDensity", "dripThickness", "bounceCurve", "cycleLength", "bounceRange", "fallSpeed", "ceilingDepth", "ceilingRoughness", "edgeSoftness", "amount"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing Paint Drips uniform ${id}`);
  }
  for (const id of ["paintColor", "backgroundColor"]) {
    assert.ok(component.code.includes(`uniform vec4 ${id};`), `missing Paint Drips color uniform ${id}`);
  }
  assert.ok(component.code.includes("for (int i = -24; i <= 24; i++)"));
  assert.ok(component.code.includes("float alpha = mix(backgroundColor.a, paintColor.a, mask) * amount"));
  assert.ok(!component.code.includes("textureLod("));
  assert.ok(!component.code.includes("for( int i=0; i<1000"));
});

test("Cloudy Tunnel preserves attribution and bounds its procedural ray march", () => {
  const component = getGeneratorShaderComponent("cloudyTunnel");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("Stephane Cuillerdier - Aiekick/2015"));
  assert.ok(component.code.includes("Creative Commons Attribution-NonCommercial-ShareAlike 3.0"));
  assert.ok(component.code.includes("https://www.shadertoy.com/view/XlSSzV"));
  assert.ok(component.code.includes("https://www.shadertoy.com/view/MljXDw"));
  for (const id of ["raySteps", "cloudDensity", "cloudScale", "cloudDetail", "tunnelRadius", "tunnelSpread", "pathBend", "pathFrequency", "cameraSway", "fieldOfView", "fogStrength", "vignette", "amount"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing Cloudy Tunnel uniform ${id}`);
  }
  for (const id of ["tunnelColor", "fogColor"]) {
    assert.ok(component.code.includes(`uniform vec4 ${id};`), `missing Cloudy Tunnel color uniform ${id}`);
  }
  assert.ok(component.code.includes("for (int i = 0; i < 160; i++)"));
  assert.ok(component.code.includes("if (float(i) >= raySteps"));
  assert.ok(component.code.includes("field = radius - min(length(cylinder), length(previousCylinder))"));
  assert.ok(component.code.includes("previousCylinder = cylinder"));
  assert.ok(!component.code.includes("field = max(field, radius - length(cylinder))"));
  assert.ok(!component.code.includes("textureLod("));
  assert.ok(!component.code.includes("for(float i=0.;i<200.;i++)"));
});

test("Cherenkov Volume preserves attribution and reuses its normal center sample", () => {
  const component = getGeneratorShaderComponent("cherenkovVolume");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("carandiru / supersinfulsilicon"));
  assert.ok(component.code.includes("Creative Commons Attribution-ShareAlike 4.0"));
  assert.ok(component.code.includes("https://www.shadertoy.com/view/l3yBzV"));
  assert.ok(component.code.includes("https://www.shadertoy.com/view/tsdfDf"));
  for (const id of ["raySteps", "zoom", "rotationSpeed", "verticalOffset", "patternScale", "emissionStrength", "absorption", "brightness", "amount"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing Cherenkov Volume uniform ${id}`);
  }
  for (const id of ["farColor", "nearColor", "backgroundColor"]) {
    assert.ok(component.code.includes(`uniform vec4 ${id};`), `missing Cherenkov Volume color uniform ${id}`);
  }
  assert.ok(component.code.includes("for (int i = 0; i < 199; i++)"));
  assert.ok(component.code.includes("if (float(i) >= raySteps"));
  assert.ok(component.code.includes("cherenkovNormal(p, dt, distanceField)"));
  assert.ok(component.code.includes("- centerDistance"));
  assert.ok(!component.code.includes("0.000000001f"));
});

test("Biomine Lite preserves attribution and removes expensive secondary passes", () => {
  const component = getGeneratorShaderComponent("biomineLite");

  assert.equal(component.type, "shadertoy");
  assert.ok(component.code.includes("https://www.shadertoy.com/view/4lyGzR"));
  assert.ok(component.code.includes("https://www.shadertoy.com/view/4scXz2"));
  for (const id of ["raySteps", "viewDistance", "fieldOfView", "pathAmount", "organicMotion", "gyroidScale", "tubeThickness", "tunnelRadius", "surfaceDetail", "specularStrength", "fogStrength", "amount"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing Biomine Lite uniform ${id}`);
  }
  for (const id of ["tubeColor", "wallColor", "glowColor", "skyColor"]) {
    assert.ok(component.code.includes(`uniform vec4 ${id};`), `missing Biomine Lite color uniform ${id}`);
  }
  assert.ok(component.code.includes("for (int i = 0; i < 72; i++)"));
  assert.ok(component.code.includes("if (float(i) >= raySteps) break"));
  assert.ok(component.code.includes("Tetrahedral normal: four scene evaluations"));
  assert.ok(!component.code.includes("calculateAO("));
  assert.ok(!component.code.includes("thickness("));
  assert.ok(!component.code.includes("doBumpMap("));
  assert.ok(!component.code.includes("vec3 eMap("));
});

test("crayon stroke effect derives bounded static marks from source luminance and edges", () => {
  const component = getShaderComponent("crayonStroke");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.deepEqual(params.style.values, ["crayon", "pen", "ink"]);
  for (const id of ["amount", "strokeScale", "roughness", "contrast", "edgeStrength", "angle", "sourceColor"]) {
    assert.equal(params[id].type, "number", `missing stroke effect param ${id}`);
  }
  assert.equal(params.strokeColor.type, "color");
  assert.equal(params.paperColor.type, "color");
  assert.ok(component.code.includes("float edge = abs(crayonLuma(sampleSource"));
  assert.ok(component.code.includes("return vec4(mix(straight, effected, amount) * color.a, color.a);"));
  assert.ok(!component.code.includes("for ("));
  assert.ok(!component.code.includes("time"));
});

test("bezier stroke generator uses a bounded transparent phased stroke field", () => {
  const component = getGeneratorShaderComponent("bezierStrokes");

  for (const id of ["style", "count", "speed", "lifetime", "fade", "width", "strokeLength", "curve", "direction", "spread", "roughness"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing bezier stroke uniform ${id}`);
  }
  assert.ok(component.code.includes("uniform vec4 strokeColor;"));
  assert.ok(component.code.includes("for (int i = 0; i < 8; i++)"));
  assert.ok(component.code.includes("float phase = strokeHash(seed + 2.0) * cycle;"));
  assert.ok(component.code.includes("mix(mix(startY, controlY, t), mix(controlY, endY, t), t)"));
  assert.ok(component.code.includes("gl_FragColor = vec4(strokeColor.rgb * outputAlpha, outputAlpha);"));
});
