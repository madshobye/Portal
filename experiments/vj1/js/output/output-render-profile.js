export class OutputRenderProfile {
  constructor({ sampleInterval = 6 } = {}) {
    this.sampleInterval = Math.max(1, Math.floor(Number(sampleInterval) || 6));
    this.frameProfile = createEmptyFrameProfile();
    this.lastFrameProfile = createEmptyFrameProfile();
    this.collectDetailed = false;
    this.componentDepth = 0;
    this.componentContext = [];
    this.diagnosticsEnabled = false;
    this.diagnosticsDeadlineMs = 0;
    this.transitionDiagnostics = [];
    this.livePatchDiagnostics = [];
    this.lastTransitionDiagnosticFrame = -Infinity;
  }

  setDiagnosticsEnabled(enabled, { durationMs = 10000 } = {}) {
    this.diagnosticsEnabled = enabled === true;
    this.diagnosticsDeadlineMs = this.diagnosticsEnabled
      ? performance.now() + Math.min(10000, Math.max(1, Number(durationMs) || 10000))
      : 0;
    this.transitionDiagnostics.length = 0;
    this.livePatchDiagnostics.length = 0;
    this.lastTransitionDiagnosticFrame = -Infinity;
    return this.diagnosticsEnabled;
  }

  diagnosticsActive() {
    if (!this.diagnosticsEnabled) return false;
    if (performance.now() <= this.diagnosticsDeadlineMs) return true;
    this.setDiagnosticsEnabled(false);
    return false;
  }

  recordTransitionBoundary(host, transition, outgoingBranch) {
    if (!this.diagnosticsActive()) return;
    const frameIndex = Math.max(0, Number(host?.frameRuntime?.frameIndex) || 0);
    if (frameIndex - this.lastTransitionDiagnosticFrame < 15) return;
    this.lastTransitionDiagnosticFrame = frameIndex;
    try {
      const relevantComponentIds = collectRelevantComponentIds(host?.state, [transition]);
      this.transitionDiagnostics.push({
        capturedAtMs: performance.now(),
        frameIndex,
        transition: snapshotTransition(transition),
        outgoingPrograms: snapshotProgramMap(outgoingBranch?.programs, relevantComponentIds),
        targetPrograms: snapshotProgramMap(host?.componentProgramRuntime?.programs, relevantComponentIds),
      });
    } catch (error) {
      this.transitionDiagnostics.push(profileCaptureError(error, { frameIndex }));
    }
    if (this.transitionDiagnostics.length > 48) this.transitionDiagnostics.splice(0, this.transitionDiagnostics.length - 48);
  }

  recordLivePatch(host, patches = [], resolution = {}, result = {}) {
    if (!this.diagnosticsActive()) return;
    try {
      const componentIds = new Set(
        (resolution.componentIds || patches.map((patch) => patch?.componentId))
          .map(String)
          .filter(Boolean),
      );
      this.livePatchDiagnostics.push({
        capturedAtMs: performance.now(),
        patches: patches.slice(0, 16).map(snapshotRenderPatch),
        resolution: {
          applied: resolution.applied === true,
          statePaths: (resolution.statePaths || []).slice(0, 16).map(String),
          componentIds: [...componentIds],
          configurationTargets: (resolution.configurationTargets || []).slice(0, 16).map((target) => ({
            componentId: String(target?.componentId || ""),
            nodeIds: (target?.nodeIds || []).slice(0, 32).map(String),
          })),
        },
        result: {
          applied: result?.applied === true,
          stateApplied: result?.stateApplied,
          configurationApplied: result?.configurationApplied,
          failedPatch: result?.failedPatch ? snapshotRenderPatch(result.failedPatch) : null,
        },
        programs: snapshotProgramMap(
          host?.componentProgramRuntime?.programs,
          componentIds,
          { compact: true },
        ),
      });
    } catch (error) {
      this.livePatchDiagnostics.push(profileCaptureError(error));
    }
    if (this.livePatchDiagnostics.length > 48) {
      this.livePatchDiagnostics.splice(0, this.livePatchDiagnostics.length - 48);
    }
  }

  captureDiagnostic(host) {
    if (!this.diagnosticsActive()) return null;
    try {
      const state = host?.state || {};
      const transitions = state.liveTransitions || (state.liveTransition ? [state.liveTransition] : []);
      const transitionBranches = host?.surfaceRuntime?.transitionBranches || new Map();
      const relevantComponentIds = collectRelevantComponentIds(state, transitions, transitionBranches);
      const transitionBoundaries = this.transitionDiagnostics.splice(0, this.transitionDiagnostics.length);
      const livePatchTransactions = this.livePatchDiagnostics.splice(0, this.livePatchDiagnostics.length);
      return boundedProfileValue({
      schema: "vj1-renderer-live-profile-diagnostic@4",
      capturedAtMs: performance.now(),
      host: {
        mode: String(host?.mode || ""),
        outputId: String(host?.outputId || ""),
        frameIndex: Math.max(0, Number(host?.frameRuntime?.frameIndex) || 0),
      },
      live: {
        selectedComponentId: String(state.ui?.live?.selectedComponentId || state.ui?.selectedComponentId || ""),
        selectedSceneId: String(state.ui?.live?.selectedSceneId || ""),
        parameterDiffBank: {
          targetId: String(state.ui?.live?.selectedComponentId || state.ui?.live?.selectedSceneId || ""),
          values: state.ui?.live?.parameterDiffs?.[
            state.ui?.live?.selectedComponentId || state.ui?.live?.selectedSceneId || ""
          ] || {},
        },
        transitions: transitions.map(snapshotTransition),
      },
      programs: snapshotProgramMap(host?.componentProgramRuntime?.programs, relevantComponentIds),
      retainedTransitionBranches: [...transitionBranches].map(([id, context]) => ({
        id: String(id || ""),
        programs: snapshotProgramMap(context?.programs, relevantComponentIds),
      })),
      livePatchFades: [...(host?.livePatchRuntime?.fades || new Map())].map(([key, fade]) => ({
        key,
        componentId: String(fade?.componentId || ""),
        leaf: String(fade?.leaf || ""),
        from: fade?.from,
        to: fade?.to,
        current: fade?.target?.[fade?.leaf],
        startedAtMs: Number(fade?.startedAtMs) || 0,
        durationMs: Number(fade?.durationMs) || 0,
      })),
      cacheIdentity: {
        componentOutputKeys: filterRelevantKeys(host?.resourceRuntime?.componentOutput?.keys?.(), relevantComponentIds),
        stableSignatures: [...(host?.componentRenderRuntime?.stableSignatures || new Map())]
          .filter(([key]) => keyMatchesRelevantComponent(key, relevantComponentIds))
          .slice(0, 128)
          .map(([key, value]) => ({ key: String(key), value: String(value) })),
        sourceRuntimeKeys: filterRelevantKeys(host?.sourceRuntime?.nodeRuntimes?.keys?.(), relevantComponentIds),
        sourceRuntimes: snapshotSourceRuntimes(
          host?.sourceRuntime?.nodeRuntimes,
          relevantComponentIds,
        ),
      },
      readiness: host?.readinessRuntime?.status || null,
      transitionBoundaries: transitionBoundaries.slice(-8),
      livePatchTransactions: livePatchTransactions.slice(-24),
      });
    } catch (error) {
      return profileCaptureError(error);
    }
  }

  beginFrame(frameIndex) {
    this.frameProfile = createEmptyFrameProfile();
    this.componentDepth = 0;
    this.componentContext.length = 0;
    this.collectDetailed = frameIndex % this.sampleInterval === 0;
    return this.frameProfile;
  }

  measure(bucket, meta, fn) {
    if (!this.collectDetailed) return fn();
    const started = performance.now();
    const result = fn();
    const ms = performance.now() - started;
    this.frameProfile[bucket] += ms;
    this.frameProfile.passSamples.push({ ...meta, ms });
    return result;
  }

  measureComponent(meta, fn) {
    if (!this.collectDetailed) return fn();
    const started = performance.now();
    const outermost = this.componentDepth === 0;
    this.componentDepth++;
    this.componentContext.push(meta);
    let result;
    try {
      result = fn();
    } finally {
      this.componentContext.pop();
      this.componentDepth--;
      const ms = performance.now() - started;
      this.frameProfile.componentMs += ms;
      if (outermost) this.frameProfile.componentWallMs += ms;
      this.frameProfile.componentRenders++;
      this.frameProfile.passSamples.push({ ...meta, ms });
    }
    return result;
  }

  activeComponentIdentity() {
    const context = this.componentContext[this.componentContext.length - 1];
    return context?.componentId ? {
      componentId: context.componentId,
      componentName: context.componentName || context.componentId,
    } : {};
  }

  finishFrame(frameStart) {
    if (!this.collectDetailed) return this.lastFrameProfile;
    const profile = {
      ...this.frameProfile,
      totalMs: performance.now() - frameStart,
      passSamples: this.frameProfile.passSamples
        .slice()
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 12)
        .map((item) => ({ ...item, ms: roundMetric(item.ms) })),
    };
    for (const key of ["shaderMs", "sourceMs", "componentMs", "componentWallMs", "totalMs"]) {
      profile[key] = roundMetric(profile[key]);
    }
    this.lastFrameProfile = profile;
    return profile;
  }
}

