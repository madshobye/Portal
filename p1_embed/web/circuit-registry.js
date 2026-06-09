import { createCircuitWorkspaceController } from "./circuit-workspace-controller.js?v=0.1.87-ui726";
import { createCircuitEditorActions } from "./circuit-editor-actions.js?v=0.1.87-ui726";
import { createCircuitShellController } from "./circuit-shell-controller.js?v=0.1.87-ui726";

export function createCircuitRegistry({
  fields,
  getCircuitChatLayout,
  getCircuitView,
  getCodeEditorShellController,
  getConsoleController,
  getCurrentProjectId,
  getCurrentRevisionId,
  getCurrentSketchName,
  getProjectCache,
  inferCircuitLayout,
  initCircuitView,
  normalizeProjectName,
  normalizeSketchName,
  setCircuitChatLayout,
  setCircuitView,
  storage,
  timestampForFilename,
  windowRef,
} = {}) {
  let circuitWorkspaceController = null;
  let circuitEditorActions = null;
  let circuitShellController = null;

  function invalidateCircuitChatLayout() {
    setCircuitChatLayout(null);
  }

  function getCircuitShellController() {
    if (circuitShellController) return circuitShellController;
    circuitShellController = createCircuitShellController({
      fields,
      windowRef,
      initCircuitView,
      inferCircuitLayout,
      getEditorValue: () => getCodeEditorShellController().getValue(),
      getCircuitChatLayout,
      getProjectCache,
      getCurrentProjectId,
      getCurrentRevisionId,
      getCurrentSketchName,
      setCircuitView,
      getCircuitView,
      getCircuitWorkspaceController,
      getCircuitEditorActions,
      normalizeProjectName,
      normalizeSketchName,
    });
    return circuitShellController;
  }

  function getCircuitWorkspaceController() {
    if (circuitWorkspaceController) return circuitWorkspaceController;
    circuitWorkspaceController = createCircuitWorkspaceController({
      artModeButton: fields.circuitArtMode,
      routingModeButton: fields.circuitRoutingMode,
      boardSelect: fields.circuitBoardSelect,
      downloadButton: fields.circuitDownload,
      storageKeys: {
        artMode: storage.circuitArtMode,
        routingMode: storage.circuitRoutingMode,
        boardType: storage.circuitBoardType,
      },
      getCircuitView,
      getCode: () => getCodeEditorShellController().getValue(),
      setCode: (code) => getCodeEditorShellController().setValueRaw(code, { persist: true }),
      onCircuitLayoutInvalidated: invalidateCircuitChatLayout,
      onCircuitStatus: (status = "") => getCircuitShellController().update(status),
      timestampForFilename,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return circuitWorkspaceController;
  }

  function getCircuitEditorActions() {
    if (circuitEditorActions) return circuitEditorActions;
    circuitEditorActions = createCircuitEditorActions({
      getCode: () => getCodeEditorShellController().getValue(),
      setCode: (code) => getCodeEditorShellController().setValueRaw(code, { persist: true }),
      inferLayout: inferCircuitLayout,
      setBoardType: (type, options) => getCircuitShellController().setBoardType(type, options),
      onCircuitLayoutInvalidated: invalidateCircuitChatLayout,
      updateCircuitView: (status = "") => getCircuitShellController().update(status),
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return circuitEditorActions;
  }

  return {
    getCircuitEditorActions,
    getCircuitShellController,
    getCircuitWorkspaceController,
  };
}
