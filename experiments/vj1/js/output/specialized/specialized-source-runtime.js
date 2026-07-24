import { clamp01 } from "../../domain/models.js?v=chain-only-authority-1-scene-mapping-default-selection-runtime-visual-sources-1";
import { createSharedFramebufferTarget, isSharedFramebufferTarget, unwrapRenderTarget } from "../shared-framebuffer-target.js?v=render-diagnostics-1";
import { drawStandby } from "../generators.js?v=standby-grace-1";
import { resolutionScaledStrokeWidth } from "../component-render-layout.js?v=canvas-global-resolution-1";
import { contentTransformUvMatrices, isIdentityTransform, normalizedContentTransform } from "../content-coordinate-space.js?v=render-core-contract-1";
import { markRenderTargetOrientation, renderTargetDescriptor, renderTargetNeedsPresentationFlip, RENDER_TEXTURE_ORIENTATION } from "../render-target-contract.js?v=render-core-contract-1";
import { drawBuffer } from "../render-draw-utils.js?v=render-diagnostics-1";
import { GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER, RENDER_PASS_VERTEX_SHADER } from "../render-pass-shaders.js?v=render-coordinate-scope-3";
import { qualityComputeMultiplier } from "../render-runtime-math.js?v=render-coordinate-scope-3";
import { advanceRateClock } from "../../libraries/timing-engine/index.js";
import {
  lowerTerrainGeometryProvider,
  terrainCameraView,
  terrainFlightControllerProcess,
} from "../../libraries/terrain-engine/index.js?v=semantic-terrain-contract-4";
import {
  evaluateSpecializedCompoundGraph,
  executeSpecializedCompoundProvider,
  executeSpecializedCompoundStage,
  specializedCompoundNativeKernel,
  specializedCompoundStageEnabled,
  specializedCompoundStageParameterView,
  specializedCompoundStageProvider,
} from "../../libraries/visual-nodes/shared/specialized-compound.js?v=compiled-semantic-specialized-compounds-26";
import { anatomyPartFitScale, drawProceduralAnatomy } from "./anatomy-renderer.js?v=node-program-hooks-15";
import { modelColor, normalizedModelColor } from "./model-color.js?v=adaptive-component-demand-29";
import { applyModelViewportProjection, modelCameraFov, modelImportBasis, modelRotation, modelViewportMetrics, modelWireThickness } from "../../libraries/mesh-engine/mesh-render-math.js?v=resolution-relative-model-clip-1";
import { disposeRawModelItemResources, renderMeshNodeProcess } from "../../libraries/mesh-engine/mesh-render/index.js?v=resolution-relative-model-clip-1";
import { updateMediaMeshRenderValues } from "../../libraries/mesh-engine/media-mesh-render-adapter.js";
import { modelLodTargetTriangles, selectModelLod } from "../../libraries/mesh-engine/mesh-resolution/index.js";
import { disposeTerrainSurfaceResources, disposeTerrainWireResources, drawTerrainSurface, drawTerrainWireframe } from "./terrain-renderer.js?v=semantic-terrain-providers-4";
import { TerrainNodeModuleExports as FALLBACK_TERRAIN_NODE_MODULE } from "./terrain-mesh.js?v=shared-terrain-grid-math-16";
import {
  FEATURE_MORPH_FRAGMENT_SHADER,
  FEATURE_MORPH_VERTEX_SHADER,
  imageFitUniform as fallbackImageFitUniform,
} from "./feature-morph-shader.js?v=source-roi-view-3";
import {
  buildFeatureMorphField as fallbackBuildFeatureMorphField,
  buildFeatureMorphMesh as fallbackBuildFeatureMorphMesh,
  matchSuperPointFeatures as fallbackMatchSuperPointFeatures,
} from "./feature-morph-field.js?v=node-program-hooks-15";
import { mobileNetAnalysisModule, MobileNetMorphPairService } from "./mobilenet-morph-service.js?v=surface-media-contract-6";
import { SuperPointPairService } from "./superpoint-service.js?v=surface-media-contract-6";
import {
  TILE_TEXTURE_FRAGMENT_SHADER,
  TILE_TEXTURE_VERTEX_SHADER,
  tileRepeatAmount as fallbackTileRepeatAmount,
} from "./tile-texture-shader.js?v=source-roi-view-3";
export { tileRepeatAmount } from "./tile-texture-shader.js?v=source-roi-view-3";
import {
  createTextMask as fallbackCreateTextMask,
  TEXT_GENERATOR_FRAGMENT_SHADER as FALLBACK_TEXT_FRAGMENT_SHADER,
  TEXT_GENERATOR_VERTEX_SHADER as FALLBACK_TEXT_VERTEX_SHADER,
  textMaskDimensions as fallbackTextMaskDimensions,
  textMaskSignature as fallbackTextMaskSignature,
} from "./text-generator-renderer.js?v=text-mask-readback-1";
import { MeshPatternRenderer } from "./mesh-pattern-renderer.js?v=compiled-artifact-authority-2";
import { disposeRenderTarget } from "../../libraries/render-engine/render-target-lifetime.js";
import { renderView } from "../../libraries/render-engine/render-view/index.js";

const FALLBACK_TEXT_NODE_MODULE = Object.freeze({
  createTextMask: fallbackCreateTextMask,
  textMaskDimensions: fallbackTextMaskDimensions,
  textMaskSignature: fallbackTextMaskSignature,
});

const FALLBACK_ANATOMY_NODE_MODULE = Object.freeze({
  anatomyPartFitScale,
  drawProceduralAnatomy,
});
const ANATOMY_MODULE_FUNCTIONS = Object.freeze(["anatomyPartFitScale", "drawProceduralAnatomy"]);
const TEXT_MODULE_FUNCTIONS = Object.freeze(["createTextMask", "textMaskSignature"]);
const TERRAIN_MODULE_FUNCTIONS = Object.freeze([
  "normalizedTerrainIrregularity",
  "terrainExpandedGridWireVertices",
  "terrainGridSize",
  "terrainRowMetrics",
  "terrainSafeNearDistance",
  "terrainSurfaceGridVertices",
  "terrainSurfaceTriangleIndices",
  "terrainTessellationSize",
]);
const TILE_TEXTURE_MODULE_FUNCTIONS = Object.freeze(["tileRepeatAmount"]);
const FEATURE_MORPH_RENDER_MODULE_FUNCTIONS = Object.freeze(["imageFitUniform"]);
const FEATURE_MORPH_ANALYSIS_MODULE_FUNCTIONS = Object.freeze([
  "imageFitUniform",
  "buildFeatureMorphField",
  "matchSuperPointFeatures",
]);
const VALIDATED_COMPILED_MODULES = new WeakMap();
const VALIDATED_COMPILED_SHADERS = new WeakMap();

function compiledSpecializedOperation(operation = {}) {
  return !!operation?.nativeCompoundProgram;
}

function requireCompiledModuleFunctions(operation, functions, errorCode) {
  const module = operation?.nodeModule;
  if (compiledSpecializedOperation(operation)) {
    let validations = VALIDATED_COMPILED_MODULES.get(operation);
    if (validations?.has(errorCode)) return module;
    let missing = "";
    for (const name of functions) {
      if (typeof module?.[name] === "function") continue;
      missing += `${missing ? "," : ""}${name}`;
    }
    if (missing) throw new Error(`${errorCode}:${missing}`);
    if (!validations) {
      validations = new Set();
      VALIDATED_COMPILED_MODULES.set(operation, validations);
    }
    validations.add(errorCode);
    return module;
  }
  for (const name of functions) {
    if (typeof module?.[name] !== "function") return null;
  }
  return module;
}

function compiledShaderSource(operation, id, fallback, errorCode) {
  const source = operation?.nodeShaders?.[id];
  if (compiledSpecializedOperation(operation)) {
    let validations = VALIDATED_COMPILED_SHADERS.get(operation);
    if (validations?.has(id)) return source;
    if (typeof source !== "string" || !source.trim()) {
      throw new Error(`${errorCode}:${id}`);
    }
    if (!validations) {
      validations = new Set();
      VALIDATED_COMPILED_SHADERS.set(operation, validations);
    }
    validations.add(id);
    return source;
  }
  return typeof source === "string" && source.trim() ? source : fallback;
}

export function anatomyNodeRuntimeModule(operation = {}) {
  return requireCompiledModuleFunctions(
    operation,
    ANATOMY_MODULE_FUNCTIONS,
    "ANATOMY_COMPILED_MODULE_MISSING",
  ) || FALLBACK_ANATOMY_NODE_MODULE;
}

