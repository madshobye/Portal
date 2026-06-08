export function createBoardDownloadService({
  getLastConfig,
  getClient,
  sendCommand,
  updateConfig,
  readProjects,
  saveProject,
  shelveEditorSketchIfNeeded,
  openRevision,
  updateScriptState,
  logLine,
  buildRevision,
  boardCodeHash,
  createProjectId,
  inferCircuitLayout,
  nextRevisionName,
  normalizeChatMessages,
  normalizeCodeHash,
  normalizeProjectName,
  normalizeProjectRecord,
  normalizeSketchName,
} = {}) {
  async function applyFetchedScript(data) {
    if (typeof data.code === "string") {
      await openDownloadedBoardRevision(data);
    }
    updateScriptState(data);
  }

  async function boardConfigForFetchedScript(data = {}) {
    let config = getLastConfig() || {};
    const hasDataProject = data.projectId || data.projectName;
    if (!hasDataProject && getClient()) {
      try {
        config = await sendCommand("config.get", {}, { quiet: true, timeoutMs: 6000 });
        updateConfig(config);
      } catch {
      }
    }
    return config || {};
  }

  async function resolveBoardProjectForFetchedScript(data = {}) {
    const config = await boardConfigForFetchedScript(data);
    const projectId = String(data.projectId || config.projectId || "").trim();
    const projectName = normalizeProjectName(data.projectName || config.projectName || "");
    const code = String(data.code ?? "");
    const codeHash = boardCodeHash(data, code);

    const projects = await readProjects();
    let project = projectId ? projects.find((item) => item.id === projectId) : null;
    if (!project && projectName) {
      project = projects.find((item) => normalizeProjectName(item.name).toLowerCase() === projectName.toLowerCase());
    }
    if (!project) {
      project = findBoardProjectByRevisionIdentity(projects, {
        revisionId: data.revisionId,
        codeHash,
        code,
      });
    }
    if (!project) {
      project = projects.find((item) => normalizeProjectName(item.name).toLowerCase() === "board project");
    }
    if (!project) {
      project = normalizeProjectRecord({
        id: projectId || createProjectId(),
        name: projectName || "Board Project",
        revisions: [],
        activeRevisionId: "",
        chat: [],
      });
    } else if (projectName && project.name !== projectName) {
      project = { ...project, name: projectName };
      await saveProject(project);
    }
    return project;
  }

  function findBoardProjectByRevisionIdentity(projects = [], identity = {}) {
    for (const project of projects) {
      const revision = findRevisionByIdentity(project, {
        ...identity,
        allowContentMatch: true,
        quiet: true,
      });
      if (revision) return project;
    }
    return null;
  }

  async function openDownloadedBoardRevision(data = {}) {
    const code = String(data.code ?? "");
    if (!code.trim()) throw new Error("Board returned an empty sketch");
    await shelveEditorSketchIfNeeded({ incomingCode: code });

    let project = await resolveBoardProjectForFetchedScript(data);
    const hasBoardRevisionId = Boolean(String(data.revisionId || "").trim());
    const codeHash = boardCodeHash(data, code);
    let revision = findRevisionByIdentity(project, {
      revisionId: data.revisionId,
      codeHash,
      code,
    });
    if (!revision && !hasBoardRevisionId) {
      revision = findReusableBoardDownloadRevision(project, { codeHash, code });
    }

    if (!revision) {
      const boardRevisionId = String(data.revisionId || "").trim();
      const boardRevisionIdAvailable = boardRevisionId && !project.revisions.some((item) => item.id === boardRevisionId);
      revision = buildRevision({
        id: boardRevisionIdAvailable ? boardRevisionId : "",
        name: normalizeSketchName(data.scriptName || "") || nextRevisionName(project),
        code,
        specification: "",
        specificationMode: "middle",
        circuit: inferCircuitLayout(code, null),
        chat: [],
        source: "download",
      });
      project.revisions.unshift(revision);
      project.activeRevisionId = revision.id;
      project = await saveProject(project);
      logLine("info", hasBoardRevisionId
        ? `downloaded board sketch as new revision ${revision.name}`
        : `downloaded board sketch as new revision ${revision.name}; no board revision id, so specification was left empty`);
    } else {
      project.activeRevisionId = revision.id;
      project = await saveProject(project);
      logLine("info", `matched board sketch to revision ${revision.name || "revision"}`);
    }

    const selected = project.revisions.find((item) => item.id === revision.id) || revision;
    await openRevision(project, selected, { saveCurrent: false });
  }

  function findRevisionByIdentity(project, { revisionId = "", codeHash = "", code = "", allowContentMatch = false, quiet = false } = {}) {
    const revisions = Array.isArray(project?.revisions) ? project.revisions : [];
    const id = String(revisionId || "").trim();
    const codeText = String(code || "");
    const hash = normalizeCodeHash(codeHash, codeText);
    const findByDownloadedCode = () => {
      if (codeText.trim()) {
        const byExactCode = revisions.find((revision) => String(revision.code || "") === codeText);
        if (byExactCode) return byExactCode;
      }
      if (hash) {
        const byHash = revisions.find((revision) => normalizeCodeHash(revision.codeHash, revision.code) === hash);
        if (byHash) return byHash;
      }
      return null;
    };
    if (id) {
      const byId = revisions.find((revision) => revision.id === id);
      if (byId) {
        if (codeText.trim() && String(byId.code || "") !== codeText) {
          if (!quiet) logLine("warn", `board revision id ${id} matched ${byId.name || "revision"} but code differs; matching downloaded code instead`);
          return findByDownloadedCode();
        }
        return byId;
      }
      if (!quiet) logLine("warn", `board revision id ${id} was not found locally; opening downloaded sketch as a new revision`);
    }
    if (!allowContentMatch) return null;
    return findByDownloadedCode();
  }

  function findReusableBoardDownloadRevision(project, { codeHash = "", code = "" } = {}) {
    const revisions = Array.isArray(project?.revisions) ? project.revisions : [];
    const hash = normalizeCodeHash(codeHash, code);
    return revisions.find((revision) => revision.source === "download"
      && !String(revision.specification || "").trim()
      && normalizeChatMessages(revision.chat).length === 0
      && (
        String(revision.code || "") === String(code || "")
        || normalizeCodeHash(revision.codeHash, revision.code) === hash
      )) || null;
  }

  return {
    applyFetchedScript,
    boardConfigForFetchedScript,
    findBoardProjectByRevisionIdentity,
    findReusableBoardDownloadRevision,
    findRevisionByIdentity,
    openDownloadedBoardRevision,
    resolveBoardProjectForFetchedScript,
  };
}
