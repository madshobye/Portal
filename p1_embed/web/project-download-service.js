export function createProjectDownloadService({
  getActiveProject,
  getEditorValue,
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
} = {}) {
  async function downloadProject() {
    const project = await projectSnapshotForDownload();
    if (!project?.revisions?.length) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URLRef.createObjectURL(blob);
    const a = documentRef.createElement("a");
    a.href = url;
    a.download = `${slugForFilename(project.name || "p1e-project")}.p1e.json`;
    documentRef.body.append(a);
    a.click();
    a.remove();
    URLRef.revokeObjectURL(url);
  }

  async function projectSnapshotForDownload() {
    const project = await getActiveProject();
    const code = getEditorValue();
    const currentSketchName = getCurrentSketchName();
    if (!project) {
      const revision = buildRevision({ code, name: currentSketchName || "Draft", source: "download" });
      return normalizeProjectRecord({
        id: createProjectId(),
        name: currentSketchName || autoProjectName(code),
        revisions: revision.code.trim() ? [revision] : [],
        activeRevisionId: revision.id,
        chat: [],
      });
    }
    const snapshot = normalizeProjectRecord(project);
    const revision = activeRevision(snapshot);
    if (revision) {
      revision.code = code;
      revision.specification = getCurrentProjectDescription();
      revision.specificationMode = getCurrentProjectSpecificationMode();
      revision.circuit = projectCircuitForCurrentCode(code) || revision.circuit;
      revision.chat = getChatMessages().slice(-60);
      revision.bytes = new Blob([code]).size;
    }
    snapshot.chat = [];
    snapshot.updatedAt = new Date().toISOString();
    return snapshot;
  }

  function slugForFilename(name) {
    const slug = normalizeSketchName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || `p1e-${timestampForFilename()}`;
  }

  return {
    downloadProject,
    projectSnapshotForDownload,
    slugForFilename,
  };
}
