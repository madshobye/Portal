import { resolutionScaledStrokeWidth } from "../component-render-layout.js?v=surface-terminology-1";
import { contentTransformUvMatrices } from "../content-coordinate-space.js?v=render-core-contract-1";
import { isSharedFramebufferTarget } from "../shared-framebuffer-target.js?v=render-diagnostics-1";
import { generateMeshPatternTopology, meshPatternTopologySignature } from "./mesh-pattern-algorithms.js?v=mesh-topology-4";
import { meshPatternPalette as fallbackMeshPatternPalette } from "../../libraries/visual-nodes/generators/mesh-patterns/palette.js?v=node-program-hooks-15";
export { meshPatternPalette } from "../../libraries/visual-nodes/generators/mesh-patterns/palette.js?v=node-program-hooks-15";
import {
  MESH_PATTERN_FILL_FRAGMENT_SHADER,
  MESH_PATTERN_FILL_VERTEX_SHADER,
  MESH_PATTERN_WIRE_FRAGMENT_SHADER,
  MESH_PATTERN_WIRE_VERTEX_SHADER,
} from "../../libraries/visual-nodes/generators/mesh-patterns/shaders.js?v=source-roi-view-3";
import { compileRawShader, linkSpecializedProgram } from "../../libraries/render-engine/raw-webgl-utils.js";
import {
  beginRawWebGlState,
  bindRawWebGlVertexArray,
  captureRawWebGlAttributes,
  disposeRawWebGlVertexArray,
  restoreRawWebGlState,
} from "../../libraries/render-engine/raw-webgl-state.js";
import { renderView } from "../../libraries/render-engine/render-view/index.js";
import {
  evaluateSpecializedCompoundGraph,
  executeSpecializedCompoundProvider,
  specializedCompoundEvaluatedStageSettings,
  specializedCompoundStageEnabled,
  specializedCompoundNativeKernel,
  specializedCompoundStageParameterView,
} from "../../libraries/visual-nodes/shared/specialized-compound.js?v=compiled-graph-value-authority-1";

const MAX_CPU_TOPOLOGIES = 32;
const MAX_GPU_TOPOLOGIES = 24;
const FALLBACK_MESH_PATTERN_NODE_MODULE = Object.freeze({
  generateMeshPatternTopology,
  meshPatternTopologySignature,
  meshPatternPalette: fallbackMeshPatternPalette,
});
const MESH_PATTERN_MODULE_ADAPTERS = new WeakMap();

export function meshPatternNodeRuntimeModule(operation = {}) {
  const module = operation?.nodeModule;
  if (
    typeof module?.generateMeshPatternTopology === "function" &&
    typeof module?.meshPatternTopologySignature === "function" &&
    typeof module?.meshPatternPalette === "function"
  ) return module;
  if (operation?.nativeCompoundProgram) {
    const missing = [
      ["generateMeshPatternTopology", module?.generateMeshPatternTopology],
      ["meshPatternTopologySignature", module?.meshPatternTopologySignature],
      ["meshPatternPalette", module?.meshPatternPalette],
    ].filter(([, value]) => typeof value !== "function").map(([name]) => name);
    throw new Error(`MESH_PATTERN_COMPILED_MODULE_MISSING:${missing.join(",")}`);
  }
  if (!module || typeof module !== "object") return FALLBACK_MESH_PATTERN_NODE_MODULE;
  let adapted = MESH_PATTERN_MODULE_ADAPTERS.get(module);
  if (!adapted) {
    adapted = Object.freeze({
      generateMeshPatternTopology: typeof module.generateMeshPatternTopology === "function"
        ? module.generateMeshPatternTopology
        : generateMeshPatternTopology,
      meshPatternTopologySignature: typeof module.meshPatternTopologySignature === "function"
        ? module.meshPatternTopologySignature
        : meshPatternTopologySignature,
      meshPatternPalette: typeof module.meshPatternPalette === "function"
        ? module.meshPatternPalette
        : fallbackMeshPatternPalette,
    });
    MESH_PATTERN_MODULE_ADAPTERS.set(module, adapted);
  }
  return adapted;
}

const FALLBACK_MESH_PATTERN_SHADERS = Object.freeze({
  "mesh-pattern-fill-vertex": MESH_PATTERN_FILL_VERTEX_SHADER,
  "mesh-pattern-fill-fragment": MESH_PATTERN_FILL_FRAGMENT_SHADER,
  "mesh-pattern-wire-vertex": MESH_PATTERN_WIRE_VERTEX_SHADER,
  "mesh-pattern-wire-fragment": MESH_PATTERN_WIRE_FRAGMENT_SHADER,
});

