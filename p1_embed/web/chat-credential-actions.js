export function createChatCredentialActions({
  fields,
  windowRef,
  navigatorRef,
  credentials,
  createEncryptedChatKeyShareToken,
  decryptEncryptedChatKeyShare,
  isEncryptedChatKeyShare,
  updateChatEnabledState,
  renderChatTranscript,
  onApiKeyChanged,
  logLine,
} = {}) {
  function hasChatApiKey() {
    return credentials.hasApiKey();
  }

  function chatDebugPromptEnabled() {
    return credentials.debugPromptEnabled();
  }

  function toggleChatDebugPrompt() {
    credentials.toggleDebugPrompt();
  }

  function updateChatDebugPromptButton() {
    credentials.updateDebugPromptButton();
  }

  function updateChatKeyButton() {
    credentials.updateKeyButton();
  }

  function toggleChatApiKey() {
    if (hasChatApiKey()) {
      credentials.clearApiKey();
      updateChatKeyButton();
      updateChatEnabledState();
      renderChatTranscript();
      onApiKeyChanged?.();
      logLine("info", "OpenAI API key cleared");
      return;
    }

    fields.chatApiKeyInput?.focus();
  }

  function saveChatApiKey() {
    const apiKey = fields.chatApiKeyInput.value.trim();
    if (!apiKey) return;
    if (isEncryptedChatKeyShare(apiKey)) {
      void importEncryptedChatKeyShare(apiKey).catch((error) => logLine("error", error.message || "encrypted key import failed"));
      return;
    }
    credentials.storeApiKey(apiKey);
    updateChatKeyButton();
    updateChatEnabledState();
    renderChatTranscript();
    onApiKeyChanged?.();
    logLine("info", "OpenAI API key stored in this browser");
  }

  async function createEncryptedChatKeyShare() {
    const apiKey = credentials.apiKey();
    const password = fields.chatKeySharePassword.value;
    const requestedDays = Number(fields.chatKeyShareDays.value) || 7;
    const { token, days } = await createEncryptedChatKeyShareToken({ apiKey, password, days: requestedDays });
    fields.chatKeyShareDays.value = String(days);
    fields.chatKeyShareOutput.value = token;
    fields.chatKeyShareOutput.hidden = false;
    await navigatorRef.clipboard?.writeText?.(token).catch(() => {});
    logLine("info", `encrypted API key share created / ${days} days`);
  }

  async function importEncryptedChatKeyShare(token) {
    const password = windowRef.prompt("Password for encrypted API key");
    const apiKey = await decryptEncryptedChatKeyShare(token, password);
    if (!apiKey) return;
    credentials.storeApiKey(apiKey);
    updateChatKeyButton();
    updateChatEnabledState();
    renderChatTranscript();
    onApiKeyChanged?.();
    logLine("info", "encrypted OpenAI API key imported");
  }

  return {
    chatDebugPromptEnabled,
    createEncryptedChatKeyShare,
    hasChatApiKey,
    importEncryptedChatKeyShare,
    saveChatApiKey,
    toggleChatApiKey,
    toggleChatDebugPrompt,
    updateChatDebugPromptButton,
    updateChatKeyButton,
  };
}
