import { OutputMediaRuntime } from "./output-media-runtime.js";
import { ControlSignalRuntime } from "./control-signal-runtime.js";
import { OutputThumbnailRuntime } from "./output-thumbnail-runtime.js";
import { OutputSurfaceRuntime } from "./output-surface-runtime.js";
import { IsfRenderRuntime } from "./isf-render-runtime.js";
import { TextureOperatorRuntime } from "./texture-operator-runtime.js";
import { ShaderEffectRuntime } from "./shader-effect-runtime.js";
import { ShaderGeneratorRuntime } from "./shader-generator-runtime.js";
import { RenderEvaluationRuntime } from "./render-evaluation-runtime.js";
import { RenderTargetRuntime } from "./render-target-runtime.js";
import { RenderRequestRuntime } from "./render-request-runtime.js";
import { CompositeRenderRuntime } from "./composite-render-runtime.js";
import { TransitionRuntime } from "./transition-runtime.js";
import {
  ComponentProgramRuntime,
  renderStateComponentProgramRoots,
} from "./component-program-runtime.js";
import {
  ComponentRenderRuntime,
  componentPipelineSourceRequest,
} from "./component-render-runtime.js";
import { MappingProgramRuntime } from "./mapping-program-runtime.js";
import {
  VisualPlanRuntime,
  primaryTextureInputPort,
  visualOperationRenderItem,
} from "./visual-plan-runtime.js";
import { SourceRenderRuntime } from "./source-render-runtime.js";
import { ComponentPreviewInteraction } from "./component-preview-interaction.js";
import { PreviewHitCoverage } from "./preview-hit-coverage.js";
import { OutputRenderProfile } from "./output-render-profile.js";
import { OutputPresentationMetrics } from "./output-presentation-metrics.js";
import { PresentationGeometryRuntime } from "./presentation-geometry-runtime.js";
import { OutputReadinessRuntime } from "./output-readiness-runtime.js";
import { OutputFrameRuntime } from "./output-frame-runtime.js";
import { LiveRenderPatchRuntime } from "./live-render-patch-runtime.js";
import { VisualNodeRuntime } from "./visual-node-runtime.js";
import { OutputMappingRuntime } from "./output-mapping-runtime.js";
import { OutputPresentationRuntime } from "./output-presentation-runtime.js";
import { ProbeRuntime } from "./probe-runtime.js";
import { OutputResourceRuntime } from "./output-resource-runtime.js";
import { OutputStateRuntime } from "./output-state-runtime.js";
import {
  frameSize,
} from "./render-geometry.js";
import { SpecializedSourceRuntime } from "./specialized/specialized-source-runtime.js";
import { NativeRendererRegistry } from "../libraries/render-engine/native-renderer-registry.js";
import { signalLoadMeter } from "../metrics/signal-load-meter.js";

export { averageGpuQueryNanoseconds, GpuTimerTracker } from "./gpu-timer-tracker.js";
export { parseObjMesh } from "../libraries/mesh-engine/obj-parser/index.js";
export { modelDepthCutoff, transformedModelDepthRange } from "../libraries/mesh-engine/mesh-render-math.js";
export { chainTransformDragScale, pointInTransformedRect } from "./preview-interaction-geometry.js";
export { advanceRateClock, advanceSpatialScale, componentInstanceTime, effectTransformUniforms, eyeballFrameUniforms, instanceTime, qualityAdjustedGeneratorParams, qualityScaledRenderRequest } from "./render-runtime-math.js";
export { sourceWithNodeParams } from "./component-patch-adapter.js";
export { effectNeedsComposite } from "./shader-target-runtime.js";
export {
  compiledSourceRenderRequest,
  compiledNativeSourceRenderer,
  compiledVisualSourceRenderer,
  mediaSourceDemandSize,
  mediaSourceDemandWidth,
  namedTextureStateKey,
  namedValueIdentityKey,
} from "./source-render-runtime.js";
export { fittedThumbnailSize } from "./thumbnail-utils.js";
export { cameraCaptureSettings, cameraSettingsSignature } from "./shared-input-runtime.js";
export {
  terrainExpandedGridWireVertices,
  terrainExpandedWireVertices,
  terrainGridSize,
  terrainSafeNearDistance,
  terrainSurfaceGridVertices,
  terrainSurfaceTriangleIndices,
  terrainTriangleEdgeUvs,
} from "./specialized/terrain-mesh.js";
export {
  sceneComponentPlacementRect,
  surfaceBorderHit,
  sceneMaxRasterSize,
  scenePreviewRenderRequest,
  componentAdaptiveRasterLimit,
  componentLogicalPreviewRect,
  componentPreviewRenderRequest,
  componentReferencePlacement,
  componentReferenceCount,
  componentReferencePrefersSharedTexture,
  componentReferenceRegionRequest,
  componentReferenceRenderRequest,
  componentReferenceVisibleRenderRequest,
  componentRenderInstanceKey,
  componentSourceView,
  directFitRects,
  moveSurfaceRect,
  resolutionScaledStrokeWidth,
  resizeSurfaceRect,
  scaledComponentSampleRect,
  sharedComponentRenderRequests,
} from "./component-render-layout.js";

