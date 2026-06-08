export function createCircuitDependencies({
  fields,
  getCodeEditorShellController,
  getConsoleController,
  getProjectDomainFeatureRegistry,
  inferCircuitLayout,
  initCircuitView,
  projectState,
  setCircuitView,
  getCircuitView,
  storage,
  timestampForFilename,
  windowRef,
} = {}) {
  return {
    ...getProjectDomainFeatureRegistry().circuitFeatureHelpers(),
    fields,
    windowRef,
    initCircuitView,
    inferCircuitLayout,
    getCircuitChatLayout: () => projectState.circuitChatLayout,
    getProjectCache: () => projectState.projectCache,
    getCurrentProjectId: () => projectState.currentProjectId,
    getCurrentRevisionId: () => projectState.currentRevisionId,
    getCurrentSketchName: () => projectState.currentSketchName,
    setCircuitView,
    getCircuitView,
    getCodeEditorShellController,
    getConsoleController,
    setCircuitChatLayout: (value) => {
      projectState.circuitChatLayout = value;
    },
    storage,
    timestampForFilename,
  };
}
