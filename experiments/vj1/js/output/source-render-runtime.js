import { normalizeParamValues } from "../libraries/visual-nodes/shared/component-schema.js";
import {
  VISUAL_SOURCE_RENDERERS,
  visualSourceRenderer,
} from "../libraries/composition-engine/index.js?v=mesh-pattern-node-authority-1";
import {
  createPlacedRenderResult,
  transformedPlacementDemandRect,
} from "../graph/placed-render-result.js?v=atomic-video-seek-1";
import { drawStandby as drawStandbyDiagnostic } from "./generators.js?v=compiled-code-sources-1";
import { drawCover, drawMediaFit, isDrawableMedia } from "./media-utils.js?v=fit-geometry-demand-1";
import { mediaSourceFit } from "./component-patch-adapter.js?v=chain-general-controls-1";
import {
  combineContentTransforms,
  transformedRectBounds,
  transformedRectVisibleRegion,
} from "./preview-interaction-geometry.js?v=alpha-feather-1";
import { drawWithContentTransform } from "./shader-target-runtime.js?v=canonical-effect-params-1";
import {
  componentInstanceTime,
  instanceTime,
  qualityScaledRenderRequest,
} from "./render-runtime-math.js?v=volumetric-clouds-1";
import { frameRenderRequest } from "./render-geometry.js?v=output-one-1";
import {
  renderSourceDetail,
  renderView,
  withRenderView,
} from "../libraries/render-engine/render-view/index.js?v=source-detail-contract-1";
import {
  evaluateSpecializedCompoundGraph,
  specializedCompoundNativeKernel,
  specializedCompoundEvaluatedStageSettings,
  specializedCompoundStageEnabled,
  specializedCompoundStageParameterView,
} from "../libraries/visual-nodes/shared/specialized-compound.js?v=mesh-pattern-node-authority-1";
import {
  drawMediaResourceToImage as fallbackDrawMediaResourceToImage,
} from "../libraries/visual-nodes/renderers/media-resource-to-image/index.js?v=screen-input-semantic-1";
import {
  componentReferenceCount,
  componentReferencePlacement,
  componentReferencePrefersSharedTexture,
  componentReferenceRenderRequest,
  componentReferenceVisibleRenderRequest,
  componentRenderInstanceKey,
  fullTargetRect,
} from "./component-render-layout.js?v=surface-terminology-1";
import { withRenderTarget2D } from "./render-target-contract.js?v=source-target-ownership-1";

const SOURCE_RUNTIME_METHODS = Object.freeze({
  [VISUAL_SOURCE_RENDERERS.COMPONENT]: "drawComponentReferenceSource",
  [VISUAL_SOURCE_RENDERERS.MEDIA]: "drawMediaSource",
  [VISUAL_SOURCE_RENDERERS.CAMERA]: "drawCameraSource",
  [VISUAL_SOURCE_RENDERERS.BLACK]: "drawBlackSource",
  [VISUAL_SOURCE_RENDERERS.GENERATOR]: "drawGeneratorSource",
});

export function compiledVisualSourceRenderer(operation = {}, source = {}) {
  if (operation.backend === "source-runtime") {
    const renderer = String(operation.renderer || operation.compilerHook?.renderer || "");
    if (renderer) return renderer;
  }
  return visualSourceRenderer(source);
}

export function compiledNativeSourceRenderer(operation = {}, source = {}, generatorComponent = null) {
  if (operation.backend === "native-specialized") {
    const renderer = String(operation.renderer || operation.compilerHook?.renderer || "");
    if (renderer) return renderer;
  }
  if (source.type !== "generator") return "";
  return String(generatorComponent?.nodeDefinition?.metadata?.nativeRenderer || "");
}

export function mediaSourceDemandSize(request = {}, source = {}) {
  const descriptor = request && typeof request === "object" ? request : { width: request };
  return renderSourceDetail(descriptor, descriptor, {
    contentScale: source?.contentTransform?.scale,
  });
}

