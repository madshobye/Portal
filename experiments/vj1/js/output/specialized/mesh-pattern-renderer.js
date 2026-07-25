import { resolutionScaledStrokeWidth } from "../component-render-layout.js?v=surface-terminology-1";
import { contentTransformUvMatrices } from "../content-coordinate-space.js?v=node-roi-placement-1";
import { isSharedFramebufferTarget } from "../shared-framebuffer-target.js?v=premultiplied-alpha-5";
export { meshPatternPalette } from "../../libraries/visual-nodes/generators/mesh-patterns/palette.js?v=node-program-hooks-15";
import { compileRawShader, linkSpecializedProgram } from "../../libraries/render-engine/raw-webgl-utils.js";
import {
  beginRawWebGlState,
  bindRawWebGlVertexArray,
  captureRawWebGlAttributes,
  disposeRawWebGlVertexArray,
  restoreRawWebGlState,
} from "../../libraries/render-engine/raw-webgl-state.js";
import { renderView } from "../../libraries/render-engine/render-view/index.js";

const MAX_GPU_TOPOLOGIES = 24;
export function meshPatternNodeShaderSource(operation = {}, id = "") {
  const source = operation?.nodeShaders?.[id];
  if (typeof source === "string" && source.trim()) return source;
  throw new Error(`MESH_PATTERN_COMPILED_SHADER_MISSING:${id}`);
}


export class MeshPatternRenderer {
  constructor({ frameIndex = () => 0 } = {}) {
    this.frameIndex = frameIndex;
    this.contexts = new Map();
  }

  drawPass(
    target,
    pass,
    source = {},
    componentTime = 0,
    renderRequest = {},
    operation = null,
    { preserveTarget = false } = {},
  ) {
    const gl = target?.drawingContext;
    if (!gl) return false;
    const topologyValue = operation?.runtimeValueInputs?.get?.("topology") || null;
    const materialValue = operation?.runtimeValueInputs?.get?.("material") || null;
    const missing = [
      !topologyValue ? "topology" : "",
      !materialValue ? "material" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(`MESH_PATTERN_VALUE_INPUT_MISSING:${operation?.id || pass}:${missing.join(",")}`);
    }
    const topology = topologyValue.geometry;
    if (!topology) throw new Error(`MESH_PATTERN_TOPOLOGY_VALUE_MISSING:${operation?.id || pass}`);
    const topologyParams = topologyValue.settings || {};
    const materialParams = materialValue.settings || {};
    const renderParams = source.params || {};
    const programId = pass === "fill" ? "mesh-pattern-fill" : "mesh-pattern-wire";
    const vertexId = `${programId}-vertex`;
    const fragmentId = `${programId}-fragment`;
    const shaderConfiguration = {
      revision: String(
        operation?.nodeShaderProgramRevisions?.[programId]
        || operation?.nodeShaderRevision
        || "legacy"
      ),
      vertex: meshPatternNodeShaderSource(operation, vertexId),
      fragment: meshPatternNodeShaderSource(operation, fragmentId),
    };
    const context = this.contextForPass(gl, pass, shaderConfiguration);
    if (!context) return false;
    const signature = String(
      topologyValue.resourceRevision
      || topology.signature
      || "unspecified"
    );
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
      resources = createTopologyResources(gl, topology, currentFrame);
      context.topologies.set(signature, resources);
      pruneGpuTopologies(gl, context.topologies, signature);
    } else {
      resources.lastUsedFrame = this.frameIndex();
    }
    const viewport = renderTargetPixelSize(target);
    const view = renderView(target, renderRequest);
    const drawMode = String(renderParams.drawMode || "fill + wire");
    const drawFill = pass === "fill" && drawMode !== "wire" && resources.fillCount > 0;
    const drawWire = pass === "wire" && drawMode !== "fill" && resources.wireCount > 0;
    const palette = meshPatternPassPalette(pass, materialValue, operation);
    const placement = contentTransformUvMatrices(source.contentTransform).placement;
    const render = () => drawMeshPasses(gl, context, resources, {
      topologyParams,
      fillMaterialParams: pass === "fill" ? materialParams : {},
      wireMaterialParams: pass === "wire" ? materialParams : {},
      fillRenderParams: pass === "fill" ? renderParams : {},
      wireRenderParams: pass === "wire" ? renderParams : {},
      palette,
      background: pass === "fill"
        ? parseColor(materialParams.backgroundColor, "#08070c00")
        : parseColor("#00000000", "#00000000"),
      placement,
      viewport,
      renderUvRect: view.uvRect,
      drawFill,
      drawWire,
      clear: !preserveTarget,
      componentTime,
      wireThickness: resolutionScaledStrokeWidth(
        Math.max(0.25, Number(materialParams.wireWidth) || 1.5),
        renderRequest,
        viewport,
      ),
    });
    if (typeof target.drawWebGL === "function") target.drawWebGL(render);
    else render();
    return true;
  }

  contextForPass(gl, pass, shaderConfiguration) {
    let context = this.contexts.get(gl);
    if (!context) {
      context = {
        topologies: new Map(),
        fill: null,
        wire: null,
        fillRevision: "",
        wireRevision: "",
      };
      this.contexts.set(gl, context);
    }
    const revisionKey = `${pass}Revision`;
    if (
      context[pass] &&
      context[revisionKey] === shaderConfiguration.revision &&
      programValid(gl, context[pass])
    ) return context;
    const replacement = createPassProgram(gl, pass, shaderConfiguration);
    if (!replacement) return null;
    disposePassProgram(gl, context[pass]);
    context[pass] = replacement;
    context[revisionKey] = shaderConfiguration.revision;
    return context;
  }

  dispose() {
    for (const [gl, context] of this.contexts) disposeContext(gl, context);
    this.contexts.clear();
  }
}

