import { inferCircuitLayout, initCircuitView, normalizeCircuitLayout } from "./circuit.js?v=0.1.87-ui554";
import { createAppShellRegistry } from "./app-shell-registry.js?v=0.1.87-ui749";
import { createUiFeatureRegistry } from "./ui-feature-registry.js?v=0.1.87-ui749";
import { createCircuitRegistry } from "./circuit-registry.js?v=0.1.87-ui749";
import {
  normalizeSpecificationMode,
  specificationModeLabel,
  specificationModePrompt,
} from "./specification-format.js?v=0.1.87-ui749";
import { createChatAppFeatureRegistry } from "./chat-app-feature-registry.js?v=0.1.87-ui749";
import { downloadTextFile, timestampForFilename } from "./download-utils.js?v=0.1.87-ui749";
import {
  createEncryptedChatKeyShareToken,
  cryptoAvailable,
  decryptEncryptedChatKeyShare,
  isEncryptedChatKeyShare,
} from "./chat-key-share.js?v=0.1.87-ui749";
import { isMqttKind } from "./connection-kinds.js?v=0.1.87-ui749";
import { normalizePeerId } from "./connection-address-utils.js?v=0.1.87-ui749";
import {
  findGeneratedRevisionMatch as findGeneratedRevisionMatchFor,
  mergeGeneratedRevision as mergeGeneratedRevisionFor,
  normalizeChatMessages,
} from "./revision-chat-model.js?v=0.1.87-ui749";
import { createChatAppDependencies } from "./chat-app-dependencies.js?v=0.1.87-ui749";
import { createAppShellDependencies } from "./app-shell-dependencies.js?v=0.1.87-ui749";
import { createUiFeatureDependencies } from "./ui-feature-dependencies.js?v=0.1.87-ui749";
import { createCircuitDependencies } from "./circuit-dependencies.js?v=0.1.87-ui749";
import {
  CHAT_DEFAULT_MAX_OUTPUT_TOKENS,
  CHAT_HARD_MAX_OUTPUT_TOKENS,
  CHAT_MIN_MAX_OUTPUT_TOKENS,
  builtInChatModelOptions,
  chatHistoryLimit,
  defaultChatModel,
  legacyStorage,
  storage,
} from "./app-config.js?v=0.1.87-ui749";

export function createWorkspaceRegistries({
  context,
  getChatStateAdapter,
  getProjectDomainFeatureRegistry,
  getProjectStateAdapter,
  narrowGenerativeQuery,
} = {}) {
  const {
    accessor,
    connectionState,
    fields,
    fetchRef,
    getCircuitView,
    navigatorRef,
    projectState,
    registryCache,
    requestAnimationFrameRef,
    setCircuitView,
    windowRef,
  } = context;

  function getUiFeatureRegistry() {
    return registryCache.get("uiFeatureRegistry", () => createUiFeatureRegistry(createUiFeatureDependencies({
      fields,
      getChatShellController: accessor("getChatShellController"),
      getCircuitShellController: accessor("getCircuitShellController"),
      getCircuitWorkspaceController: accessor("getCircuitWorkspaceController"),
      getCircuitView,
      getCodeEditorShellController: accessor("getCodeEditorShellController"),
      getConnectionUiStateController: accessor("getConnectionUiStateController"),
      getConsolePreferences: accessor("getConsolePreferences"),
      getCurrentRevisionSession: accessor("getCurrentRevisionSession"),
      getFirmwareUpdateController: accessor("getFirmwareUpdateController"),
      getGenerativePanelController: accessor("getGenerativePanelController"),
      getGuinoController: accessor("getGuinoController"),
      getLowerPanelController: accessor("getLowerPanelController"),
      getMqttSettingsPanelController: accessor("getMqttSettingsPanelController"),
      getMqttSigninDialogController: accessor("getMqttSigninDialogController"),
      getOnlineAuthListRenderer: accessor("getOnlineAuthListRenderer"),
      getProjectActionsController: accessor("getProjectActionsController"),
      getProjectDomainFeatureRegistry,
      getSettingsTabs: accessor("getSettingsTabs"),
      getViewRouting: accessor("getViewRouting"),
      isMqttKind,
      normalizePeerId,
      requestAnimationFrameRef,
      projectSelectControls: accessor("projectSelectControls"),
      revisionSelectControls: accessor("revisionSelectControls"),
      state: connectionState,
      workspaceToolbars: accessor("workspaceToolbars"),
    })));
  }

  function getAppShellRegistry() {
    return registryCache.get("appShellRegistry", () => createAppShellRegistry(createAppShellDependencies({
      fields,
      getChatShellController: accessor("getChatShellController"),
      getConsoleController: accessor("getConsoleController"),
      getFirmwareUpdateController: accessor("getFirmwareUpdateController"),
      getProjectStore: accessor("getProjectStore"),
      narrowGenerativeQuery,
      storage,
    })));
  }

  function getCircuitRegistry() {
    return registryCache.get("circuitRegistry", () => createCircuitRegistry(createCircuitDependencies({
      fields,
      getCodeEditorShellController: accessor("getCodeEditorShellController"),
      getConsoleController: accessor("getConsoleController"),
      getProjectDomainFeatureRegistry,
      inferCircuitLayout,
      initCircuitView,
      projectState,
      setCircuitView,
      getCircuitView,
      storage,
      timestampForFilename,
      windowRef,
    })));
  }

  function getChatAppFeatureRegistry() {
    return registryCache.get("chatAppFeatureRegistry", () => createChatAppFeatureRegistry(createChatAppDependencies({
      builtInChatModelOptions,
      chatDefaultMaxOutputTokens: CHAT_DEFAULT_MAX_OUTPUT_TOKENS,
      chatHardMaxOutputTokens: CHAT_HARD_MAX_OUTPUT_TOKENS,
      chatHistoryLimit,
      chatMinMaxOutputTokens: CHAT_MIN_MAX_OUTPUT_TOKENS,
      createEncryptedChatKeyShareToken,
      cryptoAvailable,
      decryptEncryptedChatKeyShare,
      defaultChatModel,
      downloadText: downloadTextFile,
      fields,
      fetchRef,
      findGeneratedRevisionMatch: findGeneratedRevisionMatchFor,
      getChatStateAdapter,
      getCodeEditorShellController: accessor("getCodeEditorShellController"),
      getConsoleController: accessor("getConsoleController"),
      getConnectionUiStateController: accessor("getConnectionUiStateController"),
      getCircuitShellController: accessor("getCircuitShellController"),
      getProjectController: accessor("getProjectController"),
      getProjectDomainFeatureRegistry,
      getProjectLibraryService: accessor("getProjectLibraryService"),
      getProjectRevisionService: accessor("getProjectRevisionService"),
      getProjectStateAdapter,
      getScriptUploadService: accessor("getScriptUploadService"),
      getSpecificationEditorController: accessor("getSpecificationEditorController"),
      getUiActionRunner: accessor("getUiActionRunner"),
      getViewShellController: accessor("getViewShellController"),
      inferCircuitLayout,
      isEncryptedChatKeyShare,
      mergeGeneratedRevision: mergeGeneratedRevisionFor,
      normalizeChatMessages,
      normalizeCircuitLayout,
      normalizeSpecificationMode,
      navigatorRef,
      specificationModeLabel,
      specificationModePrompt,
      state: connectionState,
      legacyStorage,
      storage,
      windowRef,
    })));
  }

  return {
    getAppShellRegistry,
    getChatAppFeatureRegistry,
    getCircuitRegistry,
    getUiFeatureRegistry,
  };
}