export function mediaSourceDemandWidth(request = {}, source = {}) {
  return mediaSourceDemandSize(request, source).width;
}

export class SourceRenderRuntime {
  constructor(host) {
    this.host = host;
    this.compiledNodeProcessContexts = new WeakMap();
    this.scene3dProgramContexts = new WeakMap();
    this.nativeRenderers = new Map();
    this.missingNativeRendererDiagnostics = new Set();
    this.missingGeneratorImplementationDiagnostics = new Set();
    this.sourceCrashDiagnostics = new Map();
    this.registerNativeRenderer(
      "output/specialized:screenShare",
      (target, source, time, request, operation) => this.drawScreenShareGenerator(
        target, source, time, request, operation,
      ),
    );
  }

  dispose() {
    this.compiledNodeProcessContexts = new WeakMap();
    this.scene3dProgramContexts = new WeakMap();
    this.missingNativeRendererDiagnostics.clear();
    this.missingGeneratorImplementationDiagnostics.clear();
    this.sourceCrashDiagnostics.clear();
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
    this.missingNativeRendererDiagnostics.delete(id);
    return renderer;
  }

  hasNativeRenderer(rendererId) {
    const id = String(rendererId || "");
    return this.nativeRenderers.has(id)
      || this.host.specializedSources?.hasNativeRenderer?.(id) === true;
  }

  reportMissingNativeRenderer(rendererId, generatorId = "", operation = null) {
    const id = String(rendererId || "");
    if (this.missingNativeRendererDiagnostics.has(id)) return;
    this.missingNativeRendererDiagnostics.add(id);
    console.error("[VJ1_NATIVE_SOURCE_RENDERER_MISSING]", {
      rendererId: id,
      generatorId: String(generatorId || ""),
      operationId: String(operation?.id || operation?.nodeId || ""),
      message: "compiled visual plan requires a native renderer capability that is not installed",
    });
  }

  safeDrawSourceToGraphics(
    target,
    source,
    component,
    componentTime,
    renderRequest = frameRenderRequest(this.host.state.render),
    operation = null,
    inputStates = null,
  ) {
    const diagnosticKey = sourceDiagnosticKey(component, source, operation);
    try {
      this.drawSourceToGraphics(
        target,
        source,
        component,
        componentTime,
        renderRequest,
        operation,
        inputStates,
      );
      this.sourceCrashDiagnostics.delete(diagnosticKey);
    } catch (error) {
      const errorSignature = `${error?.name || "Error"}:${error?.message || String(error || "unknown")}`;
      if (this.sourceCrashDiagnostics.get(diagnosticKey) !== errorSignature) {
        this.sourceCrashDiagnostics.set(diagnosticKey, errorSignature);
        console.error(`[VJ1_SOURCE_CRASH] ${errorSignature}`, {
          componentId: component.id,
          componentName: component.name,
          source,
          width: target.width,
          height: target.height,
          name: error?.name,
          message: error?.message,
          stack: error?.stack,
        });
      }
      withRenderTarget2D(target, () => target.background(0));
    }
  }

  drawSourceToGraphics(
    target,
    source,
    component,
    componentTime,
    renderRequest = frameRenderRequest(this.host.state.render),
    operation = null,
    inputStates = null,
  ) {
    const rendererId = compiledVisualSourceRenderer(operation || {}, source);
    const method = SOURCE_RUNTIME_METHODS[rendererId];
    if (!method || typeof this[method] !== "function") {
      console.error("[VJ1_SOURCE_RENDERER_MISSING]", {
        rendererId,
        sourceType: source.type || "unknown",
      });
      this.drawStandby(target, `source renderer unavailable: ${source.type || "unknown"}`);
      return;
    }
    this[method](
      target,
      source,
      component,
      componentTime,
      renderRequest,
      operation,
      inputStates,
    );
  }

