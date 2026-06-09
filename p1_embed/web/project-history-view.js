export function createProjectHistoryView({
  storage,
  storageArea,
  projectStoreName,
  sketchStoreName,
  legacySketchMigrationId,
  legacySketchMigrationVersion,
  readProjects,
  renderProjectSelectors,
  getCurrentProjectId,
  getEditorValue,
  openRevision,
  activeRevision,
  storageDiagnostics,
  logLine,
} = {}) {
  async function renderSketchHistory() {
    const projects = await readProjects();
    renderProjectSelectors(projects);
    if (!projects.length) await logEmptyProjectStorageDiagnostic();
    const currentProjectId = getCurrentProjectId();
    const project = projects.find((item) => item.id === currentProjectId)
      || projects.find((item) => item.id === storageArea.getItem(storage.projectId))
      || projects[0]
      || null;
    if (!currentProjectId && project && !getEditorValue().trim()) {
      await openRevision(project, activeRevision(project), { saveCurrent: false });
    }
  }

  async function logEmptyProjectStorageDiagnostic() {
    const [idbProjects, idbLegacy] = await Promise.all([
      indexedDbStoreCount(projectStoreName),
      indexedDbStoreCount(sketchStoreName),
    ]);
    logLine("info", "No projects yet. Start with the welcome sketch, ask AI for an idea, or connect a board.");
    logLine("debug", [
      "empty project storage",
      `idb.${projectStoreName}=${idbProjects}`,
      `idb.${sketchStoreName}=${idbLegacy}`,
      `${storage.projectFallback}=${localStorageArrayCount(storage.projectFallback)}`,
      `${storage.sketchHistory}=${localStorageArrayCount(storage.sketchHistory)}`,
      `legacy migration=${legacySketchMigrationId}@${legacySketchMigrationVersion}`,
      `${storage.projectSchemaMigration}=${storageArea.getItem(storage.projectSchemaMigration) || "missing"}`,
      `${storage.projectId}=${storageArea.getItem(storage.projectId) || "missing"}`,
    ].join(" / "));
  }

  function localStorageArrayCount(key) {
    return storageDiagnostics.localStorageArrayCount(key);
  }

  async function indexedDbStoreCount(storeName) {
    return await storageDiagnostics.indexedDbStoreCount(storeName);
  }

  return {
    indexedDbStoreCount,
    localStorageArrayCount,
    logEmptyProjectStorageDiagnostic,
    renderSketchHistory,
  };
}