// This is the narrow host boundary for the Text node. The compiler supplies
// editable algorithm exports and shader sources; the specialized runtime owns
// only context-bound targets, mask images, and their bounded caches.
export function textNodeRuntimeModule(operation = {}) {
  return requireCompiledModuleFunctions(
    operation,
    TEXT_MODULE_FUNCTIONS,
    "TEXT_COMPILED_MODULE_MISSING",
  ) || FALLBACK_TEXT_NODE_MODULE;
}

export function textNodeShaderSource(operation = {}, stage = "fragment") {
  return compiledShaderSource(
    operation,
    stage,
    stage === "vertex" ? FALLBACK_TEXT_VERTEX_SHADER : FALLBACK_TEXT_FRAGMENT_SHADER,
    "TEXT_COMPILED_SHADER_MISSING",
  );
}

// Terrain's node owns the pure topology/math module. The host keeps the
// context-bound WebGL programs and retained buffers. Installed/forked node
// modules are validated before compilation, so the hot path needs only this
// single capability check rather than revalidating every helper each frame.
export function terrainNodeRuntimeModule(operation = {}) {
  return requireCompiledModuleFunctions(
    operation,
    TERRAIN_MODULE_FUNCTIONS,
    "TERRAIN_COMPILED_MODULE_MISSING",
  ) || FALLBACK_TERRAIN_NODE_MODULE;
}

export function terrainNodeShaderSource(operation = {}, id = "") {
  return compiledShaderSource(
    operation,
    id,
    null,
    "TERRAIN_COMPILED_SHADER_MISSING",
  );
}

const FALLBACK_TILE_TEXTURE_NODE_MODULE = Object.freeze({ tileRepeatAmount: fallbackTileRepeatAmount });

export function tileTextureNodeRuntimeModule(operation = {}) {
  return requireCompiledModuleFunctions(
    operation,
    TILE_TEXTURE_MODULE_FUNCTIONS,
    "TILE_TEXTURE_COMPILED_MODULE_MISSING",
  ) || FALLBACK_TILE_TEXTURE_NODE_MODULE;
}

export function tileTextureNodeShaderSource(operation = {}, stage = "fragment") {
  const id = stage === "vertex" ? "tile-texture-vertex" : "tile-texture-fragment";
  return compiledShaderSource(
    operation,
    id,
    stage === "vertex" ? TILE_TEXTURE_VERTEX_SHADER : TILE_TEXTURE_FRAGMENT_SHADER,
    "TILE_TEXTURE_COMPILED_SHADER_MISSING",
  );
}

const FALLBACK_FEATURE_MORPH_NODE_MODULE = Object.freeze({
  imageFitUniform: fallbackImageFitUniform,
  buildFeatureMorphField: fallbackBuildFeatureMorphField,
  buildFeatureMorphMesh: fallbackBuildFeatureMorphMesh,
  matchSuperPointFeatures: fallbackMatchSuperPointFeatures,
});

export function featureMorphNodeRuntimeModule(operation = {}, { requireAnalysis = true } = {}) {
  return requireCompiledModuleFunctions(
    operation,
    requireAnalysis
      ? FEATURE_MORPH_ANALYSIS_MODULE_FUNCTIONS
      : FEATURE_MORPH_RENDER_MODULE_FUNCTIONS,
    "FEATURE_MORPH_COMPILED_MODULE_MISSING",
  ) || FALLBACK_FEATURE_MORPH_NODE_MODULE;
}

export function featureMorphNodeShaderSource(operation = {}, stage = "fragment") {
  const id = stage === "vertex" ? "feature-morph-vertex" : "feature-morph-fragment";
  return compiledShaderSource(
    operation,
    id,
    stage === "vertex" ? FEATURE_MORPH_VERTEX_SHADER : FEATURE_MORPH_FRAGMENT_SHADER,
    "FEATURE_MORPH_COMPILED_SHADER_MISSING",
  );
}

export class SpecializedSourceRuntime {
  constructor({
    media,
    acquireMedia,
    requestMissingMedia,
    requestMissingMediaBatch,
    applyGraphicsPixelDensity,
    measureGpu,
    gpuTimer,
    frameIndex,
    showDiagnostics,
    requestPixelDensity,
  } = {}) {
    this.media = media || (() => new Map());
    this.acquireMedia = acquireMedia || ((id) => this.media().get(id));
    this.requestMissingMedia = requestMissingMedia || (() => {});
    this.requestMissingMediaBatch = requestMissingMediaBatch || (() => {});
    this.applyGraphicsPixelDensity = applyGraphicsPixelDensity || ((target, density) => target?.pixelDensity?.(density));
    this.measureGpu = measureGpu || ((_target, draw) => draw());
    this.gpuTimer = gpuTimer || { begin: () => null, end: () => {} };
    this.frameIndex = frameIndex || (() => 0);
    this.showDiagnostics = showDiagnostics || (() => true);
    this.requestPixelDensity = requestPixelDensity || ((request = {}) => request.pixelDensity);
    this.nativeRenderers = new Map();
    this.registerNativeRenderer(
      "output/specialized:anatomy",
      (target, source, time, request, operation) => this.drawAnatomy(
        target, source, time, this.nativeRenderRequest(request), operation,
      ),
    );
    this.registerNativeRenderer(
      "output/specialized:terrainFlyover",
      (target, source, time, request, operation) => this.drawTerrain(
        target, source, time, this.nativeRenderRequest(request), operation,
      ),
    );
    this.registerNativeRenderer(
      "output/specialized:featureMorph",
      (target, source, time, request, operation) => this.drawFeatureMorph(
        target, source, time, this.nativeRenderRequest(request), operation,
      ),
    );
    this.registerNativeRenderer(
      "output/specialized:featureMorphV2",
      (target, source, time, request, operation) => this.drawFeatureMorph(
        target, source, time, this.nativeRenderRequest(request), operation,
      ),
    );
    this.registerNativeRenderer(
      "output/specialized:controlledShader",
      (target, source, time, request, operation) => this.drawControlledShader(
        target, source, time, this.nativeRenderRequest(request), operation,
      ),
    );
    this.registerNativeRenderer(
      "output/specialized:tileTexture",
      (target, source, time, request, operation) => this.drawTileTexture(
        target, source, time, this.nativeRenderRequest(request), operation,
      ),
    );
    this.registerNativeRenderer(
      "output/specialized:text",
      (target, source, time, request, operation) => this.drawText(
        target, source, time, this.nativeRenderRequest(request), operation,
      ),
    );
    this.registerNativeRenderer(
      "output/specialized:meshPatterns",
      (target, source, time, request, operation) => this.drawMeshPatterns(
        target, source, time, this.nativeRenderRequest(request), operation,
      ),
    );
    this.targets = new Map();
    this.terrainSurfaceResources = new Map();
    this.terrainWireResources = new Map();
    this.rateClocks = new Map();
    this.anatomyGraphExternalInputs = new Map();
    this.terrainFlightStates = new Map();
    this.terrainGraphExternalInputs = new Map();
    this.superPointPairs = new SuperPointPairService();
    this.mobileNetMorphPairs = new MobileNetMorphPairService();
    this.featureMorphAnalysisProviders = new Map();
    this.registerFeatureMorphAnalysisProvider("superpoint", {
      service: () => this.superPointPairs,
      targetKey: "featureMorph",
      shaderKey: "featureMorphShader",
      shaderRevisionKey: "featureMorphShaderRevision",
      requireAnalysisModule: true,
      loadingLabel: "finding SuperPoint landmarks",
      errorLabel: "feature matching failed",
      morphStrategy: () => "flow",
      morphField: (entry) => entry.result.field,
      featureInfluence: () => 1,
    });
    this.registerFeatureMorphAnalysisProvider("mobilenet", {
      service: () => this.mobileNetMorphPairs,
      targetKey: "featureMorphV2",
      shaderKey: "featureMorphV2Shader",
      shaderRevisionKey: "featureMorphV2ShaderRevision",
      requireAnalysisModule: false,
      loadingLabel: "matching MobileNet regions",
      errorLabel: "semantic matching failed",
      morphStrategy: (params) => params.morphStrategy || "elastic",
      morphField: (entry, nodeModule, strategy) =>
        mobileNetAnalysisModule(nodeModule).mobileNetMorphFieldForStrategy(entry.result, strategy),
      featureInfluence: (params) => Math.max(0, Number(params.influence) || 0) / 0.2,
    });
    this.featureMorphShader = null;
    this.featureMorphShaderRevision = "";
    this.featureMorphV2Shader = null;
    this.featureMorphV2ShaderRevision = "";
    this.controlledShaderPrograms = new Map();
    this.controlledShaderGraphExternalInputs = new Map();
    this.tileTextureShader = null;
    this.tileTextureShaderRevision = "";
    this.textGeneratorShader = null;
    this.textGeneratorShaderRevision = "";
    this.textMasks = new Map();
    this.textGraphExternalInputs = new Map();
    this.meshPatterns = new MeshPatternRenderer({ frameIndex: this.frameIndex });
    this.presentationShaders = new Map();
    this.presentationShaderFailures = new Set();
  }

