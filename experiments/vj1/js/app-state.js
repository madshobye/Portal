import {
  applySceneForEditing,
  applySceneSnapshotToState,
  clone,
  createCanvasComponent,
  createCanvasFrame,
  createDefaultComponent,
  createDefaultSurface,
  createComponentEffect,
  createComponentGroup,
  createComponentLayer,
  createInitialState,
  createLiveRenderState,
  createSceneSurfaceSnapshot,
  createSceneFromState,
  sanitizeState,
  syncLiveSnapshotFromScene,
  uid,
} from "./domain/models.js?v=adaptive-component-demand-24";
import { stampChangedProjectItems, touchComponentUsed } from "./domain/component-activity.js?v=adaptive-component-demand-24";
import { componentFrameMetrics } from "./domain/component-frame.js?v=adaptive-component-demand-24";
import { VJ1, WORKSPACES } from "./constants.js";

export function createAppState(initial = null) {
  let state = sanitizeState(initial || createInitialState());
  refreshLiveSelectedSceneSnapshot(state);
  const listeners = new Set();

  function emit(reason = "change") {
    for (const listener of listeners) listener(getState(), reason);
  }

  function getState() {
    return clone(state);
  }

  function replace(next, reason = "replace") {
    const previous = state;
    const normalized = sanitizeState(next);
    state = preservesImportedActivity(reason) ? normalized : stampChangedProjectItems(previous, normalized);
    if (!isLiveOverrideReason(reason)) reconcileLiveOverridesWithPersistentEdits(previous, state);
    refreshLiveSelectedSceneSnapshot(state);
    emit(reason);
  }

  function update(recipe, reason = "update") {
    const draft = getState();
    recipe(draft);
    replace(draft, reason);
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState(), "init");
    return () => listeners.delete(listener);
  }

  return {
    getState,
    replace,
    update,
    subscribe,
    selectSurface(id) {
      update((draft) => {
        draft.ui.selectedSurfaceId = id;
      }, "select-surface");
    },
    selectComponent(id) {
      update((draft) => {
        draft.ui.selectedComponentId = id;
        touchComponentUsed(draft, id);
        const component = draft.components.find((item) => item.id === id);
        draft.ui.selectedChainItemId = component?.chain?.[0]?.id || "";
        rememberWorkspaceComponent(draft, draft.ui.workspace, component);
      }, "select-component");
    },
    setWorkspace(workspace) {
      update((draft) => {
        const current = draft.components.find((component) => component.id === draft.ui.selectedComponentId);
        rememberWorkspaceComponent(draft, draft.ui.workspace, current);
        draft.ui.workspace = WORKSPACES.includes(workspace) ? workspace : "scene";
        restoreWorkspaceComponent(draft, draft.ui.workspace);
        draft.global.calibrating = draft.ui.workspace === "scene";
      }, "workspace");
    },
    getLiveRenderState() {
      return createLiveRenderState(getState());
    },
    getSceneRenderState(id) {
      const current = getState();
      const scene = current.scenes.find((item) => String(item.id) === String(id));
      return scene ? applySceneForEditing(current, scene) : createLiveRenderState(current);
    },
    getRenderState() {
      const current = getState();
      if (current.ui?.workspace === "live") return createLiveRenderState(current);
      if (current.ui?.workspace === "scene") {
        const scene = current.scenes.find((item) => item.id === current.ui.selectedSceneId) || current.scenes[0];
        return scene ? applySceneForEditing(current, scene) : current;
      }
      return current;
    },
    addComponent() {
      update((draft) => {
        const component = createDefaultComponent(draft.components.filter((item) => item.type !== "canvas").length);
        draft.components.push(component);
        draft.ui.selectedComponentId = component.id;
        draft.ui.selectedChainItemId = component.chain[0]?.id || "";
        rememberWorkspaceComponent(draft, "component", component);
        for (const surface of draft.surfaces) {
          if (!surface.componentId) surface.componentId = component.id;
        }
      }, "add-component");
    },
    addCanvasComponent() {
      update((draft) => {
        const component = createCanvasComponent(
          draft.components.filter((item) => item.type === "canvas").length
        );
        draft.components.push(component);
        draft.ui.selectedComponentId = component.id;
        draft.ui.selectedChainItemId = component.chain[0]?.id || "";
        rememberWorkspaceComponent(draft, "canvas", component);
      }, "add-canvas-component");
    },
    addCanvasFrame(canvasComponentId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === canvasComponentId && item.type === "canvas");
        if (!component) return;
        component.canvas ||= { width: VJ1.canvasWidth, height: VJ1.canvasHeight };
        draft.recordingFrames ||= [];
        draft.recordingFrames.push(createCanvasFrame(
          draft.recordingFrames.length,
          component.canvas.width,
          component.canvas.height
        ));
      }, "add-canvas-frame");
    },
    removeCanvasFrame(canvasComponentId, frameId) {
      update((draft) => {
        draft.recordingFrames = (draft.recordingFrames || []).filter((frame) => frame.id !== frameId);
        for (const component of draft.components || []) {
          if (component.type === "canvas" && component.canvas?.frameThumbnails) {
            delete component.canvas.frameThumbnails[frameId];
          }
        }
        for (const surface of draft.surfaces || []) {
          if (surface.outputFrameId === frameId) {
            surface.sourceNodeId = "";
            surface.outputFrameId = "";
          }
        }
        for (const scene of draft.scenes || []) {
          for (const surface of scene.snapshot?.surfaces || []) {
            if (surface.outputFrameId === frameId) {
              surface.sourceNodeId = "";
              surface.outputFrameId = "";
            }
          }
        }
      }, "remove-canvas-frame");
    },
    selectChainItem(id) {
      update((draft) => {
        draft.ui.selectedChainItemId = id;
      }, "select-chain-item");
    },
    addChainSource(componentId, source = { type: "generator", generatorId: "testPattern" }) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        if (source.type === "component" && component.type !== "canvas") return;
        const layer = createComponentLayer(component.chain?.length || 0, source);
        if (source.type === "component" && component.type === "canvas") {
          const referenced = draft.components.find((item) => item.id === source.componentId && item.type !== "canvas");
          if (!referenced) return;
          const metrics = componentFrameMetrics(draft.render, referenced);
          const canvasWidth = Math.max(1, Number(component.canvas?.width) || VJ1.canvasWidth);
          layer.source.placement = {
            scale: metrics.baseWidth / canvasWidth,
          };
        }
        component.chain ||= [];
        insertChainItemNearSelection(component.chain, draft.ui.selectedChainItemId, layer);
        draft.ui.selectedChainItemId = layer.id;
      }, "add-chain-source");
    },
    addChainEffect(componentId, effectId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        const effect = createComponentEffect(effectId);
        component.chain ||= [];
        insertChainItemNearSelection(component.chain, draft.ui.selectedChainItemId, effect);
        draft.ui.selectedChainItemId = effect.id;
      }, "add-chain-effect");
    },
    addChainGroup(componentId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        component.chain ||= [];
        const group = createComponentGroup(countChainGroups(component.chain));
        insertChainItemNearSelection(component.chain, draft.ui.selectedChainItemId, group);
        draft.ui.selectedChainItemId = group.id;
      }, "add-chain-group");
    },
    reorderChain(componentId, fromId, toId, position = "before") {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        const chain = component?.chain;
        if (!Array.isArray(chain)) return;
        moveChainItem(chain, fromId, toId, position);
      }, "reorder-chain");
    },
    reorderSurfaces(fromId, toId) {
      update((draft) => {
        moveById(draft.surfaces, fromId, toId);
        for (const scene of draft.scenes || []) {
          moveById(scene.snapshot?.surfaces, fromId, toId);
        }
      }, "reorder-surfaces");
    },
    removeComponent(id) {
      update((draft) => {
        if (draft.components.length <= 1) return;
        draft.components = draft.components.filter((component) => component.id !== id);
        draft.ui.selectedComponentId = draft.components[0]?.id || "";
        for (const surface of draft.surfaces) {
          if (surface.componentId === id) surface.componentId = draft.ui.selectedComponentId;
        }
        for (const scene of draft.scenes) {
          for (const surface of scene.snapshot?.surfaces || []) {
            if (surface.componentId === id) surface.componentId = draft.ui.selectedComponentId;
          }
        }
        for (const component of draft.components) clearComponentReferences(component.chain, id);
        restoreWorkspaceComponent(draft, draft.ui.workspace);
      }, "remove-component");
    },
    addSurface() {
      update((draft) => {
        const mappedSurfaces = draft.surfaces.filter((item) => item.destination?.type !== "direct");
        const surface = createDefaultSurface(mappedSurfaces.length);
        surface.id = uid("surface");
        surface.name = `Srf ${mappedSurfaces.length + 1}`;
        surface.mappingId = surface.id;
        surface.componentId = draft.components[0]?.id || "";
        draft.surfaces.push(surface);
        draft.ui.selectedSurfaceId = surface.id;
        for (const scene of draft.scenes) {
          scene.snapshot ||= { surfaces: [] };
          scene.snapshot.surfaces.push(createSceneSurfaceSnapshot(surface));
        }
        const liveScene = draft.scenes.find((scene) => String(scene.id) === String(draft.ui.live?.selectedSceneId || ""));
        syncLiveSnapshotFromScene(draft, liveScene);
      }, "add-surface");
    },
    removeSurface(id) {
      update((draft) => {
        const target = draft.surfaces.find((surface) => surface.id === id);
        if (target?.destination?.type === "direct") return;
        draft.surfaces = draft.surfaces.filter((surface) => surface.id !== id);
        draft.ui.selectedSurfaceId = draft.surfaces[0]?.id || "";
        if (Array.isArray(draft.mappings?.local?.surfaces)) {
          draft.mappings.local.surfaces = draft.mappings.local.surfaces.filter((surface) => surface.name !== id);
        }
        for (const scene of draft.scenes) {
          if (scene.snapshot?.surfaces) {
            scene.snapshot.surfaces = scene.snapshot.surfaces.filter((surface) => surface.id !== id);
          }
        }
      }, "remove-surface");
    },
    saveScene(name) {
      update((draft) => {
        const scene = createSceneFromState(draft, name);
        draft.scenes.push(scene);
        draft.ui.selectedSceneId = scene.id;
      }, "save-scene");
    },
    selectScene(id) {
      const current = getState();
      const scene = current.scenes.find((item) => String(item.id) === String(id));
      if (scene) replace(applySceneForEditing(current, scene), "select-scene");
    },
    selectLiveScene(id) {
      update((draft) => {
        const scene = draft.scenes.find((item) => String(item.id) === String(id));
        if (!scene) return;
        draft.ui.live.sceneOverrides ||= {};
        const previousSceneId = String(draft.ui.live.selectedSceneId || "");
        if (previousSceneId === String(scene.id)) return;
        const previousScene = draft.scenes.find((item) => String(item.id) === previousSceneId);
        const previousSnapshot = draft.ui.live.sceneSnapshot || previousScene?.snapshot || null;
        const previousOverrides = clone(draft.ui.live.componentOverrides || {});
        if (previousSceneId && Object.keys(draft.ui.live.componentOverrides || {}).length) {
          draft.ui.live.sceneOverrides[previousSceneId] = clone(draft.ui.live.componentOverrides);
        }
        const durationMs = Math.round(Math.max(0, Number(draft.ui.live.transitionDuration) || 0) * 1000);
        draft.ui.live.transition = durationMs > 0 && previousSceneId && previousSnapshot
          ? {
              id: uid("live-transition"),
              fromSceneId: previousSceneId,
              fromSnapshot: clone(previousSnapshot),
              fromComponentOverrides: previousOverrides,
              startedAtMs: Date.now() + 50,
              durationMs,
            }
          : null;
        draft.ui.live.selectedSceneId = scene.id;
        draft.ui.live.sceneSnapshot = clone(scene.snapshot);
        draft.ui.live.componentOverrides = clone(draft.ui.live.sceneOverrides[scene.id] || {});
      }, "live:scene");
    },
    resetLiveScene(id) {
      update((draft) => {
        const sceneId = String(id || draft.ui.live?.selectedSceneId || "");
        if (!sceneId) return;
        draft.ui.live.sceneOverrides ||= {};
        delete draft.ui.live.sceneOverrides[sceneId];
        if (String(draft.ui.live.selectedSceneId || "") === sceneId) {
          draft.ui.live.componentOverrides = {};
        }
      }, "live:reset");
    },
    deleteScene(id) {
      update((draft) => {
        draft.scenes = draft.scenes.filter((scene) => String(scene.id) !== String(id));
        if (draft.ui.live?.sceneOverrides) delete draft.ui.live.sceneOverrides[String(id)];
        if (String(draft.ui.selectedSceneId) === String(id)) draft.ui.selectedSceneId = draft.scenes[0]?.id || "";
        if (String(draft.ui.live?.selectedSceneId) === String(id)) {
          const fallback = draft.scenes[0];
          draft.ui.live.selectedSceneId = fallback?.id || "";
          draft.ui.live.sceneSnapshot = fallback?.snapshot ? clone(fallback.snapshot) : null;
          draft.ui.live.componentOverrides = clone(draft.ui.live.sceneOverrides?.[fallback?.id] || {});
        }
        const selectedScene = draft.scenes.find((scene) => scene.id === draft.ui.selectedSceneId);
        if (selectedScene) applySceneSnapshotToState(draft, selectedScene);
      }, "delete-scene");
    },
  };
}

