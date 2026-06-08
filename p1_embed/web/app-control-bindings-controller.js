export function createAppControlBindingsController({
  fields,
  actions,
  state,
  controllers,
} = {}) {
  function bind() {
    fields.tabs.forEach((tab) => tab.addEventListener("click", () => actions.switchTab(tab.dataset.tab)));
    controllers.lowerPanel().bind();
    bindProjectToolbarControls();
    bindScriptToolbarControls();
    controllers.projectToolbar().bind();
    fields.usbConnect.addEventListener("click", actions.connectUsb);
    fields.newWsToggle.addEventListener("click", actions.showNewWsField);
    fields.newWsConnect.addEventListener("click", () => actions.connectWebSocket(fields.websocketUrl.value));
    fields.websocketUrl.addEventListener("input", actions.renderConnectionHistory);
    fields.newPeerToggle.addEventListener("click", actions.showNewPeerField);
    fields.newPeerConnect.addEventListener("click", () => actions.connectMqtt(fields.peerId.value));
    fields.peerId.addEventListener("input", actions.renderConnectionHistory);
    fields.getScript.addEventListener("click", () => actions.runUiAction(actions.getScript, "reading"));
    fields.reboot.addEventListener("click", () => actions.runUiAction(() => actions.sendCommand("device.reboot"), "rebooting"));
    fields.formatCode.addEventListener("click", () => actions.runUiAction(actions.formatEditorCode, "formatting"));
    fields.editorTheme?.addEventListener("click", actions.toggleEditorTheme);
    [fields.circuitBoardSelect, fields.circuitRefresh, fields.circuitArtMode, fields.circuitRoutingMode, fields.circuitDownload].forEach((button) => {
      ["pointerdown", "mousedown", "mouseup", "pointerup", "click"].forEach((name) => {
        button?.addEventListener(name, (event) => event.stopPropagation());
      });
    });
    controllers.circuitWorkspace().bind();
    actions.bindSketchDrop();
    fields.settings.addEventListener("click", actions.openSettingsDialog);
    controllers.settingsTabs().bind();
    fields.deviceNameSave.addEventListener("click", () => actions.runUiAction(actions.saveDeviceName, "rename"));
    fields.wifiSave.addEventListener("click", () => actions.runUiAction(actions.saveWifi, "wifi"));
    fields.mqttSave.addEventListener("click", () => actions.runUiAction(actions.saveMqtt, "mqtt"));
    fields.accessSave.addEventListener("click", () => actions.runUiAction(actions.saveMqtt, "access"));
    [fields.allowUnauthenticatedAccess, fields.accessGuestUi, fields.accessGuestScript].forEach((toggle) => {
      toggle?.addEventListener("change", actions.updateAccessSaveVisibility);
    });
    fields.onlineAuthAdd.addEventListener("click", () => actions.runUiAction(actions.addOnlineAuthUser, "online user"));
    fields.wifiSsid.addEventListener("input", () => state.setWifiDraftDirty(true));
    fields.wifiPassword.addEventListener("input", () => state.setWifiDraftDirty(true));
    fields.settingsDialog.addEventListener("close", () => state.setWifiDraftDirty(false));
    fields.consoleTimestamps.addEventListener("click", actions.toggleConsoleTimestamps);
    fields.copyConsole.addEventListener("click", actions.copyConsole);
    fields.infoQr.addEventListener("click", actions.copyInfoShareLink);
    fields.infoQr.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      actions.copyInfoShareLink();
    });
    fields.clearConsole.addEventListener("click", actions.clearConsole);
    fields.rawForm.addEventListener("submit", (event) => {
      event.preventDefault();
      actions.runUiAction(actions.sendRaw, "sending");
    });
    fields.debugLevel.addEventListener("change", () => {
      controllers.consolePreferences().writeLogLevel(fields.debugLevel.value);
      if (state.hasClient()) actions.runUiAction(() => actions.sendCommand("debug.set", { level: fields.debugLevel.value }), "debug");
    });
    fields.chatApiKey.addEventListener("click", actions.toggleChatApiKey);
    fields.chatApiKeySave.addEventListener("click", actions.saveChatApiKey);
    fields.chatKeyShare.addEventListener("click", () => actions.runUiAction(actions.createEncryptedChatKeyShare, "sharing"));
    fields.chatModel.addEventListener("change", () => {
      controllers.chatSettings().setSelectedModel(fields.chatModel.value);
    });
    fields.chatModelsRefresh.addEventListener("click", () => actions.runUiAction(actions.refreshChatModels, "refreshing"));
    fields.chatMaxOutputTokens.addEventListener("change", () => {
      controllers.chatSettings().storeMaxOutputTokens();
    });
    fields.chatDebugPrompt.addEventListener("click", actions.toggleChatDebugPrompt);
    fields.firmwareUpdateButton?.addEventListener("click", actions.runFirmwareUpdate);
    fields.chatClear.addEventListener("click", actions.clearChat);
    controllers.generativePanel().bind();
    fields.specificationEditor?.addEventListener("input", actions.handleSpecificationInput);
    fields.specificationEditor?.addEventListener("paste", actions.handleSpecificationPaste);
    fields.specificationTools.forEach((button) => button.addEventListener("click", () => actions.applySpecificationFormat(button.dataset.specFormat)));
    fields.specificationMode.addEventListener("change", actions.handleSpecificationModeChange);
    fields.specificationGenerate.addEventListener("click", () => actions.runUiAction(actions.generateCodeFromSpecification, "generating"));
    fields.circuitRefresh?.addEventListener("click", actions.resetCircuitLayoutPositions);
    fields.uiCopyLink?.addEventListener("click", actions.copyGuinoLink);
    fields.installConnect?.addEventListener("click", () => actions.runInstallAction(actions.connectFlasher));
    fields.installFlashManifest.addEventListener("click", () => actions.runInstallAction(actions.flashInstallManifest));
    fields.installGoCode.addEventListener("click", () => actions.switchTab("coding"));
    fields.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      actions.sendChatPrompt();
    });
    fields.chatInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      actions.sendChatPrompt();
    });
    fields.chatInput.addEventListener("input", actions.updateEnabledState);
  }

  function bindProjectToolbarControls() {
    state.workspaceToolbars().forEach(({ connect, newProject, newRevision, download }) => {
      connect?.addEventListener("click", actions.toggleConnection);
      newProject?.addEventListener("click", () => actions.runUiAction(actions.createNewSketch, "new sketch"));
      newRevision?.addEventListener("click", () => actions.runUiAction(actions.createCleanRevision, "new revision"));
      download?.addEventListener("click", () => actions.runUiAction(actions.downloadProject, "download"));
    });
  }

  function bindScriptToolbarControls() {
    state.scriptToolbars().forEach(({ run, stop }) => {
      run?.addEventListener("click", actions.runScriptFromToolbar);
      stop?.addEventListener("click", () => actions.runUiAction(() => actions.sendCommand("script.stop").then(actions.refreshStatus), "stopping"));
    });
  }

  return {
    bind,
  };
}