  registerNativeRenderer(rendererId, renderer, { replace = false } = {}) {
    const id = String(rendererId || "");
    if (!id || typeof renderer !== "function") {
      throw new TypeError("VJ1_NATIVE_SOURCE_RENDERER_INVALID");
    }
    if (!replace && this.nativeRenderers.has(id)) {
      throw new Error(`VJ1_NATIVE_SOURCE_RENDERER_DUPLICATE:${id}`);
    }
    this.nativeRenderers.set(id, renderer);
    return renderer;
  }

  registerFeatureMorphAnalysisProvider(providerId, adapter, { replace = false } = {}) {
    const id = String(providerId || "");
    if (!id || !adapter || typeof adapter.service !== "function") {
      throw new TypeError("VJ1_FEATURE_MORPH_ANALYSIS_PROVIDER_INVALID");
    }
    if (!replace && this.featureMorphAnalysisProviders.has(id)) {
      throw new Error(`VJ1_FEATURE_MORPH_ANALYSIS_PROVIDER_DUPLICATE:${id}`);
    }
    this.featureMorphAnalysisProviders.set(id, Object.freeze({ ...adapter, providerId: id }));
    return this.featureMorphAnalysisProviders.get(id);
  }

  featureMorphAnalysisProvider(providerId) {
    return this.featureMorphAnalysisProviders.get(String(providerId || "")) || null;
  }

  featureMorphAnalysisService(providerId) {
    return this.featureMorphAnalysisProvider(providerId)?.service() || null;
  }

  hasNativeRenderer(rendererId) {
    return this.nativeRenderers.has(String(rendererId || ""));
  }

  drawNativeRenderer(rendererId, target, source, time, renderRequest, operation = null) {
    const renderer = this.nativeRenderers.get(String(rendererId || ""));
    if (!renderer) return false;
    renderer(target, source, time, renderRequest, operation);
    return true;
  }

  nativeRenderRequest(renderRequest = {}) {
    return {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    };
  }

