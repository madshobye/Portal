import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { numberType, optionalType, recordType, valueType } from "../../node-engine/node-types.js";
import { resolutionScaledStrokeWidth } from "../../render-engine/render-metrics.js";
import { buildParsedModelSurfaceVertices } from "../mesh-geometry.js";
import { ensureParsedModelPerceptualWireVertices, ensureParsedModelPointCloud, ensureParsedModelThickWireVertices, ensureParsedModelWireLines, drawWithPolygonOffset } from "../mesh-render-cache.js";
import { modelCameraFov, modelDepthCutoff, modelDepthSliceEnabled, modelFrontDepthCutoff, modelFrontDepthSliceEnabled, modelNormalMatrix, modelOutlineThickness, modelRotation, modelViewportMetrics, modelWireThickness, rawModelMatrices } from "../mesh-render-math.js";
import { MeshType, meshResourceCacheKey, modelTriangleCount } from "../mesh-types.js";
import {
  Camera3dType,
  createCamera3d,
  createMaterial3d,
  createTransform3d,
  Material3dType,
} from "../scene-types.js";
import { modelPreviewSvg } from "../mesh-preview-renderer.js";
import { compileRawShader, linkSpecializedProgram } from "../../render-engine/raw-webgl-utils.js";
import {
  beginRawWebGlState,
  bindRawWebGlVertexArray,
  captureRawWebGlAttributes,
  disposeRawWebGlVertexArray,
  rawWebGlContextGeneration,
  restoreRawWebGlState,
} from "../../render-engine/raw-webgl-state.js";
import {
  VISUAL_RENDER_PROCESS_CONTEXT_FORMAT,
  visualRenderProcessContext,
} from "../../render-engine/render-process-context.js";

const MeshRenderResultType = recordType("mesh-render-result", {
  rendered: valueType("boolean"),
  gpuBytes: numberType(),
  backend: valueType("string"),
  image: optionalType("image"),
});
const RAW_MODEL_PROGRAM_POOLS = new WeakMap();
const RETAINED_MESH_CACHE_OWNERS = new WeakMap();
const RETAINED_MESH_CACHE_ENTRIES = new WeakMap();

export function retainMeshRenderCacheOwner(mesh) {
  if (!mesh || typeof mesh !== "object") return { modelData: mesh };
  let entry = RETAINED_MESH_CACHE_OWNERS.get(mesh);
  if (!entry) {
    entry = {
      mesh,
      references: 0,
      owner: { modelData: mesh },
    };
    RETAINED_MESH_CACHE_OWNERS.set(mesh, entry);
    RETAINED_MESH_CACHE_ENTRIES.set(entry.owner, entry);
  }
  entry.references += 1;
  return entry.owner;
}

export function releaseMeshRenderCacheOwner(owner) {
  const entry = owner && typeof owner === "object"
    ? RETAINED_MESH_CACHE_ENTRIES.get(owner)
    : null;
  if (!entry) {
    disposeRawModelItemResources(owner);
    return;
  }
  entry.references = Math.max(0, entry.references - 1);
  if (entry.references > 0) return;
  disposeRawModelItemResources(entry.owner);
  RETAINED_MESH_CACHE_OWNERS.delete(entry.mesh);
  RETAINED_MESH_CACHE_ENTRIES.delete(entry.owner);
}

