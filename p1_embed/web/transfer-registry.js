import { createBoardDownloadService } from "./board-download-service.js?v=0.1.87-ui748";
import { createScriptDownloadService } from "./script-download-service.js?v=0.1.87-ui748";
import { createScriptUploadService } from "./script-upload-service.js?v=0.1.87-ui748";

export function createTransferRegistry({
  buildRevision,
  boardCodeHash,
  clearEditorError,
  createProjectId,
  getClient,
  getEditorValue,
  getGuinoController,
  getLastConfig,
  getTransport,
  getUploadStatusController,
  inferCircuitLayout,
  isBinaryTransportKind,
  isMqttKind,
  logLine,
  markEditorError,
  nextRevisionName,
  normalizeChatMessages,
  normalizeCodeHash,
  normalizeProjectName,
  normalizeProjectRecord,
  normalizeSketchName,
  openRevision,
  persistProjectMetadataToDevice,
  readProjects,
  refreshStatus,
  saveActiveRevisionFromEditor,
  saveProject,
  sendCommand,
  setUploadState,
  shelveEditorSketchIfNeeded,
  settle,
  updateConfig,
  updateScriptState,
  uploadErrorLabel,
  onSuccessfulUpload,
  refreshViewAvailability,
} = {}) {
  let boardDownloadService = null;
  let scriptDownloadService = null;
  let scriptUploadService = null;

  function getBoardDownloadService() {
    if (boardDownloadService) return boardDownloadService;
    boardDownloadService = createBoardDownloadService({
      getLastConfig,
      getClient,
      sendCommand,
      updateConfig,
      readProjects,
      saveProject,
      shelveEditorSketchIfNeeded,
      openRevision,
      updateScriptState,
      logLine,
      buildRevision,
      boardCodeHash,
      createProjectId,
      inferCircuitLayout,
      nextRevisionName,
      normalizeChatMessages,
      normalizeCodeHash,
      normalizeProjectName,
      normalizeProjectRecord,
      normalizeSketchName,
    });
    return boardDownloadService;
  }

  function getScriptDownloadService() {
    if (scriptDownloadService) return scriptDownloadService;
    scriptDownloadService = createScriptDownloadService({
      getTransport,
      sendCommand,
      applyFetchedScript: (data) => getBoardDownloadService().applyFetchedScript(data),
      isMqttKind,
    });
    return scriptDownloadService;
  }

  function getScriptUploadService() {
    if (scriptUploadService) return scriptUploadService;
    scriptUploadService = createScriptUploadService({
      getEditorValue,
      getTransport,
      saveActiveRevisionFromEditor,
      openRevision,
      getUploadStatusController,
      getGuinoController,
      setUploadState,
      uploadErrorLabel,
      clearEditorError,
      markEditorError,
      persistProjectMetadataToDevice,
      updateScriptState,
      refreshStatus,
      sendCommand,
      settle,
      logLine,
      isMqttKind,
      isBinaryTransportKind,
      onSuccessfulUpload,
      refreshViewAvailability,
    });
    return scriptUploadService;
  }

  return {
    getBoardDownloadService,
    getScriptDownloadService,
    getScriptUploadService,
  };
}
