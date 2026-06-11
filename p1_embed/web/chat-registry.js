import { createChatSettings } from "./chat-settings.js?v=0.1.87-ui747";
import { createChatCredentials } from "./chat-credentials.js?v=0.1.87-ui747";
import { createChatCredentialActions } from "./chat-credential-actions.js?v=0.1.87-ui747";
import { createChatTranscript } from "./chat-transcript.js?v=0.1.87-ui747";
import { createChatWorkflowController } from "./chat-workflow-controller.js?v=0.1.87-ui747";
import { createChatCompletionService } from "./chat-completion-service.js?v=0.1.87-ui747";
import { createChatShellController } from "./chat-shell-controller.js?v=0.1.87-ui747";

export function createChatRegistry({
  activeRevision,
  buildRevision,
  buildSpecificationGeneratePrompt,
  builtInChatModelOptions,
  chatHardMaxOutputTokens,
  chatHistoryLimit,
  chatMinMaxOutputTokens,
  chatDefaultMaxOutputTokens,
  codeHashFor,
  createEncryptedChatKeyShareToken,
  cryptoAvailable,
  decryptEncryptedChatKeyShare,
  defaultChatModel,
  downloadText,
  fields,
  fetchRef,
  findGeneratedRevisionMatch,
  getChatBusy,
  getChatMessages,
  getCodeEditorShellController,
  getConsoleController,
  getConnectionUiStateController,
  getCurrentProjectDescription,
  getCurrentProjectId,
  getCurrentProjectSpecificationMode,
  getCurrentRevisionId,
  getCurrentSketchName,
  getLastError,
  getLastInfo,
  getLastStatus,
  getProjectCache,
  getProjectController,
  getProjectLibraryService,
  getProjectRevisionService,
  getScriptUploadService,
  getSpecificationEditorController,
  getUiActionRunner,
  getViewShellController,
  inferCircuitLayout,
  isEncryptedChatKeyShare,
  isGenericRevisionName,
  mergeGeneratedRevision,
  nextNamedRevisionName,
  nextRevisionName,
  normalizeChatMessages,
  normalizeCircuitLayout,
  normalizeProjectName,
  normalizeProjectRecord,
  normalizeSketchName,
  normalizeSpecificationMode,
  revisionEquivalent,
  setChatBusy,
  setChatMessages,
  setProjectDescription,
  setProjectSpecificationMode,
  setProjectSpecification,
  specificationModeLabel,
  specificationModePrompt,
  legacyStorage,
  storage,
  updateCircuitView,
  windowRef,
  navigatorRef,
} = {}) {
  let chatSettings = null;
  let chatCredentials = null;
  let chatCredentialActions = null;
  let chatTranscript = null;
  let chatWorkflowController = null;
  let chatCompletionService = null;
  let chatShellController = null;

  function getChatSettings() {
    if (chatSettings) return chatSettings;
    chatSettings = createChatSettings({
      storageKeys: {
        model: storage.chatModel,
        modelList: storage.chatModelList,
        maxOutputTokens: storage.chatMaxOutputTokens,
      },
      modelSelect: fields.chatModel,
      maxOutputTokensInput: fields.chatMaxOutputTokens,
      defaultModel: defaultChatModel,
      builtInModels: builtInChatModelOptions,
      defaultMaxOutputTokens: chatDefaultMaxOutputTokens,
      minMaxOutputTokens: chatMinMaxOutputTokens,
      hardMaxOutputTokens: chatHardMaxOutputTokens,
    });
    return chatSettings;
  }

  function getChatCredentials() {
    if (chatCredentials) return chatCredentials;
    chatCredentials = createChatCredentials({
      storageKeys: {
        apiKey: storage.chatApiKey,
        legacyApiKey: legacyStorage?.chatApiKey,
        debugPrompt: storage.chatDebugPrompt,
      },
      keyButton: fields.chatApiKey,
      keyInput: fields.chatApiKeyInput,
      keyShareOutput: fields.chatKeyShareOutput,
      debugPromptButton: fields.chatDebugPrompt,
    });
    return chatCredentials;
  }

  function getChatCredentialActions() {
    if (chatCredentialActions) return chatCredentialActions;
    chatCredentialActions = createChatCredentialActions({
      fields,
      windowRef,
      navigatorRef,
      credentials: getChatCredentials(),
      createEncryptedChatKeyShareToken,
      decryptEncryptedChatKeyShare,
      isEncryptedChatKeyShare,
      updateChatEnabledState: () => getChatShellController().updateChatEnabledState(),
      renderChatTranscript: () => getChatShellController().renderChatTranscript(),
      onApiKeyChanged: () => getViewShellController().refreshChatTabVisibility(),
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return chatCredentialActions;
  }

  function getChatTranscript() {
    if (chatTranscript) return chatTranscript;
    chatTranscript = createChatTranscript({
      transcript: fields.chatTranscript,
      hasApiKey: () => getChatShellController().hasChatApiKey(),
      messages: getChatMessages,
      onRunCode: (index) => getChatShellController().runChatCode(index),
    });
    return chatTranscript;
  }

  function getChatWorkflowController() {
    if (chatWorkflowController) return chatWorkflowController;
    chatWorkflowController = createChatWorkflowController({
      fields,
      getChatMessages,
      setChatMessages,
      getChatBusy,
      setChatBusy,
      getCurrentProjectDescription,
      getCurrentProjectSpecificationMode,
      hasChatApiKey: () => getChatShellController().hasChatApiKey(),
      isDeviceConnected: () => getConnectionUiStateController().isDeviceConnected(),
      readSpecificationMarkdown: () => getSpecificationEditorController().readMarkdown(),
      shelveEditorSketchIfNeeded: (options) => getProjectController().shelveEditorSketchIfNeeded(options),
      captureActiveRevisionContext: () => getProjectRevisionService().captureActiveRevisionContext(),
      isCurrentRevisionContext: (context = {}) => getProjectRevisionService().isCurrentRevisionContext(context),
      saveChatForRevisionContext: (context = {}, messages = []) => getProjectRevisionService().saveChatForRevisionContext(context, messages),
      saveRevisionFieldsForContext: (context = {}, fields = {}) => getProjectRevisionService().saveRevisionFieldsForContext(context, fields),
      revisionFieldsFromChatResult: (result = {}, messages = []) => getProjectRevisionService().revisionFieldsFromChatResult(result, messages),
      getProjectById: (id) => getProjectLibraryService().getProjectById(id),
      ensureProjectForWrite: (options) => getProjectRevisionService().ensureProjectForWrite(options),
      saveProject: (...args) => getProjectLibraryService().saveProject(...args),
      openRevision: (...args) => getProjectController().openProjectRevision(...args),
      uploadScriptCode: (code, options) => getScriptUploadService().uploadScriptCode(code, options),
      requestChatCompletion: (prompt, options = {}) => getChatCompletionService().requestChatCompletion(prompt, options),
      buildSpecificationGeneratePrompt: (specification) => getChatCompletionService().buildSpecificationGeneratePrompt(specification),
      runUiAction: (action, label = "busy") => getUiActionRunner().run(action, label),
      renderChatTranscript: () => getChatShellController().renderChatTranscript(),
      setProjectSpecification: (text = "", mode = getCurrentProjectSpecificationMode(), options = {}) => getSpecificationEditorController().setProjectSpecification(text, mode, options),
      updateChatEnabledState: () => getChatShellController().updateChatEnabledState(),
      updateCircuitView,
      logLine: (level, message) => getConsoleController().logLine(level, message),
      activeRevision,
      buildRevision,
      findGeneratedRevisionMatch: (project, revision, preferred = null) => findGeneratedRevisionMatch(project, revision, preferred, { revisionEquivalent }),
      mergeGeneratedRevision: (existing, incoming) => mergeGeneratedRevision(existing, incoming, {
        codeHashFor,
        normalizeCircuitLayout,
        normalizeSketchName,
      }),
      inferCircuitLayout,
      nextRevisionName,
      normalizeChatMessages,
      normalizeProjectRecord,
      normalizeSketchName,
      normalizeSpecificationMode,
    });
    return chatWorkflowController;
  }

  function getChatCompletionService() {
    if (chatCompletionService) return chatCompletionService;
    chatCompletionService = createChatCompletionService({
      fields,
      fetchRef,
      getApiKey: () => getChatCredentials().apiKey(),
      getProjectCache,
      getCurrentProjectId,
      getCurrentSketchName,
      getCurrentProjectDescription,
      getCurrentProjectSpecificationMode,
      getChatMessages,
      getEditorValue: () => getCodeEditorShellController().getValue(),
      getRecentLog: () => getConsoleController().recentFormatted(100),
      getLastError,
      getLastInfo,
      getLastStatus,
      chatMaxOutputTokens: () => getChatShellController().chatMaxOutputTokens(),
      chatDebugPromptEnabled: () => getChatShellController().chatDebugPromptEnabled(),
      activeRevision,
      isGenericRevisionName,
      nextNamedRevisionName,
      normalizeProjectName,
      normalizeSketchName,
      normalizeSpecificationMode,
      specificationModeLabel,
      specificationModePrompt,
      defaultModel: defaultChatModel,
      chatHistoryLimit,
      downloadText,
    });
    return chatCompletionService;
  }

  function getChatShellController() {
    if (chatShellController) return chatShellController;
    chatShellController = createChatShellController({
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
      saveProject: (...args) => getProjectLibraryService().saveProject(...args),
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return chatShellController;
  }

  return {
    getChatCompletionService,
    getChatCredentialActions,
    getChatCredentials,
    getChatSettings,
    getChatShellController,
    getChatTranscript,
    getChatWorkflowController,
  };
}