  drawComponentReferenceSource(target, source, component, componentTime, renderRequest) {
    const host = this.host;
    const sourceComponent = host.componentForId(source.componentId);
    if (!sourceComponent || sourceComponent.id === component.id || sourceComponent.type === "scene") return;
    const sourceTime = host.componentTimes.get(sourceComponent.id) || componentTime;
    const renderIdentity = componentRenderInstanceKey(sourceComponent, source.instanceId);
    const view = renderView(target, renderRequest);
    const placement = componentReferencePlacement(
      component,
      sourceComponent,
      host.state.render,
      view,
      source.placement,
    );
    const placementTransform = combineContentTransforms(source.contentTransform, sourceComponent.transform);
    const demandRect = transformedPlacementDemandRect(placement, placementTransform);
    const coordinateFrame = { x: 0, y: 0, width: view.width, height: view.height };
    const viewport = {
      x: view.x,
      y: view.y,
      width: view.allocationWidth,
      height: view.allocationHeight,
    };
    const visiblePlacement = transformedRectBounds(coordinateFrame, placement, placementTransform);
    if (!rectsIntersect(visiblePlacement, viewport)) return;
    const referenceCount = componentReferenceCount(
      host.componentPrograms.get(component.id),
      sourceComponent.id,
    );
    const fullSourceRequest = componentReferenceRenderRequest(
      host.state.render,
      sourceComponent,
      demandRect,
      {
        reason: "component-reference",
        renderIdentity,
        sharedResolutionClass: sourceComponent.syncInstances !== false && referenceCount > 1,
      },
    );
    const preferSharedTexture = componentReferencePrefersSharedTexture(
      sourceComponent,
      referenceCount,
      fullSourceRequest,
    );
    // ROI is a property of the child placement inside its consumer, not of
    // whether the consumer itself happens to be a regional request. A normal
    // full-Scene request must still discard the scaled child area outside the
    // Scene or an off-screen placement can allocate the entire 8K child.
    const candidateVisibleRegion = !preferSharedTexture
      && host.componentRegionSafe(sourceComponent)
      ? transformedRectVisibleRegion(coordinateFrame, placement, placementTransform, viewport)
      : null;
    // A completely visible child retains the ordinary full request and its
    // stable-cache eligibility. ROI is only introduced when it actually
    // removes invisible source pixels.
    const visibleRegion = isPartialUvRect(candidateVisibleRegion?.uvRect)
      ? candidateVisibleRegion
      : null;
    const sourceRequest = visibleRegion
      ? componentReferenceVisibleRenderRequest(
        host.state.render,
        sourceComponent,
        demandRect,
        visibleRegion.uvRect,
        {
          reason: "component-reference-region",
          renderIdentity,
        }
      )
      : fullSourceRequest;
    const sourceOutput = host.renderComponentForRequest(
      sourceComponent,
      componentInstanceTime(sourceComponent, sourceTime, source.instanceId),
      sourceRequest,
    );
    withRenderTarget2D(target, () => {
      withRenderView(target, renderRequest, () => {
        host.drawPlacedResultGeometry(target, createPlacedRenderResult(sourceOutput, {
          destinationRect: visibleRegion?.destinationRect || placement,
          transform: placementTransform,
          sourceIsWebGL: host.isShaderBuffer(sourceOutput),
        }), view);
      });
    });
  }

