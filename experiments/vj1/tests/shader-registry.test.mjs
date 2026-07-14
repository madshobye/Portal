import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getShaderComponent, listShaderComponents } from "../js/shaders/shader-registry.js";
import { getGeneratorComponent } from "../js/graph/generator-registry.js";
import { getGeneratorShaderComponent } from "../js/shaders/generator-shaders.js";
import { createShaderBuilder } from "../js/shaders/shader-builder.js";

test("every effect exposes the shared render quality budget", () => {
  for (const component of listShaderComponents()) {
    const quality = component.params.find((param) => param.id === "renderQuality");
    assert.ok(quality, `${component.id} is missing renderQuality`);
    assert.equal(quality.defaultValue, 0.5);
  }
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
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("if (pass.amount <= 0.0001) continue;"));
});

test("alpha-sensitive effects keep transparent pixels premultiplied", () => {
  for (const id of ["invert", "labelGrain", "labelThresholdGrain", "hardBlack", "gray", "plasma"]) {
    const component = getShaderComponent(id);

    assert.ok(component.code.includes("* color.a") || component.code.includes("* alpha"), `${id} should multiply generated RGB by alpha`);
  }
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
  const generatorShaderSource = readFileSync(new URL("../js/shaders/generator-shaders.js", import.meta.url), "utf8");
  const fallbackGeneratorSource = readFileSync(new URL("../js/output/generators.js", import.meta.url), "utf8");

  assert.ok(shaderBuilderSource.includes("p3 += dot(p3, p3.yzx + 33.33);"));
  assert.ok(generatorShaderSource.includes("p3 += dot(p3, p3.yzx + 33.33);"));
  assert.ok(fallbackGeneratorSource.includes("function fract(value)"));
  assert.ok(!shaderBuilderSource.includes("fract(sin"));
  for (const id of ["waves", "noise", "plasma", "gradient", "bezierStrokes", "fireflies", "eyeball", "terrainFlyover", "swayingTrees"]) {
    assert.ok(!getGeneratorShaderComponent(id).code.includes("fract(sin"), `${id} regressed to a trig hash`);
  }
  assert.ok(!fallbackGeneratorSource.includes("Math.sin(x * 127.1"));
});

test("eyeball keeps frame-constant animation out of per-pixel work", () => {
  const code = getGeneratorShaderComponent("eyeball").code;

  assert.ok(code.includes("uniform vec3 eyeGazeDir;"));
  assert.ok(code.includes("uniform float eyeBlink;"));
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

test("spatial effect transforms keep the effect boundary on the composition frame", () => {
  const builderSource = readFileSync(new URL("../js/shaders/shader-builder.js", import.meta.url), "utf8");
  const maskSource = builderSource.slice(
    builderSource.indexOf("float effectFieldMask("),
    builderSource.indexOf("${effectCode}")
  );

  assert.ok(maskSource.includes("abs(vTexCoord - vec2(0.5))"));
  assert.ok(!maskSource.includes("abs(uv - vec2(0.5))"));
});

test("generator transforms change UV coordinates without changing the render target", () => {
  const builderSource = readFileSync(new URL("../js/shaders/shader-builder.js", import.meta.url), "utf8");

  assert.ok(builderSource.includes("uniform mat3 contentUvMatrix;"));
  assert.ok(builderSource.includes("contentUvMatrix * vec3(aTexCoord, 1.0)"));
  assert.ok(builderSource.includes("contentUvMatrix * vec3(baseUv, 1.0)"));
  assert.ok(!builderSource.includes("vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y)"));
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

test("terrain flyover uses a bounded hash-noise height field", () => {
  const component = getGeneratorShaderComponent("terrainFlyover");

  for (const id of ["style", "flightSpeed", "turn", "altitude", "pitch", "mountainHeight", "terrainScale", "lakeLevel", "viewDistance", "gridDensity", "wireWidth"]) {
    assert.ok(component.code.includes(`uniform float ${id};`), `missing terrain uniform ${id}`);
  }
  for (const id of ["waterColor", "grassColor", "rockColor", "snowColor", "wireColor", "skyColor"]) {
    assert.ok(component.code.includes(`uniform vec4 ${id};`), `missing terrain color ${id}`);
  }
  assert.ok(component.code.includes("float simplexLikeNoise(vec2 p)"));
  assert.ok(component.code.includes("for (int step = 0; step < 5; step++)"));
  assert.ok(component.code.includes("max(rawHeight, lakeLevel)"));
  assert.ok(component.code.includes("vec2 gridCell = abs(fract(position.xz"));
  assert.ok(!component.code.includes("texture2D("));
  assert.ok(!component.code.slice(component.code.indexOf("float hash12"), component.code.indexOf("float terrainHeight")).includes("sin("));
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
  assert.ok(fragmentSource.includes("1.0 - gl_FragCoord.y / iResolution.y"));
  assert.ok(fragmentSource.includes("shadertoyFragCoord = shaderUv * iResolution.xy"));
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