function preservesImportedActivity(reason = "") {
  return ["project-load", "project-open", "project-restore", "project-undo", "project-redo", "project-close"]
    .some((prefix) => String(reason).startsWith(prefix));
}

function rememberWorkspaceComponent(draft, workspace, component) {
  if (workspace !== "component" && workspace !== "canvas") return;
  if (!component || (workspace === "canvas") !== (component.type === "canvas")) return;
  draft.ui.workspaceSelectionIds ||= { component: "", canvas: "" };
  draft.ui.workspaceSelectionIds[workspace] = component.id;
}

function restoreWorkspaceComponent(draft, workspace) {
  if (workspace !== "component" && workspace !== "canvas") return;
  draft.ui.workspaceSelectionIds ||= { component: "", canvas: "" };
  const wantsCanvas = workspace === "canvas";
  const rememberedId = draft.ui.workspaceSelectionIds[workspace];
  const component = draft.components.find((item) =>
    item.id === rememberedId && (item.type === "canvas") === wantsCanvas
  ) || draft.components.find((item) => (item.type === "canvas") === wantsCanvas);
  if (!component) return;
  draft.ui.workspaceSelectionIds[workspace] = component.id;
  draft.ui.selectedComponentId = component.id;
  draft.ui.selectedChainItemId = component.chain?.[0]?.id || "";
}

