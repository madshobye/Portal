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
} = {}) {
  function switchTab(name) {
    const nextName = fields.views[name] ? name : "coding";
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
    restoreActiveTab,
    showSingleGenerativePanel,
    switchLowerPanel,
    switchTab,
    syncGenerativePanelState,
    toggleGenerativePanel,
  };
}
