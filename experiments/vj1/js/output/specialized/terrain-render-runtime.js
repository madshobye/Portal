import { contentTransformUvMatrices } from "../content-coordinate-space.js";
import { qualityComputeMultiplier } from "../render-runtime-math.js";
import {
  lowerTerrainGeometryProvider,
} from "../../libraries/terrain-engine/index.js";
import { normalizedModelColor } from "./model-color.js";
import { drawBuffer } from "../render-draw-utils.js";
import {
  markRenderTargetOrientation,
  RENDER_TEXTURE_ORIENTATION,
} from "../render-target-contract.js";
import {
  disposeTerrainSurfaceResources,
  disposeTerrainWireResources,
  drawTerrainSurface,
  drawTerrainWireframe,
} from "./terrain-renderer.js";
import { renderView } from "../../libraries/render-engine/render-view/index.js";
import {
  terrainNodeRuntimeModule,
  terrainNodeShaderSource,
} from "./specialized-node-artifacts.js";

// Retained Terrain pass optimizer. The ordinary compiled visual graph evaluates
// controller, geometry, camera, and material values. This capability owns only
// the two explicit context-bound Surface/Wire GPU kernels.
export class TerrainRenderRuntime {
  constructor({
    measureGpu,
    drawStandby,
    drawSurface = drawTerrainSurface,
    drawWire = drawTerrainWireframe,
    drawBufferToTarget = drawBuffer,
  } = {}) {
    this.measureGpu = measureGpu || ((_target, draw) => draw());
    this.drawStandby = drawStandby || (() => {});
    this.drawSurface = drawSurface;
    this.drawWire = drawWire;
    this.drawBufferToTarget = drawBufferToTarget;
    this.surfaceResources = new Map();
    this.wireResources = new Map();
  }

  draw(
    output,
    source = {},
    componentTime = 0,
    renderRequest = {},
    operation = null,
  ) {
    return this.drawTypedKernel(output, source, renderRequest, operation);
  }

  drawTypedKernel(output, source, renderRequest, operation = null) {
    const kernel = String(operation.nativeKernel || "");
    const geometryValue = operation.runtimeValueInputs?.get?.("geometry");
    const materialValue = operation.runtimeValueInputs?.get?.("material");
    const cameraValue = operation.runtimeValueInputs?.get?.("camera");
    const flight = operation.runtimeValueInputs?.get?.("controller");
    if (
      !geometryValue ||
      !materialValue ||
      !cameraValue ||
      !flight
    ) {
      this.drawStandby(output, "Terrain typed input unavailable");
      return false;
    }
    if (kernel !== "terrain-surface" && kernel !== "terrain-wire") {
      this.drawStandby(output, "Terrain kernel unavailable");
      return false;
    }
    const geometrySettings =
      geometryValue.runtimeSettings || geometryValue.settings || {};
    const materialSettings =
      materialValue.runtimeSettings || materialValue.settings || {};
    const cameraSettings =
      cameraValue.runtimeSettings || cameraValue.settings || {};
    const renderSettings = source.params || {};
    const style = String(renderSettings.style || "hybrid");
    if (
      (kernel === "terrain-surface" && style === "wire") ||
      (kernel === "terrain-wire" && style === "biome")
    ) {
      return true;
    }
    const terrainParams = {
      ...geometrySettings,
      ...cameraSettings,
      ...materialSettings,
      ...renderSettings,
    };
    const renderViewport = renderView(output, renderRequest);
    const flightParams = lowerTerrainGeometryProvider(
      {
        ...terrainParams,
        turn: flight.turn,
        altitude: flight.altitude,
        flightSpeed: 1,
        terrainScale: flight.terrainScale,
        terrainPhase: flight.terrainPhase,
        renderUvRect: renderViewport.uvRect,
        contentPlacementMatrix: contentTransformUvMatrices(
          source.contentTransform,
        ).placement,
        gridDensity: Math.max(
          0.25,
          Math.min(
            4,
            (Number(geometrySettings.gridDensity) || 1) *
              qualityComputeMultiplier(terrainParams, {
                minimum: 0.4,
                maximum: 1.5,
              }),
          ),
        ),
      },
      String(geometryValue.providerId || "terrain-height-field"),
    );
    const terrainModule = terrainNodeRuntimeModule(operation);
    const codeRevision = String(
      operation?.nodeCodeRevision ||
      operation?.nodeModuleRevision ||
      "legacy",
    );
    const shaderRevision = String(
      operation?.nodeShaderRevision ||
      operation?.nodeModuleRevision ||
      "legacy",
    );
    const surfaceShaderRevision = String(
      operation?.nodeShaderProgramRevisions?.surface ||
      shaderRevision,
    );
    const wireShaderRevision = String(
      operation?.nodeShaderProgramRevisions?.wire ||
      shaderRevision,
    );
    const nodeShaders = operation.nodeShaders || null;
    const input =
      kernel === "terrain-wire"
        ? operation.runtimeInputStates?.get?.("target")?.buffer || null
        : null;
    const continuesFramebuffer =
      operation.framebufferSequence?.phase === "continue";
    const sky = normalizedModelColor(
      materialSettings.skyColor,
      [108, 165, 212, 255],
    );
    this.measureGpu(output, () => {
      output.push();
      if (!continuesFramebuffer) output.clear();
      if (input && input !== output) {
        this.drawBufferToTarget(
          output,
          input,
          0,
          0,
          output.width,
          output.height,
        );
      }
      if (kernel === "terrain-surface") {
        terrainNodeShaderSource(
          operation,
          "terrain-surface-vertex",
        );
        terrainNodeShaderSource(
          operation,
          "terrain-surface-fragment",
        );
        output.background(
          sky[0] * 255,
          sky[1] * 255,
          sky[2] * 255,
          sky[3] * 255,
        );
        this.drawSurface(
          output,
          this.surfaceResources,
          flightParams,
          flight.flightTime,
          renderViewport.width,
          renderViewport.height,
          input ? 2 : 0,
          sky,
          terrainModule,
          codeRevision,
          nodeShaders,
          surfaceShaderRevision,
        );
      } else {
        terrainNodeShaderSource(operation, "terrain-wire-vertex");
        terrainNodeShaderSource(
          operation,
          "terrain-wire-fragment",
        );
        this.drawWire(
          output,
          this.wireResources,
          flightParams,
          flight.flightTime,
          renderViewport.width,
          renderViewport.height,
          renderRequest,
          terrainModule,
          codeRevision,
          nodeShaders,
          wireShaderRevision,
        );
      }
      output.pop();
    });
    markRenderTargetOrientation(
      output,
      RENDER_TEXTURE_ORIENTATION.bottomLeft,
    );
    return true;
  }

  resetResources() {
    for (const [gl, resources] of this.surfaceResources) {
      disposeTerrainSurfaceResources(gl, resources);
    }
    for (const [gl, resources] of this.wireResources) {
      disposeTerrainWireResources(gl, resources);
    }
    this.surfaceResources.clear();
    this.wireResources.clear();
  }

  dispose() {
    this.resetResources();
  }
}