export const MeshRenderNode = defineNode({
  id: "core.mesh.render",
  name: "Mesh to Image",
  version: "0.1.0",
  description: "Renders a mesh with independently connectable material, transform, camera, target, and time inputs.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    mesh: { type: MeshType, required: true },
    material: { type: Material3dType, optional: true },
    transform: { type: "transform3d", optional: true },
    camera: { type: Camera3dType, optional: true },
    surfaceColor: { type: "color", defaultValue: [220, 225, 220, 255] },
    wireColor: { type: "color", defaultValue: [20, 20, 20, 220] },
  },
  parameters: {
    backend: {
      type: { type: "enum", values: ["webgl", "svg"] },
      defaultValue: "webgl",
      editor: { type: "select" },
    },
    renderMode: {
      type: { type: "enum", values: ["surface", "points", "wireframe", "surfaceWire", "outline", "surfaceOutline", "xrayOutline"] },
      defaultValue: "surface",
      editor: { type: "select" },
    },
    modelScale: { type: "number", defaultValue: 1, allowedRange: [0.01, 100], displayRange: [0.1, 5], clamp: true },
    depth: { type: "number", defaultValue: 1, allowedRange: [0.05, 20], displayRange: [0.05, 5], clamp: true },
    focalLength: { type: "number", defaultValue: 20.7846096908, allowedRange: [8, 200], displayRange: [8, 200], clamp: true },
    visibleDepth: { type: "number", defaultValue: 1, allowedRange: [0.02, 1], displayRange: [0.02, 1], clamp: true },
    frontCut: { type: "number", defaultValue: 0, allowedRange: [0, 0.98], displayRange: [0, 0.98], clamp: true },
    wireThickness: { type: "number", defaultValue: 1, allowedRange: [0.5, 12], displayRange: [0.5, 12], clamp: true },
    pointBudget: { type: "number", defaultValue: 4000, allowedRange: [128, 75000], displayRange: [128, 75000], clamp: true },
  },
  outlets: {
    image: { type: optionalType("image") },
    texture: { type: "texture" },
    result: { type: MeshRenderResultType },
  },
  execution: {
    trigger: "frame",
    domain: "main",
    stateful: true,
    asynchronous: false,
    dispose(instance) {
      if (instance.state.cacheOwner) disposeRawModelItemResources(instance.state.cacheOwner);
    },
  },
  capabilities: ["mesh-rendering", "produces-image", "gpu", "graph-placeable", "live-fast-path", "composable-render-operation"],
  presentation: { catalogs: ["graph", "mesh", "render"], placeableOn: ["node-graph"], previewOutput: "image" },
  metadata: {
    renderProcessContext: VISUAL_RENDER_PROCESS_CONTEXT_FORMAT,
    renderTarget: { depth: true },
  },
  parts: [
    {
      id: "mesh-render-algorithm",
      name: "Mesh render algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "drawRawParsedModelMode",
      source: drawRawParsedModelMode.toString(),
    },
    {
      id: "mesh-svg-renderer",
      name: "Mesh SVG renderer",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: new URL("../mesh-preview-renderer.js", import.meta.url).href,
      export: "modelPreviewSvg",
      source: modelPreviewSvg.toString(),
    },
    {
      id: "mesh-render-shaders",
      name: "Mesh shaders",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      editable: true,
      module: import.meta.url,
      exports: ["createRawModelProgram", "createRawSurfaceProgram", "createRawWireProgram", "createRawPerceptualWireProgram"],
      source: [createRawModelProgram, createRawSurfaceProgram, createRawWireProgram, createRawPerceptualWireProgram, depthFragment]
        .map((factory) => factory.toString()).join("\n\n"),
    },
  ],
  process: renderMeshNodeProcess,
});

export function renderMeshNodeProcess(inputs = {}, context = {}) {
  const { state = {}, output = null } = context;
  const nodeOutput = output || state.nodeOutput || (state.nodeOutput = {
    image: null,
    texture: null,
    result: {
      rendered: false,
      gpuBytes: 0,
      backend: "webgl",
      image: null,
    },
  });
  if (!nodeOutput.result) {
    nodeOutput.result = {
      rendered: false,
      gpuBytes: 0,
      backend: "webgl",
      image: null,
    };
  }
  if (inputs.backend === "svg") {
    const svg = modelPreviewSvg(inputs.mesh);
    const image = state.svgImage || (state.svgImage = { kind: "svg", data: "", width: 100, height: 100 });
    image.data = svg;
    nodeOutput.image = image;
    nodeOutput.texture = image;
    nodeOutput.result.rendered = true;
    nodeOutput.result.gpuBytes = 0;
    nodeOutput.result.backend = "svg";
    nodeOutput.result.image = image;
    return nodeOutput;
  }
  const renderProcess = visualRenderProcessContext(context);
  const target = renderProcess.target;
  if (!renderProcess.cacheOwner && (!state.cacheOwner || state.mesh !== inputs.mesh)) {
    if (state.cacheOwner) disposeRawModelItemResources(state.cacheOwner);
    state.mesh = inputs.mesh;
    state.cacheOwner = { modelData: inputs.mesh };
  }
  const cacheOwner = renderProcess.cacheOwner || state.cacheOwner;
  const material = inputs.material?.kind === "material3d" ? inputs.material : null;
  if (renderProcess.clear) target?.clear?.();
  const params = state.renderParams || (state.renderParams = {});
  for (const key in inputs) params[key] = inputs[key];
  params.pointBudget = boundedBudget(material?.pointBudget ?? inputs.pointBudget);
  params.visibleDepth = material?.visibleDepth ?? inputs.visibleDepth;
  params.frontCut = material?.frontCut ?? inputs.frontCut;
  params.wireThickness = material?.wireThickness ?? inputs.wireThickness;
  params.edgeAngle = material?.edgeAngle ?? inputs.edgeAngle;
  params.edgeBudget = material?.edgeBudget ?? inputs.edgeBudget;
  params.renderQuality = material?.renderQuality ?? inputs.renderQuality;
  params.__sceneTransform = inputs.transform?.kind === "transform3d"
    ? inputs.transform
    : state.defaultTransform || (state.defaultTransform = createTransform3d());
  params.__sceneCamera = inputs.camera?.kind === "camera3d"
    ? inputs.camera
    : state.defaultCamera || (state.defaultCamera = createCamera3d());
  params.__material = material || state.defaultMaterial || (state.defaultMaterial = createMaterial3d({
      renderMode: inputs.renderMode,
      surfaceColor: inputs.surfaceColor,
      wireColor: inputs.wireColor,
      wireThickness: inputs.wireThickness,
      pointBudget: inputs.pointBudget,
      visibleDepth: inputs.visibleDepth,
      frontCut: inputs.frontCut,
    }));
  const rendered = drawRawParsedModelMode(
    target,
    cacheOwner,
    params,
    renderProcess.time,
    material?.renderMode ?? inputs.renderMode,
    material?.surfaceColor ?? inputs.surfaceColor,
    material?.wireColor ?? inputs.wireColor,
    params.pointBudget,
    renderProcess.view || renderProcess.request,
    renderProcess.contentTransform || {},
    inputs.mesh,
  );
  const image = target;
  nodeOutput.image = image;
  nodeOutput.texture = image;
  nodeOutput.result.rendered = rendered;
  nodeOutput.result.gpuBytes = estimateRawModelItemGpuBytes(cacheOwner);
  nodeOutput.result.backend = "webgl";
  nodeOutput.result.image = image;
  return nodeOutput;
}

