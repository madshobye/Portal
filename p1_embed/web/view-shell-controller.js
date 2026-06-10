export function createViewShellController({
  fields,
  routing,
  lowerPanelController,
  generativePanelController,
  getCodeView,
  getCircuitView,
  getGuinoController,
  renderChatTranscript,
  updateCircuitView,
  requestGuinoRefresh,
  isDeviceConnected,
  requestFrame,
  getHasChatApiKey,
  storageArea,
  chatIntroUploadCountKey,
  chatIntroUploadThreshold = 10,
} = {}) {
  let chatTabHidden = false;

  function readChatIntroUploadCount() {
    try {
      const raw = Number(storageArea?.getItem?.(chatIntroUploadCountKey));
      return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    } catch {
      return 0;
    }
  }

  function writeChatIntroUploadCount(value) {
    if (!storageArea || !chatIntroUploadCountKey) return;
    try {
      storageArea.setItem(chatIntroUploadCountKey, String(Math.max(0, Math.floor(value))));
    } catch {
      // Private browsing or full storage should not block code upload.
    }
  }

  function chatTab() {
    return fields.tabs.find((tab) => tab.dataset.tab === "chat") || null;
  }

  function shouldHideChatTab() {
    return readChatIntroUploadCount() >= chatIntroUploadThreshold && !getHasChatApiKey?.();
  }

  function isViewAvailable(name) {
    return Boolean(fields.views[name]) && !(name === "chat" && chatTabHidden);
  }

  function fallbackView(name) {
    if (isViewAvailable(name)) return name;
    return isViewAvailable("coding") ? "coding" : Object.keys(fields.views).find(isViewAvailable) || "coding";
  }

  function refreshChatTabVisibility() {
    chatTabHidden = shouldHideChatTab();
    const tab = chatTab();
    if (tab) {
      tab.hidden = chatTabHidden;
      tab.setAttribute("aria-hidden", chatTabHidden ? "true" : "false");
    }
    if (chatTabHidden && fields.views.chat?.classList.contains("is-active")) switchTab("coding");
    return !chatTabHidden;
  }

  function recordSuccessfulUpload() {
    writeChatIntroUploadCount(readChatIntroUploadCount() + 1);
    refreshChatTabVisibility();
  }

  function switchTab(name) {
    const nextName = fallbackView(name);
    fields.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === nextName));
    Object.entries(fields.views).forEach(([key, view]) => view.classList.toggle("is-active", key === nextName));
    routing.storeActiveView(nextName);
    routing.updateUrlParam(nextName);
    runViewEnteredHook(nextName);
  }

  function runViewEnteredHook(name) {
    if (name === "coding") getCodeView().resize();
    if (name === "chat") {
      syncGenerativePanelState();
      renderChatTranscript();
    }
    if (name === "circuit") {
      updateCircuitView();
      requestFrame(() => getCircuitView()?.resize?.());
    }
    if (name === "ui") {
      requestFrame(() => getGuinoController().resize());
      if (isDeviceConnected()) requestGuinoRefresh({ quiet: true });
    }
  }

  function restoreActiveTab() {
    refreshChatTabVisibility();
    switchTab(routing.initialView());
  }

  function switchLowerPanel(name) {
    lowerPanelController.switchPanel(name);
  }

  function toggleGenerativePanel(name) {
    generativePanelController.togglePanel(name);
  }

  function showSingleGenerativePanel(name) {
    generativePanelController.showSinglePanel(name);
  }

  function isNarrowGenerativeLayout() {
    return generativePanelController.isNarrowLayout();
  }

  function syncGenerativePanelState() {
    generativePanelController.syncState();
  }

  return {
    isNarrowGenerativeLayout,
    recordSuccessfulUpload,
    refreshChatTabVisibility,
    restoreActiveTab,
    showSingleGenerativePanel,
    switchLowerPanel,
    switchTab,
    syncGenerativePanelState,
    toggleGenerativePanel,
  };
}
