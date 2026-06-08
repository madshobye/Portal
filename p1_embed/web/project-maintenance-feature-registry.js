import { createProjectMaintenanceRegistry } from "./project-maintenance-registry.js?v=0.1.87-ui720";

export function createProjectMaintenanceFeatureRegistry({
  createProjectId,
  groupLegacySketchEntries,
  legacyEntriesToRevisions,
  legacySketchConverted,
  legacySketchConvertedCopy,
  legacySketchStoredCopy,
  legacySketchWithSource,
  localStorageRef,
  logLine,
  migrateProjectRecordSchema,
  normalizeProjectName,
  normalizeProjectRecord,
  projectLimit,
  projectSchemaMigrationVersion,
  projectStoreName,
  projectWithRequiredRevision,
  readActiveProjectId,
  readProjectsFallback,
  revisionMergeKey,
  revisionNameRoot,
  saveProject,
  setProjectCache,
  storage,
  writeActiveProjectId,
  writeProjectsFallbackBestEffort,
  getProjectStore,
} = {}) {
  let projectMaintenanceRegistry = null;

  function getProjectMaintenanceRegistry() {
    if (projectMaintenanceRegistry) return projectMaintenanceRegistry;
    projectMaintenanceRegistry = createProjectMaintenanceRegistry({
      createProjectId,
      groupLegacySketchEntries,
      legacyEntriesToRevisions,
      legacySketchConverted,
      legacySketchConvertedCopy,
      legacySketchStoredCopy,
      legacySketchWithSource,
      localStorageRef,
      logLine,
      migrateProjectRecordSchema,
      normalizeProjectName,
      normalizeProjectRecord,
      projectLimit,
      projectSchemaMigrationVersion,
      projectStoreName,
      projectWithRequiredRevision,
      readActiveProjectId,
      readProjectsFallback,
      revisionMergeKey,
      revisionNameRoot,
      saveProject,
      setProjectCache,
      storage,
      writeActiveProjectId,
      writeProjectsFallbackBestEffort,
      getProjectStore,
    });
    return projectMaintenanceRegistry;
  }

  return {
    getLegacyProjectMigrationService: () => getProjectMaintenanceRegistry().getLegacyProjectMigrationService(),
    getProjectDedupeService: () => getProjectMaintenanceRegistry().getProjectDedupeService(),
    getProjectMaintenanceRegistry,
    getProjectSchemaMigrationService: () => getProjectMaintenanceRegistry().getProjectSchemaMigrationService(),
  };
}
