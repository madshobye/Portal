export function createLowerPanelController({
  tabs,
  panels,
  consoleActions,
} = {}) {
  function switchPanel(name) {
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.panel === name));
    Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle("is-active", key === name));
    consoleActions?.classList.toggle("is-hidden", name !== "console");
  }

  function bind() {
    tabs.forEach((tab) => tab.addEventListener("click", () => switchPanel(tab.dataset.panel)));
  }

  return {
    bind,
    switchPanel,
  };
}
