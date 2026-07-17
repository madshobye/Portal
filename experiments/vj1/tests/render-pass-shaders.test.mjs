import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COMPONENT_POST_FRAGMENT_SHADER,
  COMPONENT_UPSCALE_FRAGMENT_SHADER,
  LAYER_TRANSFORM_FRAGMENT_SHADER,
  OVERLAY_BLEND_FRAGMENT_SHADER,
  RENDER_PASS_VERTEX_SHADER,
  GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER,
} from "../js/output/render-pass-shaders.js";

test("shared render-pass shaders expose their required pipeline contracts", () => {
  assert.match(RENDER_PASS_VERTEX_SHADER, /attribute vec2 aTexCoord/);
  assert.match(OVERLAY_BLEND_FRAGMENT_SHADER, /uniform mat3 layerUvMatrix/);
  assert.match(OVERLAY_BLEND_FRAGMENT_SHADER, /vec3 overlayColor/);
  assert.match(LAYER_TRANSFORM_FRAGMENT_SHADER, /uniform mat3 sourceUvMatrix/);
  assert.match(COMPONENT_UPSCALE_FRAGMENT_SHADER, /uniform vec2 sourceResolution/);
  assert.match(COMPONENT_POST_FRAGMENT_SHADER, /uniform float noiseAmount/);
  assert.match(COMPONENT_POST_FRAGMENT_SHADER, /uniform float grayscaleAmount/);
  assert.match(GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER, /storedSourceUv\(vTexCoord\)/);
  assert.doesNotMatch(GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER, /sourceUvMatrix|clamp/);
});

test("output renderer orchestrates imported passes without owning inline GLSL", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('from "./render-pass-shaders.js?v=render-coordinate-scope-3"'));
  assert.doesNotMatch(rendererSource, /const OVERLAY_BLEND_VERTEX_SHADER\s*=\s*`/);
  assert.doesNotMatch(rendererSource, /const COMPONENT_POST_FRAGMENT_SHADER\s*=\s*`/);
  assert.ok(rendererSource.includes("target.createShader(RENDER_PASS_VERTEX_SHADER, fragment)"));
});
