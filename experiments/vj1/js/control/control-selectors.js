export function getSelectedScene(state) {
  return state.scenes.find((scene) => scene.id === state.ui.selectedSceneId) || null;
}

export function getLiveSelectedScene(state) {
  const id = liveSelectedSceneId(state);
  return state.scenes.find((scene) => scene.id === id) || null;
}

export function liveSelectedSceneId(state) {
  return state.ui?.live?.selectedSceneId || state.scenes[0]?.id || "";
}

export function sceneFingerprintComponents(scene, state) {
  const ids = [];
  for (const surface of scene?.snapshot?.surfaces || []) {
    if (surface.enabled === false) continue;
    if (surface.componentId && !ids.includes(surface.componentId)) ids.push(surface.componentId);
  }
  return ids
    .map((id) => state.components.find((component) => component.id === id))
    .filter(Boolean);
}

export function liveSceneComponents(scene, state) {
  return sceneFingerprintComponents(scene, state);
}

export function canvasComponents(state) {
  return (state.components || []).filter((component) => component.type === "canvas");
}

export function ordinaryComponents(state) {
  return (state.components || []).filter((component) => component.type !== "canvas");
}

export function selectedCanvasComponent(state) {
  return canvasComponents(state).find((component) => component.id === state.ui.selectedComponentId)
    || canvasComponents(state)[0]
    || null;
}

export function sceneSurfaceSnapshot(scene, surfaceId) {
  return scene?.snapshot?.surfaces?.find((surface) => surface.id === surfaceId) || null;
}

export function getSceneSurfaceView(surface, state) {
  const snapshot = sceneSurfaceSnapshot(getSelectedScene(state), surface.id);
  return snapshot ? { ...surface, ...snapshot } : surface;
}