  drawControlledShader(pg, source = {}, componentTime = 0, renderRequest = {}, operation = null) {
    const kernel = specializedCompoundNativeKernel(operation, "controlled-shader");
    if (!operation?.nativeCompoundProgram || !kernel) {
      throw new Error("CONTROLLED_SHADER_COMPILED_KERNEL_MISSING");
    }
    const renderStageId = kernel.id;
    const controllerStageId = kernel.inputBindings?.uniforms?.stageId || "";
    if (
      !controllerStageId ||
      !specializedCompoundStageEnabled(operation, controllerStageId) ||
      !specializedCompoundStageEnabled(operation, renderStageId)
    ) {
      this.drawStandby(pg, "Controlled shader stage disabled");
      return;
    }

    const authoredParams = source.params || {};
    const instanceId = source.instanceId || renderRequest.renderIdentity || operation.id || "controlled-shader";
    let external = this.controlledShaderGraphExternalInputs.get(instanceId);
    if (!external || external.stageId !== controllerStageId) {
      const stageInputs = { componentTime: 0 };
      external = {
        stageId: controllerStageId,
        stageInputs,
        inputs: { [controllerStageId]: stageInputs },
      };
      this.controlledShaderGraphExternalInputs.set(instanceId, external);
    }
    external.stageInputs.componentTime = componentTime;
    const graph = evaluateSpecializedCompoundGraph(
      operation,
      authoredParams,
      { instanceId },
      external.inputs,
    );
    const uniforms = graph?.stageInput(renderStageId, "uniforms");
    const params = graph?.stageInputs(renderStageId)?.settings;
    if (!uniforms || !params) {
      this.drawStandby(pg, "Controlled shader graph input unavailable");
      return;
    }
    const applyUniforms = operation?.nodeModule?.applyControlledShaderUniforms;
    if (typeof applyUniforms !== "function") {
      throw new Error("CONTROLLED_SHADER_UNIFORM_BINDING_MISSING");
    }

    const targetKind = `controlledShader:${operation.nodeId || kernel.nodeId || "visual"}`;
    const shaderRevision = String(
      operation.nodeShaderProgramRevisions?.["controlled-shader"] ||
      operation.nodeShaderRevision ||
      operation.nodeModuleRevision ||
      "",
    );
    const target = this.getTarget(targetKind, pg.width, pg.height, renderRequest.pixelDensity, {
      preferSharedFramebuffer: true,
      onContextDiscard: () => this.controlledShaderPrograms.delete(targetKind),
    });
    let shaderState = this.controlledShaderPrograms.get(targetKind);
    if (
      !shaderState ||
      shaderState.target !== target ||
      shaderState.revision !== shaderRevision
    ) {
      shaderState = {
        target,
        revision: shaderRevision,
        shader: target.createShader(
          operation.nodeShaders?.vertex || "",
          operation.nodeShaders?.fragment || "",
        ),
      };
      this.controlledShaderPrograms.set(targetKind, shaderState);
    }
    const view = renderView(pg, renderRequest);
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shaderState.shader);
      shaderState.shader.setUniform("resolution", [view.width, view.height]);
      shaderState.shader.setUniform("renderUvRect", view.uvRect);
      shaderState.shader.setUniform(
        "contentUvMatrix",
        contentTransformUvMatrices(source.contentTransform).sampling,
      );
      applyUniforms(shaderState.shader, uniforms, params);
      drawShaderTargetRect(target, pg.width, pg.height);
      resetShaderTarget(target);
    });
    this.presentGeneratedTarget(pg, target);
  }

  drawFeatureMorph(pg, source = {}, componentTime = 0, renderRequest = {}, operation = null) {
    const authoredParams = source.params || {};
    const kernel = specializedCompoundNativeKernel(operation, "feature-morph");
    if (operation?.nativeCompoundProgram && !kernel) {
      throw new Error("FEATURE_MORPH_NATIVE_KERNEL_MISSING");
    }
    const renderStageId = kernel?.id || "render";
    const imageAStageId = kernel?.inputBindings?.imageA?.stageId || "image-a";
    const imageBStageId = kernel?.inputBindings?.imageB?.stageId || "image-b";
    const analysisStageId = kernel?.inputBindings?.analysis?.stageId || "analysis";
    const instanceId = source.instanceId || renderRequest.renderIdentity || source.generatorId || "feature-morph";
    const graph = operation?.nativeCompoundProgram
      ? evaluateSpecializedCompoundGraph(operation, authoredParams, { instanceId })
      : null;
    const imageAValue = graph?.stageInput(renderStageId, "imageA") || null;
    const imageBValue = graph?.stageInput(renderStageId, "imageB") || null;
    const analysisValue = graph?.stageInput(renderStageId, "analysis") || null;
    if (operation?.nativeCompoundProgram && (!imageAValue || !imageBValue || !analysisValue)) {
      throw new Error(`FEATURE_MORPH_GRAPH_VALUE_MISSING:${imageAStageId}:${imageBStageId}:${analysisStageId}`);
    }
    const params = graph?.stageInputs(renderStageId)?.settings ||
      specializedCompoundStageParameterView(operation, renderStageId, authoredParams, instanceId) ||
      authoredParams;
    const analysisParams = analysisValue?.settings || authoredParams;
    const providerId = String(analysisValue?.providerId || "");
    const analysisProvider = this.featureMorphAnalysisProvider(providerId);
    if (!analysisProvider) {
      throw new Error(`FEATURE_MORPH_ANALYSIS_PROVIDER_UNAVAILABLE:${providerId || "missing"}`);
    }
    const nodeModule = featureMorphNodeRuntimeModule(operation, {
      requireAnalysis: analysisProvider.requireAnalysisModule === true,
    });
    const pairService = analysisProvider.service();
    const { targetKey, shaderKey, shaderRevisionKey } = analysisProvider;
    const shaderRevision = String(
      operation?.nodeShaderProgramRevisions?.["feature-morph"] ||
      operation?.nodeShaderRevision ||
      operation?.nodeModuleRevision ||
      "legacy"
    );
    const imageAId = imageAValue?.mediaId || authoredParams.imageAId || "";
    const imageBId = imageBValue?.mediaId || authoredParams.imageBId || "";
    if (!imageAId || !imageBId) {
      this.drawStandby(pg, "choose two images");
      return;
    }
    const view = renderView(pg, renderRequest);
    const imageRequest = { width: Math.max(1024, Number(view.width) || 0) };
    const itemA = this.acquireMedia(imageAId, imageRequest);
    const itemB = this.acquireMedia(imageBId, imageRequest);
    const missingIds = [!itemA ? imageAId : "", !itemB ? imageBId : ""].filter(Boolean);
    if (missingIds.length) this.requestMissingMediaBatch(missingIds);
    if (!itemA?.image || !itemB?.image) {
      this.drawStandby(pg, itemA?.imageError || itemB?.imageError || "loading morph images");
      return;
    }
    const entry = pairService.request(analysisParams, itemA.image, itemB.image, {
      imageAFile: itemA.file,
      imageBFile: itemB.file,
      nodeModule,
      algorithmRevision: String(operation?.nodeCodeRevision || operation?.nodeModuleRevision || "legacy"),
    });
    if (entry.status === "loading") {
      this.drawStandby(pg, entry.detail || analysisProvider.loadingLabel);
      return;
    }
    if (entry.status === "error" || !entry.result?.field) {
      this.drawStandby(pg, entry.error || analysisProvider.errorLabel);
      return;
    }

    const target = this.getTarget(targetKey, pg.width, pg.height, renderRequest.pixelDensity, {
      preferSharedFramebuffer: true,
      onContextDiscard: () => {
        this[shaderKey] = null;
        this[shaderRevisionKey] = "";
      },
    });
    if (!this[shaderKey] || this[shaderRevisionKey] !== shaderRevision) {
      this[shaderKey] = target.createShader(
        featureMorphNodeShaderSource(operation, "vertex"),
        featureMorphNodeShaderSource(operation, "fragment")
      );
      this[shaderRevisionKey] = shaderRevision;
    }
    const shaderProgram = this[shaderKey];
    const morphStrategy = analysisProvider.morphStrategy(params);
    const morphField = analysisProvider.morphField(entry, nodeModule, morphStrategy);
    const flowImage = featureMorphFlowImage(morphField);
    const autoSpeed = Math.max(0, Number(params.autoSpeed) || 0);
    const morph = autoSpeed > 0.0001
      ? 0.5 + 0.5 * Math.sin(componentTime * autoSpeed * Math.PI * 2)
      : clamp01(Number(params.morph) || 0);
    const fit = params.fit || "cover";
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shaderProgram);
      shaderProgram.setUniform("imageA", itemA.image);
      shaderProgram.setUniform("imageB", itemB.image);
      shaderProgram.setUniform("flowField", flowImage);
      shaderProgram.setUniform("morph", morph);
      const featureInfluence = analysisProvider.featureInfluence(params);
      shaderProgram.setUniform("warpStrength", Math.max(0, Number(params.warpStrength) || 0) * featureInfluence);
      shaderProgram.setUniform("maxFlow", morphField.maxFlow);
      shaderProgram.setUniform("flowSize", [morphField.width, morphField.height]);
      shaderProgram.setUniform("flowPhases", morphField.phases || 1);
      shaderProgram.setUniform("flowLayers", morphField.layers || 1);
      shaderProgram.setUniform("morphStrategy", morphStrategy === "rigid" || morphStrategy === "elastic" ? 1 : morphStrategy === "fluid" ? 2 : 0);
      shaderProgram.setUniform("fitA", nodeModule.imageFitUniform(itemA.image, view.width, view.height, fit));
      shaderProgram.setUniform("fitB", nodeModule.imageFitUniform(itemB.image, view.width, view.height, fit));
      shaderProgram.setUniform("contentUvMatrix", contentTransformUvMatrices(source.contentTransform).sampling);
      setOptionalShaderUniform(shaderProgram, "renderUvRect", view.uvRect);
      drawShaderTargetRect(target, pg.width, pg.height);
      resetShaderTarget(target);
    });
    this.presentGeneratedTarget(pg, target);
  }

  drawTileTexture(pg, source = {}, componentTime = 0, renderRequest = {}, operation = null) {
    const authoredParams = source.params || {};
    const kernel = specializedCompoundNativeKernel(operation, "tile-texture");
    if (operation?.nativeCompoundProgram && !kernel) {
      throw new Error("TILE_TEXTURE_NATIVE_KERNEL_MISSING");
    }
    const renderStageId = kernel?.id || "render";
    const imageStageId = kernel?.inputBindings?.image?.stageId || "image";
    const instanceId = source.instanceId || renderRequest.renderIdentity || source.generatorId || "tile-texture";
    const graph = operation?.nativeCompoundProgram
      ? evaluateSpecializedCompoundGraph(operation, authoredParams, { instanceId })
      : null;
    const imageValue = graph?.stageInput(renderStageId, "image") || null;
    if (operation?.nativeCompoundProgram && !imageValue) {
      throw new Error(`TILE_TEXTURE_GRAPH_VALUE_MISSING:${imageStageId}`);
    }
    const params = graph?.stageInputs(renderStageId)?.settings ||
      specializedCompoundStageParameterView(operation, renderStageId, authoredParams, instanceId) ||
      authoredParams;
    const nodeModule = tileTextureNodeRuntimeModule(operation);
    const shaderRevision = String(
      operation?.nodeShaderProgramRevisions?.["tile-texture"] ||
      operation?.nodeShaderRevision ||
      operation?.nodeModuleRevision ||
      "legacy"
    );
    const imageId = imageValue?.mediaId || authoredParams.imageId || "";
    if (!imageId) {
      this.drawStandby(pg, "choose a tileable texture");
      return;
    }
    const item = this.acquireMedia(imageId, { width: pg.width });
    if (!item?.image) {
      if (!item) this.requestMissingMedia(imageId);
      this.drawStandby(pg, item?.imageError || "loading tile texture");
      return;
    }
    const target = this.getTarget("tileTexture", pg.width, pg.height, renderRequest.pixelDensity, {
      preferSharedFramebuffer: true,
      onContextDiscard: () => {
    this.tileTextureShader = null;
    this.tileTextureShaderRevision = "";
      },
    });
    if (!this.tileTextureShader || this.tileTextureShaderRevision !== shaderRevision) {
      this.tileTextureShader = target.createShader(
        tileTextureNodeShaderSource(operation, "vertex"),
        tileTextureNodeShaderSource(operation, "fragment")
      );
      this.tileTextureShaderRevision = shaderRevision;
    }
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, this.tileTextureShader);
      this.tileTextureShader.setUniform("tileImage", item.image);
      this.tileTextureShader.setUniform("repeatAmount", nodeModule.tileRepeatAmount(params));
      this.tileTextureShader.setUniform("offsetAmount", [Number(params.offsetX) || 0, Number(params.offsetY) || 0]);
      this.tileTextureShader.setUniform("scrollSpeed", [Number(params.scrollX) || 0, Number(params.scrollY) || 0]);
      this.tileTextureShader.setUniform("time", componentTime);
      this.tileTextureShader.setUniform("contentUvMatrix", contentTransformUvMatrices(source.contentTransform).sampling);
      setOptionalShaderUniform(this.tileTextureShader, "renderUvRect", renderView(pg, renderRequest).uvRect);
      drawShaderTargetRect(target, pg.width, pg.height);
      resetShaderTarget(target);
    });
    this.presentGeneratedTarget(pg, target);
  }

  drawText(pg, source = {}, _componentTime = 0, renderRequest = {}, operation = null) {
    const authoredParams = source.params || {};
    const kernel = specializedCompoundNativeKernel(operation, "text-mask");
    if (operation?.nativeCompoundProgram && !kernel) {
      this.drawStandby(pg, "Text render kernel unavailable");
      return;
    }
    const renderStageId = kernel?.id || "render";
    const maskStageId = kernel?.inputBindings?.mask?.stageId || "mask";
    if (
      !specializedCompoundStageEnabled(operation, renderStageId) ||
      !specializedCompoundStageEnabled(operation, maskStageId)
    ) {
      this.drawStandby(pg, "Text compound stage disabled");
      return;
    }
    const instanceId = source.instanceId || renderRequest.renderIdentity || source.generatorId || "text";
    const view = renderView(pg, renderRequest);
    let maskValue = null;
    let params = authoredParams;
    if (operation?.nativeCompoundProgram) {
      let external = this.textGraphExternalInputs.get(instanceId);
      if (!external || external.stageId !== maskStageId) {
        const stageInputs = { width: 1, height: 1 };
        external = {
          stageId: maskStageId,
          stageInputs,
          inputs: { [maskStageId]: stageInputs },
        };
        this.textGraphExternalInputs.set(instanceId, external);
      }
      external.stageInputs.width = view.width;
      external.stageInputs.height = view.height;
      const graph = evaluateSpecializedCompoundGraph(
        operation,
        authoredParams,
        { instanceId },
        external.inputs,
      );
      maskValue = graph?.stageInput(renderStageId, "mask") || null;
      params = graph?.stageInputs(renderStageId)?.settings ||
        specializedCompoundStageParameterView(operation, renderStageId, authoredParams, instanceId);
      if (!maskValue?.canvas) {
        this.drawStandby(pg, "Text mask graph input unavailable");
        return;
      }
    }
    const codeRevision = String(operation?.nodeCodeRevision || operation?.nodeModuleRevision || "legacy");
    const shaderRevision = String(operation?.nodeShaderRevision || operation?.nodeModuleRevision || "legacy");
    const vertexShader = textNodeShaderSource(operation, "vertex");
    const fragmentShader = textNodeShaderSource(operation, "fragment");
    const target = this.getTarget("text", pg.width, pg.height, renderRequest.pixelDensity, {
      preferSharedFramebuffer: true,
      onContextDiscard: () => {
        this.textGeneratorShader = null;
        this.textGeneratorShaderRevision = "";
      },
    });
    if (!this.textGeneratorShader || this.textGeneratorShaderRevision !== shaderRevision) {
      this.textGeneratorShader = target.createShader(vertexShader, fragmentShader);
      this.textGeneratorShaderRevision = shaderRevision;
    }
    let canvas;
    let maskSize;
    let providerRevision = 0;
    let signature;
    let legacyNodeModule = null;
    if (maskValue) {
      canvas = maskValue.canvas;
      maskSize = {
        width: Math.max(1, Number(maskValue.width) || canvas.width || 1),
        height: Math.max(1, Number(maskValue.height) || canvas.height || 1),
      };
      providerRevision = Math.max(0, Number(maskValue.revision) || 0);
      signature = `${codeRevision}:${String(maskValue.signature || "")}`;
    } else {
      // Compatibility-only direct host calls have no compiled Group. Current
      // production plans always receive the connected Text Mask provider.
      legacyNodeModule = textNodeRuntimeModule(operation);
      const textMaskDimensions = typeof legacyNodeModule.textMaskDimensions === "function"
        ? legacyNodeModule.textMaskDimensions
        : fallbackTextMaskDimensions;
      maskSize = textMaskDimensions(view.width, view.height);
      signature = `${codeRevision}:${legacyNodeModule.textMaskSignature(params, maskSize.width, maskSize.height)}`;
      canvas = null;
    }
    let mask = this.textMasks.get(instanceId);
    const changed = maskValue
      ? !mask ||
        mask.signature !== signature ||
        mask.providerRevision !== providerRevision ||
        mask.canvas !== canvas
      : !mask || mask.signature !== signature;
    if (changed) {
      if (!maskValue) {
        canvas = legacyNodeModule.createTextMask(
          params,
          maskSize.width,
          maskSize.height,
          mask?.canvas || null,
        );
      }
      mask = {
        signature,
        providerRevision,
        canvas,
        image: textMaskImage(canvas, mask?.image || null),
        lastUsedFrame: this.frameIndex(),
      };
      this.textMasks.set(instanceId, mask);
      pruneOldestEntries(this.textMasks, 64);
    } else {
      mask.lastUsedFrame = this.frameIndex();
    }
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, this.textGeneratorShader);
      this.textGeneratorShader.setUniform("textMask", mask.image);
      this.textGeneratorShader.setUniform("resolution", [maskSize.width, maskSize.height]);
      setOptionalShaderUniform(this.textGeneratorShader, "renderUvRect", view.uvRect);
      this.textGeneratorShader.setUniform("fillColor", colorUniform(params.fillColor, "#ffffffff"));
      this.textGeneratorShader.setUniform("outlineColor", colorUniform(params.outlineColor, "#ffffffff"));
      this.textGeneratorShader.setUniform("backgroundColor", colorUniform(params.backgroundColor, "#00000000"));
      this.textGeneratorShader.setUniform("outlineWidth", Math.max(0, Number(params.outlineWidth) || 0));
      this.textGeneratorShader.setUniform("fillEnabled", params.fillEnabled === false ? 0 : 1);
      this.textGeneratorShader.setUniform("outlineEnabled", params.outlineEnabled === true ? 1 : 0);
      this.textGeneratorShader.setUniform("contentUvMatrix", contentTransformUvMatrices(source.contentTransform).sampling);
      drawShaderTargetRect(target, pg.width, pg.height);
      resetShaderTarget(target);
    });
    this.presentGeneratedTarget(pg, target);
  }

  drawMeshPatterns(pg, source = {}, componentTime = 0, renderRequest = {}, operation = null) {
    const target = this.getTarget("meshPatterns", pg.width, pg.height, renderRequest.pixelDensity, {
      preferSharedFramebuffer: true,
    });
    const drawn = this.meshPatterns.draw(target, source, componentTime, renderRequest, operation);
    if (!drawn) {
      this.drawStandby(pg, "mesh topology unavailable");
      return false;
    }
    markRenderTargetOrientation(target, RENDER_TEXTURE_ORIENTATION.bottomLeft);
    this.presentGeneratedTarget(pg, target);
    return true;
  }

  drawStandby(target, label) {
    const transient = /loading|checking|preparing|matching|finding|not loaded/i.test(String(label || ""));
    drawStandby(target, label, {
      visible: this.showDiagnostics(),
      frame: this.frameIndex(),
      graceMs: transient ? 1000 : 0,
    });
  }

  drawAnatomy(pg, source = {}, componentTime = 0, renderRequest = {}, operation = null) {
    const kernel = specializedCompoundNativeKernel(operation, "anatomy-retained-webgl");
    if (operation?.nativeCompoundProgram && !kernel) {
      this.drawStandby(pg, "Anatomy kernel schedule unavailable");
      return;
    }
    const renderStageId = kernel?.id || "render";
    const geometryStageId = kernel?.inputBindings?.geometry?.stageId || "geometry";
    const transformStageId = kernel?.inputBindings?.transform?.stageId || "transform";
    const materialStageId = kernel?.inputBindings?.material?.stageId || "material";
    const cameraStageId = kernel?.inputBindings?.camera?.stageId || "camera";
    if (
      !specializedCompoundStageEnabled(operation, geometryStageId) ||
      !specializedCompoundStageEnabled(operation, transformStageId) ||
      !specializedCompoundStageEnabled(operation, materialStageId) ||
      !specializedCompoundStageEnabled(operation, cameraStageId) ||
      !specializedCompoundStageEnabled(operation, renderStageId)
    ) {
      this.drawStandby(pg, "Anatomy compound stage disabled");
      return;
    }
    const authoredParams = source.params || {};
    const anatomyInstanceId = source.instanceId || renderRequest.renderIdentity || source.generatorId || "anatomy";
    let external = this.anatomyGraphExternalInputs.get(anatomyInstanceId);
    if (!external || external.stageId !== transformStageId) {
      const stageInputs = { componentTime: 0 };
      external = {
        stageId: transformStageId,
        stageInputs,
        inputs: { [transformStageId]: stageInputs },
      };
      this.anatomyGraphExternalInputs.set(anatomyInstanceId, external);
    }
    external.stageInputs.componentTime = componentTime;
    const graph = evaluateSpecializedCompoundGraph(
      operation,
      authoredParams,
      { instanceId: anatomyInstanceId },
      external.inputs,
    );
    let transformParams = graph?.stageInputs(transformStageId)?.settings ||
      specializedCompoundStageParameterView(operation, transformStageId, authoredParams, anatomyInstanceId);
    const renderParams = graph?.stageInputs(renderStageId)?.settings ||
      specializedCompoundStageParameterView(operation, renderStageId, authoredParams, anatomyInstanceId);
    let geometryValue = graph?.stageInput(renderStageId, "geometry");
    let transformValue = graph?.stageInput(renderStageId, "transform");
    let materialValue = graph?.stageInput(renderStageId, "material");
    let cameraValue = graph?.stageInput(renderStageId, "camera");
    if (operation?.nativeCompoundProgram && (
      !geometryValue ||
      !transformValue ||
      !materialValue ||
      !cameraValue
    )) {
      this.drawStandby(pg, "Anatomy graph input unavailable");
      return;
    }
    if (!operation?.nativeCompoundProgram) {
      geometryValue = executeSpecializedCompoundProvider(
        operation, geometryStageId, authoredParams, anatomyInstanceId,
      );
      materialValue = executeSpecializedCompoundProvider(
        operation, materialStageId, authoredParams, anatomyInstanceId,
      );
      cameraValue = executeSpecializedCompoundProvider(
        operation, cameraStageId, authoredParams, anatomyInstanceId,
      );
      transformParams.componentTime = componentTime;
      transformValue = executeSpecializedCompoundStage(
        operation,
        transformStageId,
        transformParams,
        anatomyInstanceId,
      )?.transform;
    }
    const resolvedGeometryParams = geometryValue?.settings ||
      specializedCompoundStageParameterView(operation, geometryStageId, authoredParams, anatomyInstanceId);
    const resolvedMaterialParams = materialValue?.settings ||
      specializedCompoundStageParameterView(operation, materialStageId, authoredParams, anatomyInstanceId);
    const resolvedCameraParams = specializedCompoundStageParameterView(
      operation, cameraStageId, authoredParams, anatomyInstanceId,
    );
    const nodeModule = anatomyNodeRuntimeModule(operation);
    const target = this.getModelTarget(renderRequest.width, renderRequest.height, renderRequest.pixelDensity);
    const viewport = modelViewportMetrics(target, renderRequest);
    const renderMode = resolvedMaterialParams.renderMode || "surface";
    const surfaceColor = modelColor(resolvedMaterialParams.surfaceColor, [217, 212, 201, 255]);
    const wireColor = modelColor(resolvedMaterialParams.wireColor, [75, 73, 68, 204]);
    const wireThickness = resolutionScaledStrokeWidth(modelWireThickness(resolvedMaterialParams), renderRequest);
    const rotation = transformValue?.rotation || modelRotation(transformParams, componentTime);
    const detail = Math.max(4, Math.min(14, Math.round(
      (Number(resolvedGeometryParams.detail) || 8) * qualityComputeMultiplier(renderParams, { minimum: 0.55, maximum: 1.35 })
    )));
    const modelScale = Math.max(
      0.01,
      Number(transformValue?.scale?.[0] ?? transformParams.modelScale) || 1,
    );
    const depth = Math.max(0.05, Number(resolvedGeometryParams.depth) || 1);
    const canonicalCameraFov = cameraValue?.kind === "camera3d"
      ? Number(cameraValue.fieldOfView)
      : NaN;
    const requestedFov = Number(resolvedCameraParams.fieldOfView);
    const cameraFov = Number.isFinite(canonicalCameraFov)
      ? Math.max(20 * Math.PI / 180, Math.min(120 * Math.PI / 180, canonicalCameraFov))
      : Number.isFinite(requestedFov)
        ? Math.max(20, Math.min(120, requestedFov)) * Math.PI / 180
        : modelCameraFov(resolvedCameraParams);
    this.measureGpu(target, () => {
      target.push();
      target.clear();
      applyModelViewportProjection(target, cameraFov, viewport);
      target.camera?.(0, 0, viewport.cameraZ, 0, 0, 0, 0, 1, 0);
      target.ambientLight?.(96);
      target.directionalLight?.(238, 232, 220, -0.45, -0.55, -0.75);
      target.directionalLight?.(82, 94, 108, 0.7, 0.15, -0.35);
      applyModelContentTransform(target, source.contentTransform, viewport);
      target.rotateX(rotation[0]);
      target.rotateY(rotation[1]);
      target.rotateZ(rotation[2]);
      const scale = viewport.unitScale * modelScale * nodeModule.anatomyPartFitScale(resolvedGeometryParams.part);
      target.scale(scale, -scale, scale * depth);
      nodeModule.drawProceduralAnatomy(target, resolvedGeometryParams, componentTime, renderMode, surfaceColor, wireColor, wireThickness, detail);
      target.pop();
    });
    markRenderTargetOrientation(target, RENDER_TEXTURE_ORIENTATION.topLeft);
    this.presentGeneratedTarget(pg, target);
  }

  drawTerrain(pg, source = {}, componentTime = 0, renderRequest = {}, operation = null) {
    const surfaceKernel = specializedCompoundNativeKernel(operation, "terrain-surface");
    const wireKernel = specializedCompoundNativeKernel(operation, "terrain-wire");
    if (operation?.nativeCompoundProgram && (!surfaceKernel || !wireKernel)) {
      this.drawStandby(pg, "Terrain kernel schedule unavailable");
      return;
    }
    const surfaceStageId = surfaceKernel?.id || "surface-render";
    const wireStageId = wireKernel?.id || "wire-render";
    const flightStageId = surfaceKernel?.inputBindings?.controller?.stageId || "flight";
    const geometryStageId = surfaceKernel?.inputBindings?.geometry?.stageId || "geometry";
    const cameraStageId = surfaceKernel?.inputBindings?.camera?.stageId || "camera";
    const surfaceMaterialStageId = surfaceKernel?.inputBindings?.material?.stageId || "surface-material";
    const wireMaterialStageId = wireKernel?.inputBindings?.material?.stageId || "wire-material";
    if (
      !specializedCompoundStageEnabled(operation, flightStageId) ||
      !specializedCompoundStageEnabled(operation, geometryStageId) ||
      !specializedCompoundStageEnabled(operation, cameraStageId)
    ) {
      this.drawStandby(pg, "Terrain compound stage disabled");
      return;
    }
    const authoredParams = source.params || {};
    const flightKey = source.instanceId || renderRequest.renderIdentity || source.generatorId || "terrain";
    let external = this.terrainGraphExternalInputs.get(flightKey);
    if (!external || external.stageId !== flightStageId) {
      const stageInputs = { componentTime: 0 };
      external = {
        stageId: flightStageId,
        stageInputs,
        inputs: { [flightStageId]: stageInputs },
      };
      this.terrainGraphExternalInputs.set(flightKey, external);
    }
    external.stageInputs.componentTime = componentTime;
    const graph = evaluateSpecializedCompoundGraph(
      operation,
      authoredParams,
      { instanceId: flightKey },
      external.inputs,
    );
    const surfaceRenderSettings = graph?.stageInputs(surfaceStageId)?.settings ||
      specializedCompoundStageParameterView(operation, surfaceStageId, authoredParams, flightKey);
    const wireRenderSettings = graph?.stageInputs(wireStageId)?.settings ||
      specializedCompoundStageParameterView(operation, wireStageId, authoredParams, flightKey);
    const renderViewport = renderView(pg, renderRequest);
    const target = this.getTerrainTarget(renderRequest.width, renderRequest.height, renderRequest.pixelDensity);
    const authoredStyleValue = surfaceRenderSettings.style ?? wireRenderSettings.style;
    const authoredStyle = authoredStyleValue === "wire" ? 1 : authoredStyleValue === "hybrid" ? 2 : 0;
    const drawSurface = authoredStyle !== 1 &&
      specializedCompoundStageEnabled(operation, surfaceMaterialStageId) &&
      specializedCompoundStageEnabled(operation, surfaceStageId);
    const drawWire = authoredStyle >= 1 &&
      specializedCompoundStageEnabled(operation, wireMaterialStageId) &&
      specializedCompoundStageEnabled(operation, wireStageId);
    const style = drawSurface && drawWire ? 2 : drawWire ? 1 : 0;
    let flight = graph?.stageInput(surfaceStageId, "controller");
    let geometryValue = graph?.stageInput(surfaceStageId, "geometry");
    let cameraValue = graph?.stageInput(surfaceStageId, "camera");
    let surfaceMaterialValue = graph?.stageInput(surfaceStageId, "material");
    let wireMaterialValue = graph?.stageInput(wireStageId, "material");
    if (operation?.nativeCompoundProgram && (
      !flight ||
      !geometryValue ||
      !cameraValue ||
      !surfaceMaterialValue ||
      !wireMaterialValue
    )) {
      this.drawStandby(pg, "Terrain graph input unavailable");
      return;
    }
    if (!operation?.nativeCompoundProgram) {
      // Direct legacy host invocations do not carry a compiled Group. Keep
      // their controller state isolated while production compiled compounds
      // execute the displayed Terrain Flight Controller node itself.
      const flightSettings = specializedCompoundStageParameterView(
        operation, flightStageId, authoredParams, flightKey,
      );
      const flightSpeed = Math.max(0, Number(flightSettings.flightSpeed) || 0);
      const flightInputs = flightSettings;
      flightInputs.componentTime = componentTime;
      flightInputs.flightSpeed = flightSpeed;
      const flightState = this.terrainFlightStates.get(flightKey) || {};
      flight = terrainFlightControllerProcess(flightInputs, { state: flightState }).flight;
      this.terrainFlightStates.set(flightKey, flightState);
      geometryValue = executeSpecializedCompoundProvider(
        operation, geometryStageId, authoredParams, flightKey,
      );
      cameraValue = executeSpecializedCompoundProvider(
        operation, cameraStageId, authoredParams, flightKey,
      );
      surfaceMaterialValue = executeSpecializedCompoundProvider(
        operation, surfaceMaterialStageId, authoredParams, flightKey,
      );
      wireMaterialValue = executeSpecializedCompoundProvider(
        operation, wireMaterialStageId, authoredParams, flightKey,
      );
    }
    const flightTime = flight.flightTime;
    const geometryProvider = String(
      geometryValue?.providerId ||
      specializedCompoundStageProvider(operation, geometryStageId, "terrain-height-field"),
    );
    const geometrySettings = geometryValue?.settings || specializedCompoundStageParameterView(
      operation, geometryStageId, authoredParams, flightKey,
    );
    const cameraSettings = cameraValue?.settings || specializedCompoundStageParameterView(
      operation, cameraStageId, authoredParams, flightKey,
    );
    const surfaceMaterialSettings = surfaceMaterialValue?.settings || specializedCompoundStageParameterView(
      operation, surfaceMaterialStageId, authoredParams, flightKey,
    );
    const wireMaterialSettings = wireMaterialValue?.settings || specializedCompoundStageParameterView(
      operation, wireMaterialStageId, authoredParams, flightKey,
    );
    const terrainParams = {
      ...geometrySettings,
      ...cameraSettings,
      ...surfaceMaterialSettings,
      ...wireMaterialSettings,
      ...surfaceRenderSettings,
      ...wireRenderSettings,
    };
    const flightParams = lowerTerrainGeometryProvider({
      ...terrainParams,
      turn: flight.turn,
      altitude: flight.altitude,
      flightSpeed: 1,
      terrainScale: flight.terrainScale,
      terrainPhase: flight.terrainPhase,
      renderUvRect: renderViewport.uvRect,
      contentPlacementMatrix: contentTransformUvMatrices(source.contentTransform).placement,
      gridDensity: Math.max(0.25, Math.min(4,
        (Number(geometrySettings.gridDensity) || 1) * qualityComputeMultiplier(terrainParams, { minimum: 0.4, maximum: 1.5 })
      )),
    }, geometryProvider);
    const sky = normalizedModelColor(surfaceMaterialSettings.skyColor, [108, 165, 212, 255]);
    const terrainModule = terrainNodeRuntimeModule(operation);
    const codeRevision = String(operation?.nodeCodeRevision || operation?.nodeModuleRevision || "legacy");
    const shaderRevision = String(operation?.nodeShaderRevision || operation?.nodeModuleRevision || "legacy");
    const surfaceShaderRevision = String(operation?.nodeShaderProgramRevisions?.surface || shaderRevision);
    const wireShaderRevision = String(operation?.nodeShaderProgramRevisions?.wire || shaderRevision);
    const nodeShaders = operation?.nodeShaders || null;
    if (compiledSpecializedOperation(operation)) {
      if (drawSurface) {
        terrainNodeShaderSource(operation, "terrain-surface-vertex");
        terrainNodeShaderSource(operation, "terrain-surface-fragment");
      }
      if (drawWire) {
        terrainNodeShaderSource(operation, "terrain-wire-vertex");
        terrainNodeShaderSource(operation, "terrain-wire-fragment");
      }
    }
    this.measureGpu(target, () => {
      target.push();
      target.clear();
      if (drawSurface) target.background(sky[0] * 255, sky[1] * 255, sky[2] * 255, sky[3] * 255);
      if (drawSurface) drawTerrainSurface(target, this.terrainSurfaceResources, flightParams, flightTime, renderViewport.width, renderViewport.height, style, sky, terrainModule, codeRevision, nodeShaders, surfaceShaderRevision);
      if (drawWire) drawTerrainWireframe(target, this.terrainWireResources, flightParams, flightTime, renderViewport.width, renderViewport.height, renderRequest, terrainModule, codeRevision, nodeShaders, wireShaderRevision);
      target.pop();
    });
    // Camera/projected coordinates are already in screen-down Composition
    // space, but raw WebGL framebuffer storage still has a bottom-left texture
    // origin. Describe storage truthfully here; presentGeneratedTarget() owns
    // the single conversion into the top-left compositor convention.
    markRenderTargetOrientation(target, RENDER_TEXTURE_ORIENTATION.bottomLeft);
    this.presentGeneratedTarget(pg, target);
  }

  drawModel(pg, item, source = {}, componentTime = 0, renderRequest = {}) {
    const params = source.params || {};
    // This is compatibility-only for pre-v31 runtime packets. Canonical
    // projects compile model media as an editable Scene3d Group. Both paths
    // invoke the same retained raw-WebGL mesh operation.
    const target = this.getRawModelTarget(
      renderRequest.width,
      renderRequest.height,
      renderRequest.pixelDensity,
    );
    const viewport = modelViewportMetrics(target, renderRequest);
    const renderMode = params.renderMode || "surface";
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const pointBudget = Math.max(128, Math.min(50000, Math.round(
      (Number(params.pointBudget) || 4000) * qualityComputeMultiplier(params, { minimum: 0.25, maximum: 1.75 })
    )));
    const surfaceColor = modelColor(params.surfaceColor, [220, 225, 220, 255]);
    const wireColor = modelColor(params.wireColor, [20, 20, 20, 220]);
    const wireThickness = resolutionScaledStrokeWidth(modelWireThickness(params), renderRequest);
    const importBasis = modelImportBasis(item);
    const rotation = modelRotation(params, componentTime, importBasis);
    const modelMesh = selectModelLod(item.modelData, modelLodTargetTriangles({
      width: renderRequest.width,
      height: renderRequest.height,
      renderMode,
      renderQuality: params.renderQuality,
      edgeBudget: params.edgeBudget,
      wireDetail: params.wireDetail,
    }));
    const gpuToken = this.gpuTimer.begin(target, this.frameIndex());
    try {
      target.push();
      target.clear();
      // Intentional allocation-stable fast path: the live loop invokes the node-owned
      // render implementation directly, avoiding packet, scheduler, and instance
      // allocation overhead while keeping the exact established p5/WebGL UX.
      // The media adapter now lowers legacy STL/OBJ controls to the same
      // independently connectable values used by core.mesh.render. The shared
      // framebuffer and retained mesh caches remain backend details.
      const meshRenderValues = updateMediaMeshRenderValues(item.modelRenderNodeValues, {
        id: `${item.id || "model"}-material`,
        renderMode,
        surfaceColor,
        wireColor,
        wireThickness: modelWireThickness(params),
        pointBudget,
        visibleDepth: params.visibleDepth,
        rotation,
        modelScale,
        depth,
        fieldOfView: modelCameraFov(params),
      });
      item.modelRenderNodeValues = meshRenderValues;
      const modelRenderNodeState = item.modelRenderNodeState || (item.modelRenderNodeState = {});
      const rawParsedDrawn = item.modelData && renderMeshNodeProcess({
        ...params,
        mesh: modelMesh,
        material: meshRenderValues.material,
        transform: meshRenderValues.transform,
        camera: meshRenderValues.camera,
        target,
        cacheOwner: item,
        componentTime,
        viewport,
        contentTransform: source.contentTransform,
        modelScale: 1,
        depth: 1,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        spinX: 0,
        spinY: 0,
        spinZ: 0,
        // drawModel already cleared the retained depth target above. Keeping
        // the clear at this native-composite boundary avoids a second
        // framebuffer clear inside the generalized node process.
        clear: false,
      }, { state: modelRenderNodeState }).result.rendered;
      if (!rawParsedDrawn) {
        if (!item.modelSharedRenderFailureLogged) {
          item.modelSharedRenderFailureLogged = true;
          console.error("[VJ1_MODEL_SHARED_RENDER_FAILED]", {
            mediaId: item.id,
            message: "canonical mesh could not render in the shared GPU context",
          });
        }
      }
      markRenderTargetOrientation(target, RENDER_TEXTURE_ORIENTATION.bottomLeft);
      target.pop();
    } finally {
      this.gpuTimer.end(gpuToken);
    }
    this.presentGeneratedTarget(pg, target);
  }

  presentGeneratedTarget(pg, target) {
    const contextKey = pg?.__vj1ShaderContextId || pg?.drawingContext || pg;
    let shaderProgram = this.presentationShaders.get(contextKey);
    if (!shaderProgram && typeof pg?.createShader === "function") {
      try {
        shaderProgram = pg.createShader(RENDER_PASS_VERTEX_SHADER, GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER);
        this.presentationShaders.set(contextKey, shaderProgram);
      } catch (error) {
        shaderProgram = null;
        if (!this.presentationShaderFailures.has(contextKey)) {
          this.presentationShaderFailures.add(contextKey);
          console.error("[VJ1_PRESENTATION_SHADER_FAILED]", {
            target: renderTargetDescriptor(target).kind,
            fallback: "drawBuffer",
            message: error?.message || String(error || "presentation shader creation failed"),
          });
        }
      }
    }
    if (!shaderProgram || typeof pg?.drawWebGL !== "function") {
      pg.push();
      pg.clear();
      drawBuffer(pg, target, 0, 0, pg.width, pg.height, true);
      pg.pop();
      return;
    }
    const baseFlip = !isSharedFramebufferTarget(target);
    const storageFlip = renderTargetNeedsPresentationFlip(target);
    drawShaderTarget(pg, () => {
      clearShaderTarget(pg);
      applyShaderTarget(pg, shaderProgram);
      shaderProgram.setUniform("sourceTex", unwrapRenderTarget(target));
      shaderProgram.setUniform("sourceFlipY", baseFlip !== storageFlip);
      drawShaderTargetRect(pg, pg.width, pg.height);
      resetShaderTarget(pg);
    });
  }

  continuousRateTime(key, baseTime, rate) {
    const next = advanceRateClock(this.rateClocks.get(key), baseTime, rate);
    this.rateClocks.set(key, next);
    return next.time;
  }

  getModelTarget(width, height, density = 1) {
    return this.getTarget("model", width, height, density, {
      onContextDiscard: (gl) => this.resetModelResources(gl),
    });
  }

  getRawModelTarget(width, height, density = 1) {
    return this.getTarget("modelRaw", width, height, density, {
      onContextDiscard: (gl) => this.resetModelResources(gl),
      preferSharedFramebuffer: true,
      depth: true,
    });
  }

  getTerrainTarget(width, height, density = 1) {
    return this.getTarget("terrain", width, height, density, {
      onContextDiscard: () => this.resetTerrainResources(),
      preferSharedFramebuffer: true,
      depth: true,
    });
  }

  getTarget(kind, width, height, density = 1, {
    onContextDiscard = null,
    preferSharedFramebuffer = false,
    depth = false,
  } = {}) {
    const widthPx = Math.max(1, Math.round(Number(width) || 1));
    const heightPx = Math.max(1, Math.round(Number(height) || 1));
    const targetDensity = Math.max(0.25, Math.min(4, Number(density) || 1));
    let target = this.targets.get(kind);
    if (!target) {
      target = createSpecializedTarget(widthPx, heightPx, targetDensity, preferSharedFramebuffer, depth, this.applyGraphicsPixelDensity);
      this.targets.set(kind, target);
      return target;
    }
    const sizeChanged = target.width !== widthPx || target.height !== heightPx;
    const densityChanged = target.__vj1PixelDensity !== targetDensity;
    if (sizeChanged || densityChanged) {
      try {
        if (sizeChanged) target.resizeCanvas(widthPx, heightPx);
        if (!isSharedFramebufferTarget(target)) this.applyGraphicsPixelDensity(target, targetDensity);
      } catch (error) {
        console.error("[VJ1_SPECIALIZED_TARGET_RESIZE_FAILED]", {
          kind,
          width: widthPx,
          height: heightPx,
          density: targetDensity,
          fallback: "recreate-target",
          message: error?.message || String(error || "specialized target resize failed"),
        });
        onContextDiscard?.(target?.drawingContext);
        disposeGraphics(target);
        target = createSpecializedTarget(widthPx, heightPx, targetDensity, preferSharedFramebuffer, depth, this.applyGraphicsPixelDensity);
        this.targets.set(kind, target);
      }
      target.__vj1PixelDensity = targetDensity;
      if (!isSharedFramebufferTarget(target)) target.noStroke();
    }
    return target;
  }

  resetTerrainResources() {
    for (const [gl, resources] of this.terrainSurfaceResources) disposeTerrainSurfaceResources(gl, resources);
    for (const [gl, resources] of this.terrainWireResources) disposeTerrainWireResources(gl, resources);
    this.terrainSurfaceResources.clear();
    this.terrainWireResources.clear();
  }

  resetModelResources(gl = null) {
    for (const item of this.media()?.values?.() || []) {
      disposeRawModelItemResources(item, gl);
    }
  }

  dispose() {
    this.resetModelResources();
    this.resetTerrainResources();
    disposeGraphicsMap(this.targets);
    this.rateClocks.clear();
    this.anatomyGraphExternalInputs.clear();
    this.terrainFlightStates.clear();
    this.terrainGraphExternalInputs.clear();
    this.featureMorphShader = null;
    this.featureMorphShaderRevision = "";
    this.featureMorphV2Shader = null;
    this.featureMorphV2ShaderRevision = "";
    this.controlledShaderPrograms.clear();
    this.controlledShaderGraphExternalInputs.clear();
    this.tileTextureShader = null;
    this.tileTextureShaderRevision = "";
    this.textGeneratorShader = null;
    this.textGeneratorShaderRevision = "";
    this.textMasks.clear();
    this.textGraphExternalInputs.clear();
    this.meshPatterns.dispose();
    this.presentationShaders.clear();
    this.presentationShaderFailures.clear();
  }
}

