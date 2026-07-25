import { isSharedFramebufferTarget } from "../shared-framebuffer-target.js?v=premultiplied-alpha-5";
import { resolutionScaledStrokeWidth } from "../component-render-layout.js?v=surface-terminology-1";
import { normalizedModelColor } from "./model-color.js?v=adaptive-component-demand-29";
import { compileRawShader, linkSpecializedProgram } from "../../libraries/render-engine/raw-webgl-utils.js";
import {
  beginRawWebGlState,
  bindRawWebGlVertexArray,
  captureRawWebGlAttributes,
  disposeRawWebGlVertexArray,
  restoreRawWebGlState,
} from "../../libraries/render-engine/raw-webgl-state.js?v=node-roi-placement-1";
import {
  TerrainNodeModuleExports,
} from "./terrain-mesh.js?v=shared-terrain-grid-math-16";
import {
  TERRAIN_SURFACE_FRAGMENT_SHADER,
  TERRAIN_SURFACE_VERTEX_SHADER,
  TERRAIN_WIRE_FRAGMENT_SHADER,
  TERRAIN_WIRE_VERTEX_SHADER,
} from "../../libraries/visual-nodes/generators/terrain-flyover/shaders.js?v=source-roi-view-3";

export function drawTerrainSurface(target, resourceCache, params, componentTime, planeWidth, planeDepth, style, sky, terrainModule = TerrainNodeModuleExports, moduleRevision = "legacy", nodeShaders = null, shaderRevision = moduleRevision) {
  const gl = target?.drawingContext;
  if (!gl) return false;
  const viewportSize = renderTargetPixelSize(target);
  const passState = beginRawWebGlState(gl, "terrain-surface");
  let attributeStates = [];
  let resources = null;
  let completed = false;
  try {
  resources = resourceCache.get(gl);
  if (resources && (resources.shaderRevision !== shaderRevision || !terrainSurfaceResourcesValid(gl, resources))) {
    disposeTerrainSurfaceResources(gl, resources);
    resourceCache.delete(gl);
    resources = null;
  }
  if (!resources) {
    resources = createTerrainSurfaceResources(gl, nodeShaders, shaderRevision);
    if (!resources) return false;
    resourceCache.set(gl, resources);
  }

  const widthCells = terrainModule.terrainTessellationSize(terrainModule.terrainGridSize(params.gridWidth), params.gridDensity);
  const depthCells = terrainModule.terrainTessellationSize(terrainModule.terrainGridSize(params.gridDepth), params.gridDensity);
  const gridMetrics = terrainModule.terrainRowMetrics(componentTime, Math.max(0, Number(params.flightSpeed) || 0), params.gridDepth, params.gridDensity, params.gridScale);
  const baseRow = Math.floor(gridMetrics.travelRows) - 1;
  attributeStates = captureRawWebGlAttributes(gl, passState, [resources.gridCoord]);
  bindRawWebGlVertexArray(gl, passState, resources);
  updateTerrainSurfaceBuffers(gl, resources, widthCells, depthCells, baseRow, terrainModule, moduleRevision);

  gl.useProgram(resources.program);
  gl.viewport(0, 0, viewportSize.width, viewportSize.height);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  if (style === 2) {
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 2);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.indexBuffer);
  gl.enableVertexAttribArray(resources.gridCoord);
  gl.vertexAttribPointer(resources.gridCoord, 2, gl.FLOAT, false, 0, 0);
  setTerrainRawUniforms(gl, resources, params, componentTime, planeWidth, planeDepth, normalizedModelColor(params.wireColor, [242, 245, 239, 255]), terrainModule);
  gl.uniform2f(resources.meshCells, widthCells, depthCells);
  gl.uniform1f(resources.gridBaseRow, baseRow);
  gl.uniform1f(resources.gridIrregularity, terrainModule.normalizedTerrainIrregularity(params.gridJitter));
  gl.uniform1f(resources.style, style);
  gl.uniform1f(resources.wireWidth, Math.max(0.05, Number(params.wireWidth) || 0.85));
  gl.uniform1f(resources.textureGrain, Math.max(0, Number(params.textureGrain) || 0));
  gl.uniform1f(resources.textureDepth, Math.max(0, Number(params.textureDepth) || 0));
  gl.uniform1f(resources.colorDirection, Math.max(-3.14, Math.min(3.14, Number(params.colorDirection) || 0)));
  gl.uniform4fv(resources.waterColor, normalizedModelColor(params.waterColor, [20, 123, 193, 255]));
  gl.uniform4fv(resources.grassColor, normalizedModelColor(params.grassColor, [35, 132, 59, 255]));
  gl.uniform4fv(resources.rockColor, normalizedModelColor(params.rockColor, [76, 64, 55, 255]));
  gl.uniform4fv(resources.snowColor, normalizedModelColor(params.snowColor, [232, 237, 241, 255]));
  gl.uniform4fv(resources.downSlopeColor, normalizedModelColor(params.downSlopeColor, [32, 42, 56, 170]));
  gl.uniform4fv(resources.directionColor, normalizedModelColor(params.directionColor, [216, 138, 66, 170]));
  gl.uniform4fv(resources.skyColor, sky);
  gl.drawElements(gl.TRIANGLES, resources.count, gl.UNSIGNED_SHORT, 0);
  completed = true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
  return completed;
}

