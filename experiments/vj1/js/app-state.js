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
  createEmptySceneFromState,
  createSceneSurfaceSnapshot,
  createSceneFromState,
  sanitizeState,
  syncLiveSnapshotFromScene,
  uid,
} from "./domain/models.js?v=volumetric-clouds-1";
import { stampChangedProjectItems, touchComponentUsed } from "./domain/component-activity.js?v=adaptive-component-demand-29";
import { componentFrameMetrics } from "./domain/component-frame.js?v=adaptive-component-demand-29";
import { WORKSPACES } from "./constants.js";
import { createChangeEvent } from "./domain/change-event.js?v=chain-only-authority-1";
import { canvasFrameSize } from "./domain/render-settings.js?v=canvas-global-resolution-1";
import { nextCatalogMarker } from "./domain/catalog-marker.js?v=catalog-marker-four-state-1";
import { clearComponentReferences, countChainGroups, findChainItemLocation, insertChainItemNearSelection, moveById, moveChainItem } from "./domain/chain-operations.js?v=adaptive-component-demand-29";
import { copyComponentAsCanvas, pasteClipboardPayload } from "./domain/clipboard.js?v=canvas-global-resolution-1";
import { initializeLiveChainInsertion } from "./domain/scene-routing.js?v=scene-catalog-markers-1";

