import { roundTrimTime } from "./component-view.js";
import { getByPath, setByPath, setByPathCreate } from "./path-input-utils.js";
import { createComponentRenderPatch } from "../domain/live-render-patch.js";
import {
  ensureLiveParameterDiffBank,
  setLiveParameterDiff,
  setLiveNodeParameterDiff,
} from "../domain/live-parameter-diffs.js";
import {
  componentParameterAddress,
  componentParameterAddressForPath,
} from "../domain/component-layer-projection.js";
import { nodeBoundaryWithUniformScale } from "../libraries/render-engine/roi/index.js";

function directManipulationRenderPatch(componentId, nodeId, controlPath, value) {
  return createComponentRenderPatch(componentId, nodeId, controlPath, value, {
    interpolation: "immediate",
  });
}

// Application-side command handling is deliberately DOM-free. UI nodes emit
// semantic targets and values; this controller translates those commands into
// canonical project edits or sparse Live diffs.
export function createControlCommandController({
  store,
  getState,
  currentWorkspace,
  refreshSelectedMappingProjection,
  triggerIsfEvent = () => {},
  onLiveInput = () => {},
  showContextMenu = () => false,
  closeContextMenu = () => {},
}) {
  let contextMenuActions = new Map();

  function openComponentContextMenu(componentId, { x = 0, y = 0 } = {}) {
    const component = getState().components?.find((item) => item.id === String(componentId || ""));
    if (!component || component.type === "scene") return false;
    contextMenuActions = new Map([["convert-to-scene", () => store.copyComponentToScene?.(component.id)]]);
    showContextMenu({
      x,
      y,
      actions: [{ id: "convert-to-scene", label: "Convert to Scene" }],
    });
    return true;
  }

  function openParameterContextMenu(target = {}, { x = 0, y = 0 } = {}) {
    const path = String(target.path || target.address || "");
    if (!path) return false;
    const live = target.mode === "live";
    const animation = target.kind === "animation";
    const liveComponentId = String(target.componentId || "");
    const liveNodeId = String(target.nodeId || "");
    const state = getState();
    const componentMatch = /^components\.(\d+)\.(.+)$/.exec(path);
    const graphMatch = /^nodes\.groups\.(\d+)\./.exec(path);
    const graphComponentId = graphMatch
      ? String(state.nodes?.groups?.[Number(graphMatch[1])]?.componentId || "")
      : "";
    const componentIndex = live || animation
      ? state.components?.findIndex((item) => String(item.id) === liveComponentId) ?? -1
      : componentMatch
        ? Number(componentMatch[1])
        : graphComponentId
          ? state.components?.findIndex((item) => String(item.id) === graphComponentId) ?? -1
          : -1;
    const component = componentIndex >= 0 ? state.components?.[componentIndex] : null;
    const significantAddress = animation || !component
      ? ""
      : live
        ? componentParameterAddress(liveNodeId, path)
        : componentParameterAddressForPath(state, component, path);
    const animationIdentity = animation ? {
      targetNodeId: String(target.animation?.targetNodeId || ""),
      trackId: String(target.animation?.trackId || ""),
      field: String(target.animation?.field || ""),
    } : null;
    const significant = !!component && (animation
      ? (component.significantAnimationParams || []).some((entry) =>
          entry.targetNodeId === animationIdentity.targetNodeId &&
          entry.trackId === animationIdentity.trackId &&
          entry.field === animationIdentity.field)
      : (component.significantParams || []).includes(significantAddress));
    const boundaryScale = isBoundaryScaleTarget(target, path);
    const canMarkSignificant = !!component && (animation
      ? !!animationIdentity.targetNodeId && !!animationIdentity.trackId && !!animationIdentity.field
      : !!significantAddress && !boundaryScale);
    const actions = [];
    contextMenuActions = new Map();

    if (target.resettable !== false) {
      actions.push({ id: "reset", label: "Reset to default" });
      contextMenuActions.set("reset", () => {
        const value = target.defaultValue;
        const boundary = boundaryScale ? boundaryFromDimensions(target.boundary, value) : null;
        const recipe = (draft) => {
          if (boundary) {
            const widthPath = path.replace(/\.scale$/, ".width");
            const heightPath = path.replace(/\.scale$/, ".height");
            if (live) {
              setLiveOverride(draft, liveComponentId, widthPath, boundary.width, liveNodeId);
              setLiveOverride(draft, liveComponentId, heightPath, boundary.height, liveNodeId);
            } else {
              setByPath(draft, widthPath, boundary.width);
              setByPath(draft, heightPath, boundary.height);
              syncMappingEdits(draft, widthPath);
            }
          } else if (live) {
            setLiveOverride(draft, liveComponentId, path, value, liveNodeId);
          } else {
            setByPathCreate(draft, path, value);
            syncMappingEdits(draft, path);
          }
        };
        const livePatches = boundary ? [
          createComponentRenderPatch(liveComponentId, liveNodeId, path.replace(/\.scale$/, ".width"), boundary.width),
          createComponentRenderPatch(liveComponentId, liveNodeId, path.replace(/\.scale$/, ".height"), boundary.height),
        ] : [createComponentRenderPatch(liveComponentId, liveNodeId, path, value)];
        updateLiveAware(live, recipe, live ? "live:reset-default" : `update:${path}`, live ? livePatches : []);
      });
    }

    if (canMarkSignificant) {
      actions.push({ id: "significant", label: significant ? "Remove from significant" : "Make significant" });
      contextMenuActions.set("significant", () => {
        store.update((draft) => {
          const selected = draft.components?.[componentIndex];
          if (!selected) return;
          if (animation) {
            const entries = [...(selected.significantAnimationParams || [])];
            const index = entries.findIndex((entry) =>
              entry.targetNodeId === animationIdentity.targetNodeId &&
              entry.trackId === animationIdentity.trackId &&
              entry.field === animationIdentity.field);
            if (index >= 0) entries.splice(index, 1);
            else entries.push({
              ...animationIdentity,
              label: target.animation?.label || animationIdentity.field,
              min: Number(target.animation?.min),
              max: Number(target.animation?.max),
              step: Number(target.animation?.step) || 0,
              scale: "linear",
            });
            selected.significantAnimationParams = entries;
          } else {
            const addresses = new Set(selected.significantParams || []);
            if (addresses.has(significantAddress)) addresses.delete(significantAddress);
            else addresses.add(significantAddress);
            selected.significantParams = [...addresses];
          }
        }, {
          reason: "update:significant-param",
          outputState: "unchanged",
          effects: { control: { regions: ["live-projection-rail", "inspector"] } },
        });
      });
    }

    if (!actions.length) return false;
    showContextMenu({ x, y, actions });
    return true;
  }

  function executeContextMenuAction(actionId) {
    const action = contextMenuActions.get(String(actionId || ""));
    if (!action) return false;
    contextMenuActions = new Map();
    action();
    closeContextMenu();
    return true;
  }

  function dismissContextMenu() {
    contextMenuActions = new Map();
    closeContextMenu();
    return true;
  }

  function commitComponentValues(entries, reason, options = {}) {
    if (typeof store.setComponentValues !== "function" || !entries.length || entries.some((entry) => {
      const path = String(entry?.path || "");
      return !path.startsWith("components.") && !path.startsWith("nodes.groups.");
    })) return false;
    return store.setComponentValues(entries, { reason, ...options }) === true;
  }

  function updatePersistentValue(path, value, { phase = "commit" } = {}) {
    const normalizedPath = String(path || "");
    if (!normalizedPath) return false;
    const reason = phase === "change" ? `scrub:${normalizedPath}` : `update:${normalizedPath}`;
    if (liveTimingPreferencePath(normalizedPath) && typeof store.updateUi === "function") {
      // Live timing controls configure the next transition. They do not alter
      // the currently mounted render program, so keep their pointer cadence on
      // the UI branch and persist only the final value. Sending these through
      // project.update made every slider sample replace Preview and Output
      // state even though neither renderer consumes the preference directly.
      store.updateUi((ui) => {
        setByPath(ui, normalizedPath.slice("ui.".length), value);
      }, {
        reason,
        changedPaths: [normalizedPath],
        effects: {
          output: { mode: "none" },
          preview: { mode: "controls-only" },
          persistence: phase === "change"
            ? { mode: "none", history: false }
            : { mode: "autosave", history: false },
          control: null,
        },
      });
      return true;
    }
    if (commitComponentValues([{ path: normalizedPath, value }], reason)) return true;
    store.update((draft) => {
      const setter = normalizedPath.includes(".source.params.") ? setByPathCreate : setByPath;
      setter(draft, normalizedPath, value);
      syncMappingEdits(draft, normalizedPath);
    }, reason);
    return true;
  }

  function updatePersistentRange(target = {}, value = {}, { phase = "commit" } = {}) {
    const minPath = String(target.minPath || "");
    const maxPath = String(target.maxPath || "");
    const min = Number(value.min);
    const max = Number(value.max);
    if (!minPath || !maxPath || !Number.isFinite(min) || !Number.isFinite(max)) return false;
    const entries = [{ path: minPath, value: min }, { path: maxPath, value: max }];
    const reason = phase === "change" ? "scrub:parameter-range" : "update:parameter-range";
    if (commitComponentValues(entries, reason)) return true;
    store.update((draft) => {
      for (const entry of entries) {
        const setter = entry.path.includes(".source.params.") ? setByPathCreate : setByPath;
        setter(draft, entry.path, entry.value);
        syncMappingEdits(draft, entry.path);
      }
    }, reason);
    return true;
  }

  function updatePersistentRelatedValue(target = {}, payload = {}, options = {}) {
    const path = String(target.controls?.[String(payload.id || "")]?.path || "");
    return path ? updatePersistentValue(path, payload.value, options) : false;
  }

  function updatePersistentVideoTrim(target = {}, value = {}, active = "", { phase = "commit" } = {}) {
    const startPath = String(target.startPath || "");
    const endPath = String(target.endPath || "");
    const start = roundTrimTime(value.min);
    const explicitEnd = roundTrimTime(value.max);
    if (!startPath || !endPath || !Number.isFinite(start) || !Number.isFinite(explicitEnd)) return false;
    const end = target.implicitEnd === true && active !== "max" ? 0 : explicitEnd;
    const entries = [{ path: startPath, value: start }, { path: endPath, value: end }];
    const reason = phase === "change" ? "scrub:video-trim" : "update:video-trim";
    if (commitComponentValues(entries, reason)) return true;
    store.update((draft) => {
      for (const entry of entries) setByPath(draft, entry.path, entry.value);
    }, reason);
    return true;
  }

  function updatePersistentBoundaryScale(target = {}, scale, { phase = "commit" } = {}) {
    const path = String(target.path || "");
    if (!isBoundaryScaleTarget(target, path)) return false;
    const boundary = boundaryFromDimensions(target, scale);
    const entries = [
      { path: path.replace(/\.scale$/, ".width"), value: boundary.width },
      { path: path.replace(/\.scale$/, ".height"), value: boundary.height },
    ];
    const reason = phase === "change" ? "scrub:chain-boundary" : "update:chain-boundary";
    if (commitComponentValues(entries, reason)) return true;
    store.update((draft) => {
      for (const entry of entries) setByPath(draft, entry.path, entry.value);
      syncMappingEdits(draft, entries[0].path);
    }, reason);
    return true;
  }

  function triggerPersistentEvent(target = {}) {
    const resolved = isfEventTarget(getState(), String(target.path || ""));
    if (!resolved) return false;
    triggerIsfEvent(resolved);
    return true;
  }

  function updateLiveValue(target = {}, value, { phase = "commit" } = {}) {
    const componentId = String(target.componentId || "");
    const nodeId = String(target.nodeId || "");
    const path = String(target.path || "");
    if (!componentId || !path) return false;
    const reason = phase === "change" ? "scrub:live" : "live:update";
    onLiveInput({ reason, componentId, nodeId, path, value, inputType: "ui-node" });
    updateLiveAware(true, (draft) => setLiveOverride(draft, componentId, path, value, nodeId), reason,
      [directManipulationRenderPatch(componentId, nodeId, path, value)]);
    return true;
  }

  function updateLiveRange(target = {}, value = {}, { phase = "commit" } = {}) {
    const componentId = String(target.componentId || "");
    const nodeId = String(target.nodeId || "");
    const minPath = String(target.minPath || "");
    const maxPath = String(target.maxPath || "");
    const min = Number(value.min);
    const max = Number(value.max);
    if (!componentId || !minPath || !maxPath || !Number.isFinite(min) || !Number.isFinite(max)) return false;
    const reason = phase === "change" ? "scrub:live-range" : "live:range-update";
    onLiveInput({ reason, componentId, nodeId, path: minPath, value: min, inputType: "ui-node-range" });
    onLiveInput({ reason, componentId, nodeId, path: maxPath, value: max, inputType: "ui-node-range" });
    updateLiveAware(true, (draft) => {
      setLiveOverride(draft, componentId, minPath, min, nodeId);
      setLiveOverride(draft, componentId, maxPath, max, nodeId);
    }, reason, [
      directManipulationRenderPatch(componentId, nodeId, minPath, min),
      directManipulationRenderPatch(componentId, nodeId, maxPath, max),
    ]);
    return true;
  }

  function updateLiveRelatedValue(target = {}, payload = {}, options = {}) {
    const control = target.controls?.[String(payload.id || "")];
    return control ? updateLiveValue({
      componentId: target.componentId,
      nodeId: target.nodeId,
      path: control.path,
    }, payload.value, options) : false;
  }

  function updateLiveBoundaryScale(target = {}, scale, { phase = "commit" } = {}) {
    const componentId = String(target.componentId || "");
    const nodeId = String(target.nodeId || "");
    const path = String(target.path || "");
    if (!componentId || !nodeId || !isBoundaryScaleTarget(target, path)) return false;
    const boundary = boundaryFromDimensions(target, scale);
    const widthPath = path.replace(/\.scale$/, ".width");
    const heightPath = path.replace(/\.scale$/, ".height");
    updateLiveAware(true, (draft) => {
      setLiveOverride(draft, componentId, widthPath, boundary.width, nodeId);
      setLiveOverride(draft, componentId, heightPath, boundary.height, nodeId);
    }, phase === "change" ? "scrub:live" : "live:update", [
      directManipulationRenderPatch(componentId, nodeId, widthPath, boundary.width),
      directManipulationRenderPatch(componentId, nodeId, heightPath, boundary.height),
    ]);
    return true;
  }

  function triggerLiveEvent(target = {}) {
    const nodeId = String(target.nodeId || "");
    const parameterId = String(target.path || "").split(".").filter(Boolean).at(-1) || "";
    if (!nodeId || !parameterId) return false;
    triggerIsfEvent({ target: nodeId, parameterId });
    return true;
  }

  function updateLiveAnimationValue(target = {}, value, { phase = "commit" } = {}) {
    const componentId = String(target.componentId || "");
    const targetNodeId = String(target.targetNodeId || "");
    const trackId = String(target.trackId || "");
    const field = String(target.field || "");
    if (!componentId || !targetNodeId || !trackId || !field) return false;
    store.updateLive((draft) => {
      setLiveAnimationOverride(draft, componentId, targetNodeId, trackId, field, value);
    }, { reason: phase === "change" ? "scrub:live-animation" : "live:animation-update", input: "ui-node" });
    return true;
  }

  function updateLiveAware(isLive, recipe, reason, livePatches = []) {
    if (isLive && typeof store.updateLive === "function") store.updateLive(recipe, { reason, livePatches });
    else store.update(recipe, reason);
  }

  function syncMappingEdits(draft, path) {
    if (currentWorkspace(draft) === "mapping" && path.startsWith("mappings.")) {
      refreshSelectedMappingProjection(draft);
    }
  }

  return {
    updatePersistentValue,
    updatePersistentRange,
    updatePersistentRelatedValue,
    updatePersistentVideoTrim,
    updatePersistentBoundaryScale,
    triggerPersistentEvent,
    updateLiveValue,
    updateLiveRange,
    updateLiveRelatedValue,
    updateLiveBoundaryScale,
    triggerLiveEvent,
    updateLiveAnimationValue,
    openParameterContextMenu,
    openComponentContextMenu,
    executeContextMenuAction,
    dismissContextMenu,
  };
}

