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
import {
  dmxFixtureProfile,
  dmxProbeFixtureValues,
  dmxProbeSampleResolution,
  normalizeDmxDeviceSettings,
} from "../libraries/dmx-engine/index.js";

const PROBE_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D sourceTexture;
uniform vec2 sampleCenter;
uniform vec2 sampleSize;
uniform vec2 sampleResolution;
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
  vec2 cell = (floor(vTexCoord * sampleResolution) + 0.5) / sampleResolution - 0.5;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 grid = ((vec2(float(x), float(y)) + 0.5) / 4.0 - 0.5) / sampleResolution;
      vec2 uv = sampleCenter + rotation * ((cell + grid) * sampleSize);
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
    this.shaders = new Map();
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
    const now = this.clock();
    let retained = this.samples.get(key);
    if (!retained) {
      retained = { values: null };
      this.samples.set(key, retained);
    }
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

  observeDmx(component, operation, renderedItem, state, renderRequest) {
    const settings = normalizeDmxDeviceSettings(this.host.state?.devices?.dmx);
    if (!settings.enabled || typeof this.host.sendDmxFixture !== "function") return false;
    const requestedFixtureId = String(renderedItem?.params?.fixtureId || "");
    const fixtureId = settings.fixtures.some((entry) => entry.id === requestedFixtureId)
      ? requestedFixtureId
      : settings.fixtures[0]?.id || "";
    const { fixture, profile } = dmxFixtureProfile(settings, fixtureId);
    if (!fixture || !profile || fixture.enabled === false) return false;
    const probeId = String(renderedItem?.id || operation?.id || "");
    const key = `dmx:${component?.id || ""}:${probeId}:${fixtureId}`;
    const now = this.clock();
    let retained = this.samples.get(key);
    if (!retained) {
      retained = { values: null };
      this.samples.set(key, retained);
    }
    const samples = renderedItem?.params?.mode === "control"
      ? []
      : this.sampleGrid(
        state?.buffer,
        renderedItem?.boundary,
        renderRequest,
        dmxProbeSampleResolution(renderedItem, profile),
      );
    const values = dmxProbeFixtureValues(renderedItem, profile, samples);
    if (sameRecord(retained.values, values)) return false;
    retained.values = values;
    this.host.sendDmxFixture({
      fixtureId,
      values,
      source: {
        componentId: String(component?.id || ""),
        probeId,
      },
      timestamp: now,
    });
    return true;
  }

  sample(buffer, boundary, renderRequest) {
    return this.sampleGrid(buffer, boundary, renderRequest, {
      width: 1,
      height: 1,
    })[0] || null;
  }

  sampleGrid(buffer, boundary, renderRequest, resolution = {}) {
    if (!buffer) return [];
    const sampleWidth = Math.min(32, Math.max(1, Math.round(Number(resolution.width) || 1)));
    const sampleHeight = Math.min(32, Math.max(1, Math.round(Number(resolution.height) || 1)));
    const target = this.host.renderTargetRuntime.gpu(
      `vj1:probe-sampler:${sampleWidth}x${sampleHeight}`,
      {
        ...renderRequest,
        width: sampleWidth,
        height: sampleHeight,
        logicalWidth: sampleWidth,
        logicalHeight: sampleHeight,
        pixelDensity: 1,
        pixelDensityApplied: true,
        role: "probe-sample",
      },
    );
    const shaderKey = `${sampleWidth}x${sampleHeight}`;
    let shader = this.shaders.get(shaderKey);
    if (!shader) {
      shader = target.createShader(
        RENDER_PASS_VERTEX_SHADER,
        PROBE_FRAGMENT_SHADER,
      );
      this.shaders.set(shaderKey, shader);
    }
    const geometry = probeSampleGeometry(
      boundary,
      buffer,
      renderRequest,
    );
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shader);
      shader.setUniform("sourceTexture", unwrapRenderTarget(buffer));
      shader.setUniform("sampleCenter", geometry.center);
      shader.setUniform("sampleSize", geometry.size);
      shader.setUniform("sampleResolution", [sampleWidth, sampleHeight]);
      shader.setUniform("sampleRotation", geometry.rotation);
      shader.setUniform(
        "flipY",
        renderTargetNeedsShaderSampleFlip(
          buffer,
          this.host.renderTargetRuntime.isShaderBuffer(buffer),
        ),
      );
      drawShaderTargetRect(target, sampleWidth, sampleHeight);
      resetShaderTarget(target);
    });
    target.loadPixels?.();
    const pixels = target.pixels;
    if (!pixels || pixels.length < sampleWidth * sampleHeight * 4) return [];
    return Array.from({ length: sampleWidth * sampleHeight }, (_, index) =>
      probeColorFeatures(pixels.subarray
        ? pixels.subarray(index * 4, index * 4 + 4)
        : pixels.slice(index * 4, index * 4 + 4))
    );
  }

  dispose() {
    for (const shader of this.shaders.values()) disposeP5Shader(shader);
    this.shaders.clear();
    this.samples.clear();
  }
}

function sameRecord(previous, next, epsilon = 1 / 255) {
  if (!previous || !next) return false;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].every((key) =>
    Math.abs(Number(previous[key]) - Number(next[key])) < epsilon
  );
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