function isLiveOverrideReason(reason = "") {
  return String(reason).startsWith("live:") || String(reason) === "scrub:live";
}

function refreshLiveSelectedSceneSnapshot(state) {
  const liveSceneId = String(state.ui?.live?.selectedSceneId || "");
  const liveScene = state.scenes?.find((scene) => String(scene.id) === liveSceneId);
  syncLiveSnapshotFromScene(state, liveScene);
}

function reconcileLiveOverridesWithPersistentEdits(previous, next) {
  const previousComponents = new Map((previous?.components || []).map((component) => [String(component.id), component]));
  const nextComponents = new Map((next?.components || []).map((component) => [String(component.id), component]));
  const rebaseBank = (bank = {}) => Object.fromEntries(Object.entries(bank || {}).flatMap(([componentId, override]) => {
    const rebased = pruneChangedLiveOverride(
      override,
      previousComponents.get(String(componentId)),
      nextComponents.get(String(componentId))
    );
    return hasLiveOverrideContent(rebased) ? [[componentId, rebased]] : [];
  }));

  next.ui.live.componentOverrides = rebaseBank(next.ui.live.componentOverrides);
  next.ui.live.sceneOverrides = Object.fromEntries(Object.entries(next.ui.live.sceneOverrides || {}).map(([sceneId, bank]) => [
    sceneId,
    rebaseBank(bank),
  ]));
  const selectedSceneId = String(next.ui.live.selectedSceneId || "");
  if (selectedSceneId) {
    if (Object.keys(next.ui.live.componentOverrides).length) {
      next.ui.live.sceneOverrides[selectedSceneId] = clone(next.ui.live.componentOverrides);
    } else {
      delete next.ui.live.sceneOverrides[selectedSceneId];
    }
  }
}

