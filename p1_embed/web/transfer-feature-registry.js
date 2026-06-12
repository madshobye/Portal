import { createTransferRegistry } from "./transfer-registry.js?v=0.1.87-ui753";

export function createTransferFeatureRegistry({
  buildRevision,
  codeHashFor,
  createProjectId,
  getClient,
  getCodeEditorShellController,
  getCommandConsoleService,
  getConnectionShellController,
  getConsoleController,
  getDeviceRefreshService,
  getDeviceStateController,
  getGuinoController,
  getLastConfig,
  getProjectController,
  getProjectLibraryService,
  getProjectRevisionService,
  getTransport,
  getUploadStatusController,
  getViewShellController,
  inferCircuitLayout,
  isMqttKind,
  nextRevisionName,
  normalizeChatMessages,
  normalizeProjectName,
  normalizeProjectRecord,
  normalizeSketchName,
  settle,
} = {}) {
  let transferRegistry = null;

  function normalizeCodeHash(value, code = "") {
    if (Number.isFinite(value)) return (Number(value) >>> 0).toString(16).padStart(8, "0");
    const text = String(value || "").trim().toLowerCase();
    if (/^[0-9a-f]{8}$/.test(text)) return text;
    return codeHashFor(code);
  }

  function getTransferRegistry() {
    if (transferRegistry) return transferRegistry;
    transferRegistry = createTransferRegistry({
      buildRevision,
      boardCodeHash: (data, code) => normalizeCodeHash(data?.codeHash ?? data?.scriptHash ?? data?.hash, code),
      clearEditorError: () => getDeviceStateController().clearEditorError(),
      createProjectId,
      getClient,
      getEditorValue: () => getCodeEditorShellController().getValue(),
      getGuinoController,
      getLastConfig,
      getTransport,
      getUploadStatusController,
      inferCircuitLayout,
      isBinaryTransportKind: (kind) => getConnectionShellController().isBinaryTransportKind(kind),
      isMqttKind,
      logLine: (level, message) => getConsoleController().logLine(level, message),
      markEditorError: (message) => getDeviceStateController().markEditorError(message),
      nextRevisionName,
      normalizeChatMessages,
      normalizeCodeHash,
      normalizeProjectName,
      normalizeProjectRecord,
      normalizeSketchName,
      openRevision: (...args) => getProjectController().openProjectRevision(...args),
      persistProjectMetadataToDevice: (...args) => getProjectRevisionService().persistProjectMetadataToDevice(...args),
      readProjects: () => getProjectLibraryService().readProjects(),
      refreshStatus: (options) => getDeviceRefreshService().refreshStatus(options),
      saveActiveRevisionFromEditor: (options) => getProjectRevisionService().saveActiveRevisionFromEditor(options),
      saveProject: (...args) => getProjectLibraryService().saveProject(...args),
      sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
      setUploadState: (...args) => getDeviceStateController().setUploadState(...args),
      shelveEditorSketchIfNeeded: (options) => getProjectController().shelveEditorSketchIfNeeded(options),
      settle,
      updateConfig: (config = {}) => getDeviceStateController().updateConfig(config),
      updateScriptState: (data = {}) => getDeviceStateController().updateScriptState(data),
      uploadErrorLabel: (message = "") => getDeviceStateController().uploadErrorLabel(message),
      onSuccessfulUpload: () => getViewShellController().recordSuccessfulUpload(),
      refreshViewAvailability: () => getViewShellController().refreshViewAvailability(),
    });
    return transferRegistry;
  }

  return {
    getBoardDownloadService: () => getTransferRegistry().getBoardDownloadService(),
    getScriptDownloadService: () => getTransferRegistry().getScriptDownloadService(),
    getScriptUploadService: () => getTransferRegistry().getScriptUploadService(),
    getTransferRegistry,
  };
}