export { primaryTextureInputPort, visualOperationRenderItem };

export { renderStateComponentProgramRoots };
export { componentPipelineSourceRequest };

export class OutputRenderer {
  constructor({ mode, outputId = "", hud, font, sendMetrics, sendMapping, sendThumbnail, sendChainTransform, sendChainBoundary, sendSurfaceRect, sendMediaRendition, sendMediaMetadata, requestMediaFiles, requestPresentationFrame, onSurfaceSelect, onChainItemSelect, onSceneSurfaceSelect, sendDmxFixture = null, controlSignals = null, installedNodePackages = [] }) {
    this.mode = mode;
    this.outputId = outputId;
    this.hud = hud;
    this.sendMetrics = sendMetrics;
    this.sendMapping = sendMapping;
    this.sendThumbnail = sendThumbnail;
    this.sendChainTransform = sendChainTransform;
    this.sendChainBoundary = sendChainBoundary;
    this.sendSurfaceRect = sendSurfaceRect;
    this.sendMediaRendition = sendMediaRendition;
    this.sendMediaMetadata = sendMediaMetadata;
    this.requestMediaFiles = requestMediaFiles;
    this.requestPresentationFrame = requestPresentationFrame;
    this.onSurfaceSelect = onSurfaceSelect;
    this.onChainItemSelect = onChainItemSelect;
    this.onSceneSurfaceSelect = onSceneSurfaceSelect;
    this.sendDmxFixture = sendDmxFixture;
    this.signalMeter = signalLoadMeter(mode === "output" ? "output" : "preview");
    this.stateRuntime = new OutputStateRuntime(this);
    this.resourceRuntime = new OutputResourceRuntime(this, { font });
    this.presentationGeometry = new PresentationGeometryRuntime(this);
    this.mappingRuntime = new OutputMappingRuntime(this, {
      sendMapping: (...args) => this.sendMapping?.(...args),
    });
    this.ownsControlSignalRuntime = !controlSignals;
    this.controlSignalRuntime = controlSignals || new ControlSignalRuntime({
      onInvalidate: (reason) => this.invalidatePresentation(reason),
    });
    this.probeRuntime = new ProbeRuntime(this);
    this.renderRequestRuntime = new RenderRequestRuntime({
      getRenderSettings: () => this.state?.render || {},
      getFrameSize: (render) => frameSize(render),
      getPixelDensity: (render) => this.presentationGeometry.pixelDensity(render),
      controlSignals: this.controlSignalRuntime,
    });
    this.renderTargetRuntime = new RenderTargetRuntime(this);
    this.renderEvaluationRuntime = new RenderEvaluationRuntime(this);
    this.visualNodeRuntime = new VisualNodeRuntime(this, {
      installedPackages: installedNodePackages,
    });
    this.livePatchRuntime = new LiveRenderPatchRuntime(this);
    this.mediaRuntime = new OutputMediaRuntime({
      getRenderSettings: () => this.state?.render || {},
      requestMediaFiles: (ids) => this.requestMediaFiles?.(ids),
      sendMediaRendition: (mediaId, width, height, blob, sourceRevision) => this.sendMediaRendition?.(mediaId, width, height, blob, sourceRevision),
      applyGraphicsFont: (target) =>
        this.resourceRuntime.applyGraphicsFont(target),
      onInvalidate: (reason) => this.invalidatePresentation(reason),
      onMediaMetadata: (mediaId, metadata) => this.sendMediaMetadata?.(mediaId, metadata),
    });
    this.media = this.mediaRuntime.media;
    this.thumbnailRuntime = new OutputThumbnailRuntime({
      getState: () => this.state,
      getComponentOutput: (componentId) =>
        this.resourceRuntime.componentOutput.get(componentId),
      getComponentProgram: (componentId) =>
        this.componentProgramRuntime.programs.get(componentId),
      canCapture: () => this.mode === "component",
      shouldUseThumbnailPreview: () =>
        this.presentationRuntime.shouldUseThumbnailPreview(),
      isComponentReady: (component) =>
        this.readinessRuntime.isComponentReady(component),
      sendThumbnail: (...args) => this.sendThumbnail?.(...args),
    });
    // Specialized terrain sources render sequentially and are copied into the
    // component target immediately. Terrain uses a framebuffer in the main
    // WebGL context so resizing its scratch target cannot invalidate p5's
    // cross-context canvas texture cache. Project models use the ordinary
    // MeshResource -> Scene3D -> Image graph and shared mesh render process.
    this.isfRuntime = new IsfRenderRuntime(this, {
      setShaderParams: (...args) => this.shaderEffectRuntime.setParamUniforms(...args),
    });
    this.surfaceRuntime = new OutputSurfaceRuntime(this, {
      resolveTransition: (...args) => this.transitionRuntime.resolve(...args),
    });
    this.previewHitCoverage = new PreviewHitCoverage(this);
    this.previewInteraction = new ComponentPreviewInteraction(this);
    this.presentationRuntime = new OutputPresentationRuntime(this);
    this.presentationMetrics = new OutputPresentationMetrics(this);
    this.nativeRendererRegistry = new NativeRendererRegistry();
    this.specializedSources = new SpecializedSourceRuntime({
      nativeRendererRegistry: this.nativeRendererRegistry,
      acquireMedia: (id, options) => this.mediaRuntime.acquireMediaById(id, options),
      requestMissingMediaBatch: (ids) => this.mediaRuntime.requestMissingMediaBatch(ids),
      applyGraphicsPixelDensity: (target, density) =>
        this.resourceRuntime.applyGraphicsPixelDensity(target, density),
      measureGpu: (target, draw) =>
        this.presentationRuntime.measureGpu(target, draw),
      frameIndex: () => this.frameRuntime.frameIndex,
      showDiagnostics: () =>
        this.mode !== "output" &&
        this.state?.ui?.debugPreview !== false,
      requestPixelDensity: (request) =>
        this.renderRequestRuntime.pixelDensity(request),
      onInvalidate: (reason) => this.invalidatePresentation(reason),
    });
    this.profileRuntime = new OutputRenderProfile();
    this.frameRuntime = new OutputFrameRuntime(this);
    this.textureOperatorRuntime = new TextureOperatorRuntime(this);
    this.transitionRuntime = new TransitionRuntime({
      getState: () => this.state,
      getVisualNodes: () => this.visualNodeRuntime.nodes,
      disposeTransitionShaders: () => this.textureOperatorRuntime.disposeTransitionShaders(),
      retainTransitionKernels: (kernels) =>
        this.mappingRuntime.mapper?.retainTransitionKernels?.(kernels),
      onCompile: () => this.recordSignal("compiles", 1, "transitions"),
    });
    this.compositeRuntime = new CompositeRenderRuntime(this);
    this.shaderEffectRuntime = new ShaderEffectRuntime(this, {
      getCustomCode: () => this.state?.shaders?.customCode || "",
      getComponent: (id) => this.visualNodeRuntime.effect(id),
      onStatus: (status, error) => {
        this.state.ui.shaderStatus = status;
        this.state.ui.shaderError = error || "";
      },
      getIsfRuntime: () => this.isfRuntime,
    });
    this.shaderGeneratorRuntime = new ShaderGeneratorRuntime(this);
    this.sourceRuntime = new SourceRenderRuntime(this, {
      mediaRuntime: this.mediaRuntime,
      nativeRendererRegistry: this.nativeRendererRegistry,
    });
    this.componentProgramRuntime = new ComponentProgramRuntime({
      getMode: () => this.mode,
      getState: () => this.state,
      getVisualNodes: () => this.visualNodeRuntime.nodes,
      getCoreDefinition: (id) => this.visualNodeRuntime.coreDefinition(id),
      getSourceRuntime: () => this.sourceRuntime,
      onCompile: (count, reason) => this.recordSignal("compiles", count, reason),
    });
    this.readinessRuntime = new OutputReadinessRuntime(this);
    this.componentRenderRuntime = new ComponentRenderRuntime(this);
    this.visualPlanRuntime = new VisualPlanRuntime(this);
    this.mappingProgramRuntime = new MappingProgramRuntime({
      getState: () => this.state,
      onCompile: (count, reason) => this.recordSignal("compiles", count, reason),
    });
  }

