import {
  applyLiveRenderPatches,
  interpolatedLiveRenderValue,
  isInterpolableLiveRenderPath,
  resolveLiveRenderPatches,
} from "../domain/live-render-patch.js?v=render-state-patch-1";

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
  const chainIndex = parts.lastIndexOf("chain");
  if (chainIndex < 0) return false;
  if (parts.length <= chainIndex + 2) return true;
  const itemField = String(parts[chainIndex + 2] || "");
  if (["id", "kind", "componentId"].includes(itemField)) return true;
  if (itemField !== "source") return false;
  return ["type", "generatorId", "componentId"].includes(String(parts[chainIndex + 3] || ""));
}

// Owns the transition from authored live patches to already-compiled program
// configuration. Temporary interpolation is applied only around one render
// frame and canonical project state is restored immediately afterward.
export class LiveRenderPatchRuntime {
  constructor(host) {
    this.host = host;
    this.fades = new Map();
    this.frameRestores = [];
  }

  get active() {
    return this.fades.size > 0;
  }

  applyLive(patches = [], nowMs = performance.now()) {
    const durationMs = Math.max(
      0,
      Number(this.host.state?.ui?.live?.paramFadeDuration) || 0,
    ) * 1000;
    return this.apply(patches, nowMs, durationMs);
  }

  apply(patches = [], nowMs = performance.now(), durationMs = 0) {
    const host = this.host;
    const resolution = resolveLiveRenderPatches(host.state, patches);
    if (!resolution.applied) return resolution;
    host.invalidatePresentation("render-patch");
    if (resolution.statePaths.length) {
      const nextState = { ...host.state };
      const result = applyLiveRenderPatches(nextState, patches);
      if (!result.applied) return result;
      host.state = nextState;
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
      return result;
    }
    durationMs = Math.max(0, Number(durationMs) || 0);
    const candidates = resolution.destinations.map((destination) => {
      const key = `${destination.componentId}:${destination.path}`;
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
    const result = applyLiveRenderPatches(host.state, patches);
    if (!result.applied) return result;
    for (const candidate of candidates) {
      const { destination, key, active, from } = candidate;
      const to = destination.value;
      const canFade = durationMs > 0 &&
        isInterpolableLiveRenderPath(destination.path) &&
        Number.isFinite(from) &&
        Number.isFinite(to);
      if (!canFade || Object.is(from, to)) {
        if (durationMs <= 0 || !active || !Object.is(active.to, to)) {
          this.fades.delete(key);
        }
        continue;
      }
      if (active && Object.is(active.to, to)) continue;
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
    if (
      patches.some(renderPatchChangesProgramTopology) ||
      host.componentProgramRuntime.dependencyClosureIsIncomplete(result.componentIds)
    ) {
      host.componentProgramRuntime.rebuild();
    } else {
      for (const componentId of result.componentIds) {
        host.componentProgramRuntime.syncConfiguration(componentId);
      }
    }
    if (result.componentIds.length) host.thumbnailRuntime.invalidateSelectedComponent();
    return result;
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
  }
}
