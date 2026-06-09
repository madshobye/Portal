export function createChatCredentials({
  storageKeys,
  keyButton,
  keyInput,
  keyShareOutput,
  debugPromptButton,
} = {}) {
  function hasApiKey() {
    return Boolean(apiKey());
  }

  function apiKey() {
    return localStorage.getItem(storageKeys.apiKey)
      || (storageKeys.legacyApiKey ? localStorage.getItem(storageKeys.legacyApiKey) : "")
      || "";
  }

  function storeApiKey(value = "") {
    localStorage.setItem(storageKeys.apiKey, String(value || ""));
    if (storageKeys.legacyApiKey) localStorage.removeItem(storageKeys.legacyApiKey);
    clearKeyInput();
    clearShareOutput();
  }

  function clearApiKey() {
    localStorage.removeItem(storageKeys.apiKey);
    if (storageKeys.legacyApiKey) localStorage.removeItem(storageKeys.legacyApiKey);
    clearShareOutput();
  }

  function clearKeyInput() {
    if (keyInput) keyInput.value = "";
  }

  function clearShareOutput() {
    if (!keyShareOutput) return;
    keyShareOutput.value = "";
    keyShareOutput.hidden = true;
  }

  function debugPromptEnabled() {
    return localStorage.getItem(storageKeys.debugPrompt) === "1";
  }

  function toggleDebugPrompt() {
    localStorage.setItem(storageKeys.debugPrompt, debugPromptEnabled() ? "0" : "1");
    updateDebugPromptButton();
  }

  function updateDebugPromptButton() {
    const enabled = debugPromptEnabled();
    if (!debugPromptButton) return;
    debugPromptButton.classList.toggle("is-active", enabled);
    debugPromptButton.title = enabled ? "Download prompt debug: on" : "Download prompt debug: off";
    debugPromptButton.setAttribute("aria-label", debugPromptButton.title);
  }

  function updateKeyButton() {
    const hasKey = hasApiKey();
    if (!keyButton) return;
    keyButton.title = hasKey ? "Clear API key" : "No API key stored";
    keyButton.setAttribute("aria-label", keyButton.title);
    keyButton.textContent = hasKey ? "Clear key" : "No key";
  }

  return {
    apiKey,
    clearApiKey,
    clearKeyInput,
    clearShareOutput,
    debugPromptEnabled,
    hasApiKey,
    storeApiKey,
    toggleDebugPrompt,
    updateDebugPromptButton,
    updateKeyButton,
  };
}
