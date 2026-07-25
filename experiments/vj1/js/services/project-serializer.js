import { CURRENT_PROJECT_VERSION } from "../domain/project-migrations.js?v=project-media-contain-1";
import { normalizeOutputName } from "../domain/render-settings.js?v=surface-terminology-1";
import { authoredSurfaceFields } from "../domain/scene-routing.js?v=explicit-direct-surface-hierarchy-1";
import { serializeNodeProjectData } from "../libraries/node-engine/node-project.js?v=package-content-lock-1";

export function buildProjectPayload(state, savedAt = new Date().toISOString()) {
  return {
    version: CURRENT_PROJECT_VERSION,
    project: { ...state.project, warnings: [], savedAt },
    ui: {
      selectedMappingId: state.ui.selectedMappingId,
      selectedSurfaceId: state.ui.selectedSurfaceId,
      selectedComponentId: state.ui.selectedComponentId,
      selectedChainItemId: state.ui.selectedChainItemId,
      selectedNodeDefinitionId: state.ui.selectedNodeDefinitionId || "",
      selectedNodeGroupId: state.ui.selectedNodeGroupId || "",
      workspaceSelectionIds: state.ui.workspaceSelectionIds,
      catalogSortModes: state.ui.catalogSortModes,
      previewQuality: state.ui.previewQuality,
      previewViewports: state.ui.previewViewports,
      previewDiagnostics: state.ui.previewDiagnostics === true,
      mappingTestPattern: state.ui.mappingTestPattern !== false,
      live: {
        selectedSceneId: state.ui.live?.selectedSceneId || "",
        sceneMappingInLive: state.ui.live?.sceneMappingInLive !== false,
        showScenes: state.ui.live?.showScenes !== false,
        showComponents: state.ui.live?.showComponents !== false,
        transitionId: String(state.ui.live?.transitionId || "vj1.transition.dissolve"),
        transitionParameters: state.ui.live?.transitionParameters && typeof state.ui.live.transitionParameters === "object"
          ? state.ui.live.transitionParameters
          : {},
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
    mappings: persistedMappings(state.mappings),
    shaders: state.shaders,
  };
}

export function persistedMappings(mappings = []) {
  return (mappings || []).map((mapping) => ({
    ...mapping,
    surfaces: (mapping.surfaces || []).map(authoredSurfaceFields),
  }));
}

export function persistedComponents(components = [], nodes = {}) {
  const graphComponents = new Set((nodes?.groups || [])
    .filter((group) => group.generatedBy === "vj1-component-compiler" && group.projectionSignature)
    .map((group) => String(group.componentId || "")));
  if (nodes?.authority === "node-graph") {
    const missing = (components || [])
      .filter((component) => !component?.systemRole && !graphComponents.has(String(component?.id || "")))
      .map((component) => String(component?.id || "missing"));
    if (missing.length) {
      throw new Error(`VJ1_PROJECT_COMPONENT_GRAPH_MISSING:${missing.join(",")}`);
    }
  }
  return (components || []).filter((component) => !component.systemRole).map((component) => {
    const {
      thumbnail: _derivedThumbnail,
      nodeProjectionSignature: _runtimeProjectionSignature,
      ...componentData
    } = component || {};
    // Version 24 persists the node group as visual authority. `chain` remains
    // an in-memory projection for the established Component/Scene UI and is
    // retained only when importing a not-yet-compiled legacy component.
    const persisted = nodes?.authority === "node-graph"
      ? Object.fromEntries(Object.entries(componentData).filter(([key]) => key !== "chain"))
      : componentData;
    if (persisted.type !== "scene" || !persisted.scene) return persisted;
    const {
      surfaceThumbnails: _derivedSurfaceThumbnails,
      width: _legacyWidth,
      height: _legacyHeight,
      ...scene
    } = persisted.scene;
    return { ...persisted, scene };
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
    previewViewportZoom: _runtimePreviewViewportZoom,
    previewViewportX: _runtimePreviewViewportX,
    previewViewportY: _runtimePreviewViewportY,
    canvasSize: _legacyCanvasSize,
    componentTexture: _legacyComponentTexture,
    surfaceTexture: _legacySurfaceTexture,
    ...canonical
  } = render || {};
  return {
    ...canonical,
    outputs: (canonical.outputs || []).map((output, index) => ({
      id: String(output?.id || (index === 0 ? "output-main" : `output-${index + 1}`)),
      name: normalizeOutputName(output?.name, index),
      aspectRatio: Number(output?.aspectRatio) || 16 / 9,
    })),
  };
}