export function drawRawParsedModelMode(target, item, params = {}, componentTime = 0, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220], pointBudget = 4000, viewport = null, contentTransform = {}, mesh = item?.modelData) {
  if (renderMode === "points") {
    return drawRawParsedModel(target, item, params, componentTime, "points", wireColor, pointBudget, viewport, contentTransform, mesh);
  }
  if (renderMode === "wireframe") {
    return drawRawParsedWire(target, item, params, componentTime, wireColor, pointBudget, viewport, contentTransform, mesh);
  }
  if (renderMode === "xrayOutline") {
    return drawRawParsedPerceptualEdges(target, item, params, componentTime, wireColor, pointBudget, viewport, contentTransform, mesh, false);
  }
  const perceptualEdges = renderMode === "outline" || renderMode === "surfaceOutline";
  const lineOverlay = renderMode === "surfaceWire" || perceptualEdges;
  const depthOnlySurface = renderMode === "outline" ? [0, 0, 0, 0] : surfaceColor;
  const drewSurface = drawWithPolygonOffset(target, lineOverlay, () => (
    drawRawParsedSurface(target, item, params, componentTime, depthOnlySurface, viewport, contentTransform, mesh)
  ));
  if (drewSurface && renderMode === "surfaceWire") {
    drawRawParsedWire(target, item, params, componentTime, wireColor, pointBudget, viewport, contentTransform, mesh);
  }
  if (!drewSurface) return false;
  if (perceptualEdges) {
    return drawRawParsedPerceptualEdges(target, item, params, componentTime, wireColor, pointBudget, viewport, contentTransform, mesh);
  }
  return true;
}

