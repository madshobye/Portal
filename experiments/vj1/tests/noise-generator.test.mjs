import test from "node:test";
import assert from "node:assert/strict";
import { createGeneratorSource, getGeneratorNodeComponent as getGeneratorComponent } from "../js/libraries/visual-nodes/index.js";
import { OutputRenderer } from "../js/output/output-renderer.js";
import { getGeneratorShaderComponent } from "../js/libraries/visual-nodes/index.js";

test("Noise exposes bounded simplex, motion, shaping, and palette controls", () => {
  const component = getGeneratorComponent("noise");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.deepEqual(params.motionMode.values, ["flow", "turbulence", "pulse", "steady"]);
  assert.equal(params.motionMode.defaultValue, "flow");
  assert.equal(params.detail.min, 1);
  assert.equal(params.detail.max, 5);
  assert.equal(params.scale.min, 0.25);
  assert.equal(params.scale.max, 20);
  for (const id of ["roughness", "distortion", "movement", "speed", "contrast", "balance", "ridge", "seed"]) {
    assert.equal(params[id].type, "number", `missing numeric Noise control ${id}`);
  }
  assert.deepEqual([params.colorA.type, params.colorB.type, params.colorC.type], ["color", "color", "color"]);
});

test("Noise shader uses bounded simplex layers and multidirectional domain motion", () => {
  const code = getGeneratorShaderComponent("noise").code;

  for (const uniform of ["motionMode", "scale", "detail", "roughness", "distortion", "movement", "speed", "contrast", "balance", "ridge", "seed", "colorA", "colorB", "colorC"]) {
    assert.match(code, new RegExp(`uniform \\w+ ${uniform};`), `missing Noise uniform ${uniform}`);
  }
  assert.match(code, /float simplexNoise\(vec2 v\)/);
  assert.match(code, /for \(int octave = 0; octave < 5; octave\+\+\)/);
  assert.match(code, /mat2 domainRotation/);
  assert.match(code, /vec2 orbit/);
  assert.match(code, /vec2 secondWarp/);
  assert.match(code, /float dynamicMode = 1\.0 - step\(2\.5, motionMode\)/);
  assert.match(code, /palette\.rgb \* palette\.a/);
  assert.doesNotMatch(code, /vec2\(time \* 0\.11, -time \* 0\.08\)/);
});

test("Noise steady mode and zero motion stop frame invalidation", () => {
  const renderer = new OutputRenderer({ mode: "component" });

  assert.equal(renderer.sourceIsFrameDynamic(createGeneratorSource("noise", { motionMode: "flow" })), true);
  assert.equal(renderer.sourceIsFrameDynamic(createGeneratorSource("noise", { motionMode: "steady" })), false);
  assert.equal(renderer.sourceIsFrameDynamic(createGeneratorSource("noise", { motionMode: "flow", speed: 0 })), false);
  assert.equal(renderer.sourceIsFrameDynamic(createGeneratorSource("noise", { motionMode: "turbulence", movement: 0 })), false);
});