export function createAppState(initial = null) {
  let state = sanitizeState(initial || createInitialState());
  let pendingEditBaseline = null;
  refreshLiveSelectedSceneSnapshot(state);
  const listeners = new Set();

  function emit(change = "change") {
    const event = createChangeEvent(change);
    const snapshot = getState();
    for (const listener of listeners) listener(snapshot, event.reason, event);
  }

  function getState() {
    return clone(state);
  }

  function getMetrics() {
    return clone(state.metrics);
  }

  function replace(next, change = "replace") {
    const event = createChangeEvent(change);
    const previous = pendingEditBaseline || state;
    pendingEditBaseline = null;
    const normalized = sanitizeState(next);
    state = event.projectRestore ? normalized : stampChangedProjectItems(previous, normalized);
    if (event.scope !== "live") reconcileLiveOverridesWithPersistentEdits(previous, state);
    refreshLiveSelectedSceneSnapshot(state);
    emit(event);
  }

  function update(recipe, change = "update") {
    const event = createChangeEvent(change);
    if (event.scope === "project" && (event.phase === "scrub" || event.phase === "edit")) {
      // A gesture is one transaction. Preserve a single pre-gesture baseline
      // for activity/Live reconciliation, but do not deep-clone, sanitize, and
      // stable-diff the complete project for every pointer/keyboard sample.
      pendingEditBaseline ||= getState();
      recipe(state);
      refreshLiveSelectedSceneSnapshot(state);
      emit(event);
      return;
    }
    const draft = getState();
    recipe(draft);
    replace(draft, change);
  }

  function updateUi(recipe, change = "ui-update") {
    const ui = clone(state.ui);
    recipe(ui);
    state = { ...state, ui };
    emit({ reason: change, scope: "ui" });
  }

  function updateRuntime(recipe, change = "runtime-update") {
    const metrics = clone(state.metrics);
    recipe(metrics);
    state = { ...state, metrics };
    emit({ reason: change, scope: "runtime" });
  }

  function updateDerived(recipe, change = "derived-update") {
    const draft = getState();
    recipe(draft);
    state = draft;
    emit({ reason: change, scope: "derived", history: "none" });
  }

  function updateLive(recipe, change = "live:update") {
    const draft = { ...state, ui: clone(state.ui) };
    recipe(draft);
    state = draft;
    const supplied = change && typeof change === "object" ? change : { reason: change };
    emit({ ...supplied, scope: "live" });
  }

  function updateMapping(mappingId, mapping, status = "Mapping updated", change = "mapping-state") {
    const id = String(mappingId || "local");
    // Mapping feedback is a small, already-normalized renderer payload. Do not
    // send it through the generic whole-project clone/sanitize path: large
    // media projects otherwise make every mapping commit proportional to all
    // unrelated project data. The ordinary change event still owns history,
    // autosave, and output synchronization.
    state = {
      ...state,
      mappings: { ...(state.mappings || {}), [id]: clone(mapping) },
      ui: { ...state.ui, mappingStatus: status || "Mapping updated" },
    };
    pendingEditBaseline = null;
    emit(change);
  }

  function subscribe(listener) {
    listeners.add(listener);
    const event = createChangeEvent("init");
    listener(getState(), event.reason, event);
    return () => listeners.delete(listener);
  }

  return {
    getState,
    getMetrics,
    replace,
    update,
    updateUi,
    updateRuntime,
    updateDerived,
    updateLive,
    updateMapping,
    subscribe,
    cycleCatalogMarker(kind, id) {
      const collection = kind === "media" ? "media" : kind === "scene" ? "scenes" : "components";
      if (!(state[collection] || []).some((item) => item.id === id)) return false;
      update((draft) => {
        const item = (draft[collection] || []).find((entry) => entry.id === id);
        if (item) item.catalogMarker = nextCatalogMarker(item.catalogMarker);
      }, `catalog-marker:${kind}`);
      return true;
    },
    pasteClipboard(payload, target) {
      const draft = getState();
      const result = pasteClipboardPayload(draft, payload, target);
      if (result.pasted) replace(draft, "paste");
      return result;
    },
    selectSurface(id) {
      if (!state.surfaces.some((surface) => surface.id === id)) return;
      updateUi((ui) => {
        ui.selectedSurfaceId = id;
      }, "select-surface");
    },
    selectComponent(id) {
      const index = state.components.findIndex((component) => component.id === id);
      if (index < 0) return;
      const component = {
        ...state.components[index],
        activity: { ...(state.components[index].activity || {}) },
      };
      const components = state.components.slice();
      components[index] = component;
      touchComponentUsed({ components }, id);
      const ui = clone(state.ui);
      ui.selectedComponentId = id;
      ui.selectedChainItemId = component.chain?.[0]?.id || "";
      rememberWorkspaceComponent({ ui }, ui.workspace, component);
      state = { ...state, components, ui };
      // Selection is local to the editor. It is still autosaved so recent-use
      // sorting survives reload, but it must not rebuild a Live render state.
      emit({ reason: "select-component", scope: "ui" });
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
      // createLiveRenderState owns its clone. Passing the internal immutable
      // truth avoids cloning the complete project twice before transport.
      return createLiveRenderState(state);
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
        const componentCount = draft.components.filter((item) => item.type !== "canvas").length;
        const component = createDefaultComponent(componentCount, { empty: componentCount > 10 });
        draft.components.push(component);
        draft.ui.selectedComponentId = component.id;
        draft.ui.selectedChainItemId = component.chain[0]?.id || "";
        rememberWorkspaceComponent(draft, "component", component);
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
    copyComponentToCanvas(componentId) {
      if (!state.components.some((item) => item.id === componentId && item.type !== "canvas")) {
        return { converted: false, reason: "missing-component" };
      }
      let result = { converted: false, reason: "missing-component" };
      update((draft) => {
        result = copyComponentAsCanvas(draft, componentId);
        if (!result.converted) return;
        draft.ui.workspace = "canvas";
        draft.global.calibrating = false;
      }, "convert-component-to-canvas");
      return result;
    },
    addCanvasFrame(canvasComponentId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === canvasComponentId && item.type === "canvas");
        if (!component) return;
        component.canvas ||= { previewQuality: "auto", frameThumbnails: {} };
        const canvasSize = canvasFrameSize(draft.render);
        draft.recordingFrames ||= [];
        draft.recordingFrames.push(createCanvasFrame(
          draft.recordingFrames.length,
          canvasSize.width,
          canvasSize.height
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
      const selected = state.components.find((component) => component.id === state.ui.selectedComponentId);
      if (!findChainItemLocation(selected?.chain, id)) return;
      updateUi((ui) => {
        ui.selectedChainItemId = id;
      }, "select-chain-item");
    },
    removeChainItem(componentId, itemId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component?.chain) return;
        const removed = removeChainItemFromChain(component.chain, itemId);
        if (removed && draft.ui.selectedChainItemId === itemId) {
          draft.ui.selectedChainItemId = firstChainItemId(component.chain);
        }
      }, "remove-chain-item");
    },
    addChainSource(componentId, source = { type: "generator", generatorId: "testPattern" }) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        if (source.type === "component" && component.type !== "canvas") return;
        const layer = createComponentLayer(component.chain?.length || 0, source);
        initializeLiveChainInsertion(draft, component.id, layer);
        if (source.type === "component" && component.type === "canvas") {
          const referenced = draft.components.find((item) => item.id === source.componentId && item.type !== "canvas");
          if (!referenced) return;
          const metrics = componentFrameMetrics(draft.render, referenced);
          const canvasWidth = canvasFrameSize(draft.render).width;
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
        initializeLiveChainInsertion(draft, component.id, effect);
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
        initializeLiveChainInsertion(draft, component.id, group);
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
        draft.surfaces.push(surface);
        draft.ui.selectedSurfaceId = surface.id;
        const selectedSceneId = String(draft.ui.selectedSceneId || "");
        for (const scene of draft.scenes) {
          scene.snapshot ||= { surfaces: [] };
          scene.snapshot.surfaces.push(createSceneSurfaceSnapshot({
            ...surface,
            enabled: String(scene.id) === selectedSceneId,
          }));
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
    addScene(name) {
      update((draft) => {
        const scene = createEmptySceneFromState(draft, name);
        draft.scenes.push(scene);
        applySceneSnapshotToState(draft, scene);
        draft.ui.selectedSceneId = scene.id;
      }, "add-scene");
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
        const activeComponentId = scene.snapshot?.surfaces?.find((surface) => surface.enabled !== false && surface.componentId)?.componentId || "";
        draft.ui.live.selectedComponentId = activeComponentId;
        draft.ui.live.sceneSnapshot = clone(scene.snapshot);
        draft.ui.live.componentOverrides = clone(draft.ui.live.sceneOverrides[scene.id] || {});
      }, "live:scene");
    },
    restoreLiveScene(id) {
      updateLive((draft) => {
        const scene = draft.scenes.find((item) => String(item.id) === String(id));
        if (!scene) return;
        draft.ui.live.sceneOverrides ||= {};
        draft.ui.live.selectedSceneId = scene.id;
        draft.ui.live.sceneSnapshot = clone(scene.snapshot);
        draft.ui.live.componentOverrides = clone(draft.ui.live.sceneOverrides[scene.id] || {});
        draft.ui.live.transition = null;
        draft.ui.live.selectedComponentId = scene.snapshot?.surfaces?.find((surface) =>
          surface.enabled !== false && surface.componentId
        )?.componentId || "";
      }, { reason: "live:scene-restore", history: "none" });
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

function firstChainItemId(chain = []) {
  if (!Array.isArray(chain) || !chain.length) return "";
  return chain[0]?.id || "";
}

function removeChainItemFromChain(chain = [], itemId = "") {
  if (!Array.isArray(chain) || !itemId) return false;
  const index = chain.findIndex((item) => item.id === itemId);
  if (index >= 0) {
    chain.splice(index, 1);
    return true;
  }
  for (const item of chain) {
    if (item.kind === "group" && removeChainItemFromChain(item.chain || [], itemId)) return true;
  }
  return false;
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
    if (path !== "chain") {
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
