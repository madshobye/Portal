import { createStorageDiagnostics } from "./storage-diagnostics.js?v=0.1.87-ui723";
import { createStartupStepRunner } from "./startup-steps.js?v=0.1.87-ui723";
import { createConnectionIntentStore } from "./connection-intent.js?v=0.1.87-ui723";
import { createConsolePreferences } from "./console-preferences.js?v=0.1.87-ui723";
import { createViewRouting } from "./view-routing.js?v=0.1.87-ui723";
import { createLowerPanelController } from "./lower-panel-controller.js?v=0.1.87-ui723";
import { createSettingsTabs } from "./settings-tabs.js?v=0.1.87-ui723";
import { createGenerativePanelController } from "./generative-panel-controller.js?v=0.1.87-ui723";

export function createAppShellRegistry({
  fields,
  getChatShellController,
  getConsoleController,
  getFirmwareUpdateController,
  getProjectStore,
  narrowGenerativeQuery,
  storage,
} = {}) {
  let storageDiagnostics = null;
  let startupStepRunner = null;
  let connectionIntentStore = null;
  let consolePreferences = null;
  let viewRouting = null;
  let lowerPanelController = null;
  let settingsTabs = null;
  let generativePanelController = null;

  function getStorageDiagnostics() {
    if (storageDiagnostics) return storageDiagnostics;
    storageDiagnostics = createStorageDiagnostics({
      storeCount: (storeName) => getProjectStore().storeCount(storeName),
    });
    return storageDiagnostics;
  }

  function getStartupStepRunner() {
    if (startupStepRunner) return startupStepRunner;
    startupStepRunner = createStartupStepRunner({
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return startupStepRunner;
  }

  function getConnectionIntentStore() {
    if (connectionIntentStore) return connectionIntentStore;
    connectionIntentStore = createConnectionIntentStore({
      intentKey: storage.connectionIntent,
      reconnectKey: storage.reconnectOnLoad,
    });
    return connectionIntentStore;
  }

  function getConsolePreferences() {
    if (consolePreferences) return consolePreferences;
    consolePreferences = createConsolePreferences({
      logLevelKey: storage.logLevel,
      timestampsKey: storage.consoleTimestamps,
      timestampsButton: fields.consoleTimestamps,
    });
    return consolePreferences;
  }

  function getViewRouting() {
    if (viewRouting) return viewRouting;
    viewRouting = createViewRouting({
      activeViewKey: storage.activeTab,
      defaultView: "chat",
    });
    return viewRouting;
  }

  function getLowerPanelController() {
    if (lowerPanelController) return lowerPanelController;
    lowerPanelController = createLowerPanelController({
      tabs: fields.lowerTabs,
      panels: fields.lowerPanels,
      consoleActions: fields.consoleActions,
    });
    return lowerPanelController;
  }

  function getSettingsTabs() {
    if (settingsTabs) return settingsTabs;
    settingsTabs = createSettingsTabs({
      tabs: fields.settingsTabs,
      panels: fields.settingsPanels,
      defaultTab: "general",
      onFirmwareTab: () => {
        getFirmwareUpdateController().refreshFirmwareUpdateState({ quiet: true }).catch((error) => {
          getFirmwareUpdateController().firmwareLog(`refresh: ${error.message || error}`);
          getFirmwareUpdateController().renderFirmwareUpdatePanel();
        });
      },
    });
    return settingsTabs;
  }

  function getGenerativePanelController() {
    if (generativePanelController) return generativePanelController;
    generativePanelController = createGenerativePanelController({
      chatView: fields.views.chat,
      tabs: fields.generativeTabs,
      panels: fields.generativePanels,
      chatClearButton: fields.chatClear,
      narrowQuery: narrowGenerativeQuery,
      onChatVisible: () => getChatShellController().renderChatTranscript(),
    });
    return generativePanelController;
  }

  return {
    getConnectionIntentStore,
    getConsolePreferences,
    getGenerativePanelController,
    getLowerPanelController,
    getSettingsTabs,
    getStartupStepRunner,
    getStorageDiagnostics,
    getViewRouting,
  };
}
