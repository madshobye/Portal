export function createProjectRevisionService({
  storage,
  storageArea,
  getCurrentProjectId,
  setCurrentProjectId,
  getCurrentRevisionId,
  getCurrentSketchName,
  getCurrentSketchSource,
  getCurrentProjectCircuit,
  getCurrentProjectDescription,
  getCurrentProjectSpecificationMode,
  getChatMessages,
  getClient,
  getCircuitView,
  getEditorValue,
  readSpecificationMarkdown,
  getActiveProject,
  getProjectById,
  saveProject,
  sendCommand,
  setCurrentSketchIdentity,
  logLine,
  activeRevision,
  autoProjectName,
  buildRevision,
  codeHashFor,
  createProjectId,
  nextNamedRevisionName,
  nextRevisionName,
  normalizeChatMessages,
  normalizeCircuitLayout,
  normalizeProjectName,
  normalizeProjectRecord,
  normalizeSketchName,
  normalizeSpecificationMode,
  isExampleProject = () => false,
} = {}) {
  async function ensureProjectForWrite({ code = "", nameHint = "" } = {}) {
    const existing = await getActiveProject();
    if (existing && !isExampleProject(existing)) return normalizeProjectRecord(existing);
    if (existing && isExampleProject(existing)) {
      const project = projectFromExampleForWrite(existing, {
        code,
        nameHint,
        revision: activeRevision(existing),
      });
      setCurrentProjectId(project.id);
      storageArea.setItem(storage.projectId, project.id);
      return project;
    }
    const configuredId = getCurrentProjectId() || storageArea.getItem(storage.projectId) || "";
    const project = normalizeProjectRecord({
      id: configuredId || createProjectId(),
      name: normalizeProjectName(nameHint) || autoProjectName(code),
      revisions: [],
      activeRevisionId: "",
      chat: [],
    });
    setCurrentProjectId(project.id);
    storageArea.setItem(storage.projectId, project.id);
    return project;
  }

  async function saveActiveRevisionFromEditor({ source = "manual", nameHint = "", updateInterface = true } = {}) {
    const code = String(getEditorValue() || "");
    const specification = readSpecificationMarkdown();
    let project = await getActiveProject();
    if (!project) {
      project = await ensureProjectForWrite({ code, nameHint });
    }
    if (isExampleProject(project)) {
      const exampleRevision = project.revisions.find((item) => item.id === getCurrentRevisionId()) || activeRevision(project);
      project = projectFromExampleForWrite(project, { code, nameHint, revision: exampleRevision });
      setCurrentProjectId(project.id);
      storageArea.setItem(storage.projectId, project.id);
      logLine?.("info", `copied example to project: ${project.name}`);
    }
    project = normalizeProjectRecord(project);
    let revision = project.revisions.find((item) => item.id === getCurrentRevisionId()) || activeRevision(project);
    if (!revision) {
      revision = buildRevision({
        name: normalizeSketchName(nameHint || getCurrentSketchName()) || nextRevisionName(project),
        code,
        specification,
        specificationMode: getCurrentProjectSpecificationMode(),
        circuit: projectCircuitForCurrentCode(code),
        chat: getChatMessages(),
        source,
      });
      project.revisions.unshift(revision);
    } else {
      const shouldCheckpoint = String(revision.code || "") !== String(code || "");
      if (shouldCheckpoint) {
        revision = buildRevision({
          name: nextNamedRevisionName(project, normalizeSketchName(nameHint || getCurrentSketchName() || revision.name) || "Revision"),
          code,
          specification,
          specificationMode: getCurrentProjectSpecificationMode(),
          circuit: projectCircuitForCurrentCode(code),
          chat: getChatMessages(),
          source,
        });
        project.revisions.unshift(revision);
      } else {
        revision = {
          ...revision,
          code,
          specification,
          specificationMode: getCurrentProjectSpecificationMode(),
          circuit: projectCircuitForCurrentCode(code),
          chat: normalizeChatMessages(getChatMessages()),
          source: revision.source || source,
          bytes: new Blob([code]).size,
          codeHash: codeHashFor(code),
        };
        project.revisions = project.revisions.map((item) => item.id === revision.id ? revision : item);
      }
    }
    project.activeRevisionId = revision.id;
    const saved = await saveProject(project);
    const savedRevision = saved.revisions.find((item) => item.id === revision.id) || activeRevision(saved);
    if (!savedRevision) throw new Error("Could not save active revision");
    storageArea.removeItem(storage.revisionDraft);
    if (updateInterface) {
      setCurrentSketchIdentity(savedRevision.name || "", savedRevision.code || "", saved, savedRevision);
    }
    return { project: saved, revision: savedRevision };
  }

  function projectFromExampleForWrite(exampleProject = {}, { code = "", nameHint = "", revision = null } = {}) {
    const sourceRevision = revision || activeRevision(exampleProject) || {};
    const name = normalizeProjectName(nameHint || sourceRevision.exampleProjectName || sourceRevision.name || exampleProject.name)
      || autoProjectName(code || sourceRevision.code || "");
    return normalizeProjectRecord({
      id: createProjectId(),
      name,
      revisions: [],
      activeRevisionId: "",
      chat: [],
    });
  }

  async function persistProjectMetadataToDevice(project, revision = null) {
    if (!getClient() || !project?.id) return;
    try {
      const selected = revision || activeRevision(project);
      await sendCommand("config.set", {
        projectId: project.id,
        projectName: project.name,
        revisionId: selected?.id || "",
        scriptName: selected?.name || "",
      }, { quiet: true, timeoutMs: 2500 });
    } catch {
    }
  }

  function projectCircuitForCurrentCode(code) {
    if (String(code ?? "") === getCurrentSketchSource() && getCurrentProjectCircuit()) {
      return normalizeCircuitLayout(getCurrentProjectCircuit());
    }
    const viewModel = getCircuitView()?.getModel?.();
    return normalizeCircuitLayout(viewModel);
  }

  function captureActiveRevisionContext() {
    return {
      projectId: getCurrentProjectId(),
      revisionId: getCurrentRevisionId(),
      chat: normalizeChatMessages(getChatMessages()),
      specification: getCurrentProjectDescription(),
      specificationMode: getCurrentProjectSpecificationMode(),
    };
  }

  function isCurrentRevisionContext(context = {}) {
    return Boolean(context.projectId && context.revisionId
      && context.projectId === getCurrentProjectId()
      && context.revisionId === getCurrentRevisionId());
  }

  async function saveChatForRevisionContext(context = {}, messages = []) {
    const saved = await saveRevisionFieldsForContext(context, { chat: messages });
    return Boolean(saved);
  }

  async function saveRevisionFieldsForContext(context = {}, fields = {}) {
    if (!context.projectId || !context.revisionId) {
      logLine("warn", "revision fields not saved: response had no revision target");
      return null;
    }
    const project = await getProjectById(context.projectId);
    const revision = project?.revisions?.find((item) => item.id === context.revisionId);
    if (!project || !revision) {
      logLine("error", "revision fields not saved: target revision disappeared");
      return null;
    }
    if (fields.chat !== undefined) revision.chat = normalizeChatMessages(fields.chat);
    if (fields.specification !== undefined) revision.specification = String(fields.specification || "");
    if (fields.specificationMode !== undefined) revision.specificationMode = normalizeSpecificationMode(fields.specificationMode);
    if (fields.circuit !== undefined) revision.circuit = normalizeCircuitLayout(fields.circuit);
    project.chat = [];
    const saved = await saveProject(project, { makeActive: isCurrentRevisionContext(context) });
    const savedRevision = saved.revisions.find((item) => item.id === revision.id) || revision;
    return { project: saved, revision: savedRevision };
  }

  function revisionFieldsFromChatResult(result = {}, messages = []) {
    const fields = { chat: messages };
    if (result.project_specification) {
      fields.specification = result.project_specification;
      fields.specificationMode = result.specification_mode || getCurrentProjectSpecificationMode();
    }
    return fields;
  }

  return {
    captureActiveRevisionContext,
    ensureProjectForWrite,
    isCurrentRevisionContext,
    persistProjectMetadataToDevice,
    projectCircuitForCurrentCode,
    revisionFieldsFromChatResult,
    saveActiveRevisionFromEditor,
    saveChatForRevisionContext,
    saveRevisionFieldsForContext,
  };
}