function snapshotRenderPatch(patch = {}) {
  return {
    target: String(patch.target || "component"),
    targetId: String(patch.targetId || ""),
    componentId: String(patch.componentId || ""),
    nodeId: String(patch.nodeId || ""),
    path: String(patch.path || ""),
    value: boundedProfileValue(patch.value),
  };
}

function snapshotTransition(transition = {}) {
  const startedAtMs = Number(transition.startedAtMs) || 0;
  const durationMs = Math.max(0, Number(transition.durationMs) || 0);
  return {
    id: String(transition.id || ""),
    destination: String(transition.destination || ""),
    surfaceId: String(transition.surfaceId || ""),
    transitionId: String(transition.transitionId || ""),
    startedAtMs,
    durationMs,
    progress: transition.progress ?? (durationMs ? Math.max(0, Math.min(1, (Date.now() - startedAtMs) / durationMs)) : 0),
    transitionParameters: boundedProfileValue(transition.transitionParameters || transition.parameters || {}),
    fromTargetId: String(transition.fromTargetId || ""),
    toTargetId: String(transition.toTargetId || ""),
  };
}

function snapshotProgramMap(
  programs,
  relevantComponentIds = new Set(),
  { compact = false } = {},
) {
  if (!programs?.entries) return [];
  return [...programs.entries()]
    .filter(([componentId]) => !relevantComponentIds.size || relevantComponentIds.has(String(componentId || "")))
    .slice(0, 24)
    .map(([componentId, program]) => {
    const operations = [];
    program?.forEachOperation?.((operation = {}) => {
      if (operations.length >= 128) return;
      operations.push({
      id: String(operation.id || ""),
      nodeId: String(operation.nodeId || ""),
      nodeVersion: String(operation.nodeVersion || ""),
      opcode: String(operation.opcode || ""),
      backend: String(operation.backend || ""),
      configurationRevision: Math.max(0, Number(operation.configurationRevision) || 0),
      configuration: compact
        ? snapshotOperationConfiguration(operation.configuration)
        : boundedProfileValue(operation.configuration || null),
      retainedValues: snapshotRetainedValues(operation),
      });
    });
    return {
      componentId: String(componentId || program?.componentId || ""),
      groupId: String(program?.id || ""),
      configurationState: boundedProfileValue(program?.configurationState?.() || []),
      operations,
    };
  });
}