function createTerrainSurfaceResources(gl, nodeShaders = null, shaderRevision = "legacy") {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, nodeShaders?.["terrain-surface-vertex"] || TERRAIN_SURFACE_VERTEX_SHADER);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, nodeShaders?.["terrain-surface-fragment"] || TERRAIN_SURFACE_FRAGMENT_SHADER);
  const program = linkSpecializedProgram(gl, vertex, fragment);
  if (!program) return null;
  return {
    program,
    shaderRevision,
    vertexBuffer: gl.createBuffer(),
    indexBuffer: gl.createBuffer(),
    count: 0,
    meshSizeKey: "",
    topologyKey: "",
    gridCoord: gl.getAttribLocation(program, "aGridCoord"),
    ...terrainRawUniformLocations(gl, program),
    meshCells: gl.getUniformLocation(program, "meshCells"),
    gridBaseRow: gl.getUniformLocation(program, "gridBaseRow"),
    gridIrregularity: gl.getUniformLocation(program, "gridIrregularity"),
    style: gl.getUniformLocation(program, "style"),
    wireWidth: gl.getUniformLocation(program, "wireWidth"),
    textureGrain: gl.getUniformLocation(program, "textureGrain"),
    textureDepth: gl.getUniformLocation(program, "textureDepth"),
    colorDirection: gl.getUniformLocation(program, "colorDirection"),
    waterColor: gl.getUniformLocation(program, "waterColor"),
    grassColor: gl.getUniformLocation(program, "grassColor"),
    rockColor: gl.getUniformLocation(program, "rockColor"),
    snowColor: gl.getUniformLocation(program, "snowColor"),
    downSlopeColor: gl.getUniformLocation(program, "downSlopeColor"),
    directionColor: gl.getUniformLocation(program, "directionColor"),
    skyColor: gl.getUniformLocation(program, "skyColor"),
  };
}

function terrainSurfaceResourcesValid(gl, resources) {
  if (!gl || !resources?.program || !resources?.vertexBuffer || !resources?.indexBuffer) return false;
  try {
    return gl.isProgram(resources.program) && gl.getProgramParameter(resources.program, gl.LINK_STATUS) &&
      gl.isBuffer(resources.vertexBuffer) && gl.isBuffer(resources.indexBuffer);
  } catch (error) {
    console.warn("[VJ1_TERRAIN_SURFACE_RESOURCE_CHECK_FAILED]", { fallback: "recreate terrain surface resources", message: error?.message || String(error) });
    return false;
  }
}

export function disposeTerrainSurfaceResources(gl, resources) {
  if (!gl || !resources) return;
  try {
    disposeRawWebGlVertexArray(gl, resources);
    if (resources.vertexBuffer && gl.isBuffer(resources.vertexBuffer)) gl.deleteBuffer(resources.vertexBuffer);
    if (resources.indexBuffer && gl.isBuffer(resources.indexBuffer)) gl.deleteBuffer(resources.indexBuffer);
    if (resources.program && gl.isProgram(resources.program)) gl.deleteProgram(resources.program);
  } catch {}
}

