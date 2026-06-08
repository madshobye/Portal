export function createGenerativePanelController({
  chatView,
  tabs,
  panels,
  chatClearButton,
  narrowQuery,
  onChatVisible,
} = {}) {
  function isNarrowLayout() {
    return Boolean(narrowQuery?.matches);
  }

  function syncState() {
    let chatVisible = Boolean(chatView?.querySelector('[data-generative-panel="chat"]')?.classList.contains("is-active"));
    let specVisible = Boolean(chatView?.querySelector('[data-generative-panel="specification"]')?.classList.contains("is-active"));
    if (isNarrowLayout()) {
      const activeName = specVisible && !chatVisible ? "specification" : "chat";
      panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.generativePanel === activeName);
      });
      chatVisible = activeName === "chat";
      specVisible = activeName === "specification";
    }
    tabs.forEach((tab) => {
      const visible = tab.dataset.generativeTab === "chat" ? chatVisible : specVisible;
      tab.classList.toggle("is-active", visible);
      tab.setAttribute("aria-pressed", visible ? "true" : "false");
    });
    chatView?.classList.toggle("is-chat-visible", chatVisible);
    chatView?.classList.toggle("is-specification-visible", specVisible);
    chatView?.classList.toggle("is-single-chat", chatVisible && !specVisible);
    chatView?.classList.toggle("is-single-specification", specVisible && !chatVisible);
    chatClearButton?.classList.toggle("is-hidden", !chatVisible);
    if (chatVisible) onChatVisible?.();
  }

  function showSinglePanel(name) {
    panels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.generativePanel === name);
    });
    syncState();
  }

  function togglePanel(name) {
    if (isNarrowLayout()) {
      showSinglePanel(name);
      return;
    }
    const panel = chatView?.querySelector(`[data-generative-panel="${name}"]`);
    if (!panel) return;
    const active = panel.classList.contains("is-active");
    const activeCount = [...panels].filter((item) => item.classList.contains("is-active")).length;
    if (active && activeCount <= 1) return;
    panel.classList.toggle("is-active", !active);
    syncState();
  }

  function bind() {
    tabs.forEach((tab) => tab.addEventListener("click", () => togglePanel(tab.dataset.generativeTab)));
    if (narrowQuery?.addEventListener) {
      narrowQuery.addEventListener("change", syncState);
    } else {
      narrowQuery?.addListener?.(syncState);
    }
  }

  return {
    bind,
    isNarrowLayout,
    showSinglePanel,
    syncState,
    togglePanel,
  };
}
