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
  getHasActiveUi,
} = {}) {
  let hiddenViews = {
    chat: false,
    ui: false,
  };

  function tabFor(name) {
    return fields.tabs.find((tab) => tab.dataset.tab === name) || null;
  }

  function shouldHideChatTab() {
    return !getHasChatApiKey?.();
  }

  function shouldHideUiTab() {
    if (fields.views.ui?.classList.contains("is-active")) return false;
    return !getHasActiveUi?.();
  }

  function isViewAvailable(name) {
    return Boolean(fields.views[name]) && !hiddenViews[name];
  }

  function fallbackView(name) {
    if (isViewAvailable(name)) return name;
    return isViewAvailable("coding") ? "coding" : Object.keys(fields.views).find(isViewAvailable) || "coding";
  }

  function refreshViewAvailability() {
    hiddenViews = {
      ...hiddenViews,
      chat: shouldHideChatTab(),
      ui: shouldHideUiTab(),
    };
    Object.entries(hiddenViews).forEach(([name, hidden]) => {
      const tab = tabFor(name);
      if (!tab) return;
      tab.hidden = hidden;
      tab.setAttribute("aria-hidden", hidden ? "true" : "false");
    });
    if (hiddenViews.chat && fields.views.chat?.classList.contains("is-active")) switchTab("coding");
    return {
      chat: !hiddenViews.chat,
      ui: !hiddenViews.ui,
    };
  }

  function refreshChatTabVisibility() {
    return refreshViewAvailability().chat;
  }

  function refreshUiTabVisibility() {
    return refreshViewAvailability().ui;
  }

  function recordSuccessfulUpload() {
    refreshViewAvailability();
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
    refreshViewAvailability();
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
    refreshUiTabVisibility,
    refreshViewAvailability,
    restoreActiveTab,
    showSingleGenerativePanel,
    switchLowerPanel,
    switchTab,
    syncGenerativePanelState,
    toggleGenerativePanel,
  };
}