export function disposeRawModelContextResources(gl, resources) {
  for (const buffer of resources?.buffers?.values?.() || []) disposeRawModelBuffer(gl, buffer);
  resources?.buffers?.clear?.();
  if (resources?.programPool) {
    releaseRawModelProgramPool(gl, resources.programPool);
    resources.programPool = null;
    return;
  }
  // Serialized/legacy cache owners may still contain the former per-mesh
  // program fields. Dispose those only at this migration boundary.
  disposeRawModelProgram(gl, resources?.program);
  disposeRawModelProgram(gl, resources?.surfaceProgram);
  for (const program of resources?.surfacePrograms?.values?.() || []) disposeRawModelProgram(gl, program);
  resources?.surfacePrograms?.clear?.();
  disposeRawModelProgram(gl, resources?.wireProgram);
  disposeRawModelProgram(gl, resources?.perceptualWireProgram);
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

export function estimateRawModelItemGpuBytes(item) {
  let total = 0;
  for (const resources of item?.modelRawRenderers?.values?.() || []) {
    for (const buffer of resources?.buffers?.values?.() || []) total += Math.max(0, Number(buffer?.byteLength) || 0);
  }
  return total;
}

function drawRawParsedModel(target, item, params = {}, componentTime = 0, mode = "points", color = [245, 245, 245, 255], pointBudget = 4000, viewport = null, contentTransform = {}, mesh = item?.modelData) {
  const gl = target?.drawingContext;
  if (!gl || !mesh) return false;
  const passState = beginRawWebGlState(gl, `model-${mode}`);
  let attributeStates = [];
  try {
    const resources = ensureRawModelResources(gl, item, mode, pointBudget, mesh);
    if (!resources?.buffer || !resources.count || !resources.program) return false;
    attributeStates = captureRawWebGlAttributes(gl, passState, [resources.position]);
    bindRawWebGlVertexArray(gl, passState, resources.vertexArrayOwner);
    const { width: drawingWidth, height: drawingHeight } = rawModelTargetPixelSize(target);
    const metrics = modelViewportMetrics(target, viewport);
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const scale = metrics.unitScale * modelScale;
    const rotation = modelRotation(params, componentTime, params.__importBasis);
    const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform, modelCameraFov(params), metrics.uvRect, params.__sceneTransform, params.__sceneCamera);
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
    setDepthSliceUniforms(gl, resources, params, mesh.bounds, matrices.model);
    gl.uniform4fv(resources.color, rgba);
    gl.uniform1f(resources.pointSize, resolutionScaledStrokeWidth(
      modelWireThickness(params),
      metrics,
      { width: drawingWidth, height: drawingHeight }
    ));
    gl.drawArrays(mode === "wireframe" ? gl.LINES : gl.POINTS, 0, resources.count);
    return true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
}

function drawRawParsedWire(target, item, params = {}, componentTime = 0, color = [20, 20, 20, 220], pointBudget = 4000, viewport = null, contentTransform = {}, mesh = item?.modelData) {
  const gl = target?.drawingContext;
  if (!gl || !mesh) return false;
  const passState = beginRawWebGlState(gl, "model-wire");
  let attributeStates = [];
  try {
    // Wireframe is a render pass over the LOD selected by Geometry Detail.
    // Never replace that topology with a separately sampled "wire mesh".
    const completeLineBudget = modelTriangleCount(mesh) * 3;
    const resources = ensureRawWireResources(gl, item, completeLineBudget, mesh);
    if (!resources?.buffer || !resources.count || !resources.program) return false;
    attributeStates = captureRawWebGlAttributes(gl, passState, [resources.start, resources.end, resources.side, resources.along]);
    bindRawWebGlVertexArray(gl, passState, resources.vertexArrayOwner);
    const { width: drawingWidth, height: drawingHeight } = rawModelTargetPixelSize(target);
    const metrics = modelViewportMetrics(target, viewport);
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const scale = metrics.unitScale * modelScale;
    const rotation = modelRotation(params, componentTime, params.__importBasis);
    const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform, modelCameraFov(params), metrics.uvRect, params.__sceneTransform, params.__sceneCamera);
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
    setDepthSliceUniforms(gl, resources, params, mesh.bounds, matrices.model);
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

function drawRawParsedPerceptualEdges(target, item, params = {}, componentTime = 0, color = [20, 20, 20, 220], pointBudget = 4000, viewport = null, contentTransform = {}, mesh = item?.modelData, depthTest = true) {
  const gl = target?.drawingContext;
  if (!gl || !mesh) return false;
  const passState = beginRawWebGlState(gl, "model-perceptual-edges");
  let attributeStates = [];
  try {
    const requestedEdgeBudget = Number(params.edgeBudget);
    const edgeBudget = Number.isFinite(requestedEdgeBudget)
      ? requestedEdgeBudget
      : Math.max(20000, pointBudget);
    const resources = ensureRawPerceptualWireResources(gl, item, edgeBudget, mesh);
    if (!resources?.buffer || !resources.count || !resources.program) return false;
    attributeStates = captureRawWebGlAttributes(gl, passState, [
      resources.start,
      resources.end,
      resources.normalA,
      resources.normalB,
      resources.boundary,
      resources.side,
      resources.along,
    ]);
    bindRawWebGlVertexArray(gl, passState, resources.vertexArrayOwner);
    const { width: drawingWidth, height: drawingHeight } = rawModelTargetPixelSize(target);
    const metrics = modelViewportMetrics(target, viewport);
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const scale = metrics.unitScale * modelScale;
    const rotation = modelRotation(params, componentTime, params.__importBasis);
    const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform, modelCameraFov(params), metrics.uvRect, params.__sceneTransform, params.__sceneCamera);
    const stride = 15 * 4;
    const requestedAngle = Number(params.edgeAngle);
    const edgeAngle = Math.max(0, Math.min(180, Number.isFinite(requestedAngle) ? requestedAngle : 35));

    gl.useProgram(resources.program);
    gl.viewport(0, 0, drawingWidth, drawingHeight);
    configureModelGl(gl);
    if (!depthTest) gl.disable(gl.DEPTH_TEST);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    bindFloatAttribute(gl, resources.start, 3, stride, 0);
    bindFloatAttribute(gl, resources.end, 3, stride, 3 * 4);
    bindFloatAttribute(gl, resources.normalA, 3, stride, 6 * 4);
    bindFloatAttribute(gl, resources.normalB, 3, stride, 9 * 4);
    bindFloatAttribute(gl, resources.boundary, 1, stride, 12 * 4);
    bindFloatAttribute(gl, resources.side, 1, stride, 13 * 4);
    bindFloatAttribute(gl, resources.along, 1, stride, 14 * 4);
    gl.uniformMatrix4fv(resources.mvp, false, matrices.mvp);
    gl.uniformMatrix4fv(resources.model, false, matrices.model);
    gl.uniformMatrix3fv(resources.normalMatrix, false, modelNormalMatrix(matrices.model));
    setDepthSliceUniforms(gl, resources, params, mesh.bounds, matrices.model);
    gl.uniform2f(resources.resolution, drawingWidth, drawingHeight);
    gl.uniform1f(resources.thickness, resolutionScaledStrokeWidth(
      modelOutlineThickness(params),
      metrics,
      { width: drawingWidth, height: drawingHeight }
    ));
    gl.uniform3f(resources.cameraPosition, 0, 0, metrics.cameraZ);
    gl.uniform1f(resources.creaseCos, Math.cos(edgeAngle * Math.PI / 180));
    gl.uniform4fv(resources.color, normalizedColor(color));
    gl.drawArrays(gl.TRIANGLES, 0, resources.count);
    return true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
}

function drawRawParsedSurface(target, item, params = {}, componentTime = 0, color = [220, 225, 220, 255], viewport = null, contentTransform = {}, mesh = item?.modelData) {
  const gl = target?.drawingContext;
  if (!gl || !mesh) return false;
  const passState = beginRawWebGlState(gl, "model-surface");
  let attributeStates = [];
  try {
    const resources = ensureRawSurfaceResources(gl, item, mesh, params.__material);
    if (!resources?.buffer || !resources.count || !resources.program) return false;
    attributeStates = captureRawWebGlAttributes(gl, passState, [resources.position, resources.normal]);
    bindRawWebGlVertexArray(gl, passState, resources.vertexArrayOwner);
    const { width: drawingWidth, height: drawingHeight } = rawModelTargetPixelSize(target);
    const metrics = modelViewportMetrics(target, viewport);
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const scale = metrics.unitScale * modelScale;
    const rotation = modelRotation(params, componentTime, params.__importBasis);
    const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform, modelCameraFov(params), metrics.uvRect, params.__sceneTransform, params.__sceneCamera);
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
    gl.uniformMatrix3fv(resources.normalMatrix, false, modelNormalMatrix(matrices.model));
    setDepthSliceUniforms(gl, resources, params, mesh.bounds, matrices.model);
    gl.uniform4fv(resources.color, normalizedColor(color));
    setMaterialUniforms(gl, resources, params.__material);
    gl.drawArrays(gl.TRIANGLES, 0, resources.count);
    return true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
}

function ensureRawModelResources(gl, item, mode = "points", pointBudget = 4000, mesh = item?.modelData) {
  const contextResources = ensureRawModelContextResources(gl, item);
  const programs = contextResources.programPool;
  if (!rawModelProgramValid(gl, programs.program)) {
    disposeRawModelProgram(gl, programs.program);
    programs.program = createRawModelProgram(gl);
  }
  if (!programs.program) return null;
  const budget = boundedBudget(pointBudget);
  const meshKey = meshResourceCacheKey(mesh);
  const key = mode === "wireframe" ? `wire:${meshKey}` : `points:${meshKey}:${budget}`;
  let buffer = validCachedBuffer(gl, contextResources, key);
  if (!buffer) {
    const data = mode === "wireframe"
      ? ensureParsedModelWireLines(item, budget, mesh)
      : ensureParsedModelPointCloud(item, budget, mesh);
    if (!data?.length) return null;
    pruneRawModelBufferVariants(gl, contextResources, mode === "wireframe" ? "wire:" : "points:", key);
    buffer = createArrayBuffer(gl, data, 3);
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    vertexArrayOwner: buffer,
    ...programs.program,
    program: programs.program.program,
  };
}

function ensureRawSurfaceResources(gl, item, mesh = item?.modelData, material = null) {
  const contextResources = ensureRawModelContextResources(gl, item);
  const programs = contextResources.programPool;
  if (!(programs.surfacePrograms instanceof Map)) programs.surfacePrograms = new Map();
  const materialKey = material?.shader?.source
    ? `${material.id}@${material.version}:${sourceHash(material.shader.source)}`
    : "builtin";
  let surfaceProgram = materialKey === "builtin"
    ? programs.surfaceProgram
    : programs.surfacePrograms.get(materialKey);
  if (!rawModelProgramValid(gl, surfaceProgram)) {
    disposeRawModelProgram(gl, surfaceProgram);
    surfaceProgram = createRawSurfaceProgram(gl, material);
    if (materialKey === "builtin") programs.surfaceProgram = surfaceProgram;
    else if (surfaceProgram) programs.surfacePrograms.set(materialKey, surfaceProgram);
    else programs.surfacePrograms.delete(materialKey);
  }
  if (!surfaceProgram) return null;
  const meshKey = meshResourceCacheKey(mesh);
  const key = `surface:${meshKey}`;
  let buffer = validCachedBuffer(gl, contextResources, key);
  if (!buffer) {
    const data = buildParsedModelSurfaceVertices(mesh);
    if (!data?.length) return null;
    pruneRawModelBufferVariants(gl, contextResources, "surface:", key);
    buffer = createArrayBuffer(gl, data, 6);
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    vertexArrayOwner: buffer,
    ...surfaceProgram,
    program: surfaceProgram.program,
  };
}

function ensureRawWireResources(gl, item, pointBudget = 4000, mesh = item?.modelData) {
  const contextResources = ensureRawModelContextResources(gl, item);
  const programs = contextResources.programPool;
  if (!rawModelProgramValid(gl, programs.wireProgram)) {
    disposeRawModelProgram(gl, programs.wireProgram);
    programs.wireProgram = createRawWireProgram(gl);
  }
  if (!programs.wireProgram) return null;
  const budget = completeWireBudget(pointBudget);
  const meshKey = meshResourceCacheKey(mesh);
  const key = `thickWire:${meshKey}:${budget}`;
  let buffer = validCachedBuffer(gl, contextResources, key);
  if (!buffer) {
    const data = ensureParsedModelThickWireVertices(item, budget, mesh);
    if (!data?.length) return null;
    pruneRawModelBufferVariants(gl, contextResources, "thickWire:", key);
    buffer = createArrayBuffer(gl, data, 8);
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    vertexArrayOwner: buffer,
    ...programs.wireProgram,
    program: programs.wireProgram.program,
  };
}

function ensureRawPerceptualWireResources(gl, item, pointBudget = 4000, mesh = item?.modelData) {
  const contextResources = ensureRawModelContextResources(gl, item);
  const programs = contextResources.programPool;
  if (!rawModelProgramValid(gl, programs.perceptualWireProgram)) {
    disposeRawModelProgram(gl, programs.perceptualWireProgram);
    programs.perceptualWireProgram = createRawPerceptualWireProgram(gl);
  }
  if (!programs.perceptualWireProgram) return null;
  const budget = boundedBudget(pointBudget);
  const meshKey = meshResourceCacheKey(mesh);
  const key = `perceptualWire:${meshKey}:${budget}`;
  let buffer = validCachedBuffer(gl, contextResources, key);
  if (!buffer) {
    const data = ensureParsedModelPerceptualWireVertices(item, budget, mesh);
    if (!data?.length) return null;
    pruneRawModelBufferVariants(gl, contextResources, "perceptualWire:", key);
    buffer = createArrayBuffer(gl, data, 15);
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    vertexArrayOwner: buffer,
    ...programs.perceptualWireProgram,
    program: programs.perceptualWireProgram.program,
  };
}

function ensureRawModelContextResources(gl, item) {
  if (!(item.modelRawRenderers instanceof Map)) item.modelRawRenderers = new Map();
  let resources = item.modelRawRenderers.get(gl);
  const generation = rawWebGlContextGeneration(gl);
  if (!resources || resources.generation !== generation) {
    resources = {
      generation,
      programPool: acquireRawModelProgramPool(gl),
      buffers: new Map(),
    };
    item.modelRawRenderers.set(gl, resources);
  }
  return resources;
}

// Programs are context-wide because compilation depends on WebGL context and
// material source. Vertex buffers remain owned by each canonical Mesh cache.
export function acquireRawModelProgramPool(gl) {
  let pool = RAW_MODEL_PROGRAM_POOLS.get(gl);
  const generation = rawWebGlContextGeneration(gl);
  if (!pool || pool.generation !== generation) {
    pool = {
      generation,
      references: 0,
      program: null,
      surfaceProgram: null,
      surfacePrograms: new Map(),
      wireProgram: null,
      perceptualWireProgram: null,
    };
    RAW_MODEL_PROGRAM_POOLS.set(gl, pool);
  }
  pool.references += 1;
  return pool;
}

export function releaseRawModelProgramPool(gl, pool) {
  if (!pool) return;
  pool.references = Math.max(0, Number(pool.references) - 1);
  if (pool.references > 0) return;
  disposeRawModelProgram(gl, pool.program);
  disposeRawModelProgram(gl, pool.surfaceProgram);
  for (const program of pool.surfacePrograms.values()) disposeRawModelProgram(gl, program);
  pool.surfacePrograms.clear();
  disposeRawModelProgram(gl, pool.wireProgram);
  disposeRawModelProgram(gl, pool.perceptualWireProgram);
  if (RAW_MODEL_PROGRAM_POOLS.get(gl) === pool) RAW_MODEL_PROGRAM_POOLS.delete(gl);
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
  return {
    buffer,
    generation: rawWebGlContextGeneration(gl),
    count: Math.floor(data.length / valuesPerVertex),
    byteLength: data.byteLength || 0,
  };
}

function bindFloatAttribute(gl, location, size, stride, offset) {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
}

function configureModelGl(gl) {
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
}

function rawModelProgramValid(gl, resource) {
  return !!resource?.program &&
    resource.generation === rawWebGlContextGeneration(gl);
}

function rawModelBufferValid(gl, resource) {
  const buffers = [resource?.buffer, resource?.positionBuffer, resource?.normalBuffer].filter(Boolean);
  return buffers.length > 0 &&
    resource.generation === rawWebGlContextGeneration(gl);
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
    uniforms: [
      "mvp:uMvp",
      "model:uModel",
      "color:uColor",
      "pointSize:uPointSize",
      "depthCutoff:uDepthCutoff",
      "depthSliceEnabled:uDepthSliceEnabled",
      "frontDepthCutoff:uFrontDepthCutoff",
      "frontDepthSliceEnabled:uFrontDepthSliceEnabled",
    ],
  });
}