export function liveTimingPreferencePath(path = "") {
  return /^ui\.live\.(?:transitionId|transitionDuration|paramFadeDuration|transitionParameters(?:\.|$))/.test(
    String(path || ""),
  );
}

export function isfEventTarget(state = {}, path = "") {
  const segments = String(path || "").split(".").filter(Boolean);
  const paramsIndex = segments.lastIndexOf("params");
  const parameterId = paramsIndex >= 0 ? segments[paramsIndex + 1] : "";
  if (!parameterId) return null;
  const ownerSegments = segments.slice(0, paramsIndex);
  if (ownerSegments.at(-1) === "source") ownerSegments.pop();
  let owner = getByPath(state, ownerSegments.join("."));
  if (!owner?.id && ownerSegments.length) {
    ownerSegments.pop();
    owner = getByPath(state, ownerSegments.join("."));
  }
  const target = String(owner?.id || "");
  return target ? { target, parameterId } : null;
}

export function isBoundaryScaleTarget(target = {}, path = "") {
  return /(^|\.)boundary\.scale$/.test(String(path || "")) &&
    Number.isFinite(Number(target.width ?? target.boundary?.width)) &&
    Number.isFinite(Number(target.height ?? target.boundary?.height));
}

export function boundaryFromDimensions(target = {}, scale) {
  const boundary = nodeBoundaryWithUniformScale({
    width: Number(target.width ?? target.boundary?.width) || 1,
    height: Number(target.height ?? target.boundary?.height) || 1,
  }, Number(scale));
  return {
    width: Math.round(boundary.width * 1e12) / 1e12,
    height: Math.round(boundary.height * 1e12) / 1e12,
  };
}

export function setLiveOverride(state, componentId, path, value, nodeId = "") {
  if (nodeId) setLiveNodeParameterDiff(state, componentId, nodeId, path, value);
  else setLiveParameterDiff(state, componentId, path, value);
}

export function setLiveAnimationOverride(state, componentId, targetNodeId, trackId, field, value) {
  if (!componentId || !targetNodeId || !trackId || !field || !Number.isFinite(Number(value))) return;
  const overrides = ensureLiveParameterDiffBank(state);
  if (!overrides) return;
  const override = overrides[componentId] ||= {};
  override.animation ||= {};
  const track = override.animation[trackId] ||= { targetNodeId: String(targetNodeId), fields: {} };
  track.targetNodeId = String(targetNodeId);
  track.fields ||= {};
  track.fields[field] = Number(value);
}
