import { resolutionScaledStrokeWidth } from "../component-render-layout.js?v=instance-sync-60";
import { buildParsedModelSurfaceVertices } from "./model-geometry.js?v=model-geometry-fix-30";
import { ensureParsedModelPointCloud, ensureParsedModelThickWireVertices, ensureParsedModelWireLines, drawWithPolygonOffset } from "./model-mesh-cache.js?v=model-mesh-cache-extraction-1";
import { modelDepthCutoff, modelRotation, modelViewportMetrics, modelWireThickness, rawModelMatrices } from "./model-render-math.js?v=render-core-contract-1";
import { compileRawShader, linkSpecializedProgram } from "./raw-webgl-utils.js?v=terrain-gl-state-1";
import {
  beginRawWebGlState,
  bindRawWebGlVertexArray,
  captureRawWebGlAttributes,
  disposeRawWebGlVertexArray,
  restoreRawWebGlState,
} from "./raw-webgl-state.js?v=raw-webgl-state-1";

export function drawRawParsedModelMode(target, item, params = {}, componentTime = 0, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220], pointBudget = 4000, viewport = null, contentTransform = {}) {
  if (renderMode === "points") {
    return drawRawParsedModel(target, item, params, componentTime, "points", wireColor, pointBudget, viewport, contentTransform);
  }
  if (renderMode === "wireframe") {
    return drawRawParsedWire(target, item, params, componentTime, wireColor, pointBudget, viewport, contentTransform);
  }
  const drewSurface = drawWithPolygonOffset(target, renderMode === "surfaceWire", () => (
    drawRawParsedSurface(target, item, params, componentTime, surfaceColor, viewport, contentTransform)
  ));
  if (drewSurface && renderMode === "surfaceWire") {
    drawRawParsedWire(target, item, params, componentTime, wireColor, pointBudget, viewport, contentTransform);
  }
  return drewSurface;
}

export function disposeRawModelContextResources(gl, resources) {
  for (const buffer of resources?.buffers?.values?.() || []) disposeRawModelBuffer(gl, buffer);
  resources?.buffers?.clear?.();
  disposeRawModelProgram(gl, resources?.program);
  disposeRawModelProgram(gl, resources?.surfaceProgram);
  disposeRawModelProgram(gl, resources?.wireProgram);
}

export function disposeRawModelItemResources(item, onlyContext = null) {
  const renderers = item?.modelRawRenderers;
  if (!(renderers instanceof Map)) return;
  for (const [gl, resources] of renderers) {
    if (onlyContext && gl !== onlyContext) continue;
    disposeRawModelContextResources(gl, resources);
    renderers.delete(gl);
  }
}