  async setup(initialState, { normalized = false } = {}) {
    this.stateRuntime.initialize(initialState, { normalized });
  }

  dispose() {
    this.previewHitCoverage.dispose();
    this.previewInteraction.dispose();
    this.thumbnailRuntime.dispose();
    this.presentationRuntime.dispose();
    this.surfaceRuntime.dispose();
    this.componentProgramRuntime.dispose();
    this.mappingProgramRuntime.clear();
    this.probeRuntime.dispose();
    this.resourceRuntime.disposeBuffers();
    this.mappingRuntime.dispose();
    this.sourceRuntime.dispose();
    this.nativeRendererRegistry.clear();
    this.mediaRuntime.dispose();
    if (this.ownsControlSignalRuntime) this.controlSignalRuntime.dispose();
  }

  setState(nextState, { normalized = false } = {}) {
    return this.stateRuntime.activate(nextState, { normalized });
  }

  setUiState(nextState, { normalized = false } = {}) {
    return this.stateRuntime.activateUi(nextState, { normalized });
  }

  setMappingState(nextState, { normalized = false } = {}) {
    return this.stateRuntime.activateMapping(nextState, { normalized });
  }

  setProjectionState(nextState, { normalized = false } = {}) {
    return this.stateRuntime.activateProjection(nextState, { normalized });
  }

