import { resolutionScaledStrokeWidth } from "../component-render-layout.js?v=canvas-global-resolution-1";
import { contentTransformUvMatrices } from "../content-coordinate-space.js?v=render-core-contract-1";
import { isSharedFramebufferTarget } from "../shared-framebuffer-target.js?v=render-diagnostics-1";
import { generateMeshPatternTopology, meshPatternTopologySignature } from "./mesh-pattern-algorithms.js?v=mesh-topology-1";
import { compileRawShader, linkSpecializedProgram } from "../../libraries/render-engine/raw-webgl-utils.js";
import {
  beginRawWebGlState,
  bindRawWebGlVertexArray,
  captureRawWebGlAttributes,
  disposeRawWebGlVertexArray,
  restoreRawWebGlState,
} from "../../libraries/render-engine/raw-webgl-state.js";

const MAX_CPU_TOPOLOGIES = 32;
const MAX_GPU_TOPOLOGIES = 24;

const SHARED_VERTEX_GLSL = `
uniform mat3 contentPlacementMatrix;
uniform float rotation;
uniform vec2 offset;
uniform float time;
uniform float speed;
uniform float motion;

vec2 animatedMeshUv(vec2 uv) {
  vec2 centered = uv - 0.5;
  float phase = time * speed;
  float angle = rotation + phase * motion * 0.08;
  float cosine = cos(angle);
  float sine = sin(angle);
  centered = mat2(cosine, -sine, sine, cosine) * centered;
  centered *= 1.0 + sin(phase * 0.73) * motion * 0.018;
  return centered + 0.5 + offset * 0.12;
}

vec2 meshClip(vec2 uv) {
  vec3 placed = contentPlacementMatrix * vec3(animatedMeshUv(uv), 1.0);
  vec2 screenUv = placed.xy / max(abs(placed.z), 0.00001);
  return vec2(screenUv.x * 2.0 - 1.0, 1.0 - screenUv.y * 2.0);
}
`;

const FILL_VERTEX_SHADER = `
precision highp float;
attribute vec2 aPosition;
attribute float aColorSlot;
varying float vColorSlot;
${SHARED_VERTEX_GLSL}
void main() {
  vColorSlot = aColorSlot;
  gl_Position = vec4(meshClip(aPosition), 0.0, 1.0);
}
`;

const FILL_FRAGMENT_SHADER = `
precision highp float;
uniform vec4 palette0;
uniform vec4 palette1;
uniform vec4 palette2;
uniform vec4 palette3;
uniform float fillOpacity;
uniform float amount;
varying float vColorSlot;
vec4 paletteColor(float slot) {
  if (slot < 0.5) return palette0;
  if (slot < 1.5) return palette1;
  if (slot < 2.5) return palette2;
  return palette3;
}
void main() {
  vec4 color = paletteColor(vColorSlot);
  float alpha = color.a * fillOpacity * amount;
  gl_FragColor = vec4(color.rgb * alpha, alpha);
}
`;

const WIRE_VERTEX_SHADER = `
precision highp float;
attribute vec2 aStart;
attribute vec2 aEnd;
attribute float aSide;
attribute float aAlong;
attribute float aColorSlot;
uniform vec2 resolution;
uniform float thickness;
varying float vColorSlot;
${SHARED_VERTEX_GLSL}
void main() {
  vec2 startClip = meshClip(aStart);
  vec2 endClip = meshClip(aEnd);
  vec2 direction = endClip - startClip;
  float magnitude = max(length(direction), 0.000001);
  vec2 normal = vec2(-direction.y, direction.x) / magnitude;
  vec2 pixelScale = vec2(2.0 / max(resolution.x, 1.0), 2.0 / max(resolution.y, 1.0));
  vec2 position = mix(startClip, endClip, aAlong) + normal * pixelScale * thickness * 0.5 * aSide;
  vColorSlot = aColorSlot;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const WIRE_FRAGMENT_SHADER = `