  drawMediaSource(target, source, component, componentTime, renderRequest) {
    const host = this.host;
    const playback = host.videoPlaybackOptions(source, component);
    const view = renderView(target, renderRequest);
    const qualityRequest = qualityScaledRenderRequest({
      width: view.width,
      height: view.height,
    }, source.params || {});
    const item = host.acquireMedia(source.mediaId, {
      playback,
      width: mediaSourceDemandWidth(qualityRequest, source),
    });
    if (item?.video && isDrawableMedia(item.video)) {
      withRenderTarget2D(target, () => {
        drawWithContentTransform(target, source.contentTransform, (contentView) => {
          drawMediaFit(
            target,
            item.video,
            0,
            0,
            contentView.width,
            contentView.height,
            mediaSourceFit(source),
          );
        }, renderRequest);
      });
    } else if (item?.image && isDrawableMedia(item.image)) {
      const fit = mediaSourceFit(source);
      const renditionDemand = mediaSourceDemandSize(qualityRequest, source);
      const image = fit === "cover"
        ? host.getImageRendition(item, renditionDemand.width, renditionDemand.height) || item.image
        : item.image;
      withRenderTarget2D(target, () => {
        drawWithContentTransform(target, source.contentTransform, (contentView) => {
          drawMediaFit(target, image, 0, 0, contentView.width, contentView.height, fit);
        }, renderRequest);
      });
    } else if (item?.model || item?.modelData) {
      host.drawModelSource(target, item, source, componentTime, renderRequest);
    } else if (item?.modelError) {
      this.drawStandby(target, `3D model error: ${item.modelError}`, { forceVisible: true });
    } else if (item?.loadError || item?.imageError) {
      this.drawStandby(target, item?.loadError || "image load failed", { forceVisible: true });
    } else if (item) {
      this.drawStandby(target, item.loadStatus || "loading media");
    } else {
      host.requestMissingMedia(source.mediaId);
      this.drawStandby(target, "media file not loaded");
    }
  }

  drawCameraSource(target, source, _component, _componentTime, renderRequest) {
    const camera = this.host.acquireCameraInput();
    if (camera && isDrawableMedia(camera)) {
      withRenderTarget2D(target, () => {
        drawWithContentTransform(target, source.contentTransform, (view) => {
          drawCover(target, camera, 0, 0, view.width, view.height);
        }, renderRequest);
      });
    } else {
      this.drawStandby(target, this.host.cameraError || "camera");
    }
  }

  drawBlackSource(target) {
    withRenderTarget2D(target, () => target.background(0));
  }

  drawGeneratorSource(
    target,
    source,
    _component,
    componentTime,
    renderRequest,
    operation,
    inputStates = null,
  ) {
    const host = this.host;
    const generatorTime = instanceTime(source.instanceId || source.generatorId, componentTime);
    if (operation?.scene3dProgram) {
      this.drawCompiledScene3dProgram(target, source, generatorTime, renderRequest, operation);
      return;
    }
    if (typeof operation?.nodeProcess === "function") {
      withRenderTarget2D(target, () => {
        drawWithContentTransform(target, source.contentTransform, (view) => {
          this.executeCompiledVisualNodeProcess(
            operation,
            target,
            source,
            generatorTime,
            renderRequest,
            view,
          );
        }, renderRequest);
      });
      return;
    }
    const generatorComponent = host.generatorNodeComponent(source.generatorId);
    const nativeRenderer = compiledNativeSourceRenderer(operation || {}, source, generatorComponent);
    if (nativeRenderer && this.drawCompiledNativeSource(
      nativeRenderer,
      target,
      source,
      generatorTime,
      renderRequest,
      operation,
    )) return;
    if (!generatorComponent) return;
    const shaderGenerator = host.generatorShaderComponent(generatorComponent.id);
    if (shaderGenerator) {
      if (host.drawShaderGenerator(
        target,
        source,
        generatorTime,
        renderRequest,
        inputStates,
      )) return;
      console.error("[VJ1_SHADER_GENERATOR_UNAVAILABLE]", {
        generatorId: source.generatorId,
        fallback: "transparent diagnostic standby",
      });
      this.drawStandby(target, `shader unavailable: ${source.generatorId}`);
      return;
    }
    const generatorId = String(source.generatorId || "");
    if (!this.missingGeneratorImplementationDiagnostics.has(generatorId)) {
      this.missingGeneratorImplementationDiagnostics.add(generatorId);
      console.error("[VJ1_GENERATOR_IMPLEMENTATION_MISSING]", {
        generatorId,
        operationId: String(operation?.id || operation?.nodeId || ""),
        message: "compiled generator has no node process, shader program, or retained renderer capability",
      });
    }
    this.drawStandby(target, `generator implementation unavailable: ${generatorId || "unknown"}`);
  }