function pruneChangedLiveOverride(override, before, after, path = "") {
  if (Array.isArray(override)) {
    if (path !== "chain" && path !== "shaderChain") {
      return persistentValuesEqual(before, after) ? clone(override) : undefined;
    }
    const result = override.map((entry, index) => (
      pruneChangedLiveOverride(entry, before?.[index], after?.[index], "")
    ));
    return result.some(hasLiveOverrideContent) ? result : undefined;
  }
  if (override && typeof override === "object") {
    const result = {};
    for (const [key, value] of Object.entries(override)) {
      const rebased = pruneChangedLiveOverride(value, before?.[key], after?.[key], key);
      if (hasLiveOverrideContent(rebased)) result[key] = rebased;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return persistentValuesEqual(before, after) ? override : undefined;
}

function hasLiveOverrideContent(value) {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasLiveOverrideContent);
  if (value && typeof value === "object") return Object.values(value).some(hasLiveOverrideContent);
  return true;
}

function persistentValuesEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => persistentValuesEqual(value, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(b, key) && persistentValuesEqual(a[key], b[key])
    ));
  }
  return false;
}

function moveById(list, fromId, toId) {
  if (!Array.isArray(list)) return false;
  const fromIndex = list.findIndex((item) => item.id === fromId);
  const toIndex = list.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false;
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  return true;
}

