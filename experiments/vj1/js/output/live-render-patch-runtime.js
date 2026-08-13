import {
  applyLiveRenderPatchesImmutable,
  interpolatedLiveRenderValue,
  isInterpolableLiveRenderPath,
  resolveLiveRenderPatches,
} from "../domain/live-render-patch.js";

export function renderPatchChangesProgramReachability(patch = {}) {
  if (patch?.target === "state") return false;
  const parts = String(patch?.path || "").split(".").filter(Boolean);
  if (!parts.length) return false;
  const leaf = parts.at(-1);
  const sourceIndex = parts.lastIndexOf("source");
  if (sourceIndex >= 0 && ["type", "componentId"].includes(String(parts[sourceIndex + 1] || ""))) {
    return true;
  }
  return leaf === "componentId" && !parts.includes("params");
}

export function renderPatchChangesProgramTopology(patch = {}) {
  if (patch?.target === "state") return false;
  const parts = String(patch?.path || "").split(".").filter(Boolean);
  if (!patch?.nodeId || !parts.length) return false;
  const itemField = String(parts[0] || "");
  if (["id", "kind", "componentId"].includes(itemField)) return true;
  if (itemField !== "source") return false;
  return ["type", "generatorId", "componentId"].includes(String(parts[1] || ""));
}

export function renderPatchRejectionDiagnostic(host, patches, result, metadata = {}) {
  const failedPatch = result?.failedPatch || patches?.[0] || null;
  return {
    code: "VJ1_RENDER_PATCH_REJECTED",
    host: {
      mode: String(host?.mode || "unknown"),
      outputId: String(host?.outputId || ""),
    },
    rejectionReason: String(result?.rejectionReason || "unknown"),
    transportRevision: Number.isFinite(Number(metadata?.transportRevision))
      ? Number(metadata.transportRevision)
      : null,
    patchCount: Array.isArray(patches) ? patches.length : 0,
    failedPatch: failedPatch ? {
      target: String(failedPatch.target || "component"),
      componentId: String(failedPatch.componentId || ""),
      nodeId: String(failedPatch.nodeId || ""),
      path: String(failedPatch.path || ""),
    } : null,
  };
}

// Owns the transition from sparse Live overrides to already-compiled program
// configuration. The renderer path-copies its private state snapshot so a
// patch can never write through shared references into the authored project.
// Temporary interpolation is applied only around one render frame.
export class LiveRenderPatchRuntime {
  constructor(host, { warn = console.warn } = {}) {
    this.host = host;
    this.warn = warn;
    this.rejectionWarningKeys = new Set();
    this.fades = new Map();
    this.frameRestores = [];
  }

  get active() {
    return this.fades.size > 0;
  }

  applyLive(patches = [], nowMs = performance.now(), metadata = {}) {
    const durationMs = Math.max(
      0,
      Number(this.host.state?.ui?.live?.paramFadeDuration) || 0,
    ) * 1000;
    return this.apply(patches, nowMs, durationMs, metadata);
  }

