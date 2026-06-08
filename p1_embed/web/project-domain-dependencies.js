export function createProjectDomainDependencies({
  fnv1aHex,
  getProjectRevisionService,
  inferCircuitLayout,
  legacySketchMigrationId,
  legacySketchMigrationVersion,
  normalizeChatMessages,
  normalizeCircuitLayout,
  normalizeSpecificationMode,
  projectState,
  projectStoreName,
} = {}) {
  return {
    normalizeChatMessages,
    normalizeCircuitLayout,
    inferCircuitLayout,
    normalizeSpecificationMode,
    fnv1aHex,
    getCurrentDescription: () => projectState.currentProjectDescription,
    getCurrentSpecificationMode: () => projectState.currentProjectSpecificationMode,
    getCurrentChatMessages: () => projectState.chatMessages,
    getCircuitForCode: (code) => getProjectRevisionService().projectCircuitForCurrentCode(code),
    legacySketchMigrationId,
    legacySketchMigrationVersion,
    projectStoreName,
  };
}
