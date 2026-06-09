import { createProjectRegistries } from "./app-project-registries.js?v=0.1.87-ui725";
import { createConnectionRegistries } from "./app-connection-registries.js?v=0.1.87-ui725";
import { createWorkspaceRegistries } from "./app-workspace-registries.js?v=0.1.87-ui725";
import { createRuntimeRegistries } from "./app-runtime-registries.js?v=0.1.87-ui725";
import { createRegistryContext } from "./app-registry-context.js?v=0.1.87-ui725";

export function createAppRegistries({
  chatState,
  connectionIntentWanted,
  connectionState,
  documentRef,
  fields,
  fetchRef,
  getAccessors,
  getCircuitView,
  localStorageRef,
  markConnectionAttemptFailed,
  markConnectionAttemptStarted,
  mqttVersion,
  narrowGenerativeQuery,
  navigatorRef,
  projectState,
  registryCache,
  requestAnimationFrameRef,
  setCircuitView,
  setConnectionIntentWanted,
  updateViewportHeight,
  URLRef,
  webVersion,
  windowRef,
} = {}) {
  const context = createRegistryContext({
    chatState,
    connectionState,
    documentRef,
    fields,
    fetchRef,
    getAccessors,
    getCircuitView,
    localStorageRef,
    navigatorRef,
    projectState,
    registryCache,
    requestAnimationFrameRef,
    setCircuitView,
    URLRef,
    windowRef,
  });
  const {
    getChatStateAdapter,
    getEditorFeatureRegistry,
    getProjectAppFeatureRegistry,
    getProjectDomainFeatureRegistry,
    getProjectMaintenanceAppFeatureRegistry,
    getProjectStateAdapter,
    getWorkspaceToolbarRegistry,
  } = createProjectRegistries({
    context,
  });
  const {
    getConnectionAppFeatureRegistry,
    getConnectionShellFeatureRegistry,
    getDeviceAppFeatureRegistry,
    getInfoAppFeatureRegistry,
    getInstallAppFeatureRegistry,
    getSettingsAppFeatureRegistry,
  } = createConnectionRegistries({
    context,
    connectionIntentWanted,
    getProjectDomainFeatureRegistry,
    markConnectionAttemptFailed,
    markConnectionAttemptStarted,
    setConnectionIntentWanted,
    webVersion,
  });
  const {
    getAppShellRegistry,
    getChatAppFeatureRegistry,
    getCircuitRegistry,
    getUiFeatureRegistry,
  } = createWorkspaceRegistries({
    context,
    getChatStateAdapter,
    getProjectDomainFeatureRegistry,
    getProjectStateAdapter,
    narrowGenerativeQuery,
  });
  const {
    getAppRuntimeAppFeatureRegistry,
    getTransferAppFeatureRegistry,
  } = createRuntimeRegistries({
    context,
    connectionIntentWanted,
    getEditorFeatureRegistry,
    getProjectDomainFeatureRegistry,
    mqttVersion,
    updateViewportHeight,
    webVersion,
  });

  return {
    getAppRuntimeAppFeatureRegistry,
    getAppShellRegistry,
    getChatAppFeatureRegistry,
    getChatStateAdapter,
    getCircuitRegistry,
    getConnectionAppFeatureRegistry,
    getConnectionShellFeatureRegistry,
    getDeviceAppFeatureRegistry,
    getEditorFeatureRegistry,
    getInfoAppFeatureRegistry,
    getInstallAppFeatureRegistry,
    getProjectAppFeatureRegistry,
    getProjectDomainFeatureRegistry,
    getProjectMaintenanceAppFeatureRegistry,
    getProjectStateAdapter,
    getSettingsAppFeatureRegistry,
    getTransferAppFeatureRegistry,
    getUiFeatureRegistry,
    getWorkspaceToolbarRegistry,
  };
}