function insertChainItemNearSelection(chain = [], selectedId = "", item = null) {
  if (!item) return;
  const selected = findChainItemLocation(chain, selectedId);
  if (selected?.item?.kind === "group") {
    selected.item.chain ||= [];
    selected.item.chain.push(item);
    return;
  }
  if (selected?.chain) {
    selected.chain.splice(selected.index + 1, 0, item);
    return;
  }
  chain.push(item);
}

function findChainItemLocation(chain = [], id = "") {
  if (!Array.isArray(chain) || !id) return null;
  for (let index = 0; index < chain.length; index++) {
    const item = chain[index];
    if (item.id === id) return { chain, item, index };
    const nested = item.kind === "group" ? findChainItemLocation(item.chain, id) : null;
    if (nested) return nested;
  }
  return null;
}

function countChainGroups(chain = []) {
  let count = 0;
  for (const item of chain || []) {
    if (item.kind === "group") count++;
    if (item.kind === "group") count += countChainGroups(item.chain);
  }
  return count;
}

function moveChainItem(rootChain = [], fromId = "", toId = "", position = "before") {
  if (!fromId || !toId || !Array.isArray(rootChain)) return false;
  if (position === "inside" && (fromId === toId || chainItemContainsId(findChainItemLocation(rootChain, fromId)?.item, toId))) {
    return false;
  }
  const from = findChainItemLocation(rootChain, fromId);
  const target = findChainItemLocation(rootChain, toId);
  if (!from || !target) return false;
  if (position === "inside" && target.item.kind !== "group") return false;
  if ((position === "before" || position === "after") && from.chain === target.chain && from.index === target.index) return false;
  if (chainItemContainsId(from.item, toId)) return false;

  const [moved] = from.chain.splice(from.index, 1);
  if (!moved) return false;

  if (position === "inside") {
    target.item.chain ||= [];
    target.item.chain.push(moved);
    return true;
  }

  const adjustedTarget = findChainItemLocation(rootChain, toId);
  if (!adjustedTarget) {
    rootChain.push(moved);
    return true;
  }
  const insertIndex = adjustedTarget.index + (position === "after" ? 1 : 0);
  adjustedTarget.chain.splice(insertIndex, 0, moved);
  return true;
}

function chainItemContainsId(item = null, id = "") {
  if (!item || !id || item.kind !== "group") return false;
  for (const child of item.chain || []) {
    if (child.id === id || chainItemContainsId(child, id)) return true;
  }
  return false;
}

function clearComponentReferences(chain = [], componentId = "") {
  for (const item of chain || []) {
    if (item.kind === "source" && item.source?.type === "component" && item.source.componentId === componentId) {
      item.source.componentId = "";
    }
    if (item.kind === "group") clearComponentReferences(item.chain, componentId);
  }
}
