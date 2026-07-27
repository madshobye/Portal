import { createNumberParam } from "../../shared/component-schema.js";
import {
  createPeriodicAnimationParam,
  FULL_TURN_RADIANS,
} from "../../shared/periodic-animation-parameter.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "plasma",
    name: "Plasma",
    category: "color",
    params: [
      createNumberParam("speed", "Motion amount", { min: 0, max: 4, step: 0.01, defaultValue: 0.65 }),
      createPeriodicAnimationParam("phase", "Motion phase", {
        min: -Math.PI,
        max: Math.PI,
        defaultValue: 0,
        duration: FULL_TURN_RADIANS / 0.65,
        animationId: "plasma-motion",
        animationLabel: "Plasma motion",
        legacyRate: {
          parameterId: "speed",
          defaultValue: 0.65,
          unitsPerSecond: 1,
          skipWhenZero: true,
        },
        legacyEnabled: {
          parameterId: "motionMode",
          defaultValue: "drift",
          disabledValues: ["steady"],
          skipWhenDisabled: true,
        },
      }),
      createNumberParam("direction", "Direction", {
        min: -3.14,
        max: 3.14,
        step: 0.01,
        defaultValue: 0.65,
        suggestedAnimations: [{
          id: "orbit-direction",
          label: "Orbit direction",
          mode: "loop",
          from: -3.14,
          to: 3.14,
          duration: 10,
          curve: "linear",
        }],
      }),
      createNumberParam("frequency", "Cell scale", {
        min: 1,
        max: 24,
        step: 0.01,
        defaultValue: 8,
        suggestedAnimations: [{
          id: "breathe-cell-scale",
          label: "Breathe cell scale",
          mode: "ping-pong",
          from: 4,
          to: 12,
          duration: 6,
          curve: "sine-in-out",
        }],
      }),
      createNumberParam("complexity", "Complexity", { min: 0, max: 1, step: 0.01, defaultValue: 0.7 }),
      createNumberParam("distortion", "Distortion", {
        min: 0,
        max: 2,
        step: 0.01,
        defaultValue: 0.55,
        suggestedAnimations: [{
          id: "breathe-distortion",
          label: "Breathe distortion",
          mode: "ping-pong",
          from: 0.15,
          to: 1.35,
          duration: 5,
          curve: "sine-in-out",
        }],
      }),
      createNumberParam("hueShift", "Hue shift", {
        min: 0,
        max: 1,
        step: 0.001,
        defaultValue: 0,
        suggestedAnimations: [{
          id: "hue-cycle",
          label: "Cycle hue",
          mode: "loop",
          from: 0,
          to: 1,
          duration: 8,
          curve: "linear",
        }],
      }),
    ],
  });

const shader = Object.freeze({
    id: "generator.plasma",
    name: "Plasma Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float speed;
uniform float phase;
uniform float direction;
uniform float frequency;
uniform float complexity;
uniform float distortion;
uniform float hueShift;
varying vec2 vTexCoord;

void main() {
  vec2 p = (vTexCoord - 0.5) * vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 heading = vec2(cos(direction), sin(direction));
  vec2 orbit = vec2(cos(phase), sin(phase));
  p += speed * 0.18 * (heading * 0.35 + orbit * 0.65);
  p += distortion * 0.11 * vec2(
    sin(phase + p.y * 3.0),
    cos(phase + p.x * 3.4)
  );
  p *= frequency;
  float q = sin(p.x + phase) + sin(p.y - phase);
  q += complexity * sin((p.x + p.y) * 0.73 + phase);
  q += complexity * sin(length(p + distortion * orbit) * 1.17 - phase);
  q *= 0.25;
  float colorPhase = q + hueShift;
  vec3 color = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.333, 0.667) + colorPhase));
  gl_FragColor = vec4(color, 1.0);
}`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
