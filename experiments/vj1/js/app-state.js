import {
  applySceneForEditing,
  applySceneSnapshotToState,
  clone,
  createCanvasComposition,
  createCanvasLayer,
  createDefaultComposition,
  createDefaultSurface,
  createCompositionEffect,
  createCompositionLayer,
  createInitialState,
  createLiveRenderState,
  createSceneSurfaceSnapshot,
  createSceneFromState,
  sanitizeState,
  uid,
} from "./domain/models.js?v=world-frame-27";
import { WORKSPACES } from "./constants.js";

export function createAppState(initial = null) {
  let state = sanitizeState(initial || createInitialState());
  const listeners = new Set();

  function emit(reason = "change") {
    for (const listener of listeners) listener(getState(), reason);
  }

  function getState() {
    return clone(state);
  }

  function replace(next, reason = "replace") {
    state = sanitizeState(next);
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
        draft.global.calibrating = draft.ui.workspace === "scene";
        if (draft.ui.workspace === "live" && !draft.ui.live.selectedSceneId) {
          draft.ui.live.selectedSceneId = draft.ui.selectedSceneId || draft.scenes[0]?.id || "";
        }
      }, "workspace");
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
        const composition = createDefaultComposition(draft.compositions.length);
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
        draft.ui.selectedChainItemId = "";
      }, "add-canvas-composition");
    },
    addCanvasLayer(canvasCompositionId, sourceCompositionId = "") {
      update((draft) => {
        const composition = draft.compositions.find((item) => item.id === canvasCompositionId && item.type === "canvas");
        if (!composition) return;
        const fallbackSource = draft.compositions.find((item) => item.id !== canvasCompositionId && item.type !== "canvas")?.id || "";
        composition.canvas ||= { width: 3840, height: 2160, layers: [] };
        const layer = createCanvasLayer(composition.canvas.layers?.length || 0, sourceCompositionId || fallbackSource);
        composition.canvas.layers ||= [];
        composition.canvas.layers.push(layer);
      }, "add-canvas-layer");
    },
    removeCanvasLayer(canvasCompositionId, layerId) {
      update((draft) => {
        const composition = draft.compositions.find((item) => item.id === canvasCompositionId && item.type === "canvas");
        if (!composition?.canvas?.layers) return;
        composition.canvas.layers = composition.canvas.layers.filter((layer) => layer.id !== layerId);
      }, "remove-canvas-layer");
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
        const layer = createCompositionLayer(composition.chain?.length || 0, source);
        composition.chain ||= [];
        const selectedIndex = composition.chain.findIndex((item) => item.id === draft.ui.selectedChainItemId);
        const insertIndex = selectedIndex >= 0 ? selectedIndex + 1 : composition.chain.length;
        composition.chain.splice(insertIndex, 0, layer);
        draft.ui.selectedChainItemId = layer.id;
      }, "add-chain-source");
    },
    addChainEffect(compositionId, effectId) {
      update((draft) => {
        const composition = draft.compositions.find((item) => item.id === compositionId);
        if (!composition) return;
        const effect = createCompositionEffect(effectId);
        composition.chain ||= [];
        composition.chain.push(effect);
        draft.ui.selectedChainItemId = effect.id;
      }, "add-chain-effect");
    },
    reorderChain(compositionId, fromId, toId) {
      update((draft) => {
        const composition = draft.compositions.find((item) => item.id === compositionId);
        const chain = composition?.chain;
        if (!Array.isArray(chain)) return;
        const fromIndex = chain.findIndex((item) => item.id === fromId);
        const toIndex = chain.findIndex((item) => item.id === toId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        const [item] = chain.splice(fromIndex, 1);
        chain.splice(toIndex, 0, item);
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
        for (const composition of draft.compositions) {
          if (composition.type !== "canvas" || !Array.isArray(composition.canvas?.layers)) continue;
          composition.canvas.layers = composition.canvas.layers.map((layer) => (
            layer.compositionId === id ? { ...layer, compositionId: "" } : layer
          ));
        }
      }, "remove-composition");
    },
    addSurface() {
      update((draft) => {
        const surface = createDefaultSurface(draft.surfaces.length);
        surface.id = uid("surface");
        surface.name = `Surface ${draft.surfaces.length + 1}`;
        surface.mappingId = surface.id;
        surface.compositionId = draft.compositions[0]?.id || "";
        draft.surfaces.push(surface);
        draft.ui.selectedSurfaceId = surface.id;
        for (const scene of draft.scenes) {
          scene.snapshot ||= { surfaces: [] };
          scene.snapshot.surfaces.push(createSceneSurfaceSnapshot(surface));
        }
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
    deleteScene(id) {
      update((draft) => {
        draft.scenes = draft.scenes.filter((scene) => String(scene.id) !== String(id));
        if (String(draft.ui.selectedSceneId) === String(id)) draft.ui.selectedSceneId = draft.scenes[0]?.id || "";
        if (String(draft.ui.live?.selectedSceneId) === String(id)) draft.ui.live.selectedSceneId = draft.scenes[0]?.id || "";
        const selectedScene = draft.scenes.find((scene) => scene.id === draft.ui.selectedSceneId);
        if (selectedScene) applySceneSnapshotToState(draft, selectedScene);
      }, "delete-scene");
    },
  };
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
