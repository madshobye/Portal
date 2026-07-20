import { NODE_PART_KINDS } from "./node-definition.js";
import { defineNode } from "./node-definition.js";

const DEFAULT_PART_EDITORS = Object.freeze({
  [NODE_PART_KINDS.JAVASCRIPT]: "code-editor",
  [NODE_PART_KINDS.SHADER]: "shader-editor",
  [NODE_PART_KINDS.GRAPH]: "graph-editor",
  [NODE_PART_KINDS.ASSET]: "asset-viewer",
  [NODE_PART_KINDS.DOCUMENTATION]: "documentation-editor",
  [NODE_PART_KINDS.TEST]: "test-editor",
  [NODE_PART_KINDS.UI]: "ui-editor",
});

export class NodePartEditorRegistry {
  constructor(editors = DEFAULT_PART_EDITORS) {
    this.editors = new Map(Object.entries(editors));
  }

  register(partKind, editorId) {
    this.editors.set(String(partKind || ""), String(editorId || ""));
  }

  editorFor(part) {
    return this.editors.get(String(part?.kind || "")) || "raw-part-editor";
  }
}

export function nodeEditorPanels(definition, editorRegistry = new NodePartEditorRegistry()) {
  const panels = [{
    id: "overview",
    name: "Overview",
    editor: "node-overview",
    data: {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      description: definition.description,
      capabilities: definition.capabilities,
    },
  }];
  if (Object.keys(definition.parameters || {}).length) {
    panels.push({ id: "parameters", name: "Parameters", editor: "parameter-editor", data: definition.parameters });
  }
  for (const part of definition.parts || []) {
    panels.push({
      id: `part:${part.id}`,
      name: part.name || part.id,
      editor: editorRegistry.editorFor(part),
      editable: part.editable !== false,
      data: part,
    });
  }
  return panels;
}

export function nodeEditorProjection(definition, {
  editorRegistry = new NodePartEditorRegistry(),
  nodeRegistry = null,
  projectForks = [],
} = {}) {
  const parts = [...(definition.parts || [])];
  const partsOf = (kind) => parts.filter((part) => part.kind === kind).map((part) => ({
    ...part,
    editor: editorRegistry.editorFor(part),
    editable: part.editable !== false,
  }));
  const versions = nodeRegistry?.listVersions?.(definition.id) || [definition];
  const forks = (projectForks || []).filter((fork) => fork?.base?.id === definition.id);
  const panels = [
    editorPanel("overview", "Overview", "node-overview", {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      formatVersion: definition.formatVersion,
      description: definition.description,
      implementation: definition.implementation,
      execution: definition.execution,
      capabilities: definition.capabilities,
      presentation: definition.presentation,
      inlets: definition.inlets,
      outlets: definition.outlets,
    }),
    editorPanel("parameters", "Parameters", "parameter-editor", { parameters: definition.parameters }, true),
    editorPanel("javascript", "JavaScript", "code-editor", { parts: partsOf(NODE_PART_KINDS.JAVASCRIPT) }),
    editorPanel("shaders", "Shaders", "shader-editor", { parts: partsOf(NODE_PART_KINDS.SHADER) }),
    editorPanel("graph", "Internal graph", "graph-editor", { parts: partsOf(NODE_PART_KINDS.GRAPH) }),
    editorPanel("assets", "Assets", "asset-viewer", { parts: partsOf(NODE_PART_KINDS.ASSET) }),
    editorPanel("documentation", "Documentation", "documentation-editor", {
      description: definition.description,
      parts: partsOf(NODE_PART_KINDS.DOCUMENTATION),
    }),
    editorPanel("tests", "Tests", "test-editor", { parts: partsOf(NODE_PART_KINDS.TEST) }),
    editorPanel("versions", "Versions", "version-browser", {
      current: definition.version,
      available: versions.map((version) => ({
        id: version.id,
        version: version.version,
        formatVersion: version.formatVersion,
        migrations: version.migrations,
      })),
    }),
    editorPanel("forks", "Project forks", "node-fork-editor", { forks }),
  ];
  return Object.freeze({
    id: `${definition.id}@${definition.version}`,
    definition,
    panels: Object.freeze(panels),
    panel: (id) => panels.find((panel) => panel.id === id) || null,
  });
}