export function meshPatternNodeShaderSource(operation = {}, id = "") {
  const source = operation?.nodeShaders?.[id];
  if (typeof source === "string" && source.trim()) return source;
  if (operation?.nativeCompoundProgram) {
    throw new Error(`MESH_PATTERN_COMPILED_SHADER_MISSING:${id}`);
  }
  return FALLBACK_MESH_PATTERN_SHADERS[id] || "";
}


export class MeshPatternRenderer {
  constructor({ frameIndex = () => 0 } = {}) {
    this.frameIndex = frameIndex;
    this.cpuTopologies = new Map();
    this.contexts = new Map();
  }

  draw(target, source = {}, componentTime = 0, renderRequest = {}, operation = null) {
    const gl = target?.drawingContext;
    if (!gl) return false;
    const fillKernel = specializedCompoundNativeKernel(operation, "mesh-pattern-fill");
    const wireKernel = specializedCompoundNativeKernel(operation, "mesh-pattern-wire");
    if (operation?.nativeCompoundProgram && (!fillKernel || !wireKernel)) return false;
    const fillStageId = fillKernel?.id || "fill-render";
    const wireStageId = wireKernel?.id || "wire-render";
    const topologyStageId = fillKernel?.inputBindings?.topology?.stageId || "topology";
    const fillMaterialStageId = fillKernel?.inputBindings?.material?.stageId || "fill-material";
    const wireMaterialStageId = wireKernel?.inputBindings?.material?.stageId || "wire-material";
    if (!specializedCompoundStageEnabled(operation, topologyStageId)) return false;
    const authoredParams = source.params || {};
    const instanceId = source.instanceId || renderRequest.renderIdentity || source.generatorId || "mesh-patterns";
    const viewport = renderTargetPixelSize(target);
    const view = renderView(target, renderRequest);
    const graph = evaluateSpecializedCompoundGraph(
      operation,
      authoredParams,
      { instanceId },
      { [topologyStageId]: { aspect: view.width / view.height } },
    );
    let topologyValue = graph?.stageInput(fillStageId, "topology") || null;
    let fillMaterialValue = graph?.stageInput(fillStageId, "material") || null;
    let wireMaterialValue = graph?.stageInput(wireStageId, "material") || null;
    if (operation?.nativeCompoundProgram) {
      const missingInputs = [
        !topologyValue ? `${fillStageId}.topology` : "",
        !fillMaterialValue ? `${fillStageId}.material` : "",
        !wireMaterialValue ? `${wireStageId}.material` : "",
      ].filter(Boolean);
      if (missingInputs.length) {
        throw new Error(`MESH_PATTERN_GRAPH_INPUT_MISSING:${missingInputs.join(",")}`);
      }
    } else {
      // Only explicit uncompiled compatibility calls may reconstruct provider
      // values. Production compiled Groups consume the displayed graph wires
      // exclusively and fail closed when one is unavailable.
      topologyValue = executeSpecializedCompoundProvider(
        operation, topologyStageId, authoredParams, instanceId,
      );
      fillMaterialValue = executeSpecializedCompoundProvider(
        operation, fillMaterialStageId, authoredParams, instanceId,
      );
      wireMaterialValue = executeSpecializedCompoundProvider(
        operation, wireMaterialStageId, authoredParams, instanceId,
      );
    }
    const topologyParams = topologyValue?.settings || specializedCompoundStageParameterView(
      operation, topologyStageId, authoredParams, instanceId,
    );
    const fillMaterialParams = fillMaterialValue?.settings || specializedCompoundStageParameterView(
      operation, fillMaterialStageId, authoredParams, instanceId,
    );
    const wireMaterialParams = wireMaterialValue?.settings || specializedCompoundStageParameterView(
      operation, wireMaterialStageId, authoredParams, instanceId,
    );
    const fillRenderParams = specializedCompoundEvaluatedStageSettings(
      operation, graph, fillStageId, authoredParams, instanceId,
    );
    const wireRenderParams = specializedCompoundEvaluatedStageSettings(
      operation, graph, wireStageId, authoredParams, instanceId,
    );
    const nodeModule = operation?.nativeCompoundProgram
      ? operation.nodeModule
      : meshPatternNodeRuntimeModule(operation);
    const codeRevision = String(operation?.nodeCodeRevision || operation?.nodeModuleRevision || "legacy");
    let topology = topologyValue?.geometry || null;
    if (!topology && operation?.nativeCompoundProgram) {
      throw new Error(`MESH_PATTERN_TOPOLOGY_VALUE_MISSING:${topologyStageId}`);
    }
    if (!topology) {
      const legacySignature = nodeModule.meshPatternTopologySignature(topologyParams, view.width / view.height);
      let cached = this.cpuTopologies.get(legacySignature);
      if (!cached) {
        cached = {
          topology: nodeModule.generateMeshPatternTopology(topologyParams, view.width / view.height),
          lastUsedFrame: this.frameIndex(),
        };
        this.cpuTopologies.set(legacySignature, cached);
        pruneCpuTopologies(this.cpuTopologies);
      } else {
        cached.lastUsedFrame = this.frameIndex();
      }
      topology = cached.topology;
    }
    if (operation?.nativeCompoundProgram && !Array.isArray(fillMaterialValue?.palette)) {
      throw new Error(`MESH_PATTERN_MATERIAL_VALUE_MISSING:${fillMaterialStageId}`);
    }
    const signature = `${codeRevision}:${String(topology.signature || "unspecified")}`;
    const fillShaderRevision = String(operation?.nodeShaderProgramRevisions?.["mesh-pattern-fill"] || operation?.nodeShaderRevision || "legacy");
    const wireShaderRevision = String(operation?.nodeShaderProgramRevisions?.["mesh-pattern-wire"] || operation?.nodeShaderRevision || "legacy");
    const shaderConfiguration = {
      revision: `${fillShaderRevision}:${wireShaderRevision}`,
      fillVertex: meshPatternNodeShaderSource(operation, "mesh-pattern-fill-vertex"),
      fillFragment: meshPatternNodeShaderSource(operation, "mesh-pattern-fill-fragment"),
      wireVertex: meshPatternNodeShaderSource(operation, "mesh-pattern-wire-vertex"),
      wireFragment: meshPatternNodeShaderSource(operation, "mesh-pattern-wire-fragment"),
    };
    const context = this.contextFor(gl, shaderConfiguration);
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
    const palette = fillMaterialValue?.palette || nodeModule.meshPatternPalette(fillMaterialParams);
    const background = parseColor(fillMaterialParams.backgroundColor, "#08070c00");
    const placement = contentTransformUvMatrices(source.contentTransform).placement;
    const drawModeValue = fillRenderParams.drawMode ?? wireRenderParams.drawMode;
    const drawMode = String(drawModeValue || "fill + wire");
    const drawFill = drawMode !== "wire" && resources.fillCount > 0 &&
      specializedCompoundStageEnabled(operation, fillMaterialStageId) &&
      specializedCompoundStageEnabled(operation, fillStageId);
    const drawWire = drawMode !== "fill" && resources.wireCount > 0 &&
      specializedCompoundStageEnabled(operation, wireMaterialStageId) &&
      specializedCompoundStageEnabled(operation, wireStageId);
    const render = () => drawMeshPasses(gl, context, resources, {
      topologyParams,
      fillMaterialParams,
      wireMaterialParams,
      fillRenderParams,
      wireRenderParams,
      palette,
      background,
      placement,
      viewport,
      renderUvRect: view.uvRect,
      drawFill,
      drawWire,
      componentTime,
      wireThickness: resolutionScaledStrokeWidth(
        Math.max(0.25, Number(wireMaterialParams.wireWidth) || 1.5),
        renderRequest,
        viewport,
      ),
    });
    if (typeof target.drawWebGL === "function") target.drawWebGL(render);
    else render();
    return true;
  }