function snapshotOperationConfiguration(configuration = null) {
  if (!configuration) return null;
  const source = configuration.source || null;
  return {
    id: String(configuration.id || ""),
    kind: String(configuration.kind || ""),
    enabled: configuration.enabled !== false,
    ...(source
      ? {
          source: {
            type: String(source.type || ""),
            componentId: String(source.componentId || ""),
            generatorId: String(source.generatorId || ""),
            params: boundedProfileValue(source.params || {}),
          },
        }
      : { params: boundedProfileValue(configuration.params || {}) }),
  };
}

function snapshotRetainedValues(operation = {}) {
  const valueProgram = operation.valueProgram;
  const runtimeIdentities = operation.runtimeValueIdentityInputs;
  if (!valueProgram?.steps?.length && !runtimeIdentities?.size) return null;
  return {
    evaluationRevision: Math.max(0, Number(valueProgram?.evaluationRevision) || 0),
    ready: valueProgram?.ready !== false,
    steps: (valueProgram?.steps || []).slice(0, 32).map((step) => ({
      instanceId: String(step.instanceId || ""),
      nodeId: String(step.nodeId || ""),
      dependencyRevision: Math.max(
        0,
        Number(valueProgram?.stepDependencyRevisions?.get?.(step.id)) || 0,
      ),
      parameters: snapshotRelevant3dValue(step.parameters),
    })),
    outputIdentities: snapshotMap(valueProgram?.outputIdentities),
    runtimeInputIdentities: snapshotMap(runtimeIdentities),
    runtimeInputs: snapshotMap(
      operation.runtimeValueInputs,
      snapshotRelevant3dValue,
    ),
  };
}

function snapshotSourceRuntimes(runtimes, relevantComponentIds) {
  return [...(runtimes?.entries?.() || [])]
    .filter(([key]) => keyMatchesRelevantComponent(key, relevantComponentIds))
    .slice(0, 128)
    .map(([key, runtime]) => ({
      key: String(key),
      outputVersion: Math.max(0, Number(runtime?.outputVersion) || 0),
      lastUsedFrame: Math.max(0, Number(runtime?.lastUsedFrame) || 0),
      lastDirtyReason: String(runtime?.lastDirtyReason || ""),
      signatureDigest: stringDigest(runtime?.signature),
    }));
}