function createSpecializedTarget(width, height, density, preferSharedFramebuffer, depth, applyDensity) {
  const target = (preferSharedFramebuffer ? createSharedFramebufferTarget(width, height, { depth }) : null)
    || createGraphics(width, height, WEBGL);
  if (!isSharedFramebufferTarget(target)) applyDensity(target, density);
  target.__vj1PixelDensity = density;
  if (!isSharedFramebufferTarget(target)) target.noStroke();
  return target;
}

export { terrainCameraView };

function featureMorphFlowImage(field = {}) {
  if (field.flowImage) return field.flowImage;
  const image = createImage(field.width, field.height * (field.phases || 1) * (field.layers || 1));
  image.loadPixels();
  image.pixels.set(field.pixels);
  image.updatePixels();
  field.flowImage = image;
  return image;
}

function applyModelContentTransform(target, transform = {}, viewport = {}) {
  if (isIdentityTransform(transform)) return;
  const value = normalizedContentTransform(transform);
  const width = Math.max(1, Number(viewport.width) || Number(target?.width) || 1);
  const height = Math.max(1, Number(viewport.height) || Number(target?.height) || 1);
  target.translate(value.x * width * 0.5, value.y * height * 0.5, 0);
  target.rotateZ(value.rotation);
  target.scale(value.scale, value.scale, value.scale);
}