  contextFor(gl, shaderConfiguration) {
    let context = this.contexts.get(gl);
    if (context && context.shaderRevision === shaderConfiguration.revision && programsValid(gl, context)) return context;
    const replacement = createContext(gl, shaderConfiguration, context?.topologies);
    if (!replacement) return null;
    if (context) disposePrograms(gl, context);
    this.contexts.set(gl, replacement);
    return replacement;
  }

  dispose() {
    for (const [gl, context] of this.contexts) disposeContext(gl, context);
    this.contexts.clear();
    this.cpuTopologies.clear();
  }
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

function createContext(gl, shaderConfiguration, topologies = new Map()) {
  const fillProgram = linkSpecializedProgram(
    gl,
    compileRawShader(gl, gl.VERTEX_SHADER, shaderConfiguration.fillVertex),
    compileRawShader(gl, gl.FRAGMENT_SHADER, shaderConfiguration.fillFragment)
  );
  const wireProgram = linkSpecializedProgram(
    gl,
    compileRawShader(gl, gl.VERTEX_SHADER, shaderConfiguration.wireVertex),
    compileRawShader(gl, gl.FRAGMENT_SHADER, shaderConfiguration.wireFragment)
  );
  if (!fillProgram || !wireProgram) {
    if (fillProgram) gl.deleteProgram(fillProgram);
    if (wireProgram) gl.deleteProgram(wireProgram);
    return null;
  }
  return {
    shaderRevision: shaderConfiguration.revision,
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
    topologies: topologies || new Map(),
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
  disposePrograms(gl, context);
}

function disposePrograms(gl, context) {
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


function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