precision highp float;
uniform vec4 wireColor;
uniform float wireOpacity;
uniform float amount;
varying float vColorSlot;
void main() {
  float stressAccent = 0.82 + 0.06 * clamp(vColorSlot, 0.0, 3.0);
  float alpha = wireColor.a * wireOpacity * amount;
  gl_FragColor = vec4(wireColor.rgb * alpha * stressAccent, alpha);
}
`;

export class MeshPatternRenderer {
  constructor({ frameIndex = () => 0 } = {}) {
    this.frameIndex = frameIndex;
    this.cpuTopologies = new Map();
    this.contexts = new Map();
  }

  draw(target, source = {}, componentTime = 0, renderRequest = {}) {
    const gl = target?.drawingContext;
    if (!gl) return false;
    const params = source.params || {};
    const viewport = renderTargetPixelSize(target);
    const signature = meshPatternTopologySignature(params, viewport.width / viewport.height);
    let topology = this.cpuTopologies.get(signature);
    if (!topology) {
      topology = generateMeshPatternTopology(params, viewport.width / viewport.height);
      this.cpuTopologies.set(signature, { topology, lastUsedFrame: this.frameIndex() });
      pruneCpuTopologies(this.cpuTopologies);
    } else {
      topology.lastUsedFrame = this.frameIndex();
      topology = topology.topology;
    }
    const context = this.contextFor(gl);
    if (!context) return false;
    let resources = context.topologies.get(signature);
    if (resources && !topologyResourcesValid(gl, resources)) {
      disposeTopologyResources(gl, resources);
      context.topologies.delete(signature);
      resources = null;
      console.warn("[VJ1_MESH_GPU_RESOURCE_RECREATED]", {
        signature,
        reason: "cached WebGL buffers are no longer valid",
      });
    }
    if (!resources) {
      const currentFrame = this.frameIndex();
      // Give ownership to the cache with a valid age. The protected key also
      // makes it impossible for this frame's resource to be evicted before it
      // is drawn, even if several entries share the same frame number.
      resources = createTopologyResources(gl, topology, currentFrame);
      context.topologies.set(signature, resources);
      pruneGpuTopologies(gl, context.topologies, signature);
    } else {
      resources.lastUsedFrame = this.frameIndex();
    }
    const palette = meshPatternPalette(params);
    const background = parseColor(params.backgroundColor, "#08070c00");
    const placement = contentTransformUvMatrices(source.contentTransform).placement;
    const drawMode = String(params.drawMode || "fill + wire");
    const drawFill = drawMode !== "wire" && resources.fillCount > 0;
    const drawWire = drawMode !== "fill" && resources.wireCount > 0;
    const render = () => drawMeshPasses(gl, context, resources, {
      params,
      palette,
      background,
      placement,
      viewport,
      drawFill,
      drawWire,
      componentTime,
      wireThickness: resolutionScaledStrokeWidth(Math.max(0.25, Number(params.wireWidth) || 1.5), renderRequest, viewport),
    });
    if (typeof target.drawWebGL === "function") target.drawWebGL(render);
    else render();
    return true;
  }

  contextFor(gl) {
    let context = this.contexts.get(gl);
    if (context && programsValid(gl, context)) return context;
    if (context) disposeContext(gl, context);
    context = createContext(gl);
    if (context) this.contexts.set(gl, context);
    return context;
  }

  dispose() {
    for (const [gl, context] of this.contexts) disposeContext(gl, context);
    this.contexts.clear();
    this.cpuTopologies.clear();
  }
}

export function meshPatternPalette(params = {}) {
  const count = clamp(Math.round(Number(params.colorCount) || 4), 2, 4);
  const base = parseColor(params.baseColor, "#e34b7fff");
  const custom = [
    base,
    parseColor(params.colorB, "#27c7c7ff"),
    parseColor(params.colorC, "#f0c541ff"),
    parseColor(params.colorD, "#45246dff"),
  ];
  const harmony = String(params.palette || "triadic").toLowerCase();
  if (harmony === "custom") return Array.from({ length: 4 }, (_value, index) => custom[index % count]);
  const hsl = rgbToHsl(base);
  const offsets = {
    analogous: [-0.09, -0.03, 0.03, 0.09],
    complementary: [0, 0.5, 0.06, 0.56],
    triadic: [0, 1 / 3, 2 / 3, 1 / 6],
    "split complementary": [0, 5 / 12, 7 / 12, 0.5],
    tetradic: [0, 0.25, 0.5, 0.75],
    monochrome: [0, 0, 0, 0],
  }[harmony] || [0, 1 / 3, 2 / 3, 1 / 6];
  const generated = offsets.map((offset, index) => {
    const lightness = harmony === "monochrome"
      ? clamp(hsl[2] + (index - (count - 1) * 0.5) * 0.13, 0.08, 0.92)
      : clamp(hsl[2] + (index % 2 ? 0.06 : -0.035), 0.08, 0.92);
    const rgb = hslToRgb([(hsl[0] + offset + 1) % 1, hsl[1], lightness]);
    return [...rgb, base[3]];
  });
  return Array.from({ length: 4 }, (_value, index) => generated[index % count]);
}

function drawMeshPasses(gl, context, resources, options) {
  const state = beginRawWebGlState(gl, "mesh-patterns");
  const previousClear = gl.getParameter(gl.COLOR_CLEAR_VALUE);
  const attributeStates = captureRawWebGlAttributes(gl, state, [
    context.fill.position, context.fill.slot,
    context.wire.start, context.wire.end, context.wire.side, context.wire.along, context.wire.slot,
  ].filter((location, index, values) => location >= 0 && values.indexOf(location) === index));
  try {
    const { background } = options;
    gl.viewport(0, 0, options.viewport.width, options.viewport.height);
    gl.clearColor(background[0] * background[3], background[1] * background[3], background[2] * background[3], background[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (options.drawFill) {
      bindRawWebGlVertexArray(gl, state, resources.fillOwner);
      gl.useProgram(context.fill.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.fillBuffer);
      gl.enableVertexAttribArray(context.fill.position);
      gl.vertexAttribPointer(context.fill.position, 2, gl.FLOAT, false, 3 * 4, 0);
      gl.enableVertexAttribArray(context.fill.slot);
      gl.vertexAttribPointer(context.fill.slot, 1, gl.FLOAT, false, 3 * 4, 2 * 4);
      setSharedUniforms(gl, context.fill, options);
      options.palette.forEach((color, index) => gl.uniform4fv(context.fill[`palette${index}`], color));
      gl.uniform1f(context.fill.opacity, clamp(finite(options.params.fillOpacity, 0.82), 0, 1));
      gl.uniform1f(context.fill.amount, clamp(finite(options.params.amount, 1), 0, 1));
      gl.drawArrays(gl.TRIANGLES, 0, resources.fillCount);
    }
    if (options.drawWire) {
      bindRawWebGlVertexArray(gl, state, resources.wireOwner);
      gl.useProgram(context.wire.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.wireBuffer);
      const stride = 7 * 4;
      gl.enableVertexAttribArray(context.wire.start);
      gl.vertexAttribPointer(context.wire.start, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(context.wire.end);
      gl.vertexAttribPointer(context.wire.end, 2, gl.FLOAT, false, stride, 2 * 4);
      gl.enableVertexAttribArray(context.wire.side);
      gl.vertexAttribPointer(context.wire.side, 1, gl.FLOAT, false, stride, 4 * 4);
      gl.enableVertexAttribArray(context.wire.along);
      gl.vertexAttribPointer(context.wire.along, 1, gl.FLOAT, false, stride, 5 * 4);
      gl.enableVertexAttribArray(context.wire.slot);
      gl.vertexAttribPointer(context.wire.slot, 1, gl.FLOAT, false, stride, 6 * 4);
      setSharedUniforms(gl, context.wire, options);
      gl.uniform2f(context.wire.resolution, options.viewport.width, options.viewport.height);
      gl.uniform1f(context.wire.thickness, options.wireThickness);
      gl.uniform4fv(context.wire.color, parseColor(options.params.wireColor, "#fff4d6ff"));
      gl.uniform1f(context.wire.opacity, clamp(finite(options.params.wireOpacity, 1), 0, 1));
      gl.uniform1f(context.wire.amount, clamp(finite(options.params.amount, 1), 0, 1));
      gl.drawArrays(gl.TRIANGLES, 0, resources.wireCount);
    }
  } finally {
    gl.clearColor(...previousClear);
    restoreRawWebGlState(gl, state, attributeStates);
  }
}

function setSharedUniforms(gl, program, options) {
  gl.uniformMatrix3fv(program.placement, false, options.placement);
  gl.uniform1f(program.rotation, finite(options.params.rotation, 0));
  gl.uniform2f(program.offset, finite(options.params.offsetX, 0), finite(options.params.offsetY, 0));
  gl.uniform1f(program.time, finite(options.componentTime, 0));
  gl.uniform1f(program.speed, Math.max(0, finite(options.params.speed, 0)));
  gl.uniform1f(program.motion, clamp(finite(options.params.motion, 0.35), 0, 2));
}

function createContext(gl) {
  const fillProgram = linkSpecializedProgram(
    gl,
    compileRawShader(gl, gl.VERTEX_SHADER, FILL_VERTEX_SHADER),
    compileRawShader(gl, gl.FRAGMENT_SHADER, FILL_FRAGMENT_SHADER)
  );
  const wireProgram = linkSpecializedProgram(
    gl,
    compileRawShader(gl, gl.VERTEX_SHADER, WIRE_VERTEX_SHADER),
    compileRawShader(gl, gl.FRAGMENT_SHADER, WIRE_FRAGMENT_SHADER)
  );
  if (!fillProgram || !wireProgram) {
    if (fillProgram) gl.deleteProgram(fillProgram);
    if (wireProgram) gl.deleteProgram(wireProgram);
    return null;
  }
  return {
    fill: {
      program: fillProgram,
      position: gl.getAttribLocation(fillProgram, "aPosition"),
      slot: gl.getAttribLocation(fillProgram, "aColorSlot"),
      ...sharedUniforms(gl, fillProgram),
      palette0: gl.getUniformLocation(fillProgram, "palette0"),
      palette1: gl.getUniformLocation(fillProgram, "palette1"),
      palette2: gl.getUniformLocation(fillProgram, "palette2"),
      palette3: gl.getUniformLocation(fillProgram, "palette3"),
      opacity: gl.getUniformLocation(fillProgram, "fillOpacity"),
      amount: gl.getUniformLocation(fillProgram, "amount"),
    },
    wire: {
      program: wireProgram,
      start: gl.getAttribLocation(wireProgram, "aStart"),
      end: gl.getAttribLocation(wireProgram, "aEnd"),
      side: gl.getAttribLocation(wireProgram, "aSide"),
      along: gl.getAttribLocation(wireProgram, "aAlong"),
      slot: gl.getAttribLocation(wireProgram, "aColorSlot"),
      ...sharedUniforms(gl, wireProgram),
      resolution: gl.getUniformLocation(wireProgram, "resolution"),
      thickness: gl.getUniformLocation(wireProgram, "thickness"),
      color: gl.getUniformLocation(wireProgram, "wireColor"),
      opacity: gl.getUniformLocation(wireProgram, "wireOpacity"),
      amount: gl.getUniformLocation(wireProgram, "amount"),
    },
    topologies: new Map(),
  };
}

function sharedUniforms(gl, program) {
  return {
    placement: gl.getUniformLocation(program, "contentPlacementMatrix"),
    rotation: gl.getUniformLocation(program, "rotation"),
    offset: gl.getUniformLocation(program, "offset"),
    time: gl.getUniformLocation(program, "time"),
    speed: gl.getUniformLocation(program, "speed"),
    motion: gl.getUniformLocation(program, "motion"),
  };
}

function createTopologyResources(gl, topology, lastUsedFrame) {
  const fillBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fillBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, topology.fillVertices, gl.STATIC_DRAW);
  const wireVertices = expandedLineVertices(topology.lineSegments);
  const wireBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, wireBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, wireVertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return {
    fillBuffer,
    wireBuffer,
    fillOwner: {},
    wireOwner: {},
    fillCount: topology.fillVertexCount,
    wireCount: wireVertices.length / 7,
    lastUsedFrame,
  };
}

function expandedLineVertices(segments) {
  const corners = [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]];
  const result = new Float32Array(segments.length / 5 * corners.length * 7);
  let cursor = 0;
  for (let index = 0; index < segments.length; index += 5) {
    const startX = segments[index];
    const startY = segments[index + 1];
    const endX = segments[index + 2];
    const endY = segments[index + 3];
    const slot = segments[index + 4];
    corners.forEach(([along, side]) => {
      result[cursor++] = startX;
      result[cursor++] = startY;
      result[cursor++] = endX;
      result[cursor++] = endY;
      result[cursor++] = side;
      result[cursor++] = along;
      result[cursor++] = slot;
    });
  }
  return result;
}

function programsValid(gl, context) {
  try {
    return gl.isProgram(context?.fill?.program) && gl.isProgram(context?.wire?.program) &&
      gl.getProgramParameter(context.fill.program, gl.LINK_STATUS) && gl.getProgramParameter(context.wire.program, gl.LINK_STATUS);
  } catch {
    return false;
  }
}

function topologyResourcesValid(gl, resources) {
  try {
    return !!resources?.fillBuffer && !!resources?.wireBuffer &&
      gl.isBuffer(resources.fillBuffer) && gl.isBuffer(resources.wireBuffer);
  } catch {
    return false;
  }
}

function pruneCpuTopologies(cache) {
  while (cache.size > MAX_CPU_TOPOLOGIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame)[0];
    if (!oldest) break;
    cache.delete(oldest[0]);
  }
}

function pruneGpuTopologies(gl, cache, protectedKey) {
  while (cache.size > MAX_GPU_TOPOLOGIES) {
    const oldest = [...cache.entries()]
      .filter(([key]) => key !== protectedKey)
      .sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame)[0];
    if (!oldest) break;
    disposeTopologyResources(gl, oldest[1]);
    cache.delete(oldest[0]);
  }
}

function disposeContext(gl, context) {
  for (const resources of context?.topologies?.values?.() || []) disposeTopologyResources(gl, resources);
  context?.topologies?.clear?.();
  try {
    if (context?.fill?.program && gl.isProgram(context.fill.program)) gl.deleteProgram(context.fill.program);
    if (context?.wire?.program && gl.isProgram(context.wire.program)) gl.deleteProgram(context.wire.program);
  } catch {}
}

function disposeTopologyResources(gl, resources) {
  try {
    disposeRawWebGlVertexArray(gl, resources.fillOwner);
    disposeRawWebGlVertexArray(gl, resources.wireOwner);
    if (resources.fillBuffer && gl.isBuffer(resources.fillBuffer)) gl.deleteBuffer(resources.fillBuffer);
    if (resources.wireBuffer && gl.isBuffer(resources.wireBuffer)) gl.deleteBuffer(resources.wireBuffer);
  } catch {}
}

function renderTargetPixelSize(target) {
  const density = isSharedFramebufferTarget(target)
    ? 1
    : Math.max(0.25, Number(target?.pixelDensity?.()) || Number(target?.__vj1PixelDensity) || 1);
  return {
    width: Math.max(1, Math.round((Number(target?.width) || 1) * density)),
    height: Math.max(1, Math.round((Number(target?.height) || 1) * density)),
  };
}

function parseColor(value, fallback) {
  const clean = String(value || fallback).replace(/^#/, "");
  const fallbackClean = String(fallback).replace(/^#/, "");
  const normalized = /^[0-9a-f]{8}$/i.test(clean)
    ? clean
    : /^[0-9a-f]{6}$/i.test(clean) ? `${clean}ff` : fallbackClean;
  return [0, 2, 4, 6].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

function rgbToHsl(color) {
  const [red, green, blue] = color;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) * 0.5;
  if (maximum === minimum) return [0, 0, lightness];
  const delta = maximum - minimum;
  const saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
  let hue = maximum === red
    ? (green - blue) / delta + (green < blue ? 6 : 0)
    : maximum === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  hue /= 6;
  return [hue, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]) {
  if (saturation === 0) return [lightness, lightness, lightness];
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset) => {
    let value = (hue + offset + 1) % 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 0.5) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
