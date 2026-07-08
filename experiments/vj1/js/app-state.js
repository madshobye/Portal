import {
  applySceneSnapshot,
  clone,
  createDefaultLayer,
  createDefaultSurface,
  createInitialState,
  createSceneFromState,
  sanitizeState,
} from "./domain/models.js";

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
    setView(view) {
      update((draft) => {
        draft.ui.view = view;
      }, "view");
    },
    selectLayer(id) {
      update((draft) => {
        draft.ui.selectedLayerId = id;
      }, "select-layer");
    },
    selectSurface(id) {
      update((draft) => {
        draft.ui.selectedSurfaceId = id;
      }, "select-surface");
    },
    setWorkspace(workspace) {
      update((draft) => {
        draft.ui.workspace = workspace === "scene" ? "scene" : "setup";
        draft.global.calibrating = draft.ui.workspace === "setup";
      }, "workspace");
    },
    addLayer() {
      update((draft) => {
        const layer = createDefaultLayer(draft.layers.length);
        layer.name = `Layer ${draft.layers.length + 1}`;
        draft.layers.push(layer);
        draft.ui.selectedLayerId = layer.id;
      }, "add-layer");
    },
    removeLayer(id) {
      update((draft) => {
        if (draft.layers.length <= 1) return;
        draft.layers = draft.layers.filter((layer) => layer.id !== id);
        draft.ui.selectedLayerId = draft.layers[0]?.id || "";
        for (const surface of draft.surfaces) {
          if (surface.route.layerId === id) surface.route.layerId = draft.ui.selectedLayerId;
        }
      }, "remove-layer");
    },
    addSurface() {
      update((draft) => {
        const surface = createDefaultSurface(draft.surfaces.length, draft.layers[0]?.id || "");
        surface.id = `surface-${draft.surfaces.length + 1}`;
        surface.name = `Surface ${draft.surfaces.length + 1}`;
        surface.mappingId = surface.id;
        draft.surfaces.push(surface);
        draft.ui.selectedSurfaceId = surface.id;
      }, "add-surface");
    },
    removeSurface(id) {
      update((draft) => {
        if (draft.surfaces.length <= 1) return;
        draft.surfaces = draft.surfaces.filter((surface) => surface.id !== id);
        draft.ui.selectedSurfaceId = draft.surfaces[0]?.id || "";
      }, "remove-surface");
    },
    saveScene(name) {
      update((draft) => {
        draft.scenes.push(createSceneFromState(draft, name));
      }, "save-scene");
    },
    recallScene(id) {
      const current = getState();
      const scene = current.scenes.find((item) => item.id === id);
      if (scene) replace(applySceneSnapshot(current, scene), "recall-scene");
    },
    deleteScene(id) {
      update((draft) => {
        draft.scenes = draft.scenes.filter((scene) => scene.id !== id);
      }, "delete-scene");
    },
  };
}
