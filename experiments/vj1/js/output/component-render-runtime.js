import { normalizeComponentPipelineSettings } from "../domain/models.js";
import {
  isReadyMediaItem,
  renderBufferKey,
  runtimeCompiledComponentGraphMediaState,
  runtimeMediaInvalidation,
  staticCompiledComponentGraphMediaState,
  staticCompiledComponentGraphState,
} from "./component-render-state.js";
import { drawBuffer } from "./render-draw-utils.js";
import {
  createRenderRequest,
  renderRequestKey,
  renderRequestStateKey,
} from "./render-geometry.js";

// Retained Component execution capability. Semantic graphs are compiled by
// ComponentProgramRuntime; this capability owns the allocation-stable request,
// reuse, trace, and execution lifecycle around those programs. It never
// traverses an authored graph or creates generic node packets in the frame loop.
export class ComponentRenderRuntime {
  constructor(host) {
    this.host = host;
    this.stableSignatures = new Map();
    this.resolutionTraces = new Map();
    this.resolutionTraceStack = [];
    this.activeResolutionTrace = [];
    this.lastResolutionTrace = [];
  }

  clear() {
    this.host.recordSignal?.("cacheInvalidations", 1, "component-render-cache");
    this.stableSignatures.clear();
    this.resolutionTraces.clear();
    this.resolutionTraceStack.length = 0;
    this.activeResolutionTrace.length = 0;
    this.lastResolutionTrace.length = 0;
  }

  beginFrame() {
    if (this.host.profileRuntime.collectDetailed) this.activeResolutionTrace.length = 0;
  }

  finishFrame() {
    if (!this.host.profileRuntime.collectDetailed) return;
    this.lastResolutionTrace = this.activeResolutionTrace.map((entry) => ({
      ...entry,
    }));
  }

  renderAtSize(component, componentTime, width, height) {
    return this.render(
      component,
      componentTime,
      createRenderRequest("texture", { width, height }),
    );
  }

  render(component, componentTime, request) {
    const host = this.host;
    const outputRequest = host.renderRequestRuntime.normalize(request, "component");
    const pipeline = normalizeComponentPipelineSettings(host.state?.render || {});
    const sourceRequest = component?.type === "scene"
      ? outputRequest
      : componentPipelineSourceRequest(outputRequest, pipeline);
    const outputKey = renderBufferKey(
      component.id,
      renderRequestStateKey(outputRequest),
    );
    return this.withResolutionTrace(component, outputKey, outputRequest, () =>
      this.renderResolved(
        component,
        componentTime,
        outputRequest,
        sourceRequest,
        outputKey,
        pipeline,
      )
    );
  }

  renderResolved(
    component,
    componentTime,
    outputRequest,
    sourceRequest,
    outputKey,
    pipeline,
  ) {
    const host = this.host;
    const cached = host.resourceRuntime.componentOutput.get(outputKey);
    if (cached) {
      this.useCachedResolutionTrace(outputKey);
      host.sourceRuntime.claimRetainedComponentMedia(component);
      host.profileRuntime.frameProfile.componentCacheHits++;
      host.recordSignal?.("cacheHits", 1, "component-frame");
      return cached;
    }

    // Moving regional windows reuse size-keyed GPU allocations, but do not
    // create persistent stable-cache entries for every crop position.
    const stableSignature = outputRequest.regionView === true
      ? ""
      : this.stableSignature(component, outputRequest);
    const stableKey = renderBufferKey("stable", outputKey);
    const stableGpuKey = renderBufferKey(
      stableKey,
      renderRequestKey(outputRequest),
    );
    const stableGpuCached = stableSignature
      ? host.renderTargetRuntime.gpuTarget(stableGpuKey)
      : null;
    const stableCpuCached = stableSignature
      ? host.renderTargetRuntime.cpuTarget(stableGpuKey)
      : null;
    const stableCached = stableGpuCached || stableCpuCached;
    if (
      stableCached &&
      stableCached.width === outputRequest.width &&
      stableCached.height === outputRequest.height &&
      this.stableSignatures.get(stableKey) === stableSignature
    ) {
      this.useCachedResolutionTrace(stableKey);
      this.aliasCurrentResolutionTrace(stableKey);
      // A retained frame still owns its live media. Without renewing this
      // lease, endFrame() pauses a cached video after its first decoded frame.
      host.sourceRuntime.claimRetainedComponentMedia(component);
      if (stableGpuCached) {
        host.renderTargetRuntime.touchGpu(stableGpuKey);
      } else {
        host.renderTargetRuntime.touchCpu(stableGpuKey);
      }
      host.profileRuntime.frameProfile.componentCacheHits++;
      host.recordSignal?.("cacheHits", 1, "component-stable");
      this.cacheOutput(component, outputKey, stableCached, outputRequest);
      return stableCached;
    }

    const profile = {
      type: "component",
      componentId: component.id,
      componentName:
        component.name ||
        component.id ||
        (component.type === "scene" ? "Scene" : "Component"),
      width: sourceRequest.width,
      height: sourceRequest.height,
      ...(component.type === "scene"
        ? {}
        : {
            outputWidth: outputRequest.width,
            outputHeight: outputRequest.height,
          }),
    };
    const output = host.profileRuntime.measureComponent(profile, () => {
      const source = this.executeCompiled(
        component,
        componentTime,
        sourceRequest,
      );
      if (component.type === "scene") return source;
      return host.compositeRuntime.renderComponentPipeline({
        component,
        source,
        sourceRequest,
        outputRequest,
        componentTime,
        pipeline,
      });
    });
    this.cacheOutput(component, outputKey, output, outputRequest);
    if (stableSignature) {
      this.storeStableOutput(
        stableKey,
        stableSignature,
        output,
        outputRequest,
      );
      this.aliasCurrentResolutionTrace(stableKey);
    }
    return output;
  }

