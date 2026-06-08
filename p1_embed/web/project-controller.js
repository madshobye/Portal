export function createProjectController({
  parseDroppedProject,
  activeRevision,
  getEditorValue,
  isSpecificationDirty,
  isCurrentSketchSaved,
  saveActiveRevisionFromEditor,
  saveProject,
  normalizeProjectRecord,
  getProjectById,
  storedRevisionDraftFor,
  revisionSession,
  updateCircuitView,
  hasCircuitChatLayout,
  logLine,
} = {}) {
  async function shelveEditorSketchIfNeeded({ incomingCode = "", updateInterface = true } = {}) {
    const current = String(getEditorValue() || "");
    if (!current.trim() && !isSpecificationDirty()) return null;
    if (incomingCode && current === String(incomingCode || "") && !isSpecificationDirty()) return null;
    if (isCurrentSketchSaved()) return null;
    return await saveActiveRevisionFromEditor({ source: "manual", updateInterface });
  }

  async function handleDroppedCodeText({ text = "", file = null } = {}) {
    const project = parseDroppedProject(text, file);
    const revision = activeRevision(project);
    if (!project || !revision?.code?.trim()) return null;
    await shelveEditorSketchIfNeeded({ incomingCode: revision.code });
    const saved = await saveProject(project);
    await openProjectRevision(saved, activeRevision(saved), { saveCurrent: false });
    updateCircuitView(hasCircuitChatLayout() ? "project circuit + code inference" : "inferred from code");
    logLine("info", saved.name ? `loaded ${saved.name}` : (file ? `loaded ${file.name}` : "loaded dropped text"));
    return { project: saved, revision: activeRevision(saved) };
  }

  async function openProjectRevision(project, revision, { saveCurrent = true } = {}) {
    if (!project?.id) throw new Error("Cannot open revision without a project");
    if (!revision?.id) throw new Error("Cannot open project without a revision");
    const targetProjectId = project.id;
    const targetRevisionId = revision.id;
    project = normalizeProjectRecord(project);
    revision = project.revisions.find((item) => item.id === targetRevisionId);
    if (!revision) throw new Error("Cannot open revision because it is not part of the project");
    if (saveCurrent) {
      await shelveEditorSketchIfNeeded({ incomingCode: revision.code, updateInterface: false });
      project = normalizeProjectRecord(await getProjectById(targetProjectId) || project);
      revision = project.revisions.find((item) => item.id === targetRevisionId);
      if (!revision) throw new Error("Cannot open revision because it disappeared while saving current revision");
    }

    const draftRevision = storedRevisionDraftFor(project, revision);
    revisionSession.setActiveRevision(project, revision);
    project.activeRevisionId = revision.id;
    const saved = await saveProject(project);
    const savedRevision = saved.revisions.find((item) => item.id === revision.id) || revision;
    const visibleRevision = draftRevision ? {
      ...savedRevision,
      code: draftRevision.code,
      specification: draftRevision.specification,
      specificationMode: draftRevision.specificationMode,
    } : savedRevision;
    revisionSession.showRevision({
      project: saved,
      savedRevision,
      visibleRevision,
      hasDraft: Boolean(draftRevision),
    });
    return { project: saved, revision: visibleRevision };
  }

  return {
    handleDroppedCodeText,
    openProjectRevision,
    shelveEditorSketchIfNeeded,
  };
}