  drawCompiledScene3dProgram(target, source, componentTime, renderRequest, operation) {
    const host = this.host;
    const params = source.params || {};
    let invocation = this.scene3dProgramContexts.get(operation);
    if (!invocation) {
      invocation = {
        inputs: {},
        meshes: new Map(),
        context: {},
      };
      invocation.context.resolveMesh = (mediaId) =>
        invocation.meshes.get(String(mediaId || "")) || null;
      this.scene3dProgramContexts.set(operation, invocation);
    }
    const inputs = invocation.inputs;
    invocation.meshes.clear();
    const missingMeshIds = [];
    for (const inlet of operation.scene3dProgram.publicInputs || []) {
      if (inlet.type !== "mesh") {
        // The invocation packet is retained, but its values are not. Clearing
        // a public control must reveal the compiled Group default instead of
        // leaking the value supplied on an earlier frame.
        inputs[inlet.id] = params[inlet.id];
        continue;
      }
      const mediaId = String(params[`${inlet.id}Id`] || params[inlet.id] || "");
      const cacheOwner = mediaId ? host.acquireMedia(mediaId) : null;
      inputs[inlet.id] = cacheOwner?.modelData || null;
      if (!inputs[inlet.id]) {
        if (mediaId) {
          missingMeshIds.push(mediaId);
          host.requestMissingMedia(mediaId);
        } else if (inlet.required) {
          missingMeshIds.push(inlet.id);
        }
      }
    }
    for (const binding of operation.scene3dProgram.resourceBindings || []) {
      if (binding.kind !== "media" || binding.valueType !== "mesh") continue;
      const mediaId = String(binding.publicInputId
        ? inputs[binding.publicInputId] || ""
        : binding.staticId || "");
      const cacheOwner = mediaId ? host.acquireMedia(mediaId) : null;
      const mesh = cacheOwner?.modelData || null;
      if (mesh) invocation.meshes.set(mediaId, mesh);
      else if (mediaId) {
        missingMeshIds.push(mediaId);
        host.requestMissingMedia(mediaId);
      } else if (binding.required) {
        missingMeshIds.push(`${binding.nodeId}.${binding.parameterId}`);
      }
    }
    if (missingMeshIds.length) {
      this.drawStandby(target, `Prepare 3D mesh: ${missingMeshIds.join(", ")}`);
      return;
    }
    inputs.target = target;
    inputs.componentTime = componentTime;
    inputs.viewport = renderView(target, renderRequest);
    inputs.contentTransform = source.contentTransform || {};
    invocation.context.componentTime = componentTime;
    invocation.context.timestamp = componentTime;
    invocation.context.renderRequest = renderRequest;
    invocation.context.renderHost = host;
    operation.scene3dProgram.execute(inputs, invocation.context);
  }

  executeCompiledVisualNodeProcess(
    operation,
    target,
    source,
    time,
    renderRequest,
    sourceRenderView = null,
  ) {
    const host = this.host;
    let invocation = this.compiledNodeProcessContexts.get(operation);
    if (!invocation) {
      invocation = {
        inputs: { source: null, params: null },
        context: {
          target: null,
          source: null,
          time: 0,
          renderRequest: null,
          renderView: null,
          executionClass: "live-frame",
          renderHost: host,
          acquireMedia: host.acquireMedia.bind(host),
          requestMissingMedia: host.requestMissingMedia.bind(host),
          acquireScreenInput: host.acquireScreenInput.bind(host),
          screenInputError: host.screenError.bind(host),
          isDrawableMedia,
          drawMediaFit,
          drawStandby: this.drawStandby.bind(this),
        },
      };
      this.compiledNodeProcessContexts.set(operation, invocation);
    }
    invocation.inputs.source = source;
    invocation.inputs.params = source.params || {};
    invocation.context.target = target;
    invocation.context.source = source;
    invocation.context.time = time;
    invocation.context.renderRequest = renderRequest;
    invocation.context.renderView = sourceRenderView || renderView(target, renderRequest);
    const result = operation.nodeProcess(invocation.inputs, invocation.context);
    if (result && typeof result.then === "function") {
      throw new Error(
        `VJ1_VISUAL_NODE_PROCESS_ASYNC:${operation.nodeProcessId || operation.nodeId || operation.id}`,
      );
    }
    return result;
  }