function terrainRawUniformLocations(gl, program) {
  return {
    time: gl.getUniformLocation(program, "time"),
    flightSpeed: gl.getUniformLocation(program, "flightSpeed"),
    flightMode: gl.getUniformLocation(program, "flightMode"),
    turn: gl.getUniformLocation(program, "turn"),
    altitude: gl.getUniformLocation(program, "altitude"),
    pitch: gl.getUniformLocation(program, "pitch"),
    fieldOfView: gl.getUniformLocation(program, "fieldOfView"),
    nearClip: gl.getUniformLocation(program, "nearClip"),
    farClip: gl.getUniformLocation(program, "farClip"),
    aspectRatio: gl.getUniformLocation(program, "aspectRatio"),
    lookAhead: gl.getUniformLocation(program, "lookAhead"),
    noseFollow: gl.getUniformLocation(program, "noseFollow"),
    mountainHeight: gl.getUniformLocation(program, "mountainHeight"),
    terrainScale: gl.getUniformLocation(program, "terrainScale"),
    terrainPhase: gl.getUniformLocation(program, "terrainPhase"),
    lakeLevel: gl.getUniformLocation(program, "lakeLevel"),
    viewDistance: gl.getUniformLocation(program, "viewDistance"),
    rowSpacing: gl.getUniformLocation(program, "rowSpacing"),
    globeRadius: gl.getUniformLocation(program, "globeRadius"),
    gridDensity: gl.getUniformLocation(program, "gridDensity"),
    gridCells: gl.getUniformLocation(program, "gridCells"),
    cellScale: gl.getUniformLocation(program, "cellScale"),
    planeSize: gl.getUniformLocation(program, "planeSize"),
    wireColor: gl.getUniformLocation(program, "wireColor"),
    contentPlacementMatrix: gl.getUniformLocation(program, "contentPlacementMatrix"),
    renderUvRect: gl.getUniformLocation(program, "renderUvRect"),
  };
}

function updateTerrainSurfaceBuffers(gl, resources, widthCells, depthCells, baseRow, terrainModule, moduleRevision) {
  const sizeKey = `${moduleRevision}:${widthCells}:${depthCells}`;
  if (resources.meshSizeKey !== sizeKey) {
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, terrainModule.terrainSurfaceGridVertices(widthCells, depthCells), gl.STATIC_DRAW);
    resources.meshSizeKey = sizeKey;
    resources.topologyKey = "";
  }
  const topologyKey = `${sizeKey}:${baseRow}`;
  if (resources.topologyKey !== topologyKey) {
    const indices = terrainModule.terrainSurfaceTriangleIndices(widthCells, depthCells, baseRow);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    resources.count = indices.length;
    resources.topologyKey = topologyKey;
  }
}

