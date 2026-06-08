export function createEditorFeatureDependencies({
  documentRef,
  fields,
  getCircuitShellController,
  getConnectionUiStateController,
  getConsoleController,
  getCurrentRevisionSession,
  getProjectController,
  getRevisionDraftStore,
  normalizeSpecificationMode,
  projectState,
  storage,
} = {}) {
  return {
    documentRef,
    fields,
    getConnectionUiStateController,
    getConsoleController,
    getCurrentRevisionSession,
    getProjectController,
    getRevisionDraftStore,
    getCurrentProjectSpecificationMode: () => projectState.currentProjectSpecificationMode,
    normalizeSpecificationMode,
    scheduleCircuitUpdate: () => getCircuitShellController().scheduleUpdate(),
    setCurrentProjectDescription: (value) => {
      projectState.currentProjectDescription = value;
    },
    setCurrentProjectDescriptionSource: (value) => {
      projectState.currentProjectDescriptionSource = value;
    },
    setCurrentProjectSpecificationMode: (value) => {
      projectState.currentProjectSpecificationMode = value;
    },
    setCurrentProjectSpecificationModeSource: (value) => {
      projectState.currentProjectSpecificationModeSource = value;
    },
    setCircuitChatLayout: (value) => {
      projectState.circuitChatLayout = value;
    },
    storage,
  };
}