  drawCompiledNativeSource(
    rendererId,
    target,
    source,
    generatorTime,
    renderRequest,
    operation = null,
  ) {
    const renderer = this.nativeRenderers.get(String(rendererId || ""));
    if (renderer) {
      renderer(target, source, generatorTime, renderRequest, operation);
      return true;
    }
    if (this.host.specializedSources?.drawNativeRenderer?.(
      rendererId,
      target,
      source,
      generatorTime,
      renderRequest,
      operation,
    )) {
      return true;
    }
    this.reportMissingNativeRenderer(rendererId, source.generatorId, operation);
    this.drawStandby(target, `native renderer unavailable: ${source.generatorId}`);
    return true;
  }

  drawScreenShareGenerator(target, source = {}, _componentTime, renderRequest, operation = null) {
    const authoredParams = source.params || {};
    const kernel = specializedCompoundNativeKernel(operation, "media-resource-fit");
    if (operation?.nativeCompoundProgram && !kernel) {
      this.drawStandby(target, "screen media render kernel unavailable", { forceVisible: true });
      return;
    }
    const renderStageId = kernel?.id || "render";
    const resourceStageId = kernel?.inputBindings?.resource?.stageId || "input";
    if (operation?.nativeCompoundProgram && (
      !specializedCompoundStageEnabled(operation, resourceStageId) ||
      !specializedCompoundStageEnabled(operation, renderStageId)
    )) {
      this.drawStandby(target, "screen media compound stage disabled", { forceVisible: true });
      return;
    }
    const instanceId = source.instanceId || renderRequest.renderIdentity || source.generatorId || "screen-share";
    const graph = operation?.nativeCompoundProgram
      ? evaluateSpecializedCompoundGraph(operation, authoredParams, { instanceId })
      : null;
    const resource = operation?.runtimeValueInputs?.get?.("resource")
      || graph?.stageInput(renderStageId, "resource")
      || null;
    const params = operation?.nativeCompoundProgram
      ? specializedCompoundEvaluatedStageSettings(
          operation, graph, renderStageId, authoredParams, instanceId,
        )
      : authoredParams;
    if (operation?.nativeCompoundProgram && resource?.kind !== "screen-input-resource") {
      this.drawStandby(target, "screen input graph value unavailable", { forceVisible: true });
      return;
    }
    const inputId = String(resource?.inputId ?? authoredParams.inputId ?? "");
    const screen = this.host.acquireScreenInput(inputId);
    if (!screen || !isDrawableMedia(screen)) {
      this.drawStandby(
        target,
        this.host.screenError(inputId) || "screen share unavailable",
        { forceVisible: true },
      );
      return;
    }
    const drawMediaResourceToImage = operation?.nodeModule?.drawMediaResourceToImage;
    if (operation && typeof drawMediaResourceToImage !== "function") {
      throw new Error("MEDIA_RESOURCE_COMPILED_MODULE_MISSING:drawMediaResourceToImage");
    }
    withRenderTarget2D(target, () => {
      drawWithContentTransform(target, source.contentTransform, (view) => {
        (drawMediaResourceToImage || fallbackDrawMediaResourceToImage)(
          target, screen, params, drawMediaFit, view,
        );
      }, renderRequest);
    });
  }

  drawStandby(target, label, { forceVisible = false } = {}) {
    const transient = /loading|reading|processing|checking|preparing|matching|finding|not loaded/i
      .test(String(label || ""));
    const debugVisible = this.host.state?.ui?.debugPreview !== false;
    withRenderTarget2D(target, () => {
      drawStandbyDiagnostic(target, label, {
        visible: debugVisible || (forceVisible && this.host.mode !== "output"),
        frame: this.host.frameIndex,
        graceMs: transient ? 1000 : 0,
      });
    });
  }

