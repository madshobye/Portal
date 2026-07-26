import {
  normalizeParamValues,
  runtimeRoiContract,
} from "../libraries/visual-nodes/shared/component-schema.js";
import { visitVisualParameterReferences } from "../libraries/visual-nodes/shared/parameter-references.js";
import {
  VISUAL_SOURCE_RENDERERS,
  visualSourceRenderer,
} from "../libraries/composition-engine/index.js";
import {
  createPlacedRenderResult,
  directPlacementKind,
  transformedPlacementDemandRect,
} from "../graph/placed-render-result.js";
import { clamp01 } from "../domain/models.js";
import {
  RenderNodeRuntime,
  textureStateKey,
} from "../libraries/render-engine/render-node-contract.js";
import {
  RENDER_INVALIDATION_MODES,
  runtimePolicyRenderInvalidation,
} from "../libraries/render-engine/invalidation/index.js";
import {
  drawStandby as drawStandbyDiagnostic,
  standbyDiagnosticsVisible,
} from "./generators.js";
import { drawMediaFit, isDrawableMedia } from "./media-utils.js";
import {
  sourceWithNodeParams,
} from "./component-patch-adapter.js";
import {
  combineContentTransforms,
  normalizedContentTransform,
  transformedRectBounds,
  transformedRectVisibleRegion,
} from "./preview-interaction-geometry.js";
import { contentTransformCanvasPlacement } from "./content-coordinate-space.js";
import { applyBlend } from "./blend-utils.js";
import {
  disposeGraphics,
  drawWithContentTransform,
} from "./shader-target-runtime.js";
import {
  createSharedFramebufferTarget,
} from "./shared-framebuffer-target.js";
import {
  componentInstanceTime,
  globalVisualTimeScale,
  instanceTime,
  qualityScaledRenderRequest,
} from "./render-runtime-math.js";
import {
  frameRenderRequest,
  instanceInvariantRenderRequest,
  renderRequestKey,
  renderRequestStateKey,
} from "./render-geometry.js";
import {
  renderSourceDetail,
  renderView,
  withRenderView,
} from "../libraries/render-engine/render-view/index.js";
import {
  createVisualRenderProcessContext,
  updateVisualRenderProcessContext,
} from "../libraries/render-engine/render-process-context.js";
import { NativeRendererRegistry } from "../libraries/render-engine/native-renderer-registry.js";
import {
  componentReferenceCount,
  componentReferencePlacement,
  componentReferencePrefersSharedTexture,
  componentReferenceRenderRequest,
  componentReferenceVisibleRenderRequest,
  componentRenderInstanceKey,
  fullTargetRect,
} from "./component-render-layout.js";
import {
  withRenderTarget2D,
} from "./render-target-contract.js";
import { drawBuffer } from "./render-draw-utils.js";
import { isFullNodeBoundary, nodeBoundaryPixelRect } from "../libraries/render-engine/roi/index.js";
import {
  chainLayerState,
  componentRuntimeTimeKey,
  isReadyMediaItem,
  renderBufferKey,
  runtimeMediaInvalidation,
  runtimeMediaStateForIds,
  staticCompiledComponentGraphMediaState,
  staticCompiledComponentGraphState,
  staticMediaStateForIds,
  staticSourceState,
} from "./component-render-state.js";

