import { createProjectImporter } from "./project-import.js?v=0.1.87-ui748";
import { createProjectController } from "./project-controller.js?v=0.1.87-ui748";
import { createRevisionDraftStore } from "./revision-drafts.js?v=0.1.87-ui748";
import { createProjectStore } from "./project-store.js?v=0.1.87-ui748";
import { createProjectDownloadService } from "./project-download-service.js?v=0.1.87-ui748";
import { createProjectRevisionService } from "./project-revision-service.js?v=0.1.87-ui748";
import { createCurrentRevisionSession } from "./current-revision-session.js?v=0.1.87-ui748";
import { createProjectActionsController } from "./project-actions-controller.js?v=0.1.87-ui748";
import { createProjectHistoryView } from "./project-history-view.js?v=0.1.87-ui748";
import { createProjectLibraryService } from "./project-library-service.js?v=0.1.87-ui748";
import { createExamplesProject, isExamplesProject } from "./example-projects.js?v=0.1.87-ui748";

export function createProjectShellRegistry({
  activeRevision,
  autoProjectName,
  buildRevision,
  codeHashFor,
  createProjectId,
  createRevisionId,
  documentRef,
  formatBytes,
  getChatMessages,
  getChatShellController,
  getCircuitShellController,
  getCircuitView,
  getCodeEditorShellController,
  getCommandConsoleService,
  getConsoleController,
  getCurrentProjectCircuit,
  getCurrentProjectDescription,
  getCurrentProjectDescriptionSource,
  getCurrentProjectId,
  getCurrentProjectSpecificationMode,
  getCurrentProjectSpecificationModeSource,
  getCurrentRevisionId,
  getCurrentSketchName,
  getCurrentSketchSaved,
  getCurrentSketchSource,
  getDeviceStateController,
  getLegacyProjectMigrationService,
  getProjectCache,
  getProjectDedupeService,
  getProjectSelectTimer,
  getProjectSchemaMigrationService,
  getProjectToolbarController,
  getRevisionNameDialog,
  getRevisionSelectTimer,
  getSpecificationEditorController,
  getStartupStepRunner,
  getStorageDiagnostics,
  getTransportClient,
  getWindow,
  hasCircuitChatLayout,
  legacySketchMigrationId,
  legacySketchMigrationVersion,
  localStorageRef,
  nextNamedRevisionName,
  nextRevisionName,
  normalizeChatMessages,
  normalizeCircuitLayout,
  normalizeProject,
  normalizeProjectName,
  normalizeProjectRecord,
  normalizeSketchName,
  normalizeSpecificationMode,
  projectCircuitForCurrentCode,
  projectFromCode,
  projectLimit,
  projectStoreName,
  projectWithRequiredRevision,
  readSpecificationMarkdown,
  revisionDraftVersion,
  revisionNameRoot,
  setChatMessages,
  setCircuitChatLayout,
  setCurrentProjectCircuit,
  setCurrentProjectDescription,
  setCurrentProjectDescriptionSource,
  setCurrentProjectId,
  setCurrentProjectSpecificationMode,
  setCurrentProjectSpecificationModeSource,
  setCurrentRevisionId,
  setCurrentSketchDirty,
  setCurrentSketchName,
  setCurrentSketchSaved,
  setCurrentSketchSource,
  setCurrentSketchVersionName,
  setSketchHistoryTitle,
  setProjectCache,
  setProjectSelectTimer,
  setRevisionSelectTimer,
  sketchDbName,
  sketchDbVersion,
  sketchStoreName,
  splitRevisionNumber,
  storage,
  timestampForFilename,
  URLRef,
} = {}) {
  let projectImporter = null;
  let projectController = null;
  let revisionDraftStore = null;
  let projectStore = null;
  let projectDownloadService = null;
  let projectRevisionService = null;
  let currentRevisionSession = null;
  let projectActionsController = null;
  let projectHistoryView = null;
  let projectLibraryService = null;

  function getProjectImporter() {
    if (projectImporter) return projectImporter;
    projectImporter = createProjectImporter({
      normalizeProject,
      normalizeSketchName,
      forkImportedProjectIfNeeded: (project) => getProjectLibraryService().forkImportedProjectIfNeeded(project),
      projectFromCode,
    });
    return projectImporter;
  }

  function getProjectController() {
    if (projectController) return projectController;
    projectController = createProjectController({
      parseDroppedProject: (text, file) => getProjectImporter().parseDroppedProject(text, file),
      activeRevision,
      getEditorValue: () => getCodeEditorShellController().getValue(),
      isSpecificationDirty: () => getCurrentProjectDescription() !== getCurrentProjectDescriptionSource()
        || getCurrentProjectSpecificationMode() !== getCurrentProjectSpecificationModeSource(),
      isCurrentSketchSaved: getCurrentSketchSaved,
      saveActiveRevisionFromEditor: (options) => getProjectRevisionService().saveActiveRevisionFromEditor(options),
      saveProject: (...args) => getProjectLibraryService().saveProject(...args),
      normalizeProjectRecord,
      getProjectById: (id) => getProjectLibraryService().getProjectById(id),
      storedRevisionDraftFor: (project, revision) => getRevisionDraftStore().storedRevisionFor(project, revision),
      revisionSession: {
        setActiveRevision: (project, revision) => {
          setCurrentProjectId(project.id);
          setCurrentRevisionId(revision.id);
          localStorageRef.setItem(storage.projectId, project.id);
        },
        showRevision: ({ project, savedRevision, visibleRevision, hasDraft }) => {
          setChatMessages(normalizeChatMessages(savedRevision.chat));
          setCircuitChatLayout(normalizeCircuitLayout(savedRevision.circuit));
          getCurrentRevisionSession().setCurrentSketchIdentity(savedRevision.name || "", savedRevision.code || "", project, savedRevision);
          getCodeEditorShellController().setValueRaw(visibleRevision.code || "", { persist: true });
          getSpecificationEditorController().setProjectSpecification(visibleRevision.specification || "", visibleRevision.specificationMode, { markSaved: !hasDraft });
          if (hasDraft) getCurrentRevisionSession().updateCurrentSketchDirty();
          getProjectToolbarController().renderProjectSelectors(getProjectCache(), {
            currentProjectId: getCurrentProjectId(),
            currentRevisionId: getCurrentRevisionId(),
          });
          getChatShellController().renderChatTranscript();
          getCircuitShellController().update(hasCircuitChatLayout() ? "project circuit + code inference" : "inferred from code");
        },
      },
      updateCircuitView: (status = "") => getCircuitShellController().update(status),
      hasCircuitChatLayout,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return projectController;
  }

  function getRevisionDraftStore() {
    if (revisionDraftStore) return revisionDraftStore;
    revisionDraftStore = createRevisionDraftStore({
      storageKey: storage.revisionDraft,
      schemaVersion: revisionDraftVersion,
      getState: () => ({
        projectId: getCurrentProjectId(),
        revisionId: getCurrentRevisionId(),
        code: getCodeEditorShellController().getValue(),
        specification: getCurrentProjectDescription(),
        specificationMode: getCurrentProjectSpecificationMode(),
      }),
      normalizeSpecificationMode,
    });
    return revisionDraftStore;
  }

  function getProjectStore() {
    if (projectStore) return projectStore;
    projectStore = createProjectStore({
      dbName: sketchDbName,
      dbVersion: sketchDbVersion,
      sketchStoreName,
      projectStoreName,
      projectFallbackKey: storage.projectFallback,
      projectLimit,
      normalizeProjectRecord,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return projectStore;
  }

  function getProjectDownloadService() {
    if (projectDownloadService) return projectDownloadService;
    projectDownloadService = createProjectDownloadService({
      getActiveProject: () => getProjectLibraryService().getActiveProject(),
      getEditorValue: () => getCodeEditorShellController().getValue(),
      getCurrentSketchName,
      getCurrentProjectDescription,
      getCurrentProjectSpecificationMode,
      getChatMessages,
      buildRevision,
      createProjectId,
      autoProjectName,
      normalizeProjectRecord,
      activeRevision,
      projectCircuitForCurrentCode,
      normalizeSketchName,
      timestampForFilename,
      documentRef,
      URLRef,
    });
    return projectDownloadService;
  }

  function getProjectRevisionService() {
    if (projectRevisionService) return projectRevisionService;
    projectRevisionService = createProjectRevisionService({
      storage,
      storageArea: localStorageRef,
      getCurrentProjectId,
      setCurrentProjectId,
      getCurrentRevisionId,
      getCurrentSketchName,
      getCurrentSketchSource,
      getCurrentProjectCircuit,
      getCurrentProjectDescription,
      getCurrentProjectSpecificationMode,
      getChatMessages,
      getClient: getTransportClient,
      getCircuitView,
      getEditorValue: () => getCodeEditorShellController().getValue(),
      readSpecificationMarkdown,
      getActiveProject: () => getProjectLibraryService().getActiveProject(),
      getProjectById: (id) => getProjectLibraryService().getProjectById(id),
      saveProject: (...args) => getProjectLibraryService().saveProject(...args),
      sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
      setCurrentSketchIdentity: (...args) => getCurrentRevisionSession().setCurrentSketchIdentity(...args),
      logLine: (level, message) => getConsoleController().logLine(level, message),
      activeRevision,
      autoProjectName,
      buildRevision,
      codeHashFor,
      createProjectId,
      nextNamedRevisionName,
      nextRevisionName,
      normalizeChatMessages,
      normalizeCircuitLayout,
      normalizeProjectName,
      normalizeProjectRecord,
      normalizeSketchName,
      normalizeSpecificationMode,
      isExampleProject: isExamplesProject,
    });
    return projectRevisionService;
  }

  function getCurrentRevisionSession() {
    if (currentRevisionSession) return currentRevisionSession;
    currentRevisionSession = createCurrentRevisionSession({
      getEditorValue: () => getCodeEditorShellController().getValue(),
      getCurrentSketchName,
      setCurrentSketchName,
      getCurrentSketchSource,
      setCurrentSketchSource,
      setCurrentSketchVersionName,
      getCurrentProjectDescription,
      setCurrentProjectDescription,
      getCurrentProjectDescriptionSource,
      setCurrentProjectDescriptionSource,
      getCurrentProjectSpecificationMode,
      setCurrentProjectSpecificationMode,
      getCurrentProjectSpecificationModeSource,
      setCurrentProjectSpecificationModeSource,
      setCurrentProjectCircuit,
      setCircuitChatLayout,
      setCurrentSketchDirty,
      setCurrentSketchSaved,
      setProjectSpecification: (text = "", mode = getCurrentProjectSpecificationMode(), options = {}) => getSpecificationEditorController().setProjectSpecification(text, mode, options),
      renderCurrentSketchLabel: setSketchHistoryTitle,
      nextRevisionName,
      normalizeCircuitLayout,
      normalizeSketchName,
      normalizeSpecificationMode,
    });
    return currentRevisionSession;
  }

  function getProjectActionsController() {
    if (projectActionsController) return projectActionsController;
    projectActionsController = createProjectActionsController({
      windowRef: getWindow(),
      promptProjectName: () => getWindow().prompt("Project name", ""),
      requestRevisionName: (defaultName = "Revision") => getRevisionNameDialog().requestName(defaultName),
      getProjectSelectTimer,
      setProjectSelectTimer,
      getRevisionSelectTimer,
      setRevisionSelectTimer,
      getProjectCache,
      getEditorValue: () => getCodeEditorShellController().getValue(),
      readProjects: () => getProjectLibraryService().readProjects(),
      getActiveProject: () => getProjectLibraryService().getActiveProject(),
      ensureProjectForWrite: (options) => getProjectRevisionService().ensureProjectForWrite(options),
      shelveEditorSketchIfNeeded: (options) => getProjectController().shelveEditorSketchIfNeeded(options),
      saveProject: (...args) => getProjectLibraryService().saveProject(...args),
      openRevision: (...args) => getProjectController().openProjectRevision(...args),
      renderProjectSelectors: (projects = getProjectCache()) => getProjectToolbarController().renderProjectSelectors(projects, {
        currentProjectId: getCurrentProjectId(),
        currentRevisionId: getCurrentRevisionId(),
      }),
      clearEditorError: () => getDeviceStateController().clearEditorError(),
      logLine: (level, message) => getConsoleController().logLine(level, message),
      activeRevision,
      autoProjectName,
      buildRevision,
      createProjectId,
      nextRevisionName,
      normalizeProjectName,
      normalizeProjectRecord,
    });
    return projectActionsController;
  }

  function getProjectHistoryView() {
    if (projectHistoryView) return projectHistoryView;
    projectHistoryView = createProjectHistoryView({
      storage,
      storageArea: localStorageRef,
      projectStoreName,
      sketchStoreName,
      legacySketchMigrationId,
      legacySketchMigrationVersion,
      readProjects: () => getProjectLibraryService().readProjects(),
      renderProjectSelectors: (projects = getProjectCache()) => getProjectToolbarController().renderProjectSelectors(projects, {
        currentProjectId: getCurrentProjectId(),
        currentRevisionId: getCurrentRevisionId(),
      }),
      getCurrentProjectId,
      getEditorValue: () => getCodeEditorShellController().getValue(),
      openRevision: (...args) => getProjectController().openProjectRevision(...args),
      activeRevision,
      storageDiagnostics: getStorageDiagnostics(),
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return projectHistoryView;
  }

  function getProjectLibraryService() {
    if (projectLibraryService) return projectLibraryService;
    projectLibraryService = createProjectLibraryService({
      storage,
      storageArea: localStorageRef,
      projectLimit,
      projectStore: getProjectStore(),
      getProjectCache,
      setProjectCache,
      getCurrentProjectId,
      runProjectStartupStep: (label, fn) => getStartupStepRunner().run(label, fn),
      migrateLegacySketchesToProjects: () => getLegacyProjectMigrationService().migrateLegacySketchesToProjects(),
      recoverMissingLegacySketches: () => getLegacyProjectMigrationService().recoverMissingLegacySketches(),
      recoverLegacySketchesWhenProjectListEmpty: () => getLegacyProjectMigrationService().recoverLegacySketchesWhenProjectListEmpty(),
      migrateProjectStorageSchema: () => getProjectSchemaMigrationService().migrateProjectStorageSchema(),
      mergeDuplicateBoardProjects: (projects = []) => getProjectDedupeService().mergeDuplicateBoardProjects(projects),
      projectWithRequiredRevision,
      createProjectId,
      createRevisionId,
      normalizeProjectName,
      normalizeProjectRecord,
      revisionNameRoot,
      splitRevisionNumber,
      examplesProject: createExamplesProject({ buildRevision, normalizeProjectRecord }),
      isExampleProject: isExamplesProject,
    });
    return projectLibraryService;
  }

  return {
    getCurrentRevisionSession,
    getProjectActionsController,
    getProjectController,
    getProjectDownloadService,
    getProjectHistoryView,
    getProjectImporter,
    getProjectLibraryService,
    getProjectRevisionService,
    getProjectStore,
    getRevisionDraftStore,
  };
}
