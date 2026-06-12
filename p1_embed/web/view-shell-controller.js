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
  storageKeyLabFeatures,
  storageArea = window.localStorage,
  onLabFeaturesChanged,
} = {}) {
  let hiddenViews = {
    chat: false,
    ui: false,
    bugReport: true,
  };
  let labFeaturesEnabled = false;

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

  function readLabFeaturesEnabled() {
    try {
      return storageKeyLabFeatures ? storageArea?.getItem(storageKeyLabFeatures) === "1" : false;
    } catch {
      return false;
    }
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
      bugReport: !labFeaturesEnabled,
    };
    Object.entries(hiddenViews).forEach(([name, hidden]) => {
      const tab = tabFor(name);
      if (!tab) return;
      tab.hidden = hidden;
      tab.setAttribute("aria-hidden", hidden ? "true" : "false");
    });
    if (hiddenViews.chat && fields.views.chat?.classList.contains("is-active")) switchTab("coding");
    if (hiddenViews.bugReport && fields.views.bugReport?.classList.contains("is-active")) switchTab("coding");
    return {
      chat: !hiddenViews.chat,
      ui: !hiddenViews.ui,
      bugReport: !hiddenViews.bugReport,
    };
  }

  function refreshLabFeatureVisibility() {
    fields.labFeaturesToggle && (fields.labFeaturesToggle.checked = labFeaturesEnabled);
    fields.labFeatureElements?.forEach((element) => {
      element.hidden = !labFeaturesEnabled;
      element.setAttribute("aria-hidden", labFeaturesEnabled ? "false" : "true");
    });
  }

  function setLabFeaturesEnabled(enabled, { persist = true } = {}) {
    labFeaturesEnabled = Boolean(enabled);
    if (persist && storageKeyLabFeatures) {
      try {
        storageArea?.setItem(storageKeyLabFeatures, labFeaturesEnabled ? "1" : "0");
      } catch {
        // Ignore storage failures; the visible state still updates for this session.
      }
    }
    refreshLabFeatureVisibility();
    onLabFeaturesChanged?.(labFeaturesEnabled);
    refreshViewAvailability();
  }

  function isLabFeaturesEnabled() {
    return labFeaturesEnabled;
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
    setLabFeaturesEnabled(readLabFeaturesEnabled(), { persist: false });
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
    isLabFeaturesEnabled,
    recordSuccessfulUpload,
    refreshChatTabVisibility,
    refreshUiTabVisibility,
    refreshViewAvailability,
    restoreActiveTab,
    showSingleGenerativePanel,
    setLabFeaturesEnabled,
    switchLowerPanel,
    switchTab,
    syncGenerativePanelState,
    toggleGenerativePanel,
  };
}
