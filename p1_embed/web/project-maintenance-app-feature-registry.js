import { createProjectMaintenanceFeatureRegistry } from "./project-maintenance-feature-registry.js?v=0.1.87-ui745";

export function createProjectMaintenanceAppFeatureRegistry(options = {}) {
  let projectMaintenanceFeatureRegistry = null;

  function getProjectMaintenanceFeatureRegistry() {
    if (projectMaintenanceFeatureRegistry) return projectMaintenanceFeatureRegistry;
    projectMaintenanceFeatureRegistry = createProjectMaintenanceFeatureRegistry(options);
    return projectMaintenanceFeatureRegistry;
  }

  return {
    getLegacyProjectMigrationService: () => getProjectMaintenanceFeatureRegistry().getLegacyProjectMigrationService(),
    getProjectDedupeService: () => getProjectMaintenanceFeatureRegistry().getProjectDedupeService(),
    getProjectMaintenanceFeatureRegistry,
    getProjectMaintenanceRegistry: () => getProjectMaintenanceFeatureRegistry().getProjectMaintenanceRegistry(),
    getProjectSchemaMigrationService: () => getProjectMaintenanceFeatureRegistry().getProjectSchemaMigrationService(),
  };
}