  executeCompiled(component, componentTime, request, outputIdentity = true) {
    const host = this.host;
    const renderRequest = host.renderRequestRuntime.normalize(request, "component");
    const program = host.componentProgramRuntime.programs.get(component.id);
    if (!program) {
      throw new Error(
        `VJ1_COMPONENT_PROGRAM_MISSING:${component.id || "unknown"}`,
      );
    }
    const outputKey = outputIdentity
      ? renderBufferKey(component.id, "component-output")
      : undefined;
    const state = program.execute(
      host,
      component,
      componentTime,
      renderRequest,
      outputKey,
    );
    return state.buffer;
  }

  withResolutionTrace(component, key, request, render) {
    const host = this.host;
    const parent = this.resolutionTraceStack.at(-1) || null;
    const collect =
      !!parent ||
      host.profileRuntime.collectDetailed ||
      !this.resolutionTraces.has(key);
    if (!collect) {
      const cached = this.resolutionTraces.get(key) || [];
      if (parent) parent.entries.push(...cached);
      else if (host.profileRuntime.collectDetailed) {
        this.activeResolutionTrace.push(...cached);
      }
      return render();
    }

    const context = { key, aliases: new Set(), entries: [], component };
    this.resolutionTraceStack.push(context);
    context.entries.push({
      componentId: String(component?.id || ""),
      itemId: String(component?.id || ""),
      kind: component?.type === "scene" ? "scene" : "component",
      name:
        component?.name ||
        component?.id ||
        (component?.type === "scene" ? "Scene" : "Component"),
      width: Math.max(1, Math.round(Number(request?.width) || 1)),
      height: Math.max(1, Math.round(Number(request?.height) || 1)),
      depth: this.resolutionTraceStack.length - 1,
    });
    let result;
    try {
      result = render();
    } finally {
      this.resolutionTraceStack.pop();
      const entries = context.entries.map((entry) => ({ ...entry }));
      this.resolutionTraces.set(key, entries);
      for (const alias of context.aliases) {
        this.resolutionTraces.set(alias, entries);
      }
      if (parent) parent.entries.push(...entries);
      else if (host.profileRuntime.collectDetailed) {
        this.activeResolutionTrace.push(...entries);
      }
    }
    return result;
  }

  useCachedResolutionTrace(key) {
    const context = this.resolutionTraceStack.at(-1);
    const cached = this.resolutionTraces.get(key);
    if (!context || !cached?.length) return false;
    context.entries.length = 0;
    context.entries.push(...cached);
    return true;
  }

  aliasCurrentResolutionTrace(key) {
    const context = this.resolutionTraceStack.at(-1);
    if (!context || !key) return false;
    context.aliases.add(key);
    return true;
  }

  recordResolution(component, item, kind, request) {
    const context = this.resolutionTraceStack.at(-1);
    if (!context) return;
    component ||= context.component;
    const source = item?.source || {};
    const implementation =
      kind === "effect"
        ? this.host.visualNodeRuntime.effect(item?.componentId)
        : null;
    context.entries.push({
      componentId: String(component?.id || ""),
      itemId: String(
        item?.id ||
          source.instanceId ||
          item?.componentId ||
          kind,
      ),
      kind: String(kind || "element"),
      name:
        item?.name ||
        implementation?.name ||
        source.generatorId ||
        hudResourceName(source.mediaId) ||
        source.componentId ||
        source.type ||
        kind ||
        "Element",
      width: Math.max(1, Math.round(Number(request?.width) || 1)),
      height: Math.max(1, Math.round(Number(request?.height) || 1)),
      depth: this.resolutionTraceStack.length,
    });
  }

