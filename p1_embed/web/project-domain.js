import { createProjectModel } from "./project-model.js?v=0.1.87-ui753";
import { createProjectMigrationModel } from "./project-migration-model.js?v=0.1.87-ui753";
import { createSketchNaming } from "./sketch-naming.js?v=0.1.87-ui753";

export function createProjectDomain({
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
  let sketchNaming = null;

  const projectModel = createProjectModel({
    normalizeChatMessages,
    normalizeCircuitLayout,
    inferCircuitLayout,
    normalizeSpecificationMode,
    fnv1aHex,
    inferSketchBaseName: (code) => getSketchNaming().inferSketchBaseName(code),
    isMeaningfulAutoSketchName: (name) => getSketchNaming().isMeaningfulAutoSketchName(name),
    generatedSketchName: (code) => getSketchNaming().generatedSketchName(code),
    getCurrentDescription,
    getCurrentSpecificationMode,
    getCurrentChatMessages,
    getCircuitForCode,
  });

  function getSketchNaming() {
    if (sketchNaming) return sketchNaming;
    sketchNaming = createSketchNaming({ normalizeSketchName: projectModel.normalizeSketchName });
    return sketchNaming;
  }

  const migrationModel = createProjectMigrationModel({
    buildRevision: projectModel.buildRevision,
    normalizeChatMessages,
    normalizeCircuitLayout,
    normalizeProjectName: projectModel.normalizeProjectName,
    normalizeProjectRecord: projectModel.normalizeProjectRecord,
    revisionNameRoot: projectModel.revisionNameRoot,
    createRevisionId: projectModel.createRevisionId,
    fnv1aHex,
    autoProjectName: projectModel.autoProjectName,
    migrationId: legacySketchMigrationId,
    migrationVersion: legacySketchMigrationVersion,
    targetStoreName: projectStoreName,
  });

  return {
    ...projectModel,
    ...migrationModel,
    getSketchNaming,
  };
}