function createRawSurfaceProgram(gl, material = null) {
  const materialSource = String(material?.shader?.source || "").trim();
  const materialUniforms = material?.shader?.uniforms || {};
  const custom = !!materialSource;
  return createProgram(gl, {
    vertex: `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      uniform mat4 uMvp;
      uniform mat4 uModel;
      uniform mat3 uNormalMatrix;
      varying float vLight;
      varying float vModelDepth;
      ${custom ? "varying vec3 vSurfaceNormal; varying vec3 vSurfacePosition;" : ""}
      void main() {
        vec3 n = normalize(uNormalMatrix * aNormal);
        vec3 keyLight = normalize(vec3(-0.35, -0.45, 0.75));
        vLight = clamp(dot(n, keyLight) * 0.55 + 0.45, 0.0, 1.0);
        vModelDepth = (uModel * vec4(aPosition, 1.0)).z;
        ${custom ? "vSurfaceNormal = n; vSurfacePosition = (uModel * vec4(aPosition, 1.0)).xyz;" : ""}
        gl_Position = uMvp * vec4(aPosition, 1.0);
      }
    `,
    fragment: depthFragment(
      custom
        ? "gl_FragColor = vj1Surface(normalize(vSurfaceNormal), vSurfacePosition, vec2(0.0), uColor);"
        : "gl_FragColor = vec4(uColor.rgb * vLight, uColor.a);",
      custom
        ? `varying float vLight;
           varying vec3 vSurfaceNormal;
           varying vec3 vSurfacePosition;
           ${Object.entries(materialUniforms).map(([id, spec]) => `uniform ${spec.type} ${id};`).join("\n")}
           ${materialSource}`
        : "varying float vLight;"
    ),
    attributes: ["position:aPosition", "normal:aNormal"],
    uniforms: [
      "mvp:uMvp",
      "model:uModel",
      "normalMatrix:uNormalMatrix",
      "color:uColor",
      "depthCutoff:uDepthCutoff",
      "depthSliceEnabled:uDepthSliceEnabled",
      "frontDepthCutoff:uFrontDepthCutoff",
      "frontDepthSliceEnabled:uFrontDepthSliceEnabled",
    ],
    extraUniforms: Object.keys(materialUniforms),
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
    uniforms: [
      "mvp:uMvp",
      "model:uModel",
      "resolution:uResolution",
      "thickness:uThickness",
      "color:uColor",
      "depthCutoff:uDepthCutoff",
      "depthSliceEnabled:uDepthSliceEnabled",
      "frontDepthCutoff:uFrontDepthCutoff",
      "frontDepthSliceEnabled:uFrontDepthSliceEnabled",
    ],
  });
}

