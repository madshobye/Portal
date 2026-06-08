export function createChatShellController({
  fields,
  fetchRef,
  cryptoAvailable,
  getChatSettings,
  getChatCredentials,
  getChatCredentialActions,
  getChatTranscript,
  getChatWorkflowController,
  getChatMessages,
  setChatMessages,
  getChatBusy,
  setProjectDescription,
  setProjectSpecificationMode,
  getCurrentProjectDescription,
  setProjectSpecification,
  normalizeChatMessages,
  getProjectCache,
  getCurrentProjectId,
  getCurrentRevisionId,
  saveProject,
  logLine,
} = {}) {
  function initChat() {
    renderChatModelOptions();
    getChatSettings().restoreSelectedModel();
    getChatSettings().restoreMaxOutputTokens();
    setProjectDescription("");
    setProjectSpecificationMode("middle");
    setProjectSpecification("", "middle");
    setChatMessages(readChatHistory());
    renderChatTranscript();
    updateChatKeyButton();
    updateChatDebugPromptButton();
    updateChatEnabledState();
  }

  function chatModelOptions() {
    return getChatSettings().modelOptions();
  }

  function renderChatModelOptions() {
    getChatSettings().renderModelOptions();
  }

  function cleanChatModelList(models = []) {
    return getChatSettings().cleanModelList(models);
  }

  async function refreshChatModels() {
    const apiKey = getChatCredentials().apiKey();
    if (!apiKey) {
      logLine("warn", "store an OpenAI API key before refreshing models");
      updateChatEnabledState();
      return;
    }
    const response = await fetchRef("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `Model refresh failed (${response.status})`);
    }
    const models = cleanChatModelList(data.data || []);
    if (!models.length) throw new Error("No compatible GPT models found");
    getChatSettings().storeModelList(models);
    renderChatModelOptions();
    getChatSettings().ensureSelectedModelInList(models);
    logLine("info", `model list refreshed / ${models.length} models`);
  }

  function chatMaxOutputTokens() {
    return getChatSettings().maxOutputTokens();
  }

  function clearChat() {
    setChatMessages([]);
    const project = getProjectCache().find((item) => item.id === getCurrentProjectId());
    if (project) {
      const revision = project.revisions.find((item) => item.id === getCurrentRevisionId());
      if (!revision) {
        logLine("error", "chat not cleared: active revision was not found");
        return;
      }
      revision.chat = [];
      project.chat = [];
      void saveProject(project);
    } else {
      logLine("warn", "chat not cleared: no active revision");
    }
    renderChatTranscript();
    updateChatEnabledState();
  }

  function hasChatApiKey() {
    return getChatCredentialActions().hasChatApiKey();
  }

  function chatDebugPromptEnabled() {
    return getChatCredentialActions().chatDebugPromptEnabled();
  }

  function toggleChatDebugPrompt() {
    getChatCredentialActions().toggleChatDebugPrompt();
  }

  function updateChatDebugPromptButton() {
    getChatCredentialActions().updateChatDebugPromptButton();
  }

  function updateChatKeyButton() {
    getChatCredentialActions().updateChatKeyButton();
  }

  function updateChatEnabledState() {
    const hasKey = hasChatApiKey();
    const chatBusy = getChatBusy();
    fields.chatForm.classList.toggle("is-hidden", !hasKey);
    fields.chatInput.disabled = !hasKey || chatBusy;
    fields.chatSend.disabled = !hasKey || chatBusy || !fields.chatInput.value.trim();
    fields.specificationGenerate.disabled = !hasKey || chatBusy || !getCurrentProjectDescription().trim();
    if (fields.chatModel) fields.chatModel.disabled = chatBusy;
    if (fields.chatModelsRefresh) fields.chatModelsRefresh.disabled = chatBusy || !hasKey;
    if (fields.chatMaxOutputTokens) fields.chatMaxOutputTokens.disabled = chatBusy;
    if (fields.chatApiKey) fields.chatApiKey.disabled = chatBusy || !hasKey;
    if (fields.chatApiKeySave) fields.chatApiKeySave.disabled = chatBusy;
    if (fields.chatKeyShare) fields.chatKeyShare.disabled = chatBusy || !hasKey || !cryptoAvailable();
    if (fields.chatDebugPrompt) fields.chatDebugPrompt.disabled = chatBusy;
    fields.chatClear.disabled = chatBusy || getChatMessages().length === 0;
  }

  function toggleChatApiKey() {
    getChatCredentialActions().toggleChatApiKey();
  }

  function saveChatApiKey() {
    getChatCredentialActions().saveChatApiKey();
  }

  async function createEncryptedChatKeyShare() {
    await getChatCredentialActions().createEncryptedChatKeyShare();
  }

  async function importEncryptedChatKeyShare(token) {
    await getChatCredentialActions().importEncryptedChatKeyShare(token);
  }

  function renderChatTranscript() {
    getChatTranscript().render();
  }

  function readChatHistory() {
    const project = getProjectCache().find((item) => item.id === getCurrentProjectId());
    const revision = project?.revisions?.find((item) => item.id === getCurrentRevisionId());
    return normalizeChatMessages(revision?.chat);
  }

  async function runChatCode(index) {
    await getChatWorkflowController().runChatCode(index);
  }

  async function replaceEditorFromChat(code, message, name = "", layout = null, specification = "", specificationMode = "", {
    targetContext = null,
  } = {}) {
    return await getChatWorkflowController().replaceEditorFromChat(code, message, name, layout, specification, specificationMode, { targetContext });
  }

  async function sendChatPrompt() {
    await getChatWorkflowController().sendChatPrompt();
  }

  async function generateCodeFromSpecification() {
    await getChatWorkflowController().generateCodeFromSpecification();
  }

  return {
    chatDebugPromptEnabled,
    chatMaxOutputTokens,
    chatModelOptions,
    cleanChatModelList,
    clearChat,
    createEncryptedChatKeyShare,
    generateCodeFromSpecification,
    hasChatApiKey,
    importEncryptedChatKeyShare,
    initChat,
    refreshChatModels,
    renderChatModelOptions,
    renderChatTranscript,
    replaceEditorFromChat,
    runChatCode,
    saveChatApiKey,
    sendChatPrompt,
    toggleChatApiKey,
    toggleChatDebugPrompt,
    updateChatDebugPromptButton,
    updateChatEnabledState,
    updateChatKeyButton,
  };
}