  apply(patches = [], nowMs = performance.now(), durationMs = 0, metadata = {}) {
    const host = this.host;
    const resolution = resolveLiveRenderPatches(host.state, patches);
    const finish = (result) => {
      host.profileRuntime?.recordLivePatch?.(host, patches, resolution, result);
      if (!result?.applied) this.reportRejection(result, patches, metadata);
      return result;
    };
    if (!resolution.applied) return finish(resolution);
    host.invalidatePresentation("render-patch");
    if (resolution.statePaths.length) {
      const result = applyLiveRenderPatchesImmutable(host.state, patches);
      if (!result.applied) return finish(result);
      host.state = result.state;
      if (result.statePaths.includes("mappingCalibration")) {
        const mapping = host.mappingRuntime;
        const signature = mapping.currentSignature();
        const mappingInteractionActive = !!mapping.mapper?.isActive?.();
        const ignoreIncomingMapping = !mappingInteractionActive && mapping.pendingMappingSignature
          ? mapping.shouldIgnoreIncoming(signature)
          : false;
        if (!mappingInteractionActive && !ignoreIncomingMapping) {
          mapping.applyProject(signature);
        }
      }
      if (result.statePaths.includes("surfaces")) {
        // Live Surface eyes replace only the derived route program. Retain
        // visual programs and GPU resources, but materialize roots that may
        // become reachable when Scene Mapping is switched back on and rebuild
        // the Mapping lookup atomically against the new route array.
        const previousMappingState = host.mappingRuntime.captureState();
        host.componentProgramRuntime.ensureStateRoots(host.state);
        host.mappingProgramRuntime.rebuild(host.state);
        host.componentProgramRuntime.rebuildLookups(host.state);
        host.mappingRuntime.reconcileState(previousMappingState);
      }
      return finish(result);
    }
    durationMs = Math.max(0, Number(durationMs) || 0);
    const candidates = resolution.destinations.map((destination) => {
      const key = `${destination.componentId}:${destination.nodeId || "$component"}:${destination.path}`;
      const active = this.fades.get(key);
      const from = active
        ? interpolatedLiveRenderValue(
          active.from,
          active.to,
          active.startedAtMs,
          active.durationMs,
          nowMs,
        )
        : destination.target[destination.leaf];
      return { destination, key, active, from };
    });
    const result = applyLiveRenderPatchesImmutable(host.state, patches);
    if (!result.applied) return finish(result);
    host.state = result.state;
    const appliedResolution = resolveLiveRenderPatches(host.state, patches);
    if (!appliedResolution.applied) return finish(appliedResolution);
    for (let index = 0; index < candidates.length; index++) {
      const { key, active, from } = candidates[index];
      const destination = appliedResolution.destinations[index];
      const to = destination.value;
      const canFade = durationMs > 0 &&
        destination.interpolation !== "immediate" &&
        isInterpolableLiveRenderPath(destination.path, destination.nodeId) &&
        Number.isFinite(from) &&
        Number.isFinite(to);
      if (!canFade || Object.is(from, to)) {
        if (durationMs <= 0 || !active || !Object.is(active.to, to)) {
          this.fades.delete(key);
        }
        continue;
      }
      if (active && Object.is(active.to, to)) {
        // Immutable patching moves the canonical value into a new state
        // branch. Keep an already-running fade attached to that new branch.
        active.target = destination.target;
        active.leaf = destination.leaf;
        continue;
      }
      this.fades.set(key, {
        componentId: destination.componentId,
        target: destination.target,
        leaf: destination.leaf,
        from,
        to,
        startedAtMs: Number(nowMs) || 0,
        durationMs,
      });
    }
    for (const componentId of result.componentIds) {
      host.componentProgramRuntime.refreshLookup(componentId);
    }
    const compiledComponentIds = result.componentIds.filter((componentId) =>
      host.componentProgramRuntime.programs.has(String(componentId || ""))
    );
    // Output compiles only Components reachable from its current Surface
    // program. A patch to another Component is still authoritative within
    // this renderer snapshot, but there is no retained program to synchronize
    // until that Component becomes reachable. Rebuilding the same active roots
    // cannot materialize it and treating that as a failed patch unnecessarily
    // breaks the transport revision stream.
    const requiresProgramRebuild =
      (compiledComponentIds.length > 0 &&
        patches.some(renderPatchChangesProgramTopology)) ||
      host.componentProgramRuntime.dependencyClosureIsIncomplete(compiledComponentIds);
    if (requiresProgramRebuild) {
      host.componentProgramRuntime.rebuild();
    }
    const synchronizeConfigurationTargets = () => {
      const missingTargets = [];
      for (const target of result.configurationTargets || []) {
        if (!host.componentProgramRuntime.programs.has(String(target.componentId || ""))) {
          continue;
        }
        const synchronized =
          host.componentProgramRuntime.syncGraphNodes(
            target.componentId,
            target.nodeIds,
          );
        if (!synchronized.applied) missingTargets.push(target);
      }
      return missingTargets;
    };
    let missingTargets = synchronizeConfigurationTargets();
    // A render patch is not successful merely because it reached project
    // state. Its semantic visual item must also acknowledge the authored
    // configuration. A missing binding may be a stale retained program, so
    // rebuild once at this shared compiler boundary and retry. If the target
    // is still outside the active program roots, report that honestly:
    // Embedded Preview will activate its authoritative projection and Output
    // will request an ordered state resync. Never silently leave one renderer
    // displaying an older node configuration.
    if (missingTargets.length && !requiresProgramRebuild) {
      host.componentProgramRuntime.rebuild();
      missingTargets = synchronizeConfigurationTargets();
    }
    if (result.componentIds.length) host.thumbnailRuntime.invalidateSelectedComponent();
    if (missingTargets.length) {
      const missingComponentIds = new Set(
        missingTargets.map((target) => String(target.componentId || "")),
      );
      return finish({
        ...result,
        applied: false,
        stateApplied: true,
        configurationApplied: false,
        rejectionReason: "configuration-sync-failed",
        failedPatch: patches.find((patch) =>
          missingComponentIds.has(String(patch?.componentId || ""))
        ) || null,
      });
    }
    // A retained patch is authoritative for this renderer snapshot, even
    // though it never mutates the store-owned project. Let completed pointer
    // transactions release their optimistic overlay when the same item record
    // is patched; otherwise an older handle result can be restored over a
    // newer inspector-slider value during the next state activation.
    host.previewInteraction?.acceptAuthoritativeConfigurationPatches?.(
      appliedResolution.destinations,
    );
    return finish(result);
  }

