export function createSettingsTabs({
  tabs,
  panels,
  defaultTab = "general",
  onFirmwareTab,
} = {}) {
  function switchTab(name) {
    const target = name || defaultTab;
    tabs.forEach((tab) => {
      const active = tab.dataset.settingsTab === target;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.settingsPanel === target);
    });
    if (target === "firmware") onFirmwareTab?.();
  }

  function bind() {
    tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.settingsTab)));
  }

  return {
    bind,
    switchTab,
  };
}