export function drawTerrainWireframe(target, resourceCache, params, componentTime, planeWidth, planeDepth, renderRequest = {}, terrainModule = TerrainNodeModuleExports, moduleRevision = "legacy", nodeShaders = null, shaderRevision = moduleRevision) {
  const gl = target?.drawingContext;
  if (!gl) return false;
  const viewportSize = renderTargetPixelSize(target);
  const passState = beginRawWebGlState(gl, "terrain-wire");
  let attributeStates = [];
  let resources = null;
  let completed = false;
  try {
  resources = resourceCache.get(gl);
  if (resources && (resources.shaderRevision !== shaderRevision || !terrainWireResourcesValid(gl, resources))) {
    disposeTerrainWireResources(gl, resources);
    resourceCache.delete(gl);
    resources = null;
  }
  if (!resources) {
    resources = createTerrainWireResources(gl, nodeShaders, shaderRevision);
    if (!resources) return false;
    resourceCache.set(gl, resources);
  }
  const flightSpeed = Math.max(0, Number(params.flightSpeed) || 0);
  const widthCells = terrainModule.terrainGridSize(params.gridWidth);
  const depthCells = terrainModule.terrainGridSize(params.gridDepth);
  const tessellatedWidth = terrainModule.terrainTessellationSize(widthCells, params.gridDensity);
  const tessellatedDepth = terrainModule.terrainTessellationSize(depthCells, params.gridDensity);
  const { travelRows } = terrainModule.terrainRowMetrics(componentTime, flightSpeed, depthCells, params.gridDensity, params.gridScale);
  const baseRow = Math.floor(travelRows) - 1;
  attributeStates = captureRawWebGlAttributes(gl, passState, [resources.start, resources.end, resources.side, resources.along]);
  bindRawWebGlVertexArray(gl, passState, resources);
  updateTerrainWireBuffer(gl, resources, tessellatedWidth, tessellatedDepth, terrainModule, moduleRevision);
  const wireColor = normalizedModelColor(params.wireColor, [242, 245, 239, 255]);
  gl.useProgram(resources.program);
  gl.viewport(0, 0, viewportSize.width, viewportSize.height);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  const stride = 6 * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
  gl.enableVertexAttribArray(resources.start);
  gl.vertexAttribPointer(resources.start, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(resources.end);
  gl.vertexAttribPointer(resources.end, 2, gl.FLOAT, false, stride, 2 * 4);
  gl.enableVertexAttribArray(resources.side);
  gl.vertexAttribPointer(resources.side, 1, gl.FLOAT, false, stride, 4 * 4);
  gl.enableVertexAttribArray(resources.along);
  gl.vertexAttribPointer(resources.along, 1, gl.FLOAT, false, stride, 5 * 4);
  setTerrainRawUniforms(gl, resources, params, componentTime, planeWidth, planeDepth, wireColor, terrainModule);
  gl.uniform2f(resources.meshCells, tessellatedWidth, tessellatedDepth);
  gl.uniform1f(resources.gridBaseRow, baseRow);
  gl.uniform1f(resources.gridIrregularity, terrainModule.normalizedTerrainIrregularity(params.gridJitter));
  gl.uniform2f(resources.resolution, viewportSize.width, viewportSize.height);
  gl.uniform1f(resources.thickness, resolutionScaledStrokeWidth(
    Math.max(0.5, Number(params.wireWidth) || 0.85),
    renderRequest,
    viewportSize
  ));
  gl.drawArrays(gl.TRIANGLES, 0, resources.count);
  completed = true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
  return completed;
}

function renderTargetPixelSize(target) {
  const shared = isSharedFramebufferTarget(target);
  const density = shared
    ? 1
    : Math.max(0.25, Number(target?.pixelDensity?.()) || Number(target?.__vj1PixelDensity) || 1);
  return {
    width: Math.max(1, Math.round((Number(target?.width) || 1) * density)),
    height: Math.max(1, Math.round((Number(target?.height) || 1) * density)),
  };
}

function terrainWireResourcesValid(gl, resources) {
  if (!gl || !resources?.program || !resources?.vertexBuffer) return false;
  try {
    return gl.isProgram(resources.program) &&
      gl.getProgramParameter(resources.program, gl.LINK_STATUS) &&
      gl.isBuffer(resources.vertexBuffer);
  } catch (error) {
    console.warn("[VJ1_TERRAIN_WIRE_RESOURCE_CHECK_FAILED]", { fallback: "recreate terrain wire resources", message: error?.message || String(error) });
    return false;
  }
}

export function disposeTerrainWireResources(gl, resources) {
  if (!gl || !resources) return;
  try {
    disposeRawWebGlVertexArray(gl, resources);
    if (resources.vertexBuffer && gl.isBuffer(resources.vertexBuffer)) gl.deleteBuffer(resources.vertexBuffer);
    if (resources.program && gl.isProgram(resources.program)) gl.deleteProgram(resources.program);
  } catch {}
}

function createTerrainWireResources(gl, nodeShaders = null, shaderRevision = "legacy") {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, nodeShaders?.["terrain-wire-vertex"] || TERRAIN_WIRE_VERTEX_SHADER);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, nodeShaders?.["terrain-wire-fragment"] || TERRAIN_WIRE_FRAGMENT_SHADER);
  const program = linkSpecializedProgram(gl, vertex, fragment);
  if (!program) return null;
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, 0, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return {
    program,
    shaderRevision,
    vertexBuffer,
    count: 0,
    meshKey: "",
    start: gl.getAttribLocation(program, "aStart"),
    end: gl.getAttribLocation(program, "aEnd"),
    side: gl.getAttribLocation(program, "aSide"),
    along: gl.getAttribLocation(program, "aAlong"),
    ...terrainRawUniformLocations(gl, program),
    meshCells: gl.getUniformLocation(program, "meshCells"),
    gridBaseRow: gl.getUniformLocation(program, "gridBaseRow"),
    gridIrregularity: gl.getUniformLocation(program, "gridIrregularity"),
    resolution: gl.getUniformLocation(program, "resolution"),
    thickness: gl.getUniformLocation(program, "thickness"),
  };
}