function drawRawParsedModel(target, item, params = {}, componentTime = 0, mode = "points", color = [245, 245, 245, 255], pointBudget = 4000, viewport = null, contentTransform = {}) {
  const gl = target?.drawingContext;
  const mesh = item?.modelData;
  if (!gl || !mesh) return false;
  const passState = beginRawWebGlState(gl, `model-${mode}`);
  let attributeStates = [];
  try {
    const resources = ensureRawModelResources(gl, item, mode, pointBudget);
    if (!resources?.buffer || !resources.count || !resources.program) return false;
    attributeStates = captureRawWebGlAttributes(gl, passState, [resources.position]);
    bindRawWebGlVertexArray(gl, passState, resources.vertexArrayOwner);
    const drawingWidth = Math.max(1, gl.drawingBufferWidth || target.width || 1);
    const drawingHeight = Math.max(1, gl.drawingBufferHeight || target.height || 1);
    const metrics = modelViewportMetrics(target, viewport);
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const scale = metrics.unitScale * modelScale;
    const rotation = modelRotation(params, componentTime, params.__importBasis);
    const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform);
    const rgba = normalizedColor(color);

    gl.useProgram(resources.program);
    gl.viewport(0, 0, drawingWidth, drawingHeight);
    configureModelGl(gl);
    if (mode === "wireframe") gl.lineWidth(modelWireThickness(params));
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    gl.enableVertexAttribArray(resources.position);
    gl.vertexAttribPointer(resources.position, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(resources.mvp, false, matrices.mvp);
    gl.uniformMatrix4fv(resources.model, false, matrices.model);
    gl.uniform1f(resources.depthCutoff, modelDepthCutoff(params, mesh.bounds, matrices.model));
    gl.uniform4fv(resources.color, rgba);
    gl.uniform1f(resources.pointSize, Math.max(1, Number(params.pointSize) || 2));
    gl.drawArrays(mode === "wireframe" ? gl.LINES : gl.POINTS, 0, resources.count);
    return true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
}

function drawRawParsedWire(target, item, params = {}, componentTime = 0, color = [20, 20, 20, 220], pointBudget = 4000, viewport = null, contentTransform = {}) {
  const gl = target?.drawingContext;
  const mesh = item?.modelData;
  if (!gl || !mesh) return false;
  const passState = beginRawWebGlState(gl, "model-wire");
  let attributeStates = [];
  try {
    const resources = ensureRawWireResources(gl, item, pointBudget);
    if (!resources?.buffer || !resources.count || !resources.program) return false;
    attributeStates = captureRawWebGlAttributes(gl, passState, [resources.start, resources.end, resources.side, resources.along]);
    bindRawWebGlVertexArray(gl, passState, resources.vertexArrayOwner);
    const drawingWidth = Math.max(1, gl.drawingBufferWidth || target.width || 1);
    const drawingHeight = Math.max(1, gl.drawingBufferHeight || target.height || 1);
    const metrics = modelViewportMetrics(target, viewport);
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const scale = metrics.unitScale * modelScale;
    const rotation = modelRotation(params, componentTime, params.__importBasis);
    const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform);
    const stride = 8 * 4;

    gl.useProgram(resources.program);
    gl.viewport(0, 0, drawingWidth, drawingHeight);
    configureModelGl(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    gl.enableVertexAttribArray(resources.start);
    gl.vertexAttribPointer(resources.start, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(resources.end);
    gl.vertexAttribPointer(resources.end, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(resources.side);
    gl.vertexAttribPointer(resources.side, 1, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(resources.along);
    gl.vertexAttribPointer(resources.along, 1, gl.FLOAT, false, stride, 7 * 4);
    gl.uniformMatrix4fv(resources.mvp, false, matrices.mvp);
    gl.uniformMatrix4fv(resources.model, false, matrices.model);
    gl.uniform1f(resources.depthCutoff, modelDepthCutoff(params, mesh.bounds, matrices.model));
    gl.uniform2f(resources.resolution, drawingWidth, drawingHeight);
    gl.uniform1f(resources.thickness, resolutionScaledStrokeWidth(
      modelWireThickness(params),
      metrics,
      { width: drawingWidth, height: drawingHeight }
    ));
    gl.uniform4fv(resources.color, normalizedColor(color));
    gl.drawArrays(gl.TRIANGLES, 0, resources.count);
    return true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
}

function drawRawParsedSurface(target, item, params = {}, componentTime = 0, color = [220, 225, 220, 255], viewport = null, contentTransform = {}) {
  const gl = target?.drawingContext;
  const mesh = item?.modelData;
  if (!gl || !mesh) return false;
  const passState = beginRawWebGlState(gl, "model-surface");
  let attributeStates = [];
  try {
    const resources = ensureRawSurfaceResources(gl, item);
    if (!resources?.buffer || !resources.count || !resources.program) return false;
    attributeStates = captureRawWebGlAttributes(gl, passState, [resources.position, resources.normal]);
    bindRawWebGlVertexArray(gl, passState, resources.vertexArrayOwner);
    const drawingWidth = Math.max(1, gl.drawingBufferWidth || target.width || 1);
    const drawingHeight = Math.max(1, gl.drawingBufferHeight || target.height || 1);
    const metrics = modelViewportMetrics(target, viewport);
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const scale = metrics.unitScale * modelScale;
    const rotation = modelRotation(params, componentTime, params.__importBasis);
    const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform);
    const stride = 6 * 4;

    gl.useProgram(resources.program);
    gl.viewport(0, 0, drawingWidth, drawingHeight);
    configureModelGl(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    gl.enableVertexAttribArray(resources.position);
    gl.vertexAttribPointer(resources.position, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(resources.normal);
    gl.vertexAttribPointer(resources.normal, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.uniformMatrix4fv(resources.mvp, false, matrices.mvp);
    gl.uniformMatrix4fv(resources.model, false, matrices.model);
    gl.uniform1f(resources.depthCutoff, modelDepthCutoff(params, mesh.bounds, matrices.model));
    gl.uniform4fv(resources.color, normalizedColor(color));
    gl.drawArrays(gl.TRIANGLES, 0, resources.count);
    return true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
}

function ensureRawModelResources(gl, item, mode = "points", pointBudget = 4000) {
  const contextResources = ensureRawModelContextResources(gl, item);
  if (!rawModelProgramValid(gl, contextResources.program)) {
    disposeRawModelProgram(gl, contextResources.program);
    contextResources.program = createRawModelProgram(gl);
  }
  if (!contextResources.program) return null;
  const budget = boundedBudget(pointBudget);
  const meshKey = `${item.modelData?.triangles?.length || 0}`;
  const key = mode === "wireframe" ? `wire:${meshKey}` : `points:${meshKey}:${budget}`;
  let buffer = validCachedBuffer(gl, contextResources, key);
  if (!buffer) {
    const data = mode === "wireframe"
      ? ensureParsedModelWireLines(item, budget)
      : ensureParsedModelPointCloud(item, budget);
    if (!data?.length) return null;
    pruneRawModelBufferVariants(gl, contextResources, mode === "wireframe" ? `wire:${meshKey}` : `points:${meshKey}:`, key);
    buffer = createArrayBuffer(gl, data, 3);
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    vertexArrayOwner: buffer,
    ...contextResources.program,
    program: contextResources.program.program,
  };
}

function ensureRawSurfaceResources(gl, item) {
  const contextResources = ensureRawModelContextResources(gl, item);
  if (!rawModelProgramValid(gl, contextResources.surfaceProgram)) {
    disposeRawModelProgram(gl, contextResources.surfaceProgram);
    contextResources.surfaceProgram = createRawSurfaceProgram(gl);
  }
  if (!contextResources.surfaceProgram) return null;
  const meshKey = `${item.modelData?.triangles?.length || 0}`;
  const key = `surface:${meshKey}`;
  let buffer = validCachedBuffer(gl, contextResources, key);
  if (!buffer) {
    const data = buildParsedModelSurfaceVertices(item.modelData);
    if (!data?.length) return null;
    buffer = createArrayBuffer(gl, data, 6);
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    vertexArrayOwner: buffer,
    ...contextResources.surfaceProgram,
    program: contextResources.surfaceProgram.program,
  };
}

function ensureRawWireResources(gl, item, pointBudget = 4000) {
  const contextResources = ensureRawModelContextResources(gl, item);
  if (!rawModelProgramValid(gl, contextResources.wireProgram)) {
    disposeRawModelProgram(gl, contextResources.wireProgram);
    contextResources.wireProgram = createRawWireProgram(gl);
  }
  if (!contextResources.wireProgram) return null;
  const budget = boundedBudget(pointBudget);
  const meshKey = `${item.modelData?.triangles?.length || 0}`;
  const key = `thickWire:${meshKey}:${budget}`;
  let buffer = validCachedBuffer(gl, contextResources, key);
  if (!buffer) {
    const data = ensureParsedModelThickWireVertices(item, budget);
    if (!data?.length) return null;
    pruneRawModelBufferVariants(gl, contextResources, `thickWire:${meshKey}:`, key);
    buffer = createArrayBuffer(gl, data, 8);
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    vertexArrayOwner: buffer,
    ...contextResources.wireProgram,
    program: contextResources.wireProgram.program,
  };
}

function ensureRawModelContextResources(gl, item) {
  if (!(item.modelRawRenderers instanceof Map)) item.modelRawRenderers = new Map();
  let resources = item.modelRawRenderers.get(gl);
  if (!resources) {
    resources = { program: null, surfaceProgram: null, wireProgram: null, buffers: new Map() };
    item.modelRawRenderers.set(gl, resources);
  }
  return resources;
}

function validCachedBuffer(gl, resources, key) {
  let buffer = resources.buffers.get(key);
  if (buffer && !rawModelBufferValid(gl, buffer)) {
    disposeRawModelBuffer(gl, buffer);
    resources.buffers.delete(key);
    buffer = null;
  }
  return buffer;
}

function createArrayBuffer(gl, data, valuesPerVertex) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { buffer, count: Math.floor(data.length / valuesPerVertex) };
}

function configureModelGl(gl) {
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
}

function rawModelProgramValid(gl, resource) {
  return !!resource?.program && (typeof gl.isProgram !== "function" || gl.isProgram(resource.program));
}

function rawModelBufferValid(gl, resource) {
  const buffers = [resource?.buffer, resource?.positionBuffer, resource?.normalBuffer].filter(Boolean);
  return buffers.length > 0 && (typeof gl.isBuffer !== "function" || buffers.every((buffer) => gl.isBuffer(buffer)));
}

function pruneRawModelBufferVariants(gl, resources, prefix, keepKey) {
  for (const [key, buffer] of resources.buffers) {
    if (key !== keepKey && key.startsWith(prefix)) {
      disposeRawModelBuffer(gl, buffer);
      resources.buffers.delete(key);
    }
  }
}

function disposeRawModelBuffer(gl, resource) {
  disposeRawWebGlVertexArray(gl, resource);
  const buffers = new Set([resource?.buffer, resource?.positionBuffer, resource?.normalBuffer].filter(Boolean));
  for (const buffer of buffers) {
    try { gl.deleteBuffer(buffer); } catch {}
  }
}

function disposeRawModelProgram(gl, resource) {
  if (!resource?.program) return;
  try { gl.deleteProgram(resource.program); } catch {}
}

function createRawModelProgram(gl) {
  return createProgram(gl, {
    vertex: `
      attribute vec3 aPosition;
      uniform mat4 uMvp;
      uniform mat4 uModel;
      uniform float uPointSize;
      varying float vModelDepth;
      void main() {
        gl_Position = uMvp * vec4(aPosition, 1.0);
        vModelDepth = (uModel * vec4(aPosition, 1.0)).z;
        gl_PointSize = uPointSize;
      }
    `,
    fragment: depthFragment("gl_FragColor = uColor;"),
    attributes: ["position:aPosition"],
    uniforms: ["mvp:uMvp", "model:uModel", "color:uColor", "pointSize:uPointSize", "depthCutoff:uDepthCutoff"],
  });
}

function createRawSurfaceProgram(gl) {
  return createProgram(gl, {
    vertex: `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      uniform mat4 uMvp;
      uniform mat4 uModel;
      varying float vLight;
      varying float vModelDepth;
      void main() {
        vec3 n = normalize((uModel * vec4(aNormal, 0.0)).xyz);
        vec3 keyLight = normalize(vec3(-0.35, -0.45, 0.75));
        vLight = clamp(dot(n, keyLight) * 0.55 + 0.45, 0.0, 1.0);
        vModelDepth = (uModel * vec4(aPosition, 1.0)).z;
        gl_Position = uMvp * vec4(aPosition, 1.0);
      }
    `,
    fragment: depthFragment("gl_FragColor = vec4(uColor.rgb * vLight, uColor.a);", "varying float vLight;"),
    attributes: ["position:aPosition", "normal:aNormal"],
    uniforms: ["mvp:uMvp", "model:uModel", "color:uColor", "depthCutoff:uDepthCutoff"],
  });
}

function createRawWireProgram(gl) {
  return createProgram(gl, {
    vertex: `
      attribute vec3 aStart;
      attribute vec3 aEnd;
      attribute float aSide;
      attribute float aAlong;
      uniform mat4 uMvp;
      uniform mat4 uModel;
      uniform vec2 uResolution;
      uniform float uThickness;
      varying float vModelDepth;
      void main() {
        vec4 startClip = uMvp * vec4(aStart, 1.0);
        vec4 endClip = uMvp * vec4(aEnd, 1.0);
        float startW = abs(startClip.w) > 0.000001 ? startClip.w : 0.000001;
        float endW = abs(endClip.w) > 0.000001 ? endClip.w : 0.000001;
        vec2 startNdc = startClip.xy / startW;
        vec2 endNdc = endClip.xy / endW;
        vec2 dir = endNdc - startNdc;
        float len = length(dir);
        vec2 normal = len > 0.000001 ? vec2(-dir.y, dir.x) / len : vec2(0.0, 1.0);
        vec4 clip = mix(startClip, endClip, aAlong);
        vModelDepth = (uModel * vec4(mix(aStart, aEnd, aAlong), 1.0)).z;
        vec2 pixelToNdc = vec2(2.0 / max(1.0, uResolution.x), 2.0 / max(1.0, uResolution.y));
        clip.xy += normal * pixelToNdc * (max(0.125, uThickness) * 0.5) * aSide * clip.w;
        gl_Position = clip;
      }
    `,
    fragment: depthFragment("gl_FragColor = uColor;"),
    attributes: ["start:aStart", "end:aEnd", "side:aSide", "along:aAlong"],
    uniforms: ["mvp:uMvp", "model:uModel", "resolution:uResolution", "thickness:uThickness", "color:uColor", "depthCutoff:uDepthCutoff"],
  });
}

function createProgram(gl, { vertex, fragment, attributes = [], uniforms = [] }) {
  const vertexShader = compileRawShader(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = compileRawShader(gl, gl.FRAGMENT_SHADER, fragment);
  const program = linkSpecializedProgram(gl, vertexShader, fragmentShader);
  if (!program) return null;
  const resource = { program };
  for (const entry of attributes) {
    const [key, name] = entry.split(":");
    resource[key] = gl.getAttribLocation(program, name);
  }
  for (const entry of uniforms) {
    const [key, name] = entry.split(":");
    resource[key] = gl.getUniformLocation(program, name);
  }
  return resource;
}

function depthFragment(output, extra = "") {
  return `
    precision mediump float;
    uniform vec4 uColor;
    uniform float uDepthCutoff;
    varying float vModelDepth;
    ${extra}
    void main() {
      if (vModelDepth < uDepthCutoff) discard;
      ${output}
    }
  `;
}

function normalizedColor(color) {
  return color.map((channel) => Math.max(0, Math.min(1, Number(channel) / 255 || 0)));
}

function boundedBudget(value) {
  return Math.max(128, Math.min(50000, Math.round(Number(value) || 4000)));
}