export function meshPatternPassPalette(pass, materialValue = {}, operation = {}) {
  const palette = materialValue.palette;
  if (pass === "fill" && (!Array.isArray(palette) || palette.length !== 4)) {
    throw new Error(`MESH_PATTERN_MATERIAL_PALETTE_MISSING:${operation?.id || pass}`);
  }
  return Array.isArray(palette) ? palette : [];
}


function drawMeshPasses(gl, context, resources, options) {
  const state = beginRawWebGlState(gl, "mesh-patterns");
  const previousClear = gl.getParameter(gl.COLOR_CLEAR_VALUE);
  const attributeStates = captureRawWebGlAttributes(gl, state, [
    context.fill?.position, context.fill?.slot,
    context.wire?.start, context.wire?.end, context.wire?.side, context.wire?.along, context.wire?.slot,
  ].filter((location, index, values) => location >= 0 && values.indexOf(location) === index));
  try {
    const { background } = options;
    gl.viewport(0, 0, options.viewport.width, options.viewport.height);
    if (options.clear !== false) {
      gl.clearColor(background[0] * background[3], background[1] * background[3], background[2] * background[3], background[3]);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
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
      gl.uniform1f(context.fill.opacity, clamp(finite(options.fillMaterialParams.fillOpacity, 0.82), 0, 1));
      gl.uniform1f(context.fill.amount, clamp(finite(options.fillRenderParams.amount, 1), 0, 1));
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
      gl.uniform4fv(context.wire.color, parseColor(options.wireMaterialParams.wireColor, "#fff4d6ff"));
      gl.uniform1f(context.wire.opacity, clamp(finite(options.wireMaterialParams.wireOpacity, 1), 0, 1));
      gl.uniform1f(context.wire.amount, clamp(finite(options.wireRenderParams.amount, 1), 0, 1));
      gl.drawArrays(gl.TRIANGLES, 0, resources.wireCount);
    }
  } finally {
    gl.clearColor(...previousClear);
    restoreRawWebGlState(gl, state, attributeStates);
  }
}

function setSharedUniforms(gl, program, options) {
  gl.uniformMatrix3fv(program.placement, false, options.placement);
  gl.uniform1f(program.rotation, finite(options.topologyParams.rotation, 0));
  gl.uniform2f(program.offset, finite(options.topologyParams.offsetX, 0), finite(options.topologyParams.offsetY, 0));
  gl.uniform1f(program.time, finite(options.componentTime, 0));
  gl.uniform1f(program.speed, Math.max(0, finite(options.topologyParams.speed, 0)));
  gl.uniform1f(program.motion, clamp(finite(options.topologyParams.motion, 0.35), 0, 2));
  gl.uniform4fv(program.renderUvRect, options.renderUvRect);
}

function createPassProgram(gl, pass, shaderConfiguration) {
  const program = linkSpecializedProgram(
    gl,
    compileRawShader(gl, gl.VERTEX_SHADER, shaderConfiguration.vertex),
    compileRawShader(gl, gl.FRAGMENT_SHADER, shaderConfiguration.fragment),
  );
  if (!program) return null;
  if (pass === "fill") {
    return {
      program,
      position: gl.getAttribLocation(program, "aPosition"),
      slot: gl.getAttribLocation(program, "aColorSlot"),
      ...sharedUniforms(gl, program),
      palette0: gl.getUniformLocation(program, "palette0"),
      palette1: gl.getUniformLocation(program, "palette1"),
      palette2: gl.getUniformLocation(program, "palette2"),
      palette3: gl.getUniformLocation(program, "palette3"),
      opacity: gl.getUniformLocation(program, "fillOpacity"),
      amount: gl.getUniformLocation(program, "amount"),
    };
  }
  return {
    program,
    start: gl.getAttribLocation(program, "aStart"),
    end: gl.getAttribLocation(program, "aEnd"),
    side: gl.getAttribLocation(program, "aSide"),
    along: gl.getAttribLocation(program, "aAlong"),
    slot: gl.getAttribLocation(program, "aColorSlot"),
    ...sharedUniforms(gl, program),
    resolution: gl.getUniformLocation(program, "resolution"),
    thickness: gl.getUniformLocation(program, "thickness"),
    color: gl.getUniformLocation(program, "wireColor"),
    opacity: gl.getUniformLocation(program, "wireOpacity"),
    amount: gl.getUniformLocation(program, "amount"),
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
    renderUvRect: gl.getUniformLocation(program, "renderUvRect"),
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

function programValid(gl, program) {
  try {
    return gl.isProgram(program?.program) &&
      gl.getProgramParameter(program.program, gl.LINK_STATUS);
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
  disposePrograms(gl, context);
}

function disposePrograms(gl, context) {
  disposePassProgram(gl, context?.fill);
  disposePassProgram(gl, context?.wire);
}

function disposePassProgram(gl, pass) {
  try {
    if (pass?.program && gl.isProgram(pass.program)) gl.deleteProgram(pass.program);
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


function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