function createRawPerceptualWireProgram(gl) {
  return createProgram(gl, {
    vertex: `
      attribute vec3 aStart;
      attribute vec3 aEnd;
      attribute vec3 aNormalA;
      attribute vec3 aNormalB;
      attribute float aBoundary;
      attribute float aSide;
      attribute float aAlong;
      uniform mat4 uMvp;
      uniform mat4 uModel;
      uniform mat3 uNormalMatrix;
      uniform vec2 uResolution;
      uniform float uThickness;
      uniform vec3 uCameraPosition;
      uniform float uCreaseCos;
      varying float vModelDepth;
      varying float vVisible;
      varying float vEdgeDistance;
      varying float vHalfWidth;
      void main() {
        vec4 startClip = uMvp * vec4(aStart, 1.0);
        vec4 endClip = uMvp * vec4(aEnd, 1.0);
        float startW = abs(startClip.w) > 0.000001 ? startClip.w : 0.000001;
        float endW = abs(endClip.w) > 0.000001 ? endClip.w : 0.000001;
        vec2 startNdc = startClip.xy / startW;
        vec2 endNdc = endClip.xy / endW;
        vec2 direction = endNdc - startNdc;
        float lineLength = length(direction);
        vec2 screenDirection = lineLength > 0.000001 ? direction / lineLength : vec2(1.0, 0.0);
        vec2 screenNormal = vec2(-screenDirection.y, screenDirection.x);

        vec3 normalA = normalize(uNormalMatrix * aNormalA);
        vec3 normalB = normalize(uNormalMatrix * aNormalB);
        vec3 midpoint = (uModel * vec4((aStart + aEnd) * 0.5, 1.0)).xyz;
        vec3 viewDirection = normalize(uCameraPosition - midpoint);
        float facingA = dot(normalA, viewDirection);
        float facingB = dot(normalB, viewDirection);
        float hasTwoFaces = step(0.0001, length(normalA - normalB));
        float silhouette = (1.0 - step(0.000001, facingA * facingB)) * hasTwoFaces;
        float crease = (1.0 - step(uCreaseCos, dot(normalA, normalB))) * hasTwoFaces;
        vVisible = max(aBoundary, max(silhouette, crease));

        vec4 clip = mix(startClip, endClip, aAlong);
        vModelDepth = (uModel * vec4(mix(aStart, aEnd, aAlong), 1.0)).z;
        vec2 pixelToNdc = vec2(2.0 / max(1.0, uResolution.x), 2.0 / max(1.0, uResolution.y));
        vHalfWidth = max(0.125, uThickness) * 0.5;
        float expandedHalfWidth = vHalfWidth + 0.75;
        vEdgeDistance = aSide * expandedHalfWidth;
        clip.xy += screenNormal * pixelToNdc * expandedHalfWidth * aSide * clip.w;
        // Perceptual contours are assembled from independent mesh edges. A
        // half-width cap overlap closes sub-pixel cracks at their shared
        // vertices without requiring CPU-side path reconstruction.
        clip.xy += screenDirection * pixelToNdc * expandedHalfWidth * (aAlong * 2.0 - 1.0) * clip.w;
        gl_Position = clip;
      }
    `,
    fragment: depthFragment(`
      if (vVisible < 0.5) discard;
      float coverage = 1.0 - smoothstep(max(0.0, vHalfWidth - 0.75), vHalfWidth + 0.75, abs(vEdgeDistance));
      gl_FragColor = uColor * coverage;
    `, "varying float vVisible; varying float vEdgeDistance; varying float vHalfWidth;"),
    attributes: [
      "start:aStart",
      "end:aEnd",
      "normalA:aNormalA",
      "normalB:aNormalB",
      "boundary:aBoundary",
      "side:aSide",
      "along:aAlong",
    ],
    uniforms: [
      "mvp:uMvp",
      "model:uModel",
      "normalMatrix:uNormalMatrix",
      "resolution:uResolution",
      "thickness:uThickness",
      "cameraPosition:uCameraPosition",
      "creaseCos:uCreaseCos",
      "color:uColor",
      "depthCutoff:uDepthCutoff",
      "depthSliceEnabled:uDepthSliceEnabled",
      "frontDepthCutoff:uFrontDepthCutoff",
      "frontDepthSliceEnabled:uFrontDepthSliceEnabled",
    ],
  });
}

