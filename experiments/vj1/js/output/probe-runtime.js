import { probeSignalAddress } from "../libraries/control-engine/live-signal-addresses.js";
import { nodeBoundaryPixelRect } from "../libraries/render-engine/roi/index.js";
import { disposeP5Shader } from "../libraries/mapping-engine/mapping-engine/index.js";
import { RENDER_PASS_VERTEX_SHADER } from "./render-pass-shaders.js";
import {
  applyShaderTarget,
  clearShaderTarget,
  drawShaderTarget,
  drawShaderTargetRect,
  resetShaderTarget,
} from "./shader-target-runtime.js";
import { unwrapRenderTarget } from "./shared-framebuffer-target.js";
import { renderTargetNeedsShaderSampleFlip } from "./render-target-contract.js";

const PROBE_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D sourceTexture;
uniform vec2 sampleCenter;
uniform vec2 sampleSize;
uniform float sampleRotation;
uniform bool flipY;
varying vec2 vTexCoord;

vec2 sourceUv(vec2 uv) {
  return flipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

void main() {
  float c = cos(sampleRotation);
  float s = sin(sampleRotation);
  mat2 rotation = mat2(c, -s, s, c);
  vec4 total = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 grid = (vec2(float(x), float(y)) + 0.5) / 4.0 - 0.5;
      vec2 uv = sampleCenter + rotation * (grid * sampleSize);
      total += texture2D(sourceTexture, sourceUv(clamp(uv, 0.0, 1.0)));
    }
  }
  gl_FragColor = total / 16.0;
}`;

const PROBE_FEATURES = Object.freeze([
  "brightness",
  "r",
  "g",
  "b",
  "h",
  "s",
  "v",
  "alpha",
]);

export class ProbeRuntime {
  constructor(host, {
    clock = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    this.host = host;
    this.clock = clock;
    this.shader = null;
    this.samples = new Map();
    this.sequence = 0;
  }

  observe(component, operation, renderedItem, state, renderRequest) {
    if (!state?.buffer) return false;
    const probeId = String(renderedItem?.id || operation?.id || "");
    const componentId = String(component?.id || "");
    if (!probeId || !componentId) return false;
    const demandedFeatures = PROBE_FEATURES.filter((feature) =>
      this.host.componentProgramRuntime?.requiresControlSignal?.(
        "probe",
        probeSignalAddress(componentId, probeId, feature),
      ) === true
    );
    if (!demandedFeatures.length) return false;
    const key = `${componentId}:${probeId}`;
    const sampleRate = Math.min(
      30,
      Math.max(1, Number(renderedItem?.params?.sampleRate) || 15),
    );
    const now = this.clock();
    let retained = this.samples.get(key);
    if (!retained) {
      retained = { sampledAt: -Infinity, values: null };
      this.samples.set(key, retained);
    }
    if (now - retained.sampledAt < 1000 / sampleRate) return false;
    retained.sampledAt = now;
    const values = this.sample(
      state.buffer,
      renderedItem?.boundary,
      renderRequest,
    );
    if (!values || !probeValuesChanged(retained.values, values)) return false;
    retained.values = values;
    const addresses = Object.fromEntries(demandedFeatures.map((feature) => [
      probeSignalAddress(componentId, probeId, feature),
      values[feature],
    ]));
    return this.host.controlSignalRuntime.publishBatch("probe", addresses, {
      sequence: ++this.sequence,
      timestamp: now,
    });
  }

  sample(buffer, boundary, renderRequest) {
    const target = this.host.renderTargetRuntime.gpu(
      "vj1:probe-sampler",
      {
        ...renderRequest,
        width: 1,
        height: 1,
        logicalWidth: 1,
        logicalHeight: 1,
        pixelDensity: 1,
        pixelDensityApplied: true,
        role: "probe-sample",
      },
    );
    this.shader ||= target.createShader(
      RENDER_PASS_VERTEX_SHADER,
      PROBE_FRAGMENT_SHADER,
    );
    const geometry = probeSampleGeometry(
      boundary,
      buffer,
      renderRequest,
    );
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, this.shader);
      this.shader.setUniform("sourceTexture", unwrapRenderTarget(buffer));
      this.shader.setUniform("sampleCenter", geometry.center);
      this.shader.setUniform("sampleSize", geometry.size);
      this.shader.setUniform("sampleRotation", geometry.rotation);
      this.shader.setUniform(
        "flipY",
        renderTargetNeedsShaderSampleFlip(
          buffer,
          this.host.renderTargetRuntime.isShaderBuffer(buffer),
        ),
      );
      drawShaderTargetRect(target, 1, 1);
      resetShaderTarget(target);
    });
    const pixel = target.get(0, 0);
    return Array.isArray(pixel) || ArrayBuffer.isView(pixel)
      ? probeColorFeatures(pixel)
      : null;
  }

  dispose() {
    disposeP5Shader(this.shader);
    this.shader = null;
    this.samples.clear();
  }
}

export function probeSampleGeometry(boundary = {}, buffer = {}, renderRequest = {}) {
  const width = Math.max(1, Number(buffer?.width) || Number(renderRequest.width) || 1);
  const height = Math.max(1, Number(buffer?.height) || Number(renderRequest.height) || 1);
  const rect = nodeBoundaryPixelRect(boundary, {
    ...renderRequest,
    width,
    height,
  });
  return {
    center: [
      clamp01(rect.centerX / width),
      clamp01(rect.centerY / height),
    ],
    size: [
      Math.max(1 / width, rect.boundaryWidth / width),
      Math.max(1 / height, rect.boundaryHeight / height),
    ],
    rotation: Number(rect.rotation) || 0,
  };
}

export function probeColorFeatures(pixel = []) {
  const r = clamp01((Number(pixel[0]) || 0) / 255);
  const g = clamp01((Number(pixel[1]) || 0) / 255);
  const b = clamp01((Number(pixel[2]) || 0) / 255);
  const alpha = clamp01((Number(pixel[3]) || 0) / 255);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let h = 0;
  if (delta > 0) {
    if (maximum === r) h = ((g - b) / delta) % 6;
    else if (maximum === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = ((h / 6) + 1) % 1;
  }
  return Object.freeze({
    r,
    g,
    b,
    h,
    s: maximum > 0 ? delta / maximum : 0,
    v: maximum,
    brightness: clamp01(r * 0.2126 + g * 0.7152 + b * 0.0722),
    alpha,
  });
}

export function probeValuesChanged(previous, next, epsilon = 1 / 255) {
  if (!previous || !next) return true;
  return PROBE_FEATURES.some((feature) =>
    Math.abs(Number(previous[feature]) - Number(next[feature])) >= epsilon
  );
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
}