function snapshotMap(value, project = (item) => boundedProfileValue(item)) {
  return [...(value?.entries?.() || [])]
    .slice(0, 64)
    .map(([key, item]) => [String(key), project(item)]);
}

function snapshotRelevant3dValue(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return boundedProfileValue(value);
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Array.from(value).slice(0, 16).map(snapshotRelevant3dValue);
  }
  const result = {};
  const relevantKeys = new Set([
    "kind", "id", "providerId", "renderMode", "surfaceColor", "wireColor",
    "geometryDetail", "wireThickness", "pointBudget", "visibleDepth",
    "frontCut", "edgeAngle", "edgeBudget", "renderQuality", "material",
    "sceneMaterial", "object", "objects", "scene", "camera", "transform",
  ]);
  for (const [key, item] of Object.entries(value)) {
    if (!relevantKeys.has(key)) continue;
    if (key === "objects" && Array.isArray(item)) {
      result[key] = item.slice(0, 8).map(snapshotRelevant3dValue);
    } else {
      result[key] = snapshotRelevant3dValue(item);
    }
  }
  return result;
}

function stringDigest(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function collectRelevantComponentIds(state = {}, transitions = [], transitionBranches = new Map()) {
  const live = state.ui?.live || {};
  const ids = new Set([
    live.selectedComponentId,
    live.selectedSceneId,
    state.ui?.selectedComponentId,
  ].map(String).filter(Boolean));
  const targetId = String(live.selectedComponentId || live.selectedSceneId || "");
  for (const componentId of Object.keys(live.parameterDiffs?.[targetId] || {})) {
    if (componentId) ids.add(String(componentId));
  }
  const visitSurface = (surface = {}) => {
    const componentId = String(surface.componentId || surface.source?.componentId || "");
    if (componentId) ids.add(componentId);
  };
  for (const surface of state.surfaces || []) visitSurface(surface);
  for (const context of transitionBranches.values()) {
    for (const componentId of context?.programs?.keys?.() || []) ids.add(String(componentId));
    for (const surface of context?.state?.surfaces || []) visitSurface(surface);
  }
  return ids;
}

function filterRelevantKeys(keys, relevantComponentIds) {
  return [...(keys || [])]
    .filter((key) => keyMatchesRelevantComponent(key, relevantComponentIds))
    .slice(0, 128)
    .map(String);
}

function keyMatchesRelevantComponent(key, relevantComponentIds) {
  if (!relevantComponentIds?.size) return true;
  const value = String(key || "");
  return [...relevantComponentIds].some((componentId) => value.includes(componentId));
}

function boundedProfileValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 8192 ? `${value.slice(0, 8192)}…[truncated ${value.length - 8192}]` : value;
  if (typeof value !== "object") return String(value);
  if (depth >= 16) return "[max-depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, 128).map((item) => boundedProfileValue(item, depth + 1, seen));
    if (value.length > 128) result.push(`[truncated ${value.length - 128} items]`);
    seen.delete(value);
    return result;
  }
  const result = {};
  const entries = Object.entries(value).slice(0, 128);
  for (const [key, item] of entries) result[key] = boundedProfileValue(item, depth + 1, seen);
  if (Object.keys(value).length > entries.length) result.__truncatedKeys = Object.keys(value).length - entries.length;
  seen.delete(value);
  return result;
}

function profileCaptureError(error, detail = {}) {
  return {
    schema: "vj1-renderer-live-profile-diagnostic@4",
    ...detail,
    captureError: error?.message || String(error),
  };
}

export function createEmptyFrameProfile() {
  return {
    shaderPasses: 0,
    shaderChains: 0,
    maxShaderChainLength: 0,
    shaderHandoffs: 0,
    componentCacheHits: 0,
    stageCacheHits: 0,
    stageRenders: 0,
    shaderMs: 0,
    sourceMs: 0,
    componentMs: 0,
    componentWallMs: 0,
    componentRenders: 0,
    surfaceRouteCandidates: 0,
    surfaceRoutesVisible: 0,
    surfaceRoutesCulled: 0,
    componentRasterPixels: 0,
    surfaceRasterPixels: 0,
    directSourceComposites: 0,
    avoidedSourceRasterPixels: 0,
    directSurfaceSamples: 0,
    avoidedSurfaceRasterPixels: 0,
    totalMs: 0,
    passSamples: [],
  };
}

export function roundMetric(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