  resolvePlacedSourceResult(output, source, component, componentTime, renderRequest) {
    const host = this.host;
    const target = { width: output.width, height: output.height };
    if (source.type === "component") {
      const dependency = host.componentForId(source.componentId);
      if (!dependency || dependency.id === component.id || dependency.type === "scene") return null;
      const placement = componentReferencePlacement(
        component,
        dependency,
        host.state.render,
        target,
        source.placement,
      );
      const placementTransform = combineContentTransforms(
        source.contentTransform,
        dependency.transform,
      );
      const demandRect = transformedPlacementDemandRect(placement, placementTransform);
      const dependencyTime = host.componentTimes.get(dependency.id) || componentTime;
      const renderIdentity = componentRenderInstanceKey(dependency, source.instanceId);
      const referenceCount = componentReferenceCount(
        host.componentPrograms.get(component.id),
        dependency.id,
      );
      const texture = host.renderComponentForRequest(
        dependency,
        componentInstanceTime(dependency, dependencyTime, source.instanceId),
        componentReferenceRenderRequest(host.state.render, dependency, demandRect, {
          reason: "direct-component-reference",
          renderIdentity,
          sharedResolutionClass: dependency.syncInstances !== false && referenceCount > 1,
        }),
      );
      return createPlacedRenderResult(texture, {
        destinationRect: placement,
        transform: placementTransform,
        sourceIsWebGL: host.isShaderBuffer(texture),
      });
    }
    if (source.type === "media") {
      const playback = host.videoPlaybackOptions(source, component);
      const qualityRequest = qualityScaledRenderRequest(renderRequest, source.params || {});
      const media = host.acquireMedia(source.mediaId, {
        playback,
        width: mediaSourceDemandWidth(qualityRequest, source),
      });
      if (media?.video && isDrawableMedia(media.video)) {
        return createPlacedRenderResult(media.video, {
          destinationRect: fullTargetRect(target),
          fit: mediaSourceFit(source),
          transform: source.contentTransform,
        });
      }
      if (media?.image && isDrawableMedia(media.image)) {
        const fit = mediaSourceFit(source);
        const renditionDemand = mediaSourceDemandSize(qualityRequest, source);
        const texture = fit === "cover"
          ? host.getImageRendition(media, renditionDemand.width, renditionDemand.height) || media.image
          : media.image;
        return createPlacedRenderResult(texture, {
          destinationRect: fullTargetRect(target),
          fit,
          transform: source.contentTransform,
        });
      }
      return null;
    }
    if (source.type === "camera") {
      const camera = host.acquireCameraInput();
      if (!camera || !isDrawableMedia(camera)) return null;
      return createPlacedRenderResult(camera, {
        destinationRect: fullTargetRect(target),
        fit: "cover",
        transform: source.contentTransform,
      });
    }
    return null;
  }
}

function rectsIntersect(left = {}, right = {}) {
  const leftX = Number(left.x) || 0;
  const leftY = Number(left.y) || 0;
  const rightX = Number(right.x) || 0;
  const rightY = Number(right.y) || 0;
  return leftX < rightX + Math.max(0, Number(right.width) || 0)
    && leftX + Math.max(0, Number(left.width) || 0) > rightX
    && leftY < rightY + Math.max(0, Number(right.height) || 0)
    && leftY + Math.max(0, Number(left.height) || 0) > rightY;
}

function isPartialUvRect(value) {
  if (!Array.isArray(value) || value.length < 4) return false;
  return Math.abs(Number(value[0]) || 0) > 1e-9 ||
    Math.abs(Number(value[1]) || 0) > 1e-9 ||
    Math.abs((Number(value[2]) || 0) - 1) > 1e-9 ||
    Math.abs((Number(value[3]) || 0) - 1) > 1e-9;
}

function sourceDiagnosticKey(component = {}, source = {}, operation = null) {
  return [
    String(component.id || ""),
    String(operation?.id || operation?.nodeId || ""),
    String(source.instanceId || source.mediaId || source.componentId || source.generatorId || source.type || ""),
  ].join(":");
}
