import { createLegacyProjectMigrationService } from "./legacy-project-migration-service.js?v=0.1.87-ui749";
import { createProjectSchemaMigrationService } from "./project-schema-migration-service.js?v=0.1.87-ui749";
import { createProjectDedupeService } from "./project-dedupe-service.js?v=0.1.87-ui749";

export function createProjectMaintenanceRegistry({
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
  let legacyProjectMigrationService = null;
  let projectSchemaMigrationService = null;
  let projectDedupeService = null;

  function getLegacyProjectMigrationService() {
    if (legacyProjectMigrationService) return legacyProjectMigrationService;
    legacyProjectMigrationService = createLegacyProjectMigrationService({
      storage,
      storageArea: localStorageRef,
      projectLimit,
      projectStore: getProjectStore(),
      readProjectsFallback,
      writeProjectsFallbackBestEffort,
      saveProject,
      setProjectCache,
      logLine,
      createProjectId,
      normalizeProjectName,
      normalizeProjectRecord,
      projectWithRequiredRevision,
      revisionNameRoot,
      groupLegacySketchEntries,
      legacyEntriesToRevisions,
      legacySketchConverted,
      legacySketchConvertedCopy,
      legacySketchStoredCopy,
      legacySketchWithSource,
    });
    return legacyProjectMigrationService;
  }

  function getProjectSchemaMigrationService() {
    if (projectSchemaMigrationService) return projectSchemaMigrationService;
    projectSchemaMigrationService = createProjectSchemaMigrationService({
      storage,
      storageArea: localStorageRef,
      projectStoreName,
      projectLimit,
      migrationVersion: projectSchemaMigrationVersion,
      projectStore: getProjectStore(),
      readProjectsFallback,
      writeProjectsFallbackBestEffort,
      migrateProjectRecordSchema,
      setProjectCache,
    });
    return projectSchemaMigrationService;
  }

  function getProjectDedupeService() {
    if (projectDedupeService) return projectDedupeService;
    projectDedupeService = createProjectDedupeService({
      projectLimit,
      projectStore: getProjectStore(),
      readActiveProjectId,
      writeActiveProjectId,
      writeProjectsFallbackBestEffort,
      logLine,
      normalizeProjectName,
      normalizeProjectRecord,
      revisionMergeKey,
    });
    return projectDedupeService;
  }

  return {
    getLegacyProjectMigrationService,
    getProjectDedupeService,
    getProjectSchemaMigrationService,
  };
}
