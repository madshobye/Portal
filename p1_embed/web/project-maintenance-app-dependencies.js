export function createProjectMaintenanceAppDependencies({
  getConsoleController,
  getProjectDomainFeatureRegistry,
  getProjectLibraryService,
  getProjectStore,
  localStorageRef,
  projectLimit,
  projectSchemaMigrationVersion,
  projectStoreName,
  projectState,
  storage,
} = {}) {
  return {
    ...getProjectDomainFeatureRegistry().projectMaintenanceFeatureHelpers(),
    localStorageRef,
    logLine: (level, message) => getConsoleController().logLine(level, message),
    projectLimit,
    projectSchemaMigrationVersion,
    projectStoreName,
    readActiveProjectId: () => localStorageRef.getItem(storage.projectId) || "",
    readProjectsFallback: () => getProjectLibraryService().readProjectsFallback(),
    saveProject: (...args) => getProjectLibraryService().saveProject(...args),
    setProjectCache: (projects) => {
      projectState.projectCache = projects;
    },
    storage,
    writeActiveProjectId: (id) => localStorageRef.setItem(storage.projectId, id),
    writeProjectsFallbackBestEffort: (projects = []) => getProjectLibraryService().writeProjectsFallbackBestEffort(projects),
    getProjectStore,
  };
}