  reportRejection(result, patches = [], metadata = {}) {
    if (result?.applied) return;
    const diagnostic = renderPatchRejectionDiagnostic(this.host, patches, result, metadata);
    const patch = diagnostic.failedPatch;
    const key = [
      diagnostic.host.mode,
      diagnostic.host.outputId,
      diagnostic.rejectionReason,
      patch?.target,
      patch?.componentId,
      patch?.nodeId,
      patch?.path,
    ].join(":");
    if (this.rejectionWarningKeys.has(key)) return;
    this.rejectionWarningKeys.add(key);
    if (this.rejectionWarningKeys.size > 128) {
      this.rejectionWarningKeys.delete(this.rejectionWarningKeys.values().next().value);
    }
    this.warn?.("[VJ1_RENDER_PATCH_REJECTED]", diagnostic);
  }

  applyFrame(nowMs = performance.now()) {
    this.frameRestores.length = 0;
    const synchronizedComponents = new Set();
    for (const [key, fade] of this.fades) {
      if (!Object.is(fade.target[fade.leaf], fade.to)) {
        this.fades.delete(key);
        continue;
      }
      if (Number(nowMs) >= fade.startedAtMs + fade.durationMs) {
        this.fades.delete(key);
        synchronizedComponents.add(fade.componentId);
        continue;
      }
      const value = interpolatedLiveRenderValue(
        fade.from,
        fade.to,
        fade.startedAtMs,
        fade.durationMs,
        nowMs,
      );
      this.frameRestores.push(fade);
      fade.target[fade.leaf] = value;
      synchronizedComponents.add(fade.componentId);
    }
    for (const componentId of synchronizedComponents) {
      this.host.componentProgramRuntime.programs
        .get(componentId)
        ?.syncGeneratedControlsFromConfiguration?.();
    }
  }

  restoreFrame() {
    for (const fade of this.frameRestores) fade.target[fade.leaf] = fade.to;
    this.frameRestores.length = 0;
  }

  clear() {
    this.restoreFrame();
    this.fades.clear();
    this.rejectionWarningKeys.clear();
  }
}