function drawShaderTarget(target, draw) {
  if (isSharedFramebufferTarget(target)) {
    return target.drawWebGL(() => {
      push();
      try {
        noStroke();
        return draw();
      } finally {
        pop();
      }
    });
  }
  target.push();
  try {
    return draw();
  } finally {
    target.pop();
  }
}

function clearShaderTarget(target) {
  if (isSharedFramebufferTarget(target)) clear();
  else target.clear();
}

function applyShaderTarget(target, shaderProgram) {
  if (isSharedFramebufferTarget(target)) shader(shaderProgram);
  else target.shader(shaderProgram);
}

function resetShaderTarget(target) {
  if (isSharedFramebufferTarget(target)) resetShader();
  else target.resetShader();
}

function setOptionalShaderUniform(shaderProgram, name, value) {
  if (shaderProgram?.uniforms?.[name]) shaderProgram.setUniform(name, value);
}

function drawShaderTargetRect(target, width, height) {
  if (isSharedFramebufferTarget(target)) rect(-width / 2, -height / 2, width, height);
  else target.rect(-width / 2, -height / 2, width, height);
}

function disposeGraphicsMap(map) {
  const seen = new Set();
  for (const item of map.values()) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    disposeGraphics(item);
  }
  map.clear();
}

function disposeGraphics(item) {
  disposeRenderTarget(item);
}

