import { CURRENT_PROJECT_VERSION } from "../domain/project-migrations.js?v=boundary-authority-1";
import { serializeNodeProjectData } from "../libraries/node-engine/node-project.js";

export function buildProjectPayload(state, savedAt = new Date().toISOString()) {
  return {
    version: CURRENT_PROJECT_VERSION,
    project: { ...state.project, warnings: [], savedAt },
    ui: {
      selectedSceneId: state.ui.selectedSceneId,
      selectedSurfaceId: state.ui.selectedSurfaceId,
      selectedComponentId: state.ui.selectedComponentId,
      selectedChainItemId: state.ui.selectedChainItemId,
      selectedNodeDefinitionId: state.ui.selectedNodeDefinitionId || "",
      selectedNodeGroupId: state.ui.selectedNodeGroupId || "",
      workspaceSelectionIds: state.ui.workspaceSelectionIds,
      catalogSortModes: state.ui.catalogSortModes,
      previewQuality: state.ui.previewQuality,
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
    nodes: serializeNodeProjectData(state.nodes),
    media: state.media,
    components: persistedComponents(state.components, state.nodes),
    recordingFrames: state.recordingFrames,
    surfaces: state.surfaces,
    scenes: state.scenes,
    mappings: state.mappings,
    shaders: state.shaders,
  };
}

export function persistedComponents(components = [], nodes = {}) {
  const graphComponents = new Set((nodes?.groups || [])
    .filter((group) => group.generatedBy === "vj1-component-compiler" && group.projectionSignature)
    .map((group) => String(group.componentId || "")));
  return (components || []).map((component) => {
    const {
      thumbnail: _derivedThumbnail,
      nodeProjectionSignature: _runtimeProjectionSignature,
      ...componentData
    } = component || {};
    // Version 24 persists the node group as visual authority. `chain` remains
    // an in-memory projection for the established Component/Canvas UI and is
    // retained only when importing a not-yet-compiled legacy component.
    const persisted = nodes?.authority === "node-graph" && graphComponents.has(String(component?.id || ""))
      ? Object.fromEntries(Object.entries(componentData).filter(([key]) => key !== "chain"))
      : componentData;
    if (persisted.type !== "canvas" || !persisted.canvas) return persisted;
    const {
      frameThumbnails: _derivedFrameThumbnails,
      width: _legacyWidth,
      height: _legacyHeight,
      ...canvas
    } = persisted.canvas;
    return { ...persisted, canvas };
  });
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
    hostViewport: _runtimeHostViewport,
    previewRasterScale: _runtimePreviewRasterScale,
    canvasSize: _legacyCanvasSize,
    componentTexture: _legacyComponentTexture,
    surfaceTexture: _legacySurfaceTexture,
    ...canonical
  } = render || {};
  return {
    ...canonical,
    outputs: (canonical.outputs || []).map((output, index) => ({
      id: String(output?.id || (index === 0 ? "output-main" : `output-${index + 1}`)),
      name: output?.name || (index === 0 ? "Main output" : `Output ${index + 1}`),
      aspectRatio: Number(output?.aspectRatio) || 16 / 9,
    })),
  };
}