function updateTerrainWireBuffer(gl, resources, widthCells, depthCells, terrainModule, moduleRevision) {
  const meshKey = `${moduleRevision}:${widthCells}:${depthCells}`;
  if (resources.meshKey === meshKey) return;
  const vertices = terrainModule.terrainExpandedGridWireVertices(widthCells, depthCells);
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  resources.count = vertices.length / 6;
  resources.meshKey = meshKey;
}

function setTerrainRawUniforms(gl, resources, params, componentTime, planeWidth, planeDepth, wireColor, terrainModule) {
  gl.uniform1f(resources.time, componentTime);
  gl.uniform1f(resources.flightSpeed, Math.max(0, Number(params.flightSpeed) || 0));
  gl.uniform1f(resources.flightMode, params.flightMode === "terrainFollow" ? 1 : 0);
  gl.uniform1f(resources.turn, Math.max(-1, Math.min(1, Number(params.turn) || 0)));
  gl.uniform1f(resources.altitude, Math.max(0.2, Number(params.altitude) || 2.5));
  gl.uniform1f(resources.pitch, Math.max(-1.4, Number(params.pitch) || 0.28));
  gl.uniform1f(resources.fieldOfView, Math.max(20, Math.min(120, Number(params.fieldOfView) || 60)));
  gl.uniform1f(resources.nearClip, terrainModule.terrainSafeNearDistance(params));
  gl.uniform1f(resources.farClip, Math.max(100, Number(params.farClip) || 20000));
  gl.uniform1f(resources.aspectRatio, planeWidth / Math.max(1, planeDepth));
  gl.uniform1f(resources.lookAhead, Math.max(0.1, Number(params.lookAhead) || 14));
  gl.uniform1f(resources.noseFollow, Number.isFinite(Number(params.noseFollow)) ? Math.max(0, Number(params.noseFollow)) : 1);
  gl.uniform1f(resources.mountainHeight, Math.max(0.05, Number(params.mountainHeight) || 2.4));
  gl.uniform1f(resources.terrainScale, Math.max(0.02, Number(params.terrainScale) || 0.62));
  gl.uniform2fv(resources.terrainPhase, params.terrainPhase || [0, 0]);
  gl.uniform1f(resources.lakeLevel, Number.isFinite(Number(params.lakeLevel)) ? Number(params.lakeLevel) : -0.12);
  gl.uniform1f(resources.viewDistance, Math.max(0, Number(params.viewDistance) || 0));
  const gridMetrics = terrainModule.terrainRowMetrics(componentTime, Math.max(0, Number(params.flightSpeed) || 0), params.gridDepth, params.gridDensity, params.gridScale);
  gl.uniform1f(resources.rowSpacing, gridMetrics.rowSpacing);
  gl.uniform1f(resources.cellScale, gridMetrics.cellScale);
  gl.uniform1f(resources.globeRadius, Math.max(60, Number(params.globeRadius) || 280));
  gl.uniform1f(resources.gridDensity, Math.max(0.25, Number(params.gridDensity) || 1));
  gl.uniform2f(resources.gridCells, terrainModule.terrainGridSize(params.gridWidth), terrainModule.terrainGridSize(params.gridDepth));
  gl.uniform2f(resources.planeSize, planeWidth, planeDepth);
  gl.uniform4fv(resources.wireColor, wireColor);
  gl.uniformMatrix3fv(resources.contentPlacementMatrix, false, params.contentPlacementMatrix || [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
  gl.uniform4fv(resources.renderUvRect, params.renderUvRect || [0, 0, 1, 1]);
}
