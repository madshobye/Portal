import { createProjectDomain } from "./project-domain.js?v=0.1.87-ui728";

export function createProjectDomainFeatureRegistry({
  fnv1aHex,
  getCircuitForCode,
  getCurrentChatMessages,
  getCurrentDescription,
  getCurrentSpecificationMode,
  inferCircuitLayout,
  legacySketchMigrationId,
  legacySketchMigrationVersion,
  normalizeChatMessages,
  normalizeCircuitLayout,
  normalizeSpecificationMode,
  projectStoreName,
} = {}) {
  let projectDomain = null;

  function getProjectDomain() {
    if (projectDomain) return projectDomain;
    projectDomain = createProjectDomain({
      fnv1aHex,
      getCircuitForCode,
      getCurrentChatMessages,
      getCurrentDescription,
      getCurrentSpecificationMode,
      inferCircuitLayout,
      legacySketchMigrationId,
      legacySketchMigrationVersion,
      normalizeChatMessages,
      normalizeCircuitLayout,
      normalizeSpecificationMode,
      projectStoreName,
    });
    return projectDomain;
  }

  function pick(names = []) {
    const domain = getProjectDomain();
    return Object.fromEntries(names.map((name) => [name, domain[name]]));
  }

  return {
    chatFeatureHelpers: () => pick([
      "activeRevision",
      "buildRevision",
      "codeHashFor",
      "isGenericRevisionName",
      "nextNamedRevisionName",
      "nextRevisionName",
      "normalizeProjectName",
      "normalizeProjectRecord",
      "normalizeSketchName",
      "revisionEquivalent",
    ]),
    circuitFeatureHelpers: () => pick(["normalizeProjectName", "normalizeSketchName"]),
    getProjectDomain,
    installFeatureHelpers: () => pick(["formatBytes"]),
    projectFeatureHelpers: () => pick([
      "activeRevision",
      "autoProjectName",
      "buildRevision",
      "codeHashFor",
      "createProjectId",
      "createRevisionId",
      "formatBytes",
      "nextNamedRevisionName",
      "nextRevisionName",
      "normalizeProject",
      "normalizeProjectName",
      "normalizeProjectRecord",
      "normalizeSketchName",
      "projectFromCode",
      "projectWithRequiredRevision",
      "revisionNameRoot",
      "splitRevisionNumber",
    ]),
    projectMaintenanceFeatureHelpers: () => pick([
      "createProjectId",
      "groupLegacySketchEntries",
      "legacyEntriesToRevisions",
      "legacySketchConverted",
      "legacySketchConvertedCopy",
      "legacySketchStoredCopy",
      "legacySketchWithSource",
      "migrateProjectRecordSchema",
      "normalizeProjectName",
      "normalizeProjectRecord",
      "projectWithRequiredRevision",
      "revisionMergeKey",
      "revisionNameRoot",
    ]),
    transferFeatureHelpers: () => pick([
      "buildRevision",
      "codeHashFor",
      "createProjectId",
      "nextRevisionName",
      "normalizeProjectName",
      "normalizeProjectRecord",
      "normalizeSketchName",
    ]),
    uiFeatureHelpers: () => pick(["formatBytes", "normalizeSketchName"]),
  };
}
