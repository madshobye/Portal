export function createProjectModel({
  normalizeChatMessages,
  normalizeCircuitLayout,
  inferCircuitLayout,
  normalizeSpecificationMode,
  fnv1aHex,
  inferSketchBaseName,
  isMeaningfulAutoSketchName,
  generatedSketchName,
  getCurrentDescription = () => "",
  getCurrentSpecificationMode = () => "middle",
  getCurrentChatMessages = () => [],
  getCircuitForCode = () => null,
} = {}) {
  function createOpaqueId(prefix = "id") {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    if (!bytes.some(Boolean)) {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${prefix}-${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  function createProjectId() {
    return createOpaqueId("xobit-prj");
  }

  function createRevisionId() {
    return createOpaqueId("rev");
  }

  function normalizeSketchName(name) {
    return String(name || "")
      .replace(/\s+/g, " ")
      .replace(/[^\w .:/+-]/g, "")
      .trim()
      .slice(0, 32);
  }

  function normalizeProjectName(name) {
    return normalizeSketchName(name);
  }

  function autoProjectName(code) {
    const inferred = inferSketchBaseName(code);
    if (isMeaningfulAutoSketchName(inferred)) return inferred;
    return generatedSketchName(code || `${Date.now()}`);
  }

  function projectRevisionSource(project = {}) {
    if (Array.isArray(project.revisions)) return project.revisions;
    if (Array.isArray(project.sketches)) return project.sketches;
    if (Array.isArray(project.history)) return project.history;
    if (Array.isArray(project.versions)) return project.versions;
    if (typeof project.code === "string") return [project];
    return [];
  }

  function normalizeRevisionRecord(revision = {}) {
    const code = String(revision.code ?? "");
    const specification = String(revision.specification ?? revision.description ?? "");
    const circuit = normalizeCircuitLayout(revision.circuit)
      || (code.trim() ? inferCircuitLayout(code, null) : null);
    return {
      id: String(revision.id || createRevisionId()),
      name: normalizeSketchName(revision.name) || "Revision",
      code,
      specification,
      specificationMode: normalizeSpecificationMode(revision.specificationMode || revision.descriptionMode || "middle"),
      circuit,
      chat: normalizeChatMessages(revision.chat),
      source: String(revision.source || "manual"),
      exampleProjectName: normalizeProjectName(revision.exampleProjectName || ""),
      createdAt: String(revision.createdAt || revision.at || new Date().toISOString()),
      bytes: Number(revision.bytes) || new Blob([code]).size,
      codeHash: String(revision.codeHash || revision.hash || fnv1aHex(code)),
    };
  }

  function normalizeProjectRecord(project = {}) {
    const now = new Date().toISOString();
    const projectChat = normalizeChatMessages(project.chat);
    const revisionSource = projectRevisionSource(project);
    const activeRevisionId = String(project.activeRevisionId || project.revisionId || project.activeSketchId || project.activeVersionId || "");
    const revisions = revisionSource
      .map((revision) => normalizeRevisionRecord(revision))
      .filter((revision) => revision.code.trim() || revision.specification.trim() || revision.source === "new-revision");
    const active = revisions.find((revision) => revision.id === activeRevisionId) || revisions[0] || null;
    if (active && projectChat.length && !active.chat.length) active.chat = projectChat;
    return {
      type: "xobit-project",
      version: 2,
      id: String(project.id || createProjectId()),
      name: normalizeProjectName(project.name) || autoProjectName(active?.code || ""),
      createdAt: String(project.createdAt || now),
      updatedAt: String(project.updatedAt || now),
      activeRevisionId: active?.id || "",
      isExampleProject: Boolean(project.isExampleProject),
      specialLabel: String(project.specialLabel || ""),
      chat: [],
      revisions,
    };
  }

  function buildRevision({
    id = "",
    name = "",
    code = "",
    specification = getCurrentDescription(),
    specificationMode = getCurrentSpecificationMode(),
    circuit = undefined,
    chat = getCurrentChatMessages(),
    source = "manual",
    createdAt = "",
    exampleProjectName = "",
  } = {}) {
    const text = String(code ?? "");
    return normalizeRevisionRecord({
      id: id || createRevisionId(),
      name: name || "Revision",
      code: text,
      specification,
      specificationMode,
      circuit: circuit === undefined ? getCircuitForCode(text) : circuit,
      chat,
      source,
      createdAt,
      exampleProjectName,
    });
  }

  function buildProject({ name = "", code = "", circuit = undefined, description = undefined, specificationMode = getCurrentSpecificationMode() } = {}) {
    const source = String(code ?? "");
    const explicitCircuit = circuit === undefined ? getCircuitForCode(source) : normalizeCircuitLayout(circuit);
    const revision = buildRevision({
      code: source,
      name: name || "Draft",
      specification: String(description ?? getCurrentDescription() ?? ""),
      specificationMode,
      circuit: explicitCircuit || inferCircuitLayout(source, null),
      source: "import",
    });
    return normalizeProjectRecord({
      id: createProjectId(),
      name: normalizeProjectName(name) || autoProjectName(source),
      revisions: source.trim() ? [revision] : [],
      activeRevisionId: revision.id,
      chat: [],
    });
  }

  function projectFromCode(code, name = "", circuit = null, description = "", specificationMode = getCurrentSpecificationMode()) {
    return buildProject({ name, code, circuit, description, specificationMode });
  }

  function normalizeProject(project, fallbackName = "") {
    if (!project || typeof project !== "object") return null;
    if (Array.isArray(project.revisions)) {
      return normalizeProjectRecord({ ...project, name: project.name || fallbackName });
    }
    if (typeof project.code !== "string") return null;
    return buildProject({
      name: project.name || fallbackName,
      code: project.code,
      circuit: project.circuit,
      description: project.description ?? project.specification,
      specificationMode: project.specificationMode || project.descriptionMode,
    });
  }

  function activeRevision(project) {
    if (!project?.revisions?.length) return null;
    return project.revisions.find((revision) => revision.id === project.activeRevisionId) || project.revisions[0];
  }

  function codeHashFor(code) {
    return fnv1aHex(String(code ?? ""));
  }

  function normalizeCodeHash(value, code = "") {
    if (Number.isFinite(value)) return (Number(value) >>> 0).toString(16).padStart(8, "0");
    const text = String(value || "").trim().toLowerCase();
    if (/^[0-9a-f]{8}$/.test(text)) return text;
    return codeHashFor(code);
  }

  function boardCodeHash(data = {}, code = "") {
    return normalizeCodeHash(data.codeHash ?? data.scriptHash ?? data.hash, code);
  }

  function revisionEquivalent(left, right) {
    if (!left || !right) return false;
    return String(left.code || "") === String(right.code || "")
      && String(left.specification || "") === String(right.specification || "")
      && normalizeSpecificationMode(left.specificationMode) === normalizeSpecificationMode(right.specificationMode)
      && JSON.stringify(normalizeCircuitLayout(left.circuit) || null) === JSON.stringify(normalizeCircuitLayout(right.circuit) || null);
  }

  function revisionMergeKey(revision = {}) {
    const code = String(revision.code || "");
    if (code.trim()) return `code:${codeHashFor(code)}:${code.length}`;
    const id = String(revision.id || "").trim();
    if (id) return `id:${id}`;
    return `name:${normalizeSketchName(revision.name || "")}:${String(revision.createdAt || "")}`;
  }

  function nextRevisionName(project) {
    let maxVersion = 0;
    (project?.revisions || []).forEach((revision) => {
      const parsed = splitRevisionNumber(revision?.name || "");
      if (parsed.root.toLowerCase() === "revision") {
        maxVersion = Math.max(maxVersion, parsed.version);
      }
    });
    return `Revision ${maxVersion + 1}`;
  }

  function nextNamedRevisionName(project, name = "") {
    if (isGenericRevisionName(name)) return nextRevisionName(project);
    const root = revisionNameRoot(name);
    if (!root) return nextRevisionName(project);
    let maxVersion = 1;
    (project?.revisions || []).forEach((revision) => {
      const parsed = splitRevisionNumber(revision?.name || "");
      if (parsed.root.toLowerCase() === root.toLowerCase()) {
        maxVersion = Math.max(maxVersion, parsed.version);
      }
    });
    return normalizeSketchName(`${root} ${maxVersion + 1}`);
  }

  function isGenericRevisionName(name = "") {
    const clean = normalizeSketchName(name).toLowerCase();
    return /^(initial revision|revision|new sketch)( \d+)?$/.test(clean);
  }

  function revisionNameRoot(name = "") {
    return splitRevisionNumber(name).root;
  }

  function splitRevisionNumber(name = "") {
    const normalized = normalizeSketchName(name);
    const match = normalized.match(/^(.*?)\s+(?:v)?(\d+)$/i);
    if (!match) return { root: normalized, version: normalized ? 1 : 0 };
    return {
      root: normalizeSketchName(match[1]),
      version: Math.max(1, Number(match[2]) || 1),
    };
  }

  function formatBytes(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) return "0 B";
    if (size < 1024) return `${size} B`;
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return {
    activeRevision,
    autoProjectName,
    boardCodeHash,
    buildProject,
    buildRevision,
    codeHashFor,
    createProjectId,
    createRevisionId,
    formatBytes,
    isGenericRevisionName,
    nextNamedRevisionName,
    nextRevisionName,
    normalizeCodeHash,
    normalizeProject,
    normalizeProjectName,
    normalizeProjectRecord,
    normalizeRevisionRecord,
    normalizeSketchName,
    projectFromCode,
    projectRevisionSource,
    revisionEquivalent,
    revisionMergeKey,
    revisionNameRoot,
    splitRevisionNumber,
  };
}