const SOURCE_RUNTIME_METHODS = Object.freeze({
  [VISUAL_SOURCE_RENDERERS.COMPONENT]: "drawComponentReferenceSource",
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

export function namedTextureStateKey(states = null) {
  if (!states?.size) return [];
  return [...states.entries()]
    .sort(([left], [right]) =>
      String(left).localeCompare(String(right))
    )
    .map(([name, state]) => [String(name), textureStateKey(state)]);
}

export function namedValueIdentityKey(identities = null) {
  if (!identities?.size) return [];
  return [...identities.entries()]
    .sort(([left], [right]) =>
      String(left).localeCompare(String(right))
    )
    .map(([name, identity]) => [
      String(name),
      String(identity || ""),
    ]);
}

export function runtimeValueMediaResources(values = null) {
  const resources = [];
  const visited = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    const mediaResource =
      typeof value.mediaId === "string" &&
      value.mediaId &&
      (
        String(value.kind || "").includes("media-resource") ||
        String(value.resourceIdentity || "").startsWith("project-media:")
      );
    if (mediaResource) {
      resources.push(value);
      return;
    }
    if (value instanceof Map) {
      for (const nested of value.values()) visit(nested);
      return;
    }
    if (Array.isArray(value)) {
      for (const nested of value) visit(nested);
      return;
    }
    // Canonical typed values are retained graph resources, not arbitrary
    // records to rediscover every frame. In particular, walking a Scene3D
    // recursively enters every Mesh LOD and typed vertex array. The compiler
    // already projects media dependencies from the producing value graph.
    if (
      (String(value.kind || "") && value.contractVersion != null) ||
      ArrayBuffer.isView(value) ||
      value instanceof ArrayBuffer
    ) {
      return;
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(values);
  return resources;
}

export function runtimeValueMediaResourceIds(values = null) {
  return [
    ...new Set(
      runtimeValueMediaResources(values).map((resource) => resource.mediaId),
    ),
  ];
}

export function operationMediaResourceIds(operation = null) {
  // Every compiled operation owns an authoritative dependency projection,
  // including an intentionally empty list. Falling back to a runtime object
  // walk here made retained Mesh/Scene values behave like generic packets and
  // traversed high-density geometry on every animated frame.
  if (
    operation &&
    Object.prototype.hasOwnProperty.call(operation, "mediaDependencies")
  ) {
    return new Set(operation.mediaDependencies || []);
  }
  return new Set([
    ...runtimeValueMediaResourceIds(operation?.runtimeValueInputs),
  ]);
}

export function sourceOperationUsesRuntimeClock(operation = null, params = null) {
  const configurationParams =
    params ||
    operation?.configuration?.source?.params ||
    operation?.configuration?.params ||
    {};
  if (
    runtimePolicyRenderInvalidation(
      operation?.runtimePolicy,
      configurationParams,
    ).mode === RENDER_INVALIDATION_MODES.FRAME
  ) {
    return true;
  }
  const mode = String(operation?.renderInvalidation?.mode || "");
  return !["stable", "revision", "dependency"].includes(mode);
}

export function sourceOperationUsesExternalRevision(operation = null) {
  return (
    operation == null ||
    operation.externalResourceDependent === true ||
    operation.runtimePolicy?.externalRevisionDependent === true
  );
}

export function compiledSourceRenderRequest(
  operation = {},
  source = {},
  renderRequest = {},
) {
  return operation?.backend === "shader-generator"
    ? qualityScaledRenderRequest(renderRequest, source.params || {})
    : renderRequest;
}

export function compiledSourceRenderTargetOptions(operation = {}) {
  return Object.freeze({
    depth: operation?.renderTarget?.depth === true,
  });
}

export class SourceRenderRuntime {
  constructor(host, {
    mediaRuntime = host?.mediaRuntime,
    nativeRendererRegistry = host?.nativeRendererRegistry,
  } = {}) {
    this.host = host;
    this.mediaRuntime = mediaRuntime;
    this.componentRegionSafety = new WeakMap();
    this.componentVideoPresence = new WeakMap();
    this.nodeRuntimes = new Map();
    this.directPlacementResults = new Map();
    this.compiledNodeProcessContexts = new WeakMap();
    this.nativeRendererRegistry =
      nativeRendererRegistry || new NativeRendererRegistry();
    this.missingNativeRendererDiagnostics = new Set();
    this.missingGeneratorImplementationDiagnostics = new Set();
    this.sourceCrashDiagnostics = new Map();
  }

  dispose() {
    this.compiledNodeProcessContexts = new WeakMap();
    this.missingNativeRendererDiagnostics.clear();
    this.missingGeneratorImplementationDiagnostics.clear();
    this.sourceCrashDiagnostics.clear();
    this.componentRegionSafety = new WeakMap();
    this.componentVideoPresence = new WeakMap();
    this.nodeRuntimes.clear();
    this.directPlacementResults.clear();
  }

  invalidateStructure() {
    this.host.recordSignal?.("cacheInvalidations", 1, "source-structure");
    this.host.previewHitCoverage?.invalidateStructure();
    this.componentRegionSafety = new WeakMap();
    this.componentVideoPresence = new WeakMap();
    this.directPlacementResults.clear();
  }

  measureOperation(component, item, renderRequest, render) {
    const host = this.host;
    const source = item?.source || {};
    host.componentRenderRuntime.recordResolution(
      component,
      item,
      "source",
      renderRequest,
    );
    return host.profileRuntime.measure("sourceMs", {
      type: "source",
      componentId: component.id,
      componentName: component.name || component.id || "Component",
      passId: item.id || source.instanceId || "",
      chainItemId: item.id || source.instanceId || "",
      implementationId:
        source.generatorId || source.mediaId || source.type || "",
      passName:
        item.name ||
        source.generatorId ||
        source.mediaId ||
        source.type ||
        "Source",
      width: renderRequest.width,
      height: renderRequest.height,
    }, render);
  }

  canDirectComposite(
    item = {},
    renderRequest = {},
    operation = null,
    component = {},
  ) {
    const host = this.host;
    // Direct placement uses the allocation as its complete fit rectangle.
    // A node-local ROI is only a cropped allocation within the authored node
    // boundary, so it must use the render-view-aware retained source path.
    // `regionView` is intentionally not checked here: it describes a regional
    // render of the whole Component and has different placement ownership.
    if (renderRequest.nodeRegionView === true) return false;
    const source = item.source || {};
    const dependency = source.type === "component"
      ? host.state?.components?.find(
          (component) => component.id === source.componentId,
        )
      : null;
    const directResource = this.directPlacementResource(
      operation,
      source,
      component,
      renderRequest,
    );
    return !!directPlacementKind({
      source,
      blend: item.blend || "normal",
      dependency,
      drawableResourceDrawable:
        !!directResource?.drawable &&
        isDrawableMedia(directResource.drawable),
      drawableResourceRequiresRetainedFrame:
        directResource?.requiresRetainedFrame === true,
    });
  }

  directPlacementResource(
    operation = null,
    source = {},
    component = {},
    renderRequest = {},
  ) {
    const contract = operation?.directPlacement;
    if (
      contract?.kind !== "drawable-resource" ||
      source.type !== "generator"
    ) {
      return null;
    }
    const params = source.params || {};
    if (params[contract.mirrorParameter || "mirrored"] === true) return null;
    const descriptor = operation.runtimeValueInputs?.get?.(
      contract.input || "resource",
    );
    if (!descriptor?.ready) return null;
    const drawable = this.mediaRuntime.acquireDrawableResource(
      descriptor,
      Math.max(1, Number(renderRequest.width) || 1),
      {
        playback: this.drawableResourcePlaybackOptions(
          descriptor,
          component,
        ),
      },
    );
    const runtimeMedia = descriptor.kind === "project-media-resource"
      ? this.host.media.get(String(descriptor.mediaId || ""))
      : null;
    return {
      contract,
      descriptor,
      drawable,
      requiresRetainedFrame:
        contract.retainProjectVideoFrame === true &&
        !!runtimeMedia?.video,
    };
  }

  componentRegionSafetyResult(component = {}, visiting = new Set()) {
    const host = this.host;
    if (!component?.id || visiting.has(component.id)) {
      return { safe: false, dynamic: false };
    }
    const cached = this.componentRegionSafety.get(component);
    if (cached !== undefined) return { safe: cached, dynamic: false };
    visiting.add(component.id);
    const program = host.componentProgramRuntime.programs.get(component.id);
    let safe = !!program;
    let dynamic = false;
    program?.forEachOperation((operation) => {
      if (
        !safe ||
        operation.configuration?.enabled === false ||
        operation.opcode === "group"
      ) {
        return;
      }
      if (operation.opcode === "effect") {
        const params =
          operation.configuration?.source?.params ||
          operation.configuration?.params ||
          {};
        const runtimePolicy = operation.runtimePolicy || {};
        const roi = runtimeRoiContract(runtimePolicy, params, {
          component,
          operation,
        });
        dynamic = dynamic || typeof runtimePolicy.roiForParams === "function";
        safe =
          roi.pixelEquivalentToFullFrame === true &&
          roi.mode === "local";
        return;
      }
      if (operation.opcode !== "source") return;
      const source = operation.configuration?.source || {};
      if (source.type === "component") {
        const dependency = host.state?.components?.find(
          (candidate) => candidate.id === source.componentId,
        );
        const dependencyResult = dependency && dependency.type !== "scene"
          ? this.componentRegionSafetyResult(dependency, visiting)
          : { safe: false, dynamic: false };
        dynamic = dynamic || dependencyResult.dynamic;
        safe = !!dependency && dependencyResult.safe;
      } else if (
        operation.contract?.roi?.mode === "projective"
      ) {
        // A compiled projective renderer (for example Scene3D → Image) is not
        // a legacy catalog generator. Its compiler contract is the authority:
        // it can evaluate a viewport ROI through a sub-frustum while remaining
        // pixel-equivalent to a crop of the full render. Requiring a legacy
        // generator registration here forced every containing Component back
        // to its hidden full cover raster, even though the compiled renderer
        // had already declared and implemented regional evaluation.
        safe =
          operation.contract.roi.pixelEquivalentToFullFrame === true &&
          operation.contract.roi.inputMapping === "sub-frustum";
      } else if (
        !["black", "media", "camera", "generator"].includes(source.type)
      ) {
        safe = false;
      } else if (source.type === "generator") {
        safe = !!host.visualNodeRuntime.generator(source.generatorId);
      }
    });
    visiting.delete(component.id);
    if (!dynamic) this.componentRegionSafety.set(component, safe);
    return { safe, dynamic };
  }

  componentRegionSafe(component = {}, visiting = new Set()) {
    return this.componentRegionSafetyResult(component, visiting).safe;
  }

  sceneComponentRegionSafe(component = {}) {
    return (
      component.type === "scene" &&
      this.componentRegionSafe(component)
    );
  }

  sceneComponentFrameFanoutSafe(component = {}, visiting = new Set()) {
    const host = this.host;
    if (component?.type !== "scene" || !component.id) return false;
    const visitComponent = (candidate) => {
      if (!candidate?.id || visiting.has(candidate.id)) return false;
      visiting.add(candidate.id);
      const inspection = host.componentProgramRuntime.programs
        .get(candidate.id)
        ?.inspect();
      let safe = !!inspection;
      for (const dependencyId of inspection?.dependencies?.components || []) {
        const dependency = host.state?.components?.find(
          (item) => item.id === dependencyId,
        );
        if (
          !dependency ||
          dependency.syncInstances === false ||
          !visitComponent(dependency)
        ) {
          safe = false;
          break;
        }
      }
      visiting.delete(candidate.id);
      return safe;
    };
    return visitComponent(component);
  }

  videoPlaybackOptions(source = {}, component = {}) {
    const host = this.host;
    return {
      start: source.start,
      end: source.end,
      speed: (host.frameRuntime.isPlaybackActive() ? 1 : 0) *
        globalVisualTimeScale(host.state?.global) *
        (Number(source.speed) || 1) *
        Math.max(0, Number(component.speed) || 0),
    };
  }

  drawableResourcePlaybackOptions(descriptor = {}, component = {}) {
    if (descriptor?.kind !== "project-media-resource") return null;
    return this.videoPlaybackOptions({
      start: descriptor.start,
      end: descriptor.end,
      speed: descriptor.speed,
    }, component);
  }

  componentContainsVideo(component = {}, visiting = new Set()) {
    const host = this.host;
    if (!component?.id) return false;
    const cached = this.componentVideoPresence.get(component);
    if (cached != null) return cached;
    if (visiting.has(component.id)) return false;
    visiting.add(component.id);
    const inspection = host.componentProgramRuntime.programs
      .get(component.id)
      ?.inspect();
    if (!inspection) {
      visiting.delete(component.id);
      throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id}`);
    }
    let containsVideo = false;
    for (const dependencyId of inspection.dependencies.components || []) {
      const dependency = host.state?.components?.find(
        (candidate) => candidate.id === dependencyId,
      );
      if (dependency && this.componentContainsVideo(dependency, visiting)) {
        containsVideo = true;
        break;
      }
    }
    if (!containsVideo) {
      for (const mediaId of inspection.mediaDemand.ids || []) {
        const runtimeItem = host.media.get(mediaId);
        const mediaMeta = (host.state?.media || []).find(
          (entry) => entry.id === mediaId,
        );
        if (
          mediaMeta?.type === "video" ||
          !!runtimeItem?.video ||
          /\.(mp4|m4v|mov|webm|ogv)$/i.test(mediaId)
        ) {
          containsVideo = true;
          break;
        }
      }
    }
    visiting.delete(component.id);
    this.componentVideoPresence.set(component, containsVideo);
    return containsVideo;
  }

  claimRetainedComponentMedia(component = {}, visiting = new Set()) {
    const host = this.host;
    if (!component?.id || visiting.has(component.id)) return;
    visiting.add(component.id);
    const program = host.componentProgramRuntime.programs.get(component.id);
    if (!program) {
      visiting.delete(component.id);
      throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id}`);
    }
    const inspection = program.inspect();
    for (const mediaId of inspection.mediaDemand.ids || []) {
      const runtimeItem = host.media.get(mediaId);
      const mediaMeta = (host.state?.media || []).find(
        (entry) => entry.id === mediaId,
      );
      const video =
        mediaMeta?.type === "video" ||
        !!runtimeItem?.video ||
        /\.(mp4|m4v|mov|webm|ogv)$/i.test(mediaId);
      if (!video) host.mediaRuntime.retainMediaById(mediaId);
    }
    for (const dependencyId of inspection.dependencies.components || []) {
      const dependency = host.state?.components?.find(
        (candidate) => candidate.id === dependencyId,
      );
      if (dependency) this.claimRetainedComponentMedia(dependency, visiting);
    }
    if (!this.componentContainsVideo(component)) {
      visiting.delete(component.id);
      return;
    }
    const claimedVideoIds = new Set();
    program.forEachOperation((operation) => {
      if (
        operation.configuration?.enabled === false ||
        (
          operation.opcode !== "source" &&
          operation.backend !== "compiled-visual-group"
        )
      ) {
        return;
      }
      const source = sourceWithNodeParams(
        operation.configuration?.source,
        {},
        operation.id,
      );
      if (source.type === "component") {
        return;
      }
      // A compiled compound publishes media ownership through its typed value
      // inputs. The child renderer's configuration intentionally contains only
      // rendering parameters, so reconstructing ownership from generator
      // parameters loses the decoder lease whenever the retained Component
      // texture is reused. Renew playback from the exact resource descriptor
      // that the compiled operation consumed.
      for (const descriptor of runtimeValueMediaResources(
        operation.runtimeValueInputs,
      )) {
        const mediaId = String(descriptor.mediaId || "");
        if (!mediaId || claimedVideoIds.has(mediaId)) continue;
        const runtimeItem = host.media.get(mediaId);
        const mediaMeta = (host.state?.media || []).find(
          (entry) => entry.id === mediaId,
        );
        if (
          mediaMeta?.type !== "video" &&
          !runtimeItem?.video &&
          !/\.(mp4|m4v|mov|webm|ogv)$/i.test(mediaId)
        ) {
          continue;
        }
        claimedVideoIds.add(mediaId);
        this.mediaRuntime.acquireMediaById(mediaId, {
          playback: this.drawableResourcePlaybackOptions(
            descriptor,
            component,
          ),
        });
      }
      if (source.type === "generator") {
        const generator = host.visualNodeRuntime.generator(source.generatorId);
        const params = generator
          ? normalizeParamValues(generator, source.params || {})
          : { ...(source.params || {}) };
        for (const mediaId of this.visualMediaResourceIds(
          source.generatorId,
          source.params || {},
          params,
        )) {
          const runtimeItem = host.media.get(mediaId);
          const mediaMeta = (host.state?.media || []).find(
            (entry) => entry.id === mediaId,
          );
          if (
            mediaMeta?.type !== "video" &&
            !runtimeItem?.video &&
            !/\.(mp4|m4v|mov|webm|ogv)$/i.test(mediaId)
          ) {
            continue;
          }
          if (claimedVideoIds.has(mediaId)) continue;
          claimedVideoIds.add(mediaId);
          this.mediaRuntime.acquireMediaById(mediaId, {
            playback: this.videoPlaybackOptions(params, component),
          });
        }
        return;
      }
    });
    visiting.delete(component.id);
  }

  claimRetainedSourceMedia(
    source = {},
    component = {},
    renderRequest = {},
    declaredMediaIds = null,
  ) {
    const host = this.host;
    if (source.type !== "generator") return [];
    const generator = host.visualNodeRuntime.generator(source.generatorId);
    const params = generator
      ? normalizeParamValues(generator, source.params || {})
      : { ...(source.params || {}) };
    const qualityRequest = qualityScaledRenderRequest(
      renderRequest,
      params,
    );
    const claimed = [];
    const mediaIds = declaredMediaIds
      ? Array.from(declaredMediaIds)
      : this.visualMediaResourceIds(
          source.generatorId,
          source.params || {},
          params,
        );
    for (const mediaId of mediaIds) {
      const runtimeItem = host.media.get(mediaId);
      const mediaMeta = (host.state?.media || []).find(
        (entry) => entry.id === mediaId,
      );
      if (
        mediaMeta?.type !== "video" &&
        !runtimeItem?.video &&
        !/\.(mp4|m4v|mov|webm|ogv)$/i.test(mediaId)
      ) {
        claimed.push(this.mediaRuntime.retainMediaById(mediaId));
        continue;
      }
      claimed.push(this.mediaRuntime.acquireMediaById(mediaId, {
        playback: this.videoPlaybackOptions(params, component),
        width: mediaSourceDemandWidth(qualityRequest, source),
      }));
    }
    return claimed;
  }

  specializedVisualStageContract(
    generatorId = "",
    stageId = "",
    authoredParameters = {},
    normalizedParameters = null,
  ) {
    const host = this.host;
    const component = host.visualNodeRuntime.generator(generatorId);
    const definition = component?.nodeDefinition;
    const graph = definition?.parts?.find(
      (part) => part.kind === "graph",
    );
    const stage = graph?.nodes?.find(
      (node) => node.id === String(stageId || ""),
    );
    if (!component || !definition || !stage) return null;
    const normalized =
      normalizedParameters ||
      normalizeParamValues(component, authoredParameters || {});
    const stageDefinition = host.visualNodeRuntime.definition(stage.type);
    const params = {};
    for (const [id, parameter] of Object.entries(
      stageDefinition?.parameters || {},
    )) {
      if (parameter.defaultValue !== undefined) {
        params[id] = parameter.defaultValue;
      }
    }
    Object.assign(params, stage.parameters || {});
    const nativeBindings =
      definition.metadata?.nativeCompound?.parameterBindings?.[stage.id] ||
      [];
    const projectedBindings = (
      definition.metadata?.controlProjection?.sections || []
    )
      .flatMap((section) => section.controls || [])
      .flatMap((control) =>
        (control.bindings || [])
          .filter(
            (binding) =>
              String(binding?.nodeId || "") === String(stage.id || ""),
          )
          .map((binding) => ({
            publicParameterId: control.parameterId,
            targetParameterId: binding.parameterId,
          }))
      );
    const bindings = nativeBindings.length
      ? nativeBindings
      : projectedBindings;
    for (const binding of bindings) {
      const publicParameterId = String(
        typeof binding === "string"
          ? binding
          : binding?.publicParameterId || binding?.parameterId || "",
      );
      const targetParameterId = String(
        typeof binding === "string"
          ? binding
          : binding?.targetParameterId ||
            binding?.parameterId ||
            publicParameterId,
      );
      if (
        publicParameterId &&
        targetParameterId &&
        normalized[publicParameterId] !== undefined
      ) {
        params[targetParameterId] = normalized[publicParameterId];
      }
    }
    return {
      component,
      definition,
      stage,
      stageDefinition,
      normalized,
      params,
    };
  }

  visualMediaResourceIds(
    generatorId = "",
    authoredParameters = {},
    normalizedParameters = null,
  ) {
    const host = this.host;
    const component = host.visualNodeRuntime.generator(generatorId);
    const graph = component?.nodeDefinition?.parts?.find(
      (part) => part.kind === "graph",
    );
    const normalized =
      normalizedParameters ||
      (component
        ? normalizeParamValues(component, authoredParameters || {})
        : { ...(authoredParameters || {}) });
    const ids = new Set();
    visitVisualParameterReferences(normalized, ({ kind, id }) => {
      if (kind === "media" && id) ids.add(id);
    });
    for (const node of graph?.nodes || []) {
      const nodeDefinition = host.visualNodeRuntime.definition(node.type);
      if (!nodeDefinition?.capabilities?.includes("media-resource")) {
        continue;
      }
      const stage = this.specializedVisualStageContract(
        generatorId,
        node.id,
        authoredParameters,
        normalized,
      );
      const mediaId = String(stage?.params?.mediaId || "");
      if (mediaId) ids.add(mediaId);
    }
    return [...ids];
  }

  featureMorphAnalysisContract(
    generatorId = "",
    authoredParameters = {},
  ) {
    const stage = this.specializedVisualStageContract(
      generatorId,
      "analysis",
      authoredParameters,
    );
    const providerId = String(stage?.params?.providerId || "");
    const service =
      this.host.specializedSources.featureMorph.analysisService(providerId);
    if (!service) return null;
    const params = stage.params;
    const normalized = stage.normalized;
    params.imageAId = String(normalized.imageAId || "");
    params.imageBId = String(normalized.imageBId || "");
    return { providerId, service, params };
  }

  featureMorphPairService(providerId = "") {
    return this.host.specializedSources.featureMorph.analysisService(
      providerId,
    );
  }

  sourceIsFrameDynamic(source = {}, owner = {}, seen = new Set()) {
    const host = this.host;
    if (!source) return true;
    if (source.type === "generator") {
      const component = host.visualNodeRuntime.generator(source.generatorId);
      // Pending file-backed definitions stay dynamic so a temporary
      // transparent result cannot enter the stable Component cache.
      if (!component) return true;
      const params = normalizeParamValues(component, source.params || {});
      const featureMorph = this.featureMorphAnalysisContract(
        source.generatorId,
        params,
      );
      if (featureMorph && params.imageAId && params.imageBId) {
        const imageA = host.media.get(params.imageAId);
        const imageB = host.media.get(params.imageBId);
        if (!isReadyMediaItem(imageA) || !isReadyMediaItem(imageB)) {
          return true;
        }
        const analysisStatus = featureMorph.service.status(
          featureMorph.params,
          {
            imageAFile: imageA.file,
            imageBFile: imageB.file,
          },
        );
        if (
          analysisStatus === "idle" ||
          analysisStatus === "loading"
        ) {
          return true;
        }
      }
      for (const mediaId of this.visualMediaResourceIds(
        source.generatorId,
        params,
        params,
      )) {
        const runtimeItem = host.media.get(mediaId);
        if (!isReadyMediaItem(runtimeItem)) return true;
        const mediaMeta = (host.state?.media || []).find(
          (item) => item.id === mediaId,
        );
        if (
          (mediaMeta?.type === "video" || runtimeItem?.video) &&
          runtimeMediaInvalidation(runtimeItem, mediaMeta, {
            frame: host.frameRuntime.frameIndex,
          }).mode === "frame"
        ) {
          return true;
        }
      }
      return (
        component.runtime?.cacheable === false ||
        component.runtime?.timeDependent?.(params) === true
      );
    }
    if (source.type === "component") {
      const dependency = host.state?.components?.find(
        (component) => component.id === source.componentId,
      );
      return (
        !dependency ||
        host.componentRenderRuntime.isFrameDynamic(dependency, seen)
      );
    }
    return true;
  }

  renderItem(
    component,
    item,
    componentTime = this.host.frameRuntime.visualTime,
    request = frameRenderRequest(this.host.state.render),
  ) {
    return this.renderItemState(
      component,
      item,
      componentTime,
      request,
      renderBufferKey(component.id, item.id || "source"),
    ).buffer;
  }

  renderItemState(
    component,
    item,
    componentTime,
    request,
    nodeId,
    operation = null,
    inputStates = null,
  ) {
    const host = this.host;
    const renderRequest = host.renderRequestRuntime.normalize(request, "source");
    const source = {
      ...sourceWithNodeParams(item.source, {}, item.id),
      contentTransform: item.transform || {},
    };
    const runtimeContext = this.nodeRuntimeContext(componentTime);
    const namedStatesInvariant =
      !inputStates?.size ||
      [...inputStates.values()].every(
        (state) => state?.instanceInvariant === true,
      );
    const instanceInvariant =
      namedStatesInvariant && !this.sourceIsFrameDynamic(source, item);
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const sourceRequest = compiledSourceRenderRequest(
      operation,
      source,
      evaluationRequest,
    );
    const targetOptions = compiledSourceRenderTargetOptions(operation);
    const key = renderBufferKey(
      nodeId,
      "source",
      renderRequestKey(sourceRequest),
      targetOptions.depth ? "depth" : "color",
    );
    let target = host.resourceRuntime.componentSource.get(key);
    if (
      !target ||
      target.width !== sourceRequest.width ||
      target.height !== sourceRequest.height
    ) {
      disposeGraphics(target);
      target = createSharedFramebufferTarget(
        sourceRequest.width,
        sourceRequest.height,
        targetOptions,
      );
      host.resourceRuntime.componentSource.set(key, target);
    }
    host.resourceRuntime.renderCache.touch("source", key, host.frameRuntime.frameIndex);
    const generatorMediaIds =
      source.type === "generator"
        ? this.visualMediaResourceIds(
            source.generatorId,
            source.params || {},
          )
        : [];
    const resourceMediaIds = operationMediaResourceIds(operation);
    const sourceMediaIds = new Set([
      ...generatorMediaIds,
      ...resourceMediaIds,
    ]);
    const usesRuntimeClock = sourceOperationUsesRuntimeClock(
      operation,
      source.params,
    );
    const sourceSignature = stableStringifyValue({
      source: staticSourceState(source),
      execution: operation
        ? {
            backend: operation.backend || "",
            renderer:
              operation.renderer ||
              operation.compilerHook?.renderer ||
              "",
            nodeId: operation.nodeId || "",
            nodeVersion: operation.nodeVersion || "",
            nodeModule:
              operation.nodeModuleRevision ||
              operation.nodeProcessRevision ||
              "",
          }
        : null,
      media: staticMediaStateForIds(
        host.state?.media || [],
        sourceMediaIds,
      ),
      runtimeMedia: runtimeMediaStateForIds(
        host.media,
        sourceMediaIds,
      ),
      time: usesRuntimeClock
        ? this.runtimeTimeKey(source, item, runtimeContext)
        : 0,
      // External resource identity is independent from time invalidation.
      // A revision-driven node (for example retained image analysis) must
      // repaint when that resource becomes ready even when authored state and
      // the presentation clock are unchanged.
      external: this.sourceUsesExternalRevision(source, operation)
        ? this.runtimeExternalKey(
            source,
            item,
            runtimeContext,
            operation,
          )
        : null,
      inputs: namedTextureStateKey(inputStates),
      values: namedValueIdentityKey(
        operation?.runtimeValueIdentityInputs,
      ),
      request: renderRequestStateKey(sourceRequest),
    });
    let runtime = this.nodeRuntimes.get(key);
    if (!runtime) {
      runtime = new RenderNodeRuntime(key);
      this.nodeRuntimes.set(key, runtime);
    }
    runtime.bindOutput(target);
    const result = runtime.evaluate(
      sourceSignature,
      () => {
        target.push();
        target.clear();
        target.pop();
        // Dependencies and retained kernels are prepared before the source
        // backend owns its final framebuffer scope.
        this.safeDrawSourceToGraphics(
          target,
          source,
          component,
          componentTime,
          sourceRequest,
          operation,
          inputStates,
        );
        return target;
      },
      { frame: host.frameRuntime.frameIndex, dirtyReason: "source" },
    );
    if (!result.rendered) {
      this.claimRetainedSourceMedia(
        source,
        component,
        sourceRequest,
        sourceMediaIds,
      );
      host.profileRuntime.frameProfile.stageCacheHits++;
      host.recordSignal?.("cacheHits", 1, "source-stage");
    } else {
      host.profileRuntime.frameProfile.stageRenders++;
    }
    const sourceState = {
      buffer: result.output,
      outputVersion: result.outputVersion,
      nodeKey: key,
      dirtyReason: result.dirtyReason,
      instanceInvariant,
    };
    return sourceState;
  }

  // Execute a compiler-validated linear pass sequence on one retained
  // framebuffer. The sequence is one cache authority: individual passes never
  // cache aliases of a target that a later pass mutates.
  renderFramebufferPassSequence(
    component,
    operations,
    componentTime,
    request,
    nodeId,
    inputStatesByOperation = new Map(),
  ) {
    const host = this.host;
    const renderRequest = host.renderRequestRuntime.normalize(
      request,
      "framebuffer-pass",
    );
    const active = (operations || []).filter(
      (operation) =>
        (operation.configuration || operation).enabled !== false,
    );
    const descriptors = active.map((operation) => {
      const item = operation.configuration || operation;
      const source = {
        ...sourceWithNodeParams(item.source, {}, item.id),
        contentTransform: item.transform || {},
      };
      const inputStates =
        inputStatesByOperation.get(operation.id) ||
        operation.runtimeInputStates ||
        new Map();
      const sourceRequest = compiledSourceRenderRequest(
        operation,
        source,
        renderRequest,
      );
      const mediaIds =
        source.type === "generator"
          ? this.visualMediaResourceIds(
              source.generatorId,
              source.params || {},
            )
          : [];
      for (const mediaId of operationMediaResourceIds(operation)) {
        if (!mediaIds.includes(mediaId)) mediaIds.push(mediaId);
      }
      return {
        operation,
        item,
        source,
        sourceRequest,
        inputStates,
        mediaIds,
      };
    });
    const sourceRequest = descriptors[0]?.sourceRequest || renderRequest;
    const targetOptions = Object.freeze({
      depth: descriptors.some(({ operation }) =>
        compiledSourceRenderTargetOptions(operation).depth
      ),
    });
    for (const descriptor of descriptors.slice(1)) {
      if (
        descriptor.sourceRequest.width !== sourceRequest.width ||
        descriptor.sourceRequest.height !== sourceRequest.height
      ) {
        throw new Error(
          `VJ1_FRAMEBUFFER_PASS_RESOLUTION_MISMATCH:${nodeId}:${descriptor.operation.id}`,
        );
      }
    }
    const key = renderBufferKey(
      nodeId,
      "framebuffer-pass",
      renderRequestKey(sourceRequest),
      targetOptions.depth ? "depth" : "color",
    );
    let target = host.resourceRuntime.componentSource.get(key);
    if (
      !target ||
      target.width !== sourceRequest.width ||
      target.height !== sourceRequest.height
    ) {
      disposeGraphics(target);
      target = createSharedFramebufferTarget(
        sourceRequest.width,
        sourceRequest.height,
        targetOptions,
      );
      host.resourceRuntime.componentSource.set(key, target);
    }
    host.resourceRuntime.renderCache.touch(
      "source",
      key,
      host.frameRuntime.frameIndex,
    );
    let runtime = this.nodeRuntimes.get(key);
    if (!runtime) {
      runtime = new RenderNodeRuntime(key);
      this.nodeRuntimes.set(key, runtime);
    }
    runtime.bindOutput(target);
    const runtimeContext = this.nodeRuntimeContext(componentTime);
    // Value identities own pass invalidation. A controller may advance every
    // frame, but a static controller/material/camera tuple must stay cacheable
    // even when another layer keeps the presentation clock awake.
    const instanceInvariant = false;
    const signature = stableStringifyValue({
      request: renderRequestStateKey(sourceRequest),
      passes: descriptors.map(({
        operation,
        item,
        source,
        inputStates,
        mediaIds,
      }) => ({
        id: operation.id,
        renderer:
          operation.renderer ||
          operation.compilerHook?.renderer ||
          "",
        source: staticSourceState(source),
        media: staticMediaStateForIds(
          host.state?.media || [],
          new Set(mediaIds),
        ),
        runtimeMedia: runtimeMediaStateForIds(
          host.media,
          new Set(mediaIds),
        ),
        time: sourceOperationUsesRuntimeClock(operation, source.params)
          ? this.runtimeTimeKey(source, item, runtimeContext)
          : 0,
        external: this.sourceUsesExternalRevision(source, operation)
          ? this.runtimeExternalKey(
              source,
              item,
              runtimeContext,
              operation,
            )
          : null,
        inputs: namedTextureStateKey(
          new Map(
            [...inputStates].filter(
              ([port]) =>
                port !==
                operation.framebufferSequence?.inputPort,
            ),
          ),
        ),
        values: namedValueIdentityKey(
          operation.runtimeValueIdentityInputs,
        ),
        module:
          operation.nodeModuleRevision ||
          operation.nodeProcessRevision ||
          "",
      })),
    });
    const result = runtime.evaluate(
      signature,
      () => {
        target.push();
        target.clear();
        target.pop();
        const sharedState = {
          buffer: target,
          outputVersion: runtime.outputVersion,
          nodeKey: key,
          dirtyReason: "framebuffer-pass",
          instanceInvariant,
        };
        for (const descriptor of descriptors) {
          const { operation, source, inputStates } = descriptor;
          const continuationInput =
            operation.framebufferSequence?.inputPort;
          if (continuationInput) {
            inputStates.set(continuationInput, sharedState);
          }
          this.safeDrawSourceToGraphics(
            target,
            source,
            component,
            componentTime,
            sourceRequest,
            operation,
            inputStates,
          );
        }
        return target;
      },
      {
        frame: host.frameRuntime.frameIndex,
        dirtyReason: "framebuffer-pass",
      },
    );
    if (result.rendered) {
      host.profileRuntime.frameProfile.stageRenders++;
    } else {
      host.profileRuntime.frameProfile.stageCacheHits++;
      host.recordSignal?.("cacheHits", 1, "framebuffer-pass");
    }
    return {
      buffer: result.output,
      outputVersion: result.outputVersion,
      nodeKey: key,
      dirtyReason: result.dirtyReason,
      instanceInvariant,
    };
  }

  nodeRuntimeContext(time) {
    return {
      time: Number(time) || 0,
      frame: this.host.frameRuntime.frameIndex,
      playing: this.host.frameRuntime.isPlaybackActive(),
    };
  }

  runtimeTimeKey(source = {}, owner = {}, runtimeContext = {}) {
    const host = this.host;
    if (!source) return runtimeContext.frame;
    if (source.type === "generator") {
      const component = host.visualNodeRuntime.generator(source.generatorId);
      if (!component) return runtimeContext.frame;
      const params = normalizeParamValues(component, {
        ...(source.params || {}),
        ...(owner.params || {}),
      });
      return componentRuntimeTimeKey(component, params, runtimeContext);
    }
    if (source.type === "component") {
      const dependency = host.state?.components?.find(
        (component) => component.id === source.componentId,
      );
      if (
        !dependency ||
        host.componentRenderRuntime.isFrameDynamic(dependency)
      ) {
        return runtimeContext.frame;
      }
      return stableStringifyValue({
        component: staticCompiledComponentGraphState(
          dependency,
          host.componentProgramRuntime.programs,
          host.state?.components || [],
        ),
        media: staticCompiledComponentGraphMediaState(
          host.state?.media || [],
          dependency,
          host.componentProgramRuntime.programs,
          host.state?.components || [],
        ),
      });
    }
    return runtimeContext.frame;
  }

  runtimeExternalKey(
    source = {},
    owner = {},
    runtimeContext = {},
    operation = null,
  ) {
    const host = this.host;
    if (source?.type !== "generator") return null;
    if (operation?.externalResourceRequirements?.length) {
      return operation.runtimeExternalRevisionInputs?.size
        ? namedValueIdentityKey(
            operation.runtimeExternalRevisionInputs,
          )
        : [["capability", "unresolved"]];
    }
    const featureMorph = this.featureMorphAnalysisContract(
      source.generatorId,
      {
        ...(source.params || {}),
        ...(owner.params || {}),
      },
    );
    if (featureMorph) {
      const params = {
        ...(source.params || {}),
        ...(owner.params || {}),
      };
      const imageA = host.media.get(params.imageAId);
      const imageB = host.media.get(params.imageBId);
      return featureMorph.service.externalKey(featureMorph.params, {
        imageAFile: imageA?.file,
        imageBFile: imageB?.file,
      });
    }
    const component = host.visualNodeRuntime.generator(source.generatorId);
    if (!component) return runtimeContext.frame;
    const params = normalizeParamValues(component, {
      ...(source.params || {}),
      ...(owner.params || {}),
    });
    return (
      component.runtime?.externalKey?.(params, runtimeContext) ?? null
    );
  }

  sourceUsesExternalRevision(source = {}, operation = null) {
    if (sourceOperationUsesExternalRevision(operation)) return true;
    if (source?.type !== "generator") return false;
    return this.host.visualNodeRuntime.generator(source.generatorId)
      ?.runtime?.externalRevisionDependent === true;
  }

  prune() {
    for (const key of Array.from(this.nodeRuntimes.keys())) {
      if (!this.host.resourceRuntime.componentSource.has(key)) {
        this.nodeRuntimes.delete(key);
      }
    }
  }

  renderDirectNodeState(
    nodeId,
    inputState,
    component,
    item,
    componentTime,
    renderRequest,
    operation = null,
  ) {
    const host = this.host;
    const source = {
      ...sourceWithNodeParams(item.source, {}, item.id),
      contentTransform: item.transform || {},
    };
    const runtimeContext = this.nodeRuntimeContext(componentTime);
    const usesRuntimeClock = sourceOperationUsesRuntimeClock(
      operation,
      source.params,
    );
    const time = usesRuntimeClock
      ? this.runtimeTimeKey(source, item, runtimeContext)
      : 0;
    const external = this.sourceUsesExternalRevision(source, operation)
      ? this.runtimeExternalKey(
          source,
          item,
          runtimeContext,
          operation,
        )
      : null;
    const instanceInvariant =
      inputState.instanceInvariant === true &&
      !this.sourceIsFrameDynamic(source, item);
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const resourceMediaIds = operationMediaResourceIds(operation);
    const signature = stableStringifyValue({
      input: textureStateKey(inputState),
      source: staticSourceState(source),
      media: staticMediaStateForIds(
        host.state?.media || [],
        resourceMediaIds,
      ),
      runtimeMedia: runtimeMediaStateForIds(
        host.media,
        resourceMediaIds,
      ),
      values: namedValueIdentityKey(
        operation?.runtimeValueIdentityInputs,
      ),
      directPlacement: operation?.directPlacement || null,
      time,
      external,
      layer: chainLayerState(item),
      request: renderRequestStateKey(evaluationRequest),
    });
    const result = host.renderEvaluationRuntime.evaluate(
      nodeId,
      signature,
      renderRequest,
      (output) => {
        output.push();
        output.clear();
        drawBuffer(
          output,
          inputState.buffer,
          0,
          0,
          output.width,
          output.height,
          host.renderTargetRuntime.isShaderBuffer(inputState.buffer),
        );
        output.pop();
        const placed = this.resolvePlacedSourceResult(
          output,
          source,
          component,
          componentTime,
          evaluationRequest,
          operation,
        );
        this.directPlacementResults.set(nodeId, { signature, placed });
        const clipRect = isFullNodeBoundary(item.boundary)
          ? null
          : nodeBoundaryPixelRect(item.boundary, renderRequest);
        if (placed) {
          this.drawPlacedSourceResult(output, placed, item, clipRect);
        }
        host.profileRuntime.frameProfile.directSourceComposites++;
        host.profileRuntime.frameProfile.avoidedSourceRasterPixels +=
          renderRequest.width * renderRequest.height;
      },
      "direct-source",
      { instanceInvariant },
    );
    const placedRecord = this.directPlacementResults.get(nodeId);
    if (placedRecord?.signature === signature && placedRecord.placed) {
      host.previewHitCoverage?.recordPlaced(
        component,
        item,
        placedRecord.placed,
        renderRequest,
        operation?.contract?.interaction?.hitRegion,
      );
    }
    return result;
  }

  drawPlacedSourceResult(output, placed, layer = {}, clipRect = null) {
    output.push();
    applyBlend(output, layer.blend);
    output.tint(255, 255 * clamp01(layer.opacity ?? 1));
    withTargetScissor(
      output,
      clipRect,
      () => this.drawPlacedResultGeometry(output, placed),
    );
    output.noTint();
    output.blendMode(BLEND);
    output.pop();
  }

  drawPlacedResultGeometry(output, placed, coordinateTarget = output) {
    const rect = placed.destinationRect;
    const transform = normalizedContentTransform(placed.transform);
    const coordinateWidth = Math.max(
      1,
      Number(coordinateTarget?.width) || Number(output.width) || 1,
    );
    const coordinateHeight = Math.max(
      1,
      Number(coordinateTarget?.height) || Number(output.height) || 1,
    );
    const placement = contentTransformCanvasPlacement(
      transform,
      coordinateWidth,
      coordinateHeight,
    );
    output.push();
    output.translate(placement.centerX, placement.centerY);
    output.rotate(transform.rotation);
    output.scale(transform.scale);
    const x = rect.x - coordinateWidth * 0.5;
    const y = rect.y - coordinateHeight * 0.5;
    if (placed.fit === "stretch") {
      drawBuffer(
        output,
        placed.texture,
        x,
        y,
        rect.width,
        rect.height,
        placed.sourceIsWebGL,
      );
    } else {
      drawMediaFit(
        output,
        placed.texture,
        x,
        y,
        rect.width,
        rect.height,
        placed.fit,
      );
    }
    output.pop();
  }

  registerNativeRenderer(rendererId, renderer, { replace = false } = {}) {
    const id = String(rendererId || "");
    if (!id || typeof renderer !== "function") {
      throw new TypeError("VJ1_NATIVE_SOURCE_RENDERER_INVALID");
    }
    this.nativeRendererRegistry.register(id, renderer, { replace });
    this.missingNativeRendererDiagnostics.delete(id);
    return renderer;
  }

  hasNativeRenderer(rendererId) {
    const id = String(rendererId || "");
    return this.nativeRendererRegistry.has(id);
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
    const sourceComponent = host.componentProgramRuntime.componentForId(source.componentId);
    if (!sourceComponent || sourceComponent.id === component.id || sourceComponent.type === "scene") return;
    const sourceTime = host.frameRuntime.componentTimes.get(sourceComponent.id) || componentTime;
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
      host.componentProgramRuntime.programs.get(component.id),
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
      && this.componentRegionSafe(sourceComponent)
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
    const sourceOutput = host.componentRenderRuntime.render(
      sourceComponent,
      componentInstanceTime(sourceComponent, sourceTime, source.instanceId),
      sourceRequest,
    );
    withRenderTarget2D(target, () => {
      withRenderView(target, renderRequest, () => {
        this.drawPlacedResultGeometry(target, createPlacedRenderResult(sourceOutput, {
          destinationRect: visibleRegion?.destinationRect || placement,
          transform: placementTransform,
          sourceIsWebGL:
            host.renderTargetRuntime.isShaderBuffer(sourceOutput),
        }), view);
      });
    });
  }

  drawGeneratorSource(
    target,
    source,
    component,
    componentTime,
    renderRequest,
    operation,
    inputStates = null,
  ) {
    const host = this.host;
    const generatorTime = instanceTime(source.instanceId || source.generatorId, componentTime);
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
            component,
          );
        }, renderRequest);
      });
      return;
    }
    const generatorComponent = host.visualNodeRuntime.generator(source.generatorId);
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
    const shaderGenerator = host.visualNodeRuntime.generatorShader(
      generatorComponent.id,
    );
    if (shaderGenerator) {
      if (host.shaderGeneratorRuntime.draw(
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

  executeCompiledVisualNodeProcess(
    operation,
    target,
    source,
    time,
    renderRequest,
    sourceRenderView = null,
    component = null,
  ) {
    const host = this.host;
    let invocation = this.compiledNodeProcessContexts.get(operation);
    if (!invocation) {
      invocation = {
        inputs: {
          source: null,
          params: null,
          runtimeValues: operation.runtimeValueInputs,
          runtimeValueIdentities: operation.runtimeValueIdentityInputs,
        },
        context: {
          target: null,
          source: null,
          time: 0,
          renderRequest: null,
          renderView: null,
          state: operation.nodeProcessState || {},
          output: operation.nodeProcessOutput || {},
          executionClass: "live-frame",
          renderHost: host,
          acquireMedia: (mediaId, options) =>
            this.mediaRuntime.acquireMediaById(mediaId, options),
          requestMissingMedia: (mediaId) =>
            this.mediaRuntime.requestMissingMedia(mediaId),
          acquireDrawableResource: (descriptor, width) =>
            this.mediaRuntime.acquireDrawableResource(descriptor, width, {
              playback: this.drawableResourcePlaybackOptions(
                descriptor,
                invocation.context.component,
              ),
            }),
          drawableResourceError: (descriptor) =>
            this.mediaRuntime.drawableResourceError(descriptor),
          isDrawableMedia,
          drawMediaFit,
          drawStandby: this.drawStandby.bind(this),
          renderProcess: createVisualRenderProcessContext(),
          component: null,
        },
      };
      for (const portId of operation.runtimeValueInputs?.keys?.() || []) {
        if (Object.hasOwn(invocation.inputs, portId)) continue;
        Object.defineProperty(invocation.inputs, portId, {
          enumerable: true,
          get: () => operation.runtimeValueInputs.get(portId),
        });
      }
      this.compiledNodeProcessContexts.set(operation, invocation);
    }
    invocation.inputs.source = source;
    invocation.inputs.params = source.params || {};
    invocation.context.target = target;
    invocation.context.source = source;
    invocation.context.time = time;
    invocation.context.renderRequest = renderRequest;
    invocation.context.renderView = sourceRenderView || renderView(target, renderRequest);
    invocation.context.component = component;
    updateVisualRenderProcessContext(invocation.context.renderProcess, {
      target,
      time,
      request: renderRequest,
      view: invocation.context.renderView,
      contentTransform: source.contentTransform || null,
      // renderItemState/renderFramebufferPassSequence own the single clear for
      // the retained target. A compiled node draws into that prepared target.
      clear: false,
    });
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
    if (this.nativeRendererRegistry.execute(
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

  drawStandby(target, label, {
    forceVisible = false,
    icon = "resource",
    detail = false,
  } = {}) {
    const transient = /loading|reading|processing|checking|preparing|matching|finding|not loaded/i
      .test(String(label || ""));
    withRenderTarget2D(target, () => {
      drawStandbyDiagnostic(target, label, {
        visible: standbyDiagnosticsVisible({
          mode: this.host.mode,
          debugPreview: this.host.state?.ui?.debugPreview,
          forceVisible,
        }),
        frame: this.host.frameRuntime.frameIndex,
        graceMs: transient ? 1000 : 0,
        icon,
        detail,
      });
    });
  }

  resolvePlacedSourceResult(
    output,
    source,
    component,
    componentTime,
    renderRequest,
    operation = null,
  ) {
    const host = this.host;
    const target = { width: output.width, height: output.height };
    const directResource = this.directPlacementResource(
      operation,
      source,
      component,
      renderRequest,
    );
    if (
      directResource?.drawable &&
      !directResource.requiresRetainedFrame &&
      isDrawableMedia(directResource.drawable)
    ) {
      const fitParameter =
        directResource.contract.fitParameter || "fit";
      const fit = source.params?.[fitParameter] || "contain";
      return createPlacedRenderResult(directResource.drawable, {
        destinationRect: fullTargetRect(target),
        fit,
        transform: source.contentTransform,
      });
    }
    if (source.type === "component") {
      const dependency = host.componentProgramRuntime.componentForId(source.componentId);
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
      const dependencyTime = host.frameRuntime.componentTimes.get(dependency.id) || componentTime;
      const renderIdentity = componentRenderInstanceKey(dependency, source.instanceId);
      const referenceCount = componentReferenceCount(
        host.componentProgramRuntime.programs.get(component.id),
        dependency.id,
      );
      const texture = host.componentRenderRuntime.render(
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
        sourceIsWebGL: host.renderTargetRuntime.isShaderBuffer(texture),
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

function stableStringifyValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyValue).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringifyValue(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withTargetScissor(target, rect, draw) {
  if (!rect || typeof draw !== "function") return draw?.();
  const gl = target?.drawingContext;
  if (!gl?.scissor || !gl?.enable) {
    if (!gl?.save || !gl?.beginPath || !gl?.rect || !gl?.clip) {
      return draw();
    }
    gl.save();
    gl.beginPath();
    gl.rect(
      Number(rect.x) || 0,
      Number(rect.y) || 0,
      Math.max(0, Number(rect.width) || 0),
      Math.max(0, Number(rect.height) || 0),
    );
    gl.clip();
    try {
      return draw();
    } finally {
      gl.restore();
    }
  }
  const targetWidth = Math.max(1, Number(target?.width) || 1);
  const targetHeight = Math.max(1, Number(target?.height) || 1);
  const density = target?.__vj1SharedFramebuffer
    ? 1
    : Math.max(1, Number(target?.pixelDensity?.()) || 1);
  const left = Math.max(
    0,
    Math.min(targetWidth, Number(rect.x) || 0),
  );
  const top = Math.max(
    0,
    Math.min(targetHeight, Number(rect.y) || 0),
  );
  const right = Math.max(
    left,
    Math.min(
      targetWidth,
      left + Math.max(0, Number(rect.width) || 0),
    ),
  );
  const bottom = Math.max(
    top,
    Math.min(
      targetHeight,
      top + Math.max(0, Number(rect.height) || 0),
    ),
  );
  const wasEnabled = gl.isEnabled?.(gl.SCISSOR_TEST) === true;
  const previousBox = gl.getParameter?.(gl.SCISSOR_BOX);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(
    Math.floor(left * density),
    Math.floor((targetHeight - bottom) * density),
    Math.max(1, Math.ceil((right - left) * density)),
    Math.max(1, Math.ceil((bottom - top) * density)),
  );
  try {
    return draw();
  } finally {
    if (previousBox?.length === 4) {
      gl.scissor(
        previousBox[0],
        previousBox[1],
        previousBox[2],
        previousBox[3],
      );
    }
    if (!wasEnabled) gl.disable(gl.SCISSOR_TEST);
  }
}
