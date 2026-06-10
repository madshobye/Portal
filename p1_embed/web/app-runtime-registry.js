import { createPageLifecycleController } from "./page-lifecycle-controller.js?v=0.1.87-ui744";
import { createAppBootstrapController } from "./app-bootstrap-controller.js?v=0.1.87-ui744";
import { createAppControlBindingsController } from "./app-control-bindings-controller.js?v=0.1.87-ui744";
import { copyTextToClipboard } from "./clipboard.js?v=0.1.87-ui744";
import { isMqttKind } from "./connection-kinds.js?v=0.1.87-ui744";
import { mqttSharePeerId } from "./status-model.js?v=0.1.87-ui744";
import { createTopbarShareController } from "./topbar-share-controller.js?v=0.1.87-ui744";

export function createAppRuntimeRegistry({
  defaultPeerIdFromWebSocket,
  fields,
  getChatSettings,
  getChatShellController,
  getCircuitShellController,
  getCircuitWorkspaceController,
  getCodeEditorShellController,
  getCommandConsoleService,
  getConnectionShellController,
  getConnectionAddressService,
  getConnectionTransportSession,
  getConnectionUiStateController,
  getConsoleController,
  getConsolePreferences,
  getDeviceRefreshService,
  getDeviceSettingsController,
  getEditorRegistry,
  getFirmwareUpdateController,
  getGenerativePanelController,
  getGuinoController,
  getGuinoShellService,
  getInfoPanelController,
  getInstallWorkflowController,
  getLowerPanelController,
  getProjectActionsController,
  getProjectDownloadService,
  getProjectHistoryView,
  getProjectToolbarController,
  getRevisionDraftStore,
  getScriptDownloadService,
  getScriptUploadService,
  getSettingsShellController,
  getSettingsTabs,
  getSpecificationEditorController,
  getUiActionRunner,
  getViewShellController,
  isBusy,
  isConnectionVerified,
  connectionIntentWanted,
  getClient,
  getTransport,
  getLastStatus,
  mqttVersion,
  scriptToolbars,
  setReconnectAfterReturn,
  setUnloading,
  setWifiDraftDirty,
  storage,
  storageArea,
  syncGenerativePanelState,
  updateViewportHeight,
  webVersion,
  windowRef,
  documentRef,
  workspaceToolbars,
} = {}) {
  let pageLifecycleController = null;
  let appBootstrapController = null;
  let appControlBindingsController = null;
  let topbarShareController = null;

  function getPageLifecycleController() {
    if (pageLifecycleController) return pageLifecycleController;
    pageLifecycleController = createPageLifecycleController({
      windowRef,
      documentRef,
      writeCurrentRevisionDraft: () => getRevisionDraftStore().write(),
      isBusy,
      connectionIntentWanted,
      getClient,
      getTransport,
      isConnectionVerified,
      handleTransportDropped: (droppedClient, options) => getConnectionTransportSession().handleTransportDropped(droppedClient, options),
      maybeReconnectAfterReturn: () => getConnectionTransportSession().maybeReconnectAfterReturn(),
      setUnloading,
      setReconnectAfterReturn,
    });
    return pageLifecycleController;
  }

  function getAppBootstrapController() {
    if (appBootstrapController) return appBootstrapController;
    appBootstrapController = createAppBootstrapController({
      fields,
      storage,
      storageArea,
      webVersion,
      mqttVersion,
      updateViewportHeight,
      initEditor: () => getCodeEditorShellController().init(),
      setEditorValueRaw: (value, options) => getCodeEditorShellController().setValueRaw(value, options),
      defaultPeerIdFromWebSocket,
      getConsolePreferences,
      updateConsoleTimestampButton: () => getConsolePreferences().updateTimestampButton(),
      bindControls: () => getAppControlBindingsController().bind(),
      syncGenerativePanelState,
      bindLifecycle: () => getPageLifecycleController().bind(),
      initChat: () => getChatShellController().initChat(),
      initCircuit: () => getCircuitShellController().init(),
      initGuino: () => getGuinoController().init(),
      migrateConnectionHistory: () => getConnectionShellController().migrateConnectionHistory(),
      renderConnectionHistory: () => getConnectionShellController().renderConnectionHistory(),
      renderSketchHistory: () => getProjectHistoryView().renderSketchHistory(),
      logLine: (level, message) => getConsoleController().logLine(level, message),
      refreshKnownUsbPorts: () => getConnectionShellController().refreshKnownUsbPorts(),
      refreshInstallManifestInfo: () => getInstallWorkflowController().refreshInstallManifestInfo(),
      refreshFirmwareReleaseInfo: (options) => getFirmwareUpdateController().refreshFirmwareReleaseInfo(options),
      firmwareLog: (message) => getFirmwareUpdateController().firmwareLog(message),
      renderFirmwareUpdatePanel: () => getFirmwareUpdateController().renderFirmwareUpdatePanel(),
      setConnected: (connected) => getConnectionUiStateController().setConnected(connected),
      renderFields: () => getConnectionUiStateController().renderFields(),
      applyGuestUiShell: () => getConnectionShellController().applyGuestUiShell(),
      restoreActiveTab: () => getViewShellController().restoreActiveTab(),
      autoConnectFromUrlParams: () => getConnectionShellController().autoConnectFromUrlParams(),
      autoReconnectLastConnection: (options) => getConnectionShellController().autoReconnectLastConnection(options),
    });
    return appBootstrapController;
  }

  function getAppControlBindingsController() {
    if (appControlBindingsController) return appControlBindingsController;
    appControlBindingsController = createAppControlBindingsController({
      fields,
      actions: {
        switchTab: (name) => getViewShellController().switchTab(name),
        toggleConnection: () => getConnectionShellController().toggleConnection(),
        createNewSketch: () => getProjectActionsController().createNewSketch(),
        createCleanRevision: () => getProjectActionsController().createCleanRevision(),
        downloadProject: () => getProjectDownloadService().downloadProject(),
        runScriptFromToolbar: () => {
          getConsoleController().logLine("debug", "upload requested");
          getUiActionRunner().run(() => getScriptUploadService().setScript({ run: true, save: true }), "uploading");
        },
        refreshStatus: (options) => getDeviceRefreshService().refreshStatus(options),
        connectUsb: () => getConnectionShellController().connectUsb(),
        showNewWsField: () => getConnectionShellController().showNewWsField(),
        connectWebSocket: (value) => getConnectionShellController().connectWebSocket(value),
        renderConnectionHistory: () => getConnectionShellController().renderConnectionHistory(),
        showNewPeerField: () => getConnectionShellController().showNewPeerField(),
        connectMqtt: (value, mqttConfig = null) => getConnectionShellController().connectMqtt(value, mqttConfig),
        runUiAction: (action, label = "busy") => getUiActionRunner().run(action, label),
        getScript: (options) => getScriptDownloadService().getScript(options),
        sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
        formatEditorCode: () => getCodeEditorShellController().formatCode(),
        toggleAppTheme: () => getCodeEditorShellController().toggleTheme(),
        bindSketchDrop: () => getEditorRegistry().bindCodeDrop(),
        openSettingsDialog: () => getSettingsShellController().openSettingsDialog(),
        saveDeviceName: () => getDeviceSettingsController().saveDeviceName(),
        saveWifi: () => getDeviceSettingsController().saveWifi(),
        saveMqtt: () => getDeviceSettingsController().saveMqtt(),
        updateAccessSaveVisibility: (baseline = null) => getSettingsShellController().updateAccessSaveVisibility(baseline),
        addOnlineAuthUser: () => getDeviceSettingsController().addOnlineAuthUser(),
        toggleConsoleTimestamps: () => {
          getConsolePreferences().toggleTimestamps();
          getConsoleController().render();
        },
        copyConsole: () => getConsoleController().copy(),
        clearConsole: () => getConsoleController().clear(),
        sendRaw: () => getCommandConsoleService().sendRaw(),
        toggleChatApiKey: () => getChatShellController().toggleChatApiKey(),
        saveChatApiKey: () => getChatShellController().saveChatApiKey(),
        createEncryptedChatKeyShare: () => getChatShellController().createEncryptedChatKeyShare(),
        refreshChatModels: () => getChatShellController().refreshChatModels(),
        toggleChatDebugPrompt: () => getChatShellController().toggleChatDebugPrompt(),
        runFirmwareUpdate: () => getFirmwareUpdateController().runFirmwareUpdate(),
        clearChat: () => getChatShellController().clearChat(),
        handleSpecificationInput: () => getSpecificationEditorController().handleInput(),
        handleSpecificationPaste: (event) => getSpecificationEditorController().handlePaste(event),
        applySpecificationFormat: (format = "") => getSpecificationEditorController().applyFormat(format),
        handleSpecificationModeChange: () => getSpecificationEditorController().handleModeChange(),
        generateCodeFromSpecification: () => getChatShellController().generateCodeFromSpecification(),
        resetCircuitLayoutPositions: () => getCircuitShellController().resetLayoutPositions(),
        runInstallAction: (action) => getInstallWorkflowController().runInstallAction(action),
        connectFlasher: () => getInstallWorkflowController().connectFlasher(),
        flashInstallManifest: (options) => getInstallWorkflowController().flashInstallManifest(options),
        sendChatPrompt: () => getChatShellController().sendChatPrompt(),
        updateEnabledState: () => getConnectionUiStateController().updateEnabledState(),
      },
      state: {
        hasClient: () => Boolean(getClient()),
        workspaceToolbars,
        scriptToolbars,
        setWifiDraftDirty,
      },
      controllers: {
        lowerPanel: getLowerPanelController,
        projectToolbar: getProjectToolbarController,
        topbarShare: getTopbarShareController,
        circuitWorkspace: getCircuitWorkspaceController,
        settingsTabs: getSettingsTabs,
        consolePreferences: getConsolePreferences,
        chatSettings: getChatSettings,
        generativePanel: getGenerativePanelController,
      },
    });
    return appControlBindingsController;
  }

  function getTopbarShareController() {
    if (topbarShareController) return topbarShareController;
    topbarShareController = createTopbarShareController({
      fields,
      documentRef,
      URLRef: windowRef.URL,
      shareLinks,
      buildBugReport,
      copyText: copyTextToClipboard,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return topbarShareController;
  }

  async function buildBugReport(description = "") {
    const transport = getTransport();
    const activeView = documentRef.querySelector(".view.is-active")?.id || "";
    const activeLowerPanel = documentRef.querySelector(".lower-panel.is-active")?.id || "";
    const activeGenerativePanel = documentRef.querySelector(".generative-panel.is-active")?.dataset.generativePanel || "";
    const projectSnapshot = await getProjectDownloadService().projectSnapshotForDownload().catch((error) => ({
      error: error?.message || "project snapshot failed",
    }));
    const report = {
      kind: "xobit-bug-report",
      createdAt: new Date().toISOString(),
      description: String(description || "").trim(),
      app: {
        webVersion,
        mqttVersion,
        url: windowRef.location?.href || "",
        userAgent: windowRef.navigator?.userAgent || "",
        language: windowRef.navigator?.language || "",
        viewport: {
          width: windowRef.innerWidth,
          height: windowRef.innerHeight,
          devicePixelRatio: windowRef.devicePixelRatio,
        },
      },
      ui: {
        activeView,
        activeLowerPanel,
        activeGenerativePanel,
        theme: documentRef.body?.getAttribute("data-theme") || "",
        debugLevel: fields.debugLevel?.value || "",
        consoleTimestamps: Boolean(fields.consoleTimestamps?.classList.contains("is-active")),
      },
      connection: {
        busy: isBusy(),
        verified: isConnectionVerified(),
        hasClient: Boolean(getClient()),
        transport: summarizeTransport(transport),
        status: getLastStatus() || null,
      },
      ai: {
        model: fields.chatModel?.value || "",
        maxOutputTokens: getChatSettings()?.maxOutputTokens?.() || null,
        keyStored: Boolean(fields.chatApiKey?.dataset?.hasKey === "true" || fields.chatApiKeyInput?.value),
      },
      logs: getConsoleController().recentFormatted(180),
      project: currentRevisionOnly(projectSnapshot),
    };
    return redactSensitive(report);
  }

  function currentRevisionOnly(project = null) {
    if (!project || project.error) return project;
    const revisions = Array.isArray(project.revisions) ? project.revisions : [];
    const revision = revisions.find((item) => item.id === project.activeRevisionId) || revisions[0] || null;
    return {
      id: project.id || "",
      name: project.name || "",
      activeRevisionId: revision?.id || project.activeRevisionId || "",
      updatedAt: project.updatedAt || "",
      revision: revision ? { ...revision } : null,
    };
  }

  function summarizeTransport(transport = null) {
    if (!transport) return null;
    return {
      kind: transport.kind || "",
      label: transport.label || "",
      name: transport.name || "",
      peerId: transport.peerId || "",
      connected: Boolean(transport.connected),
    };
  }

  function redactSensitive(value, key = "") {
    if (Array.isArray(value)) return value.map((item) => redactSensitive(item, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sensitiveKey(entryKey) ? "[redacted]" : redactSensitive(entryValue, entryKey),
      ]));
    }
    if (typeof value === "string") return redactSensitiveString(value, key);
    return value;
  }

  function sensitiveKey(key = "") {
    return /(?:password|passphrase|api.?key|secret|credential|authorization|bearer|token|keyshare|sharekey|authkey)/i.test(key);
  }

  function redactSensitiveString(value = "", key = "") {
    if (sensitiveKey(key)) return value ? "[redacted]" : "";
    return String(value)
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
      .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted-openai-key]")
      .replace(/\bv1:eyJ[A-Za-z0-9._~+/=-]{20,}(?:<<XOBIT_KEY_END>>)?/g, "[redacted-encrypted-key]")
      .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]");
  }

  async function shareLinks() {
    return {
      ui: await getGuinoShellService().shareUrl().catch(() => ""),
      mqtt: mqttLinkIfUsable(),
    };
  }

  function mqttLinkIfUsable() {
    if (!getConnectionShellController().isConnectionKindAvailable("mqtt")) return "";
    const transport = getTransport();
    const mqtt = getLastStatus()?.mqtt || {};
    if (!isMqttKind(transport?.kind) && !mqtt.connected) return "";
    const addressService = getConnectionAddressService();
    const peerId = mqttSharePeerId({
      mqtt,
      transport,
      normalizePeerId: (value) => addressService.normalizePeerId(value),
      isMqttKind,
    });
    if (!peerId) return "";
    const url = new URL(addressService.sharePageUrl("mqtt", "", null, peerId));
    url.searchParams.set("view", "ui");
    return url.toString();
  }

  return {
    getAppBootstrapController,
    getAppControlBindingsController,
    getPageLifecycleController,
  };
}