  setAssetState(nextState, { normalized = false } = {}) {
    return this.stateRuntime.activateAssets(nextState, { normalized });
  }

  get state() {
    return this.stateRuntime.current;
  }

  set state(state) {
    this.stateRuntime.replace(state);
  }

  importFiles(files) {
    this.invalidatePresentation("media-files");
    this.mediaRuntime.importFiles(files);
  }

  importMediaRenditions(item, renditions) {
    this.mediaRuntime.importRenditions(item, renditions);
  }

  draw() {
    return this.presentationRuntime.draw();
  }

  mousePressed(x, y) {
    const point = this.presentationGeometry.previewPointToWorld({ x, y });
    return this.previewInteraction.mousePressed(point.x, point.y);
  }

  mouseDragged(x, y) {
    const point = this.presentationGeometry.previewPointToWorld({ x, y });
    return this.previewInteraction.mouseDragged(point.x, point.y);
  }

  mouseReleased() {
    const mappingWasActive = !!this.mappingRuntime.mapper?.isActive?.();
    const result = this.previewInteraction.mouseReleased();
    this.mappingRuntime.finishInteraction(mappingWasActive);
    return result;
  }

  invalidatePresentation(reason = "runtime") {
    this.recordSignal("invalidations", 1, reason);
    if (/(media|resource|asset|camera|screen|video|font|morph)/i.test(reason)) {
      this.recordSignal("resourceRevisions", 1, reason);
    }
    this.requestPresentationFrame?.(reason);
  }

  recordSignal(category, count = 1, reason = "") {
    this.signalMeter?.record(category, count, reason);
  }

  resize() {
    if (!this.resourceRuntime.matchesRenderSize()) {
      this.resourceRuntime.createBuffers();
    }
    this.mappingRuntime.resize();
  }

}
