import {
  applySceneForEditing,
  applySceneSnapshotToState,
  clone,
  createCanvasComposition,
  createCanvasFrame,
  createDefaultComposition,
  createDefaultSurface,
  createCompositionEffect,
  createCompositionGroup,
  createCompositionLayer,
  createInitialState,
  createLiveRenderState,
  createSceneSurfaceSnapshot,
  createSceneFromState,
  sanitizeState,
  syncLiveSnapshotFromScene,
  uid,
} from "./domain/models.js?v=batch-fixes-1";
import { WORKSPACES } from "./constants.js";

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
    state = sanitizeState(next);
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
    selectComposition(id) {
      update((draft) => {
        draft.ui.selectedCompositionId = id;
        const composition = draft.compositions.find((item) => item.id === id);
        draft.ui.selectedChainItemId = composition?.chain?.[0]?.id || "";
      }, "select-composition");
    },
    setWorkspace(workspace) {
      update((draft) => {
        draft.ui.workspace = WORKSPACES.includes(workspace) ? workspace : "scene";
        if (draft.ui.workspace === "canvas") {
          const selected = draft.compositions.find((composition) => composition.id === draft.ui.selectedCompositionId);
          const canvas = selected?.type === "canvas"
            ? selected
            : draft.compositions.find((composition) => composition.type === "canvas");
          if (canvas) {
            draft.ui.selectedCompositionId = canvas.id;
            draft.ui.selectedChainItemId = canvas.chain?.[0]?.id || "";
          }
        } else if (draft.ui.workspace === "compose") {
          const selected = draft.compositions.find((composition) => composition.id === draft.ui.selectedCompositionId);
          const composition = selected?.type !== "canvas"
            ? selected
            : draft.compositions.find((item) => item.type !== "canvas");
          if (composition) {
            draft.ui.selectedCompositionId = composition.id;
            draft.ui.selectedChainItemId = composition.chain?.[0]?.id || "";
          }
        }
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
    addComposition() {
      update((draft) => {
        const composition = createDefaultComposition(draft.compositions.filter((item) => item.type !== "canvas").length);
        draft.compositions.push(composition);
        draft.ui.selectedCompositionId = composition.id;
        draft.ui.selectedChainItemId = composition.chain[0]?.id || "";
        for (const surface of draft.surfaces) {
          if (!surface.compositionId) surface.compositionId = composition.id;
        }
      }, "add-composition");
    },
    addCanvasComposition() {
      update((draft) => {
        const firstChainComposition = draft.compositions.find((composition) => composition.type !== "canvas");
        const composition = createCanvasComposition(
          draft.compositions.filter((item) => item.type === "canvas").length,
          firstChainComposition?.id || ""
        );
        draft.compositions.push(composition);
        draft.ui.selectedCompositionId = composition.id;
        draft.ui.selectedChainItemId = composition.chain[0]?.id || "";
      }, "add-canvas-composition");
    },
    addCanvasFrame(canvasCompositionId) {
      update((draft) => {
        const composition = draft.compositions.find((item) => item.id === canvasCompositionId && item.type === "canvas");
        if (!composition) return;
        composition.canvas ||= { width: 3840, height: 2160 };
        draft.recordingFrames ||= [];
        draft.recordingFrames.push(createCanvasFrame(
          draft.recordingFrames.length,
          composition.canvas.width,
          composition.canvas.height
        ));
      }, "add-canvas-frame");
    },
    removeCanvasFrame(canvasCompositionId, frameId) {
      update((draft) => {
        draft.recordingFrames = (draft.recordingFrames || []).filter((frame) => frame.id !== frameId);
        for (const composition of draft.compositions || []) {
          if (composition.type === "canvas" && composition.canvas?.frameThumbnails) {
            delete composition.canvas.frameThumbnails[frameId];
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
    addChainSource(compositionId, source = { type: "generator", generatorId: "testPattern" }) {
      update((draft) => {
        const composition = draft.compositions.find((item) => item.id === compositionId);
        if (!composition) return;
        if (source.type === "composition" && composition.type !== "canvas") return;
        const layer = createCompositionLayer(composition.chain?.length || 0, source);
        composition.chain ||= [];
        insertChainItemNearSelection(composition.chain, draft.ui.selectedChainItemId, layer);
        draft.ui.selectedChainItemId = layer.id;
      }, "add-chain-source");
    },
    addChainEffect(compositionId, effectId) {
      update((draft) => {
        const composition = draft.compositions.find((item) => item.id === compositionId);
        if (!composition) return;
        const effect = createCompositionEffect(effectId);
        composition.chain ||= [];
        insertChainItemNearSelection(composition.chain, draft.ui.selectedChainItemId, effect);
        draft.ui.selectedChainItemId = effect.id;
      }, "add-chain-effect");
    },
    addChainGroup(compositionId) {
      update((draft) => {
        const composition = draft.compositions.find((item) => item.id === compositionId);
        if (!composition) return;
        composition.chain ||= [];
        const group = createCompositionGroup(countChainGroups(composition.chain));
        insertChainItemNearSelection(composition.chain, draft.ui.selectedChainItemId, group);
        draft.ui.selectedChainItemId = group.id;
      }, "add-chain-group");
    },
    reorderChain(compositionId, fromId, toId, position = "before") {
      update((draft) => {
        const composition = draft.compositions.find((item) => item.id === compositionId);
        const chain = composition?.chain;
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
    removeComposition(id) {
      update((draft) => {
        if (draft.compositions.length <= 1) return;
        draft.compositions = draft.compositions.filter((composition) => composition.id !== id);
        draft.ui.selectedCompositionId = draft.compositions[0]?.id || "";
        for (const surface of draft.surfaces) {
          if (surface.compositionId === id) surface.compositionId = draft.ui.selectedCompositionId;
        }
        for (const scene of draft.scenes) {
          for (const surface of scene.snapshot?.surfaces || []) {
            if (surface.compositionId === id) surface.compositionId = draft.ui.selectedCompositionId;
          }
        }
        for (const composition of draft.compositions) clearCompositionReferences(composition.chain, id);
      }, "remove-composition");
    },
    addSurface() {
      update((draft) => {
        const surface = createDefaultSurface(draft.surfaces.length);
        surface.id = uid("surface");
        surface.name = `Srf ${draft.surfaces.length + 1}`;
        surface.mappingId = surface.id;
        surface.compositionId = draft.compositions[0]?.id || "";
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
        if (draft.surfaces.length <= 1) return;
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
        if (previousSceneId && Object.keys(draft.ui.live.compositionOverrides || {}).length) {
          draft.ui.live.sceneOverrides[previousSceneId] = clone(draft.ui.live.compositionOverrides);
        }
        draft.ui.live.selectedSceneId = scene.id;
        draft.ui.live.sceneSnapshot = clone(scene.snapshot);
        draft.ui.live.compositionOverrides = clone(draft.ui.live.sceneOverrides[scene.id] || {});
      }, "live:scene");
    },
    resetLiveScene(id) {
      update((draft) => {
        const sceneId = String(id || draft.ui.live?.selectedSceneId || "");
        if (!sceneId) return;
        draft.ui.live.sceneOverrides ||= {};
        delete draft.ui.live.sceneOverrides[sceneId];
        if (String(draft.ui.live.selectedSceneId || "") === sceneId) {
          draft.ui.live.compositionOverrides = {};
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
          draft.ui.live.compositionOverrides = clone(draft.ui.live.sceneOverrides?.[fallback?.id] || {});
        }
        const selectedScene = draft.scenes.find((scene) => scene.id === draft.ui.selectedSceneId);
        if (selectedScene) applySceneSnapshotToState(draft, selectedScene);
      }, "delete-scene");
    },
  };
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
  const previousCompositions = new Map((previous?.compositions || []).map((composition) => [String(composition.id), composition]));
  const nextCompositions = new Map((next?.compositions || []).map((composition) => [String(composition.id), composition]));
  const rebaseBank = (bank = {}) => Object.fromEntries(Object.entries(bank || {}).flatMap(([compositionId, override]) => {
    const rebased = pruneChangedLiveOverride(
      override,
      previousCompositions.get(String(compositionId)),
      nextCompositions.get(String(compositionId))
    );
    return hasLiveOverrideContent(rebased) ? [[compositionId, rebased]] : [];
  }));

  next.ui.live.compositionOverrides = rebaseBank(next.ui.live.compositionOverrides);
  next.ui.live.sceneOverrides = Object.fromEntries(Object.entries(next.ui.live.sceneOverrides || {}).map(([sceneId, bank]) => [
    sceneId,
    rebaseBank(bank),
  ]));
  const selectedSceneId = String(next.ui.live.selectedSceneId || "");
  if (selectedSceneId) {
    if (Object.keys(next.ui.live.compositionOverrides).length) {
      next.ui.live.sceneOverrides[selectedSceneId] = clone(next.ui.live.compositionOverrides);
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

function clearCompositionReferences(chain = [], compositionId = "") {
  for (const item of chain || []) {
    if (item.kind === "source" && item.source?.type === "composition" && item.source.compositionId === compositionId) {
      item.source.compositionId = "";
    }
    if (item.kind === "group") clearCompositionReferences(item.chain, compositionId);
  }
}
