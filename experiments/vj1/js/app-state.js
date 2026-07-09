import {
  applySceneForEditing,
  applySceneSnapshotToState,
  clone,
  createDefaultComposition,
  createDefaultSurface,
  createInitialState,
  createLiveRenderState,
  createSceneSurfaceSnapshot,
  createSceneFromState,
  sanitizeState,
  uid,
} from "./domain/models.js";
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
      return createLiveRenderState(getState());
    },
    addComposition() {
      update((draft) => {
        const composition = createDefaultComposition(draft.compositions.length);
        draft.compositions.push(composition);
        draft.ui.selectedCompositionId = composition.id;
        for (const surface of draft.surfaces) {
          if (!surface.compositionId) surface.compositionId = composition.id;
        }
      }, "add-composition");
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
