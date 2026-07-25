export function getSelectedMapping(state) {
  return state.mappings.find((mapping) => mapping.id === state.ui.selectedMappingId) || null;
}

export function getLiveSelectedScene(state) {
  const id = liveSelectedSceneId(state);
  return sceneComponents(state).find((scene) => scene.id === id) || null;
}

export function getLiveSourceTarget(state) {
  const live = state.ui?.live || {};
  const previewSurfaceId = String(live.previewSurfaceId || "__mapping__");
  const resolvedRouteId = previewSurfaceId !== "__mapping__"
    ? compileLiveProjectionProgram(state).currentRoutes.surfaces
      .find((surface) => String(surface.id) === previewSurfaceId)?.componentId || ""
    : "";
  const id = String(previewSurfaceId !== "__mapping__"
    ? live.patchSourceId || resolvedRouteId
    : live.selectedComponentId || "");
  if (!id && (previewSurfaceId !== "__mapping__" || live.overallSourceCleared === true)) return null;
  return (state.components || []).find((component) => !component.systemRole && String(component.id) === id)
    || getLiveSelectedScene(state);
}

export function getLiveSelectedTarget(state) {
  const inspectedId = String(state.ui?.live?.inspectedComponentId || "");
  return (state.components || []).find((component) => !component.systemRole && String(component.id) === inspectedId)
    || getLiveSourceTarget(state);
}

export function liveSelectedSceneId(state) {
  if (state.ui?.live?.overallSourceCleared === true) return "";
  return state.ui?.live?.selectedSceneId || sceneComponents(state)[0]?.id || "";
}

export function mappingFingerprintComponents(mapping, state) {
  const ids = [];
  for (const surface of mapping?.surfaces || []) {
    if (surface.enabled === false) continue;
    if (surface.componentId && !ids.includes(surface.componentId)) ids.push(surface.componentId);
  }
  return ids
    .map((id) => state.components.find((component) => component.id === id))
    .filter(Boolean);
}

export function liveSceneComponents(scene, state) {
  return scene ? [scene] : [];
}

export function sceneComponents(state) {
  return (state.components || []).filter((component) => component.type === "scene");
}

export function ordinaryComponents(state) {
  return (state.components || []).filter((component) => component.type !== "scene" && !component.systemRole);
}

export function selectedSceneComponent(state) {
  return sceneComponents(state).find((component) => component.id === state.ui.selectedComponentId)
    || sceneComponents(state)[0]
    || null;
}

export function mappingSurface(mapping, surfaceId) {
  return mapping?.surfaces?.find((surface) => surface.id === surfaceId) || null;
}

export function getMappingSurfaceView(surface, state) {
  return mappingSurface(getSelectedMapping(state), surface.id) || surface;
}
import { compileLiveProjectionProgram } from "../domain/live-projection-program.js?v=live-output-matrix-contract-3";