export function createProjectNodeFork(definition, {
  forkId = createForkId(),
  name = `${definition.name} (Project fork)`,
  description = definition.description,
  overrides = {},
} = {}) {
  const localId = String(forkId || createForkId()).replace(/[^a-z0-9._/-]+/gi, "-");
  return Object.freeze({
    formatVersion: 1,
    id: `${definition.id}/fork/${localId}`,
    projectLocal: true,
    base: Object.freeze({ id: definition.id, version: definition.version }),
    definition: Object.freeze({
      name,
      description,
      parameters: overrides.parameters || definition.parameters,
      parts: Object.freeze([...(overrides.parts || definition.parts || [])]),
      metadata: Object.freeze({ ...definition.metadata, ...overrides.metadata }),
    }),
  });
}

export function materializeProjectNodeFork(baseDefinition, fork) {
  if (fork?.base?.id !== baseDefinition.id || fork?.base?.version !== baseDefinition.version) {
    throw new Error(`NODE_FORK_BASE_MISMATCH:${fork?.id || "missing"}`);
  }
  const parts = fork.definition?.parts || baseDefinition.parts || [];
  const graphChanged = changedParts(baseDefinition.parts, parts, NODE_PART_KINDS.GRAPH).length > 0;
  const process = compiledForkProcess(baseDefinition, parts);
  const materialized = defineNode({
    ...baseDefinition,
    ...fork.definition,
    id: fork.id,
    version: "0.1.0",
    process,
    metadata: {
      ...baseDefinition.metadata,
      ...fork.definition?.metadata,
      projectLocal: true,
      baseNode: fork.base,
    },
  });
  if (baseDefinition.implementation?.kind !== "group") return materialized;
  return Object.freeze({
    ...materialized,
    // An edited group graph uses the deterministic call-driven executor.
    // Unchanged built-in groups retain their specialized direct program.
    program: graphChanged ? null : baseDefinition.program,
  });
}

export function compileJavaScriptNodeProcess(source, definition = {}) {
  const code = String(source || "").trim();
  if (!code) throw new Error(`NODE_FORK_JAVASCRIPT_EMPTY:${definition.id || "missing"}`);
  if (/^(?:async\s+)?function\b/.test(code) || /^(?:async\s*)?\(?[A-Za-z_$]/.test(code) && code.includes("=>")) {
    const compiled = Function(`"use strict"; return (${code}\n);`)();
    if (typeof compiled !== "function") throw new Error(`NODE_FORK_JAVASCRIPT_INVALID:${definition.id || "missing"}`);
    return compiled;
  }
  const names = [...Object.keys(definition.inlets || {}), ...Object.keys(definition.parameters || {})]
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  return Function("inputs", "context", `"use strict"; const { ${names.join(", ")} } = inputs;\n${code}`);
}

export function validateProjectNodeFork(baseDefinition, fork) {
  materializeProjectNodeFork(baseDefinition, fork);
  const parts = fork?.definition?.parts || [];
  for (const part of changedParts(baseDefinition.parts, parts, NODE_PART_KINDS.JAVASCRIPT)) {
    const code = String(part.source || "").trim();
    if (!code) throw new Error(`NODE_FORK_JAVASCRIPT_EMPTY:${baseDefinition.id}`);
    if (/^(?:async\s+)?function\b/.test(code) || code.includes("=>")) compileJavaScriptNodeProcess(code, baseDefinition);
    else Function("inputs", "context", `"use strict";\n${code}`);
  }
  return true;
}

function compiledForkProcess(baseDefinition, parts) {
  if (baseDefinition.implementation?.kind !== "code" && baseDefinition.implementation?.kind !== "data") {
    return baseDefinition.process;
  }
  const changed = changedParts(baseDefinition.parts, parts, NODE_PART_KINDS.JAVASCRIPT);
  const processName = baseDefinition.process?.name || "";
  const candidate = changed.find((part) => part.entry === "process" || (part.export && part.export === processName))
    || (changed.length === 1 && !changed[0].export ? changed[0] : null);
  return candidate ? compileJavaScriptNodeProcess(candidate.source, baseDefinition) : baseDefinition.process;
}

function changedParts(baseParts = [], nextParts = [], kind) {
  const base = new Map((baseParts || []).filter((part) => part.kind === kind).map((part) => [part.id, part]));
  return (nextParts || []).filter((part) => part.kind === kind && JSON.stringify(part) !== JSON.stringify(base.get(part.id)));
}

function editorPanel(id, name, editor, data, alwaysAvailable = false) {
  const parts = data?.parts;
  const parameters = data?.parameters;
  return Object.freeze({
    id,
    name,
    editor,
    available: alwaysAvailable || !Array.isArray(parts) || parts.length > 0 || Object.keys(parameters || {}).length > 0,
    data: Object.freeze(data),
  });
}

function createForkId() {
  return globalThis.crypto?.randomUUID?.() || `local-${Date.now().toString(36)}`;
}
