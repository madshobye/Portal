import { inferCircuitLayout, normalizeCircuitLayout } from "./circuit.js?v=0.1.87-ui554";
import { createProjectDomainFeatureRegistry } from "./project-domain-feature-registry.js?v=0.1.87-ui747";
import { createEditorFeatureRegistry } from "./editor-feature-registry.js?v=0.1.87-ui747";
import { createProjectAppFeatureRegistry } from "./project-app-feature-registry.js?v=0.1.87-ui747";
import { createProjectStateAdapter } from "./project-state-adapter.js?v=0.1.87-ui747";
import { createChatStateAdapter } from "./chat-state-adapter.js?v=0.1.87-ui747";
import { createWorkspaceToolbarRegistry } from "./workspace-toolbar-registry.js?v=0.1.87-ui747";
import { normalizeSpecificationMode } from "./specification-format.js?v=0.1.87-ui747";
import { fnv1aHex } from "./script-chunking.js?v=0.1.87-ui747";
import { normalizeChatMessages } from "./revision-chat-model.js?v=0.1.87-ui747";
import { createProjectAppDependencies } from "./project-app-dependencies.js?v=0.1.87-ui747";
import { createEditorFeatureDependencies } from "./editor-feature-dependencies.js?v=0.1.87-ui747";
import { createProjectDomainDependencies } from "./project-domain-dependencies.js?v=0.1.87-ui747";
import { createProjectMaintenanceAppFeatureRegistry } from "./project-maintenance-app-feature-registry.js?v=0.1.87-ui747";
import { createProjectMaintenanceAppDependencies } from "./project-maintenance-app-dependencies.js?v=0.1.87-ui747";
import {
  legacySketchMigrationId,
  legacySketchMigrationVersion,
  projectLimit,
  projectSchemaMigrationVersion,
  projectStoreName,
  revisionDraftVersion,
  sketchDbName,
  sketchDbVersion,
  sketchStoreName,
  storage,
} from "./app-config.js?v=0.1.87-ui747";

export function createProjectRegistries({
  context,
} = {}) {
  const {
    accessor,
    chatState,
    connectionState,
    documentRef,
    fields,
    getAccessors,
    getCircuitView,
    localStorageRef,
    projectState,
    registryCache,
    URLRef,
    windowRef,
  } = context;

  function getEditorFeatureRegistry() {
    return registryCache.get("editorFeatureRegistry", () => createEditorFeatureRegistry(createEditorFeatureDependencies({
      documentRef,
      fields,
      getCircuitShellController: accessor("getCircuitShellController"),
      getConnectionUiStateController: accessor("getConnectionUiStateController"),
      getConsoleController: accessor("getConsoleController"),
      getCurrentRevisionSession: accessor("getCurrentRevisionSession"),
      getProjectController: accessor("getProjectController"),
      getRevisionDraftStore: accessor("getRevisionDraftStore"),
      normalizeSpecificationMode,
      projectState,
      storage,
    })));
  }

  function getWorkspaceToolbarRegistry() {
    return registryCache.get("workspaceToolbarRegistry", () => createWorkspaceToolbarRegistry(fields));
  }

  function getProjectDomainFeatureRegistry() {
    return registryCache.get("projectDomainFeatureRegistry", () => createProjectDomainFeatureRegistry(createProjectDomainDependencies({
      normalizeChatMessages,
      normalizeCircuitLayout,
      inferCircuitLayout,
      normalizeSpecificationMode,
      fnv1aHex,
      getProjectRevisionService: accessor("getProjectRevisionService"),
      legacySketchMigrationId,
      legacySketchMigrationVersion,
      projectState,
      projectStoreName,
    })));
  }

  function getProjectStateAdapter() {
    return registryCache.get("projectStateAdapter", () => createProjectStateAdapter({
      state: projectState,
      setSketchHistoryTitle: (title) => {
        fields.sketchHistory.title = title;
      },
    }));
  }

  function getChatStateAdapter() {
    return registryCache.get("chatStateAdapter", () => createChatStateAdapter({
      state: chatState,
      projectStateAdapter: getProjectStateAdapter(),
      setProjectSpecification: (text = "", mode = projectState.currentProjectSpecificationMode, options = {}) => {
        getAccessors().getSpecificationEditorController().setProjectSpecification(text, mode, options);
      },
    }));
  }

  function getProjectAppFeatureRegistry() {
    return registryCache.get("projectAppFeatureRegistry", () => createProjectAppFeatureRegistry(createProjectAppDependencies({
      documentRef,
      getChatShellController: accessor("getChatShellController"),
      getCircuitShellController: accessor("getCircuitShellController"),
      getCircuitView,
      getCodeEditorShellController: accessor("getCodeEditorShellController"),
      getCommandConsoleService: accessor("getCommandConsoleService"),
      getConsoleController: accessor("getConsoleController"),
      getDeviceStateController: accessor("getDeviceStateController"),
      getLegacyProjectMigrationService: accessor("getLegacyProjectMigrationService"),
      getProjectDedupeService: accessor("getProjectDedupeService"),
      getProjectDomainFeatureRegistry,
      getProjectRevisionService: accessor("getProjectRevisionService"),
      getProjectSchemaMigrationService: accessor("getProjectSchemaMigrationService"),
      getProjectStateAdapter,
      getProjectToolbarController: accessor("getProjectToolbarController"),
      getRevisionNameDialog: accessor("getRevisionNameDialog"),
      getSpecificationEditorController: accessor("getSpecificationEditorController"),
      getStartupStepRunner: accessor("getStartupStepRunner"),
      getStorageDiagnostics: accessor("getStorageDiagnostics"),
      legacySketchMigrationId,
      legacySketchMigrationVersion,
      localStorageRef,
      normalizeChatMessages,
      normalizeCircuitLayout,
      normalizeSpecificationMode,
      projectLimit,
      projectStoreName,
      revisionDraftVersion,
      sketchDbName,
      sketchDbVersion,
      sketchStoreName,
      state: connectionState,
      storage,
      URLRef,
      windowRef,
    })));
  }

  function getProjectMaintenanceAppFeatureRegistry() {
    return registryCache.get("projectMaintenanceAppFeatureRegistry", () => createProjectMaintenanceAppFeatureRegistry(createProjectMaintenanceAppDependencies({
      getConsoleController: accessor("getConsoleController"),
      getProjectDomainFeatureRegistry,
      getProjectLibraryService: accessor("getProjectLibraryService"),
      getProjectStore: accessor("getProjectStore"),
      localStorageRef,
      projectLimit,
      projectSchemaMigrationVersion,
      projectStoreName,
      projectState,
      storage,
    })));
  }

  return {
    getChatStateAdapter,
    getEditorFeatureRegistry,
    getProjectAppFeatureRegistry,
    getProjectDomainFeatureRegistry,
    getProjectMaintenanceAppFeatureRegistry,
    getProjectStateAdapter,
    getWorkspaceToolbarRegistry,
  };
}
