import { NODE_PART_KINDS } from "./node-definition.js";
import { defineNode } from "./node-definition.js";
import { NODE_GROUP_EXECUTION_MODELS } from "./node-group.js";

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
      inlets: overrides.inlets || definition.inlets,
      outlets: overrides.outlets || definition.outlets,
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
  const graphChanged = executableGraphChanged(baseDefinition.parts, parts);
  const runtimeModule = compiledForkModule(baseDefinition, parts);
  const materialized = defineNode({
    ...baseDefinition,
    ...fork.definition,
    id: fork.id,
    version: "0.1.0",
    process: runtimeModule.process,
    moduleExports: runtimeModule.exports,
    metadata: {
      ...baseDefinition.metadata,
      ...fork.definition?.metadata,
      projectLocal: true,
      baseNode: fork.base,
    },
  });
  if (baseDefinition.implementation?.kind !== "group") return materialized;
  const executionModel = baseDefinition.implementation?.executionModel
    || (typeof baseDefinition.program === "function"
      ? NODE_GROUP_EXECUTION_MODELS.NATIVE_COMPOSITE
      : NODE_GROUP_EXECUTION_MODELS.GRAPH);
  if (graphChanged && executionModel === NODE_GROUP_EXECUTION_MODELS.NATIVE_COMPOSITE) {
    throw new Error(`NODE_NATIVE_COMPOSITE_GRAPH_EDIT_UNSUPPORTED:${baseDefinition.id}`);
  }
  return Object.freeze({
    ...materialized,
    compiler: baseDefinition.compiler || null,
    // A graph-semantic Group may retain a code implementation as an
    // optimization until its topology changes. Compiled Groups keep their
    // compiler host entry point. Native composites never accept topology
    // edits because their visible graph is explanatory rather than executable.
    program: graphChanged && executionModel === NODE_GROUP_EXECUTION_MODELS.GRAPH
      ? null
      : baseDefinition.program,
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

export function compileJavaScriptNodeModule(parts = [], definition = {}) {
  const moduleParts = orderJavaScriptModuleParts(parts, definition.id);
  if (!moduleParts.length) throw new Error(`NODE_FORK_JAVASCRIPT_EMPTY:${definition.id || "missing"}`);
  const entry = moduleEntryPart(moduleParts, definition);
  const emitted = [];
  const exportNames = new Set();
  let entryName = "";
  for (const [index, part] of moduleParts.entries()) {
    const result = emitJavaScriptModulePart(part, definition, index);
    emitted.push(`// node-part:${part.id}\n${result.source}`);
    for (const name of result.exports) exportNames.add(name);
    if (part === entry) entryName = result.entryName || result.exports[0] || "";
  }
  if (entry && !entryName) throw new Error(`NODE_FORK_JAVASCRIPT_ENTRY_INVALID:${definition.id}:${entry.id}`);
  const exportsSource = [...exportNames].map((name) => `${JSON.stringify(name)}: ${name}`).join(",\n");
  const bindings = Object.entries(definition.moduleBindings || {})
    .filter(([name]) => /^[A-Za-z_$][\w$]*$/.test(name));
  let compiled;
  try {
    compiled = Function(...bindings.map(([name]) => name), `"use strict";\n${emitted.join("\n\n")}\nreturn { process: ${entryName || "null"}, exports: { ${exportsSource} } };`)(
      ...bindings.map(([, value]) => value)
    );
  } catch (error) {
    throw new SyntaxError(`NODE_FORK_JAVASCRIPT_MODULE_INVALID:${definition.id || "missing"}:${error.message}`);
  }
  if (entry && typeof compiled.process !== "function") throw new Error(`NODE_FORK_JAVASCRIPT_ENTRY_INVALID:${definition.id}:${entry.id}`);
  return Object.freeze({
    process: compiled.process,
    exports: Object.freeze(compiled.exports),
    parts: Object.freeze(moduleParts.map((part) => part.id)),
  });
}

export function validateProjectNodeFork(baseDefinition, fork) {
  materializeProjectNodeFork(baseDefinition, fork);
  const parts = fork?.definition?.parts || [];
  const changedJavaScript = changedParts(baseDefinition.parts, parts, NODE_PART_KINDS.JAVASCRIPT);
  for (const part of changedJavaScript) {
    const code = String(part.source || "").trim();
    if (!code) throw new Error(`NODE_FORK_JAVASCRIPT_EMPTY:${baseDefinition.id}`);
  }
  if (changedJavaScript.length) {
    const moduleParts = parts.filter((part) => part.kind === NODE_PART_KINDS.JAVASCRIPT);
    if (moduleEntryPart(moduleParts, baseDefinition)) compileJavaScriptNodeModule(moduleParts, baseDefinition);
    else for (const part of changedJavaScript) compileJavaScriptNodeProcess(part.source, baseDefinition);
  }
  return true;
}

function compiledForkModule(baseDefinition, parts) {
  const nativeModuleGroup = baseDefinition.implementation?.kind === "group"
    && baseDefinition.metadata?.nodeOwnedNativeModule === true;
  if (
    baseDefinition.implementation?.kind !== "code"
    && baseDefinition.implementation?.kind !== "data"
    && !nativeModuleGroup
  ) {
    return { process: baseDefinition.process, exports: baseDefinition.moduleExports || {} };
  }
  const changed = changedParts(baseDefinition.parts, parts, NODE_PART_KINDS.JAVASCRIPT);
  if (!changed.length) return { process: baseDefinition.process, exports: baseDefinition.moduleExports || {} };
  const moduleParts = (parts || []).filter((part) => part.kind === NODE_PART_KINDS.JAVASCRIPT);
  const moduleEntry = moduleEntryPart(moduleParts, baseDefinition);
  if (moduleEntry) {
    const compiled = compileJavaScriptNodeModule(moduleParts, baseDefinition);
    return {
      process: nativeModuleGroup ? baseDefinition.process : compiled.process,
      exports: compiled.exports,
    };
  }
  const processName = baseDefinition.process?.name || "";
  const candidate = changed.find((part) => part.entry === "process" || (part.export && part.export === processName))
    || (changed.length === 1 && !changed[0].export ? changed[0] : null);
  return {
    process: candidate ? compileJavaScriptNodeProcess(candidate.source, baseDefinition) : baseDefinition.process,
    exports: baseDefinition.moduleExports || {},
  };
}

function moduleEntryPart(parts, definition) {
  const explicit = parts.filter((part) => part.entry === "process");
  if (explicit.length > 1) throw new Error(`NODE_FORK_JAVASCRIPT_MULTIPLE_ENTRIES:${definition.id || "missing"}`);
  if (explicit.length) return explicit[0];
  const processName = definition.process?.name || "";
  return processName ? parts.find((part) => partExports(part).includes(processName)) || null : null;
}

function orderJavaScriptModuleParts(parts, definitionId) {
  const items = (parts || []).filter((part) => part.kind === NODE_PART_KINDS.JAVASCRIPT);
  const byId = new Map(items.map((part) => [part.id, part]));
  const result = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (part) => {
    if (visited.has(part.id)) return;
    if (visiting.has(part.id)) throw new Error(`NODE_FORK_JAVASCRIPT_DEPENDENCY_CYCLE:${definitionId || "missing"}:${part.id}`);
    visiting.add(part.id);
    for (const dependencyId of part.dependsOn || []) {
      const dependency = byId.get(String(dependencyId || ""));
      if (!dependency) throw new Error(`NODE_FORK_JAVASCRIPT_DEPENDENCY_MISSING:${definitionId || "missing"}:${part.id}:${dependencyId}`);
      visit(dependency);
    }
    visiting.delete(part.id);
    visited.add(part.id);
    result.push(part);
  };
  for (const part of items) visit(part);
  return result;
}

function emitJavaScriptModulePart(part, definition, index) {
  const code = String(part.source || "").trim();
  if (!code) throw new Error(`NODE_FORK_JAVASCRIPT_EMPTY:${definition.id || "missing"}:${part.id}`);
  const exports = partExports(part);
  const explicitEntry = part.entry === "process";
  if (!exports.length && explicitEntry) {
    const name = `__nodeProcess${index}`;
    const inputNames = [...Object.keys(definition.inlets || {}), ...Object.keys(definition.parameters || {})]
      .filter((value) => /^[A-Za-z_$][\w$]*$/.test(value));
    return {
      source: `${part.asynchronous === true ? "async " : ""}function ${name}(inputs, context) { const { ${inputNames.join(", ")} } = inputs;\n${code}\n}`,
      exports: [],
      entryName: name,
    };
  }
  const exportName = exports[0] || "";
  let source = code
    .replace(/^\s*export\s+default\s+/, exportName ? `const ${exportName} = ` : "")
    .replace(/(^|\n)\s*export\s+(?=(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/g, "$1");
  const expression = /^(?:async\s*)?(?:function\s*\(|\(?[A-Za-z_$][\w$]*(?:\s*,[^)]*)?\)?\s*=>)/.test(source);
  if (exportName && expression) source = `const ${exportName} = (${source});`;
  return { source, exports, entryName: explicitEntry ? exportName : "" };
}

function partExports(part) {
  const values = [...(Array.isArray(part.exports) ? part.exports : []), ...(part.export ? [part.export] : [])];
  return [...new Set(values.map((value) => String(value || "")).filter((value) => /^[A-Za-z_$][\w$]*$/.test(value)))];
}

function changedParts(baseParts = [], nextParts = [], kind) {
  const base = new Map((baseParts || []).filter((part) => part.kind === kind).map((part) => [part.id, part]));
  return (nextParts || []).filter((part) => part.kind === kind && JSON.stringify(part) !== JSON.stringify(base.get(part.id)));
}

function executableGraphChanged(baseParts = [], nextParts = []) {
  const base = (baseParts || []).find((part) => part.kind === NODE_PART_KINDS.GRAPH);
  const next = (nextParts || []).find((part) => part.kind === NODE_PART_KINDS.GRAPH);
  return graphExecutionSignature(base) !== graphExecutionSignature(next);
}

function graphExecutionSignature(graph = {}) {
  return JSON.stringify({
    nodes: (graph?.nodes || []).map(({ position: _position, ...node }) => node),
    connections: graph?.connections || [],
    publicInlets: graph?.publicInlets || {},
    publicOutlets: graph?.publicOutlets || {},
  });
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
