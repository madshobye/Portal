import { CURRENT_PROJECT_VERSION } from "../domain/project-migrations.js?v=adaptive-component-demand-29";

export function buildProjectPayload(state, savedAt = new Date().toISOString()) {
  return {
    version: CURRENT_PROJECT_VERSION,
    project: { ...state.project, warnings: [], savedAt },
    ui: {
      selectedSceneId: state.ui.selectedSceneId,
      selectedSurfaceId: state.ui.selectedSurfaceId,
      selectedComponentId: state.ui.selectedComponentId,
      selectedChainItemId: state.ui.selectedChainItemId,
      workspaceSelectionIds: state.ui.workspaceSelectionIds,
      catalogSortModes: state.ui.catalogSortModes,
      previewQualities: state.ui.previewQualities,
      live: {
        selectedSceneId: state.ui.live?.selectedSceneId || "",
        sceneSnapshot: state.ui.live?.sceneSnapshot || null,
        transitionDuration: Math.max(0, Number(state.ui.live?.transitionDuration) || 0),
        paramFadeDuration: Math.max(0, Number(state.ui.live?.paramFadeDuration) || 0),
      },
    },
    global: state.global,
    render: persistedRenderSettings(state.render),
    scheduler: state.scheduler,
    media: state.media,
    components: state.components,
    recordingFrames: state.recordingFrames,
    surfaces: state.surfaces,
    scenes: state.scenes,
    mappings: state.mappings,
    shaders: state.shaders,
  };
}

// Output windows are the persisted authority for output and mapping geometry.
// The removed aliases are derived by normalizeRenderSettings() at load time.
export function persistedRenderSettings(render = {}) {
  const {
    width: _derivedWidth,
    height: _derivedHeight,
    frameWidth: _derivedFrameWidth,
    frameHeight: _derivedFrameHeight,
    worldScale: _derivedWorldScale,
    worldWidth: _derivedWorldWidth,
    worldHeight: _derivedWorldHeight,
    outputGap: _derivedOutputGap,
    surfaceWidth: _legacySurfaceWidth,
    surfaceHeight: _legacySurfaceHeight,
    surfaceTextureMode: _legacySurfaceTextureMode,
    edgeSoftness: _removedEdgeSoftness,
    ...canonical
  } = render || {};
  return canonical;
}