function createProgram(gl, { vertex, fragment, attributes = [], uniforms = [], extraUniforms = [] }) {
  const vertexShader = compileRawShader(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = compileRawShader(gl, gl.FRAGMENT_SHADER, fragment);
  const program = linkSpecializedProgram(gl, vertexShader, fragmentShader);
  if (!program) return null;
  const resource = {
    program,
    generation: rawWebGlContextGeneration(gl),
  };
  for (const entry of attributes) {
    const [key, name] = entry.split(":");
    resource[key] = gl.getAttribLocation(program, name);
  }
  for (const entry of uniforms) {
    const [key, name] = entry.split(":");
    resource[key] = gl.getUniformLocation(program, name);
  }
  resource.materialUniforms = Object.freeze(Object.fromEntries(extraUniforms.map((name) => [
    name,
    gl.getUniformLocation(program, name),
  ])));
  return resource;
}

function depthFragment(output, extra = "") {
  return `
    precision highp float;
    uniform vec4 uColor;
    uniform float uDepthCutoff;
    uniform float uDepthSliceEnabled;
    uniform float uFrontDepthCutoff;
    uniform float uFrontDepthSliceEnabled;
    varying float vModelDepth;
    ${extra}
    void main() {
      if (uDepthSliceEnabled > 0.5 && vModelDepth < uDepthCutoff) discard;
      if (uFrontDepthSliceEnabled > 0.5 && vModelDepth > uFrontDepthCutoff) discard;
      ${output}
    }
  `;
}

function setDepthSliceUniforms(gl, resources, params, bounds, modelMatrix) {
  gl.uniform1f(resources.depthCutoff, modelDepthCutoff(params, bounds, modelMatrix));
  gl.uniform1f(resources.depthSliceEnabled, modelDepthSliceEnabled(params) ? 1 : 0);
  gl.uniform1f(resources.frontDepthCutoff, modelFrontDepthCutoff(params, bounds, modelMatrix));
  gl.uniform1f(resources.frontDepthSliceEnabled, modelFrontDepthSliceEnabled(params) ? 1 : 0);
}

function normalizedColor(color) {
  return color.map((channel) => Math.max(0, Math.min(1, Number(channel) / 255 || 0)));
}

function setMaterialUniforms(gl, resources, material) {
  for (const [id, specification] of Object.entries(material?.shader?.uniforms || {})) {
    const location = resources.materialUniforms?.[id];
    if (location === null || location === undefined) continue;
    const value = specification.value;
    if (specification.type === "float") gl.uniform1f(location, Number(value) || 0);
    else if (specification.type === "int" || specification.type === "bool") gl.uniform1i(location, Math.round(Number(value) || 0));
    else if (specification.type === "vec2") gl.uniform2fv(location, value || [0, 0]);
    else if (specification.type === "vec3") gl.uniform3fv(location, value || [0, 0, 0]);
    else if (specification.type === "vec4") gl.uniform4fv(location, value || [0, 0, 0, 0]);
  }
}

function sourceHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index++) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function rawModelTargetPixelSize(target) {
  const density = Math.max(
    0.25,
    Number(target?.pixelDensity?.()) || Number(target?.__vj1PixelDensity) || 1
  );
  return {
    width: Math.max(1, Math.round((Number(target?.width) || 1) * density)),
    height: Math.max(1, Math.round((Number(target?.height) || 1) * density)),
  };
}

function boundedBudget(value) {
  return Math.max(128, Math.min(75000, Math.round(Number(value) || 4000)));
}

function completeWireBudget(value) {
  return Math.max(128, Math.round(Number(value) || 4000));
}