function colorUniform(value, fallback = "#ffffffff") {
  const clean = String(value || fallback).replace(/^#/, "");
  const fallbackClean = String(fallback).replace(/^#/, "");
  const normalized = /^[0-9a-f]{8}$/i.test(clean)
    ? clean
    : /^[0-9a-f]{6}$/i.test(clean) ? `${clean}ff` : fallbackClean;
  return [0, 2, 4, 6].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

function textMaskImage(canvas, existing = null) {
  const width = Math.max(1, Number(canvas?.width) || 1);
  const height = Math.max(1, Number(canvas?.height) || 1);
  const image = existing?.width === width && existing?.height === height
    ? existing
    : createImage(width, height);
  const pixels = canvas
    .getContext("2d", { alpha: true, willReadFrequently: true })
    .getImageData(0, 0, width, height).data;
  image.loadPixels();
  image.pixels.set(pixels);
  image.updatePixels();
  return image;
}

function pruneOldestEntries(map, maximum) {
  while (map.size > maximum) {
    let oldestKey = null;
    let oldestFrame = Infinity;
    for (const [key, value] of map) {
      if ((Number(value?.lastUsedFrame) || 0) >= oldestFrame) continue;
      oldestKey = key;
      oldestFrame = Number(value?.lastUsedFrame) || 0;
    }
    if (oldestKey === null) return;
    map.delete(oldestKey);
  }
}
