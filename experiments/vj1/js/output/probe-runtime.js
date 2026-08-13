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
import { AsyncPixelReadback } from "./async-pixel-readback.js";
import { textureStateKey } from "../libraries/render-engine/render-node-contract.js";
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
  "flow",
  "flowX",
  "flowY",
  "flowRotation",
  "flowExpansion",
  "flowConfidence",
]);

const PROBE_FLOW_FEATURES = Object.freeze([
  "flow",
  "flowX",
  "flowY",
  "flowRotation",
  "flowExpansion",
  "flowConfidence",
]);

export class ProbeRuntime {
  constructor(host, {
    clock = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    this.host = host;
    this.clock = clock;
    this.shaders = new Map();
    this.samples = new Map();
    this.pixelReadback = new AsyncPixelReadback();
    this.sequence = 0;
    this.dmxSources = new Map();
    this.dmxFrameSources = null;
  }

  beginFrame() {
    this.dmxFrameSources = new Set();
  }

  endFrame() {
    if (!this.dmxFrameSources) return;
    for (const [key, entry] of this.dmxSources) {
      if (this.dmxFrameSources.has(key)) continue;
      this.host.sendDmxFixture?.({ ...entry, values: {}, release: true });
      this.dmxSources.delete(key);
    }
    this.dmxFrameSources = null;
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
    const needsFlow = demandedFeatures.some((feature) =>
      PROBE_FLOW_FEATURES.includes(feature)
    );
    const values = needsFlow
      ? this.sampleFlow(
        state.buffer,
        renderedItem,
        renderRequest,
        key,
        textureStateKey(state),
        retained,
      )
      : this.sample(
        state.buffer,
        renderedItem?.boundary,
        renderRequest,
        key,
        textureStateKey(state),
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

  sampleFlow(buffer, renderedItem, renderRequest, streamKey, sampleRevision, retained) {
    const params = renderedItem?.params || {};
    const resolution = Math.min(16, Math.max(
      4,
      Math.round(Number(params.flowResolution) || 8),
    ));
    const grid = this.sampleGrid(
      buffer,
      renderedItem?.boundary,
      renderRequest,
      { width: resolution, height: resolution },
      `${streamKey}:flow:${resolution}`,
      sampleRevision,
    );
    if (grid === null) return null;
    if (!grid.length) return null;

    const color = averageProbeColorFeatures(grid);
    const rawFlow = retained.grid?.length === grid.length
      ? probeOpticalFlowFeatures(retained.grid, grid, resolution, resolution, {
        gain: params.flowGain,
        threshold: params.flowThreshold,
      })
      : zeroProbeFlowFeatures();
    const smoothing = clamp(Number(params.flowSmoothing) || 0, 0, 0.95);
    const flow = smoothProbeFlowFeatures(retained.values, rawFlow, smoothing);
    retained.grid = grid;
    return Object.freeze({ ...color, ...flow });
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
    const sourceKey = `${component?.id || ""}:${probeId}`;
    const source = {
      rendererId: String(this.host.dmxRendererId || `${this.host.mode || "preview"}:${this.host.outputId || "local"}`),
      mode: this.host.mode === "output" ? "output" : "preview",
      outputId: String(this.host.outputId || ""),
      componentId: String(component?.id || ""),
      probeId,
    };
    this.dmxFrameSources?.add(sourceKey);
    const previousSource = this.dmxSources.get(sourceKey);
    if (previousSource && previousSource.fixtureId !== fixtureId) {
      this.host.sendDmxFixture?.({ ...previousSource, values: {}, release: true });
      this.dmxSources.delete(sourceKey);
    }
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
        key,
        textureStateKey(state),
      );
    if (samples === null) return false;
    const values = dmxProbeFixtureValues(renderedItem, profile, samples);
    this.dmxSources.set(sourceKey, { fixtureId, source });
    if (sameRecord(retained.values, values)) return false;
    retained.values = values;
    this.host.sendDmxFixture({
      fixtureId,
      values,
      source,
      timestamp: now,
    });
    return true;
  }

  sample(
    buffer,
    boundary,
    renderRequest,
    streamKey = "probe:default",
    sampleRevision = "direct",
  ) {
    return this.sampleGrid(buffer, boundary, renderRequest, {
      width: 1,
      height: 1,
    }, streamKey, sampleRevision)?.[0] || null;
  }

  sampleGrid(
    buffer,
    boundary,
    renderRequest,
    resolution = {},
    streamKey = "probe-grid:default",
    sampleRevision = "direct",
  ) {
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
    const readback = this.pixelReadback.read(
      target,
      streamKey,
      sampleWidth,
      sampleHeight,
      sampleRevision,
    );
    if (readback.pending) this.host.invalidatePresentation?.("probe-readback");
    let pixels = readback.pixels;
    if (!readback.supported) {
      target.loadPixels?.();
      pixels = target.pixels;
    }
    if (readback.supported && !pixels) return null;
    if (!pixels || pixels.length < sampleWidth * sampleHeight * 4) return [];
    return Array.from({ length: sampleWidth * sampleHeight }, (_, index) =>
      probeColorFeatures(pixels.subarray
        ? pixels.subarray(index * 4, index * 4 + 4)
        : pixels.slice(index * 4, index * 4 + 4))
    );
  }

  dispose() {
    for (const entry of this.dmxSources.values()) {
      this.host.sendDmxFixture?.({ ...entry, values: {}, release: true });
    }
    this.dmxSources.clear();
    this.dmxFrameSources = null;
    this.pixelReadback.dispose();
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

export function probeOpticalFlowFeatures(
  previous = [],
  current = [],
  width = 0,
  height = 0,
  { gain = 2, threshold = 0.01 } = {},
) {
  const columns = Math.max(0, Math.round(Number(width) || 0));
  const rows = Math.max(0, Math.round(Number(height) || 0));
  if (columns < 3 || rows < 3 || previous.length !== columns * rows || current.length !== previous.length) {
    return zeroProbeFlowFeatures();
  }

  const normal = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const right = [0, 0, 0, 0];
  let temporalEnergy = 0;
  let samples = 0;
  const stepX = 2 / Math.max(1, columns - 1);
  const stepY = 2 / Math.max(1, rows - 1);
  const brightness = (grid, x, y) => Number(grid[y * columns + x]?.brightness) || 0;

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < columns - 1; x++) {
      const ix = (
        brightness(previous, x + 1, y) - brightness(previous, x - 1, y) +
        brightness(current, x + 1, y) - brightness(current, x - 1, y)
      ) / (4 * stepX);
      const iy = (
        brightness(previous, x, y + 1) - brightness(previous, x, y - 1) +
        brightness(current, x, y + 1) - brightness(current, x, y - 1)
      ) / (4 * stepY);
      const it = brightness(current, x, y) - brightness(previous, x, y);
      const px = x * stepX - 1;
      const py = y * stepY - 1;
      const row = [ix, iy, -ix * py + iy * px, ix * px + iy * py];
      for (let a = 0; a < 4; a++) {
        right[a] -= row[a] * it;
        for (let b = 0; b < 4; b++) normal[a][b] += row[a] * row[b];
      }
      temporalEnergy += it * it;
      samples++;
    }
  }

  const rmsChange = Math.sqrt(temporalEnergy / Math.max(1, samples));
  const noiseFloor = Math.max(0, Number(threshold) || 0);
  if (rmsChange <= noiseFloor) return zeroProbeFlowFeatures();
  for (let index = 0; index < 4; index++) normal[index][index] += 0.0001;
  const solution = solveLinearSystem4(normal, right);
  const scale = Math.max(0, Number(gain) || 0);
  const flowX = clamp(solution[0] * scale, -1, 1);
  const flowY = clamp(solution[1] * scale, -1, 1);
  const flowRotation = clamp(solution[2] * scale, -1, 1);
  const flowExpansion = clamp(solution[3] * scale, -1, 1);
  const residual = flowResidual(previous, current, columns, rows, solution);
  const flowConfidence = clamp01((rmsChange - noiseFloor) / (rmsChange + residual + 0.0001));
  return Object.freeze({
    flow: clamp01(Math.hypot(flowX, flowY)),
    flowX,
    flowY,
    flowRotation,
    flowExpansion,
    flowConfidence,
  });
}

function averageProbeColorFeatures(grid) {
  const total = grid.reduce((sum, feature) => {
    sum[0] += feature.r;
    sum[1] += feature.g;
    sum[2] += feature.b;
    sum[3] += feature.alpha;
    return sum;
  }, [0, 0, 0, 0]);
  const divisor = Math.max(1, grid.length);
  return probeColorFeatures(total.map((value) => value * 255 / divisor));
}

function zeroProbeFlowFeatures() {
  return Object.freeze({
    flow: 0,
    flowX: 0,
    flowY: 0,
    flowRotation: 0,
    flowExpansion: 0,
    flowConfidence: 0,
  });
}

function smoothProbeFlowFeatures(previous, next, smoothing) {
  if (!previous || smoothing <= 0) return next;
  return Object.freeze(Object.fromEntries(PROBE_FLOW_FEATURES.map((feature) => [
    feature,
    Number(previous[feature] || 0) * smoothing + Number(next[feature] || 0) * (1 - smoothing),
  ])));
}

function solveLinearSystem4(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    if (Math.abs(divisor) < 1e-9) continue;
    for (let index = column; index < 5; index++) rows[column][index] /= divisor;
    for (let row = 0; row < 4; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index < 5; index++) rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map((row) => Number.isFinite(row[4]) ? row[4] : 0);
}

function flowResidual(previous, current, width, height, solution) {
  const stepX = 2 / Math.max(1, width - 1);
  const stepY = 2 / Math.max(1, height - 1);
  const brightness = (grid, x, y) => Number(grid[y * width + x]?.brightness) || 0;
  let error = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const ix = (brightness(current, x + 1, y) - brightness(current, x - 1, y)) / (2 * stepX);
      const iy = (brightness(current, x, y + 1) - brightness(current, x, y - 1)) / (2 * stepY);
      const px = x * stepX - 1;
      const py = y * stepY - 1;
      const predicted = ix * (solution[0] - solution[2] * py + solution[3] * px) +
        iy * (solution[1] + solution[2] * px + solution[3] * py);
      error += Math.abs(predicted + brightness(current, x, y) - brightness(previous, x, y));
      samples++;
    }
  }
  return error / Math.max(1, samples);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : 0));
}