  cacheOutput(component, outputKey, output, renderRequest) {
    const host = this.host;
    host.resourceRuntime.componentOutput.set(outputKey, output);
    if (
      host.resourceRuntime.mainMix &&
      renderRequest.width === host.resourceRuntime.mainMix.width &&
      renderRequest.height === host.resourceRuntime.mainMix.height
    ) {
      host.resourceRuntime.componentOutput.set(component.id, output);
    }
  }

  storeStableOutput(stableKey, signature, source, renderRequest) {
    const host = this.host;
    const stable = host.renderTargetRuntime.gpu(stableKey, renderRequest);
    stable.push();
    stable.clear();
    drawBuffer(
      stable,
      source,
      0,
      0,
      stable.width,
      stable.height,
      host.renderTargetRuntime.isShaderBuffer(source),
    );
    stable.pop();
    this.stableSignatures.set(stableKey, signature);
  }

  stableSignature(component, renderRequest, seen = new Set()) {
    const host = this.host;
    const pipeline = normalizeComponentPipelineSettings(
      host.state?.render || {},
    );
    if (
      pipeline.postProcessing.noiseEnabled &&
      pipeline.postProcessing.noiseAmount > 0.0001
    ) {
      return "";
    }
    if (!component?.id || this.isFrameDynamic(component, seen)) return "";
    if (!host.componentProgramRuntime.programs.has(component.id)) {
      throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id}`);
    }
    const controlSignalRevision = this.controlSignalRevision(component);
    // A control host without a revision contract cannot safely participate in
    // retained caching. Production hosts expose revisionFor(); custom hosts
    // remain correct by taking the uncached path until they implement it.
    if (controlSignalRevision === null) return "";
    const externalResources = this.runtimeExternalResourceState(component);
    return stableStringify({
      version: 5,
      request: {
        role: renderRequest.role || "component",
        width: renderRequest.width,
        height: renderRequest.height,
      },
      // A component transform belongs to its consumer. Nested component
      // transforms remain part of the parent Component's rendered graph.
      component: staticCompiledComponentGraphState(
        component,
        host.componentProgramRuntime.programs,
        host.state?.components || [],
        new Set(),
        false,
      ),
      media: staticCompiledComponentGraphMediaState(
        host.state?.media || [],
        component,
        host.componentProgramRuntime.programs,
        host.state?.components || [],
      ),
      runtimeMedia: runtimeCompiledComponentGraphMediaState(
        host.media,
        component,
        host.componentProgramRuntime.programs,
        host.state?.components || [],
      ),
      controlSignals: controlSignalRevision,
      externalResources,
      customShader: host.state?.shaders?.customCode || "",
      pipeline,
    });
  }

  runtimeExternalResourceState(component, seen = new Set()) {
    const host = this.host;
    const componentId = String(component?.id || "");
    if (!componentId || seen.has(componentId)) return null;
    const program = host.componentProgramRuntime.programs.get(componentId);
    const inspection = program?.inspect?.();
    if (!inspection) return null;
    seen.add(componentId);
    const externalSources = [];
    const runtimeContext = host.sourceRuntime.nodeRuntimeContext(
      host.frameRuntime.componentTimes.get(componentId) || 0,
    );
    program.forEachOperation((operation) => {
      const configuration = operation?.configuration || {};
      const source = configuration.source;
      if (
        !source ||
        !host.sourceRuntime.sourceUsesExternalRevision(source, operation)
      ) return;
      externalSources.push({
        id: String(operation.id || ""),
        revision: String(
          host.sourceRuntime.runtimeExternalKey(
            source,
            configuration,
            runtimeContext,
            operation,
          ) ?? "",
        ),
      });
    });
    externalSources.sort((left, right) => left.id.localeCompare(right.id));
    const capabilities = (inspection.readiness?.requirements || [])
      .filter((requirement) => requirement.kind === "capability")
      .map((requirement) => {
        const resolved = host.specializedSources.capabilityReadiness(
          requirement,
          { component, program },
        );
        if (!resolved) return null;
        return {
          id: String(requirement.id || ""),
          state: String(resolved.state || "error"),
          revision: String(
            resolved.revision ??
            resolved.invalidationKey ??
            resolved.state ??
            "",
          ),
          error: String(resolved.error || ""),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id));
    const dependencies = (inspection.dependencies?.components || [])
      .map((dependencyId) => {
        const dependency = host.componentProgramRuntime.componentForId(
          dependencyId,
        );
        return this.runtimeExternalResourceState(dependency, seen);
      })
      .filter(Boolean);
    seen.delete(componentId);
    if (
      !externalSources.length &&
      !capabilities.length &&
      !dependencies.length
    ) return null;
    return {
      componentId,
      externalSources,
      capabilities,
      dependencies,
    };
  }

  isFrameDynamic(component, seen = new Set()) {
    const host = this.host;
    if (!component || seen.has(component.id)) return true;
    seen.add(component.id);
    const inspection = host.componentProgramRuntime.programs
      .get(component.id)
      ?.inspect();
    if (!inspection) {
      seen.delete(component.id);
      return true;
    }
    let dynamic = inspection?.dynamics?.frameDependent === true;
    if (
      !dynamic &&
      controlSignalRequirements(inspection).length &&
      typeof host.controlSignalRuntime?.revisionFor !== "function"
    ) {
      dynamic = true;
    }
    if (!dynamic) {
      for (const mediaId of inspection?.mediaDemand?.ids || []) {
        const runtimeItem = host.media.get(mediaId);
        const mediaMeta = (host.state?.media || []).find(
          (item) => item.id === mediaId,
        );
        if (!mediaMeta || !isReadyMediaItem(runtimeItem)) {
          dynamic = true;
          break;
        }
        if (
          runtimeMediaInvalidation(runtimeItem, mediaMeta, {
            frame: host.frameRuntime.frameIndex,
          }).mode === "frame"
        ) {
          dynamic = true;
          break;
        }
      }
    }
    if (!dynamic) {
      for (
        const dependencyId of
        inspection?.dependencies?.components || []
      ) {
        const dependency = host.state?.components?.find(
          (candidate) => candidate.id === dependencyId,
        );
        if (!dependency || this.isFrameDynamic(dependency, seen)) {
          dynamic = true;
          break;
        }
      }
    }
    seen.delete(component.id);
    return dynamic;
  }

  controlSignalRevision(component, seen = new Set()) {
    const host = this.host;
    if (!component?.id || seen.has(component.id)) return "";
    seen.add(component.id);
    const inspection = host.componentProgramRuntime.programs
      .get(component.id)
      ?.inspect?.();
    if (!inspection) {
      seen.delete(component.id);
      return null;
    }
    const requirements = controlSignalRequirements(inspection);
    const localRevision = requirements.length
      ? host.controlSignalRuntime?.revisionFor?.(requirements)
      : "";
    if (requirements.length && localRevision == null) {
      seen.delete(component.id);
      return null;
    }
    const revisions = localRevision ? [localRevision] : [];
    for (const dependencyId of inspection?.dependencies?.components || []) {
      const dependency = host.state?.components?.find(
        (candidate) => candidate.id === dependencyId,
      );
      const revision = this.controlSignalRevision(dependency, seen);
      if (revision === null) {
        seen.delete(component.id);
        return null;
      }
      if (revision) revisions.push(`${dependencyId}[${revision}]`);
    }
    seen.delete(component.id);
    return revisions.sort().join("|");
  }

  pruneStableSignatures() {
    const host = this.host;
    for (const key of Array.from(this.stableSignatures.keys())) {
      const hasCpuEntry = host.renderTargetRuntime.hasCpuPrefix(`${key}:`);
      const hasGpuEntry = host.renderTargetRuntime.hasGpuPrefix(`${key}:`);
      if (!hasCpuEntry && !hasGpuEntry) this.stableSignatures.delete(key);
    }
  }
}

function controlSignalRequirements(inspection = {}) {
  return (inspection?.readiness?.requirements || []).filter(
    (requirement) => requirement?.kind === "control-signal",
  );
}

export function componentPipelineSourceRequest(request = {}, pipeline = {}) {
  const upscaling = pipeline?.upscaling || {};
  if (
    upscaling.enabled !== true ||
    Number(upscaling.amount) >= 0.999
  ) {
    return request;
  }
  const amount = Math.min(
    1,
    Math.max(0.35, Number(upscaling.amount) || 0.67),
  );
  return createRenderRequest(
    request.role || "texture",
    {
      width: Math.max(
        1,
        Math.round((Number(request.width) || 1) * amount),
      ),
      height: Math.max(
        1,
        Math.round((Number(request.height) || 1) * amount),
      ),
    },
    {
      ...request,
      logicalWidth: Math.max(
        1,
        Number(request.logicalWidth) ||
          Number(request.width) ||
          1,
      ),
      logicalHeight: Math.max(
        1,
        Number(request.logicalHeight) ||
          Number(request.height) ||
          1,
      ),
      pipelineSource: true,
      pipelineScale: amount,
    },
  );
}

function stableStringify(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  });
}

function hudResourceName(value = "") {
  const normalized = String(value || "").replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) || normalized;
}
