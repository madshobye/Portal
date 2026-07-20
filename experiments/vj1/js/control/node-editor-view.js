import { createProjectNodeFork, materializeProjectNodeFork } from "../libraries/node-engine/node-editor.js";
import { esc, icon } from "./template-utils.js";

export function selectedNodeEditorTemplate(component, state, nodePackage) {
  if (!component || !nodePackage?.registry) return "";
  const group = (state?.nodes?.groups || []).find((item) => item.componentId === component.id);
  const topology = findTopologyNode(group?.nodes || [], state?.ui?.selectedChainItemId);
  if (!topology) return "";
  let baseDefinition;
  try {
    baseDefinition = nodePackage.registry.get(topology.nodeId, topology.nodeVersion);
  } catch {
    return "";
  }
  const graph = topology.nodes?.length
    ? { nodes: topology.nodes, connections: topology.connections || [] }
    : null;
  return nodeDefinitionEditorTemplate(baseDefinition, state, nodePackage, {
    graph,
    parameterValues: topology.parameters,
  });
}

export function nodeDefinitionEditorTemplate(baseDefinition, state, nodePackage, {
  graph = null,
  parameterValues = {},
} = {}) {
  if (!baseDefinition || !nodePackage?.registry) return "";
  const fork = activeForkFor(state?.nodes, baseDefinition);
  const definition = materializeForkSafely(baseDefinition, fork);
  const projection = nodePackage.editorProjection(definition, { projectForks: state?.nodes?.forks || [] });
  const visibleGraph = graph || projection.panel("graph")?.data?.parts?.[0] || null;
  const sourcePanels = [projection.panel("javascript"), projection.panel("shaders")]
    .filter((panel) => panel?.available);
  const editable = sourcePanels.some((panel) => panel.data.parts.some((part) => part.editable !== false));
  return `
    <div class="node-editor-projection" data-node-editor data-node-base-id="${esc(baseDefinition.id)}" data-node-base-version="${esc(baseDefinition.version)}">
      <div class="node-editor-identity">
        <span>${icon(definition.implementation.kind === "shader" ? "code_blocks" : definition.implementation.kind === "group" ? "account_tree" : "data_object")}</span>
        <span><strong>${esc(definition.name)}</strong><small>${esc(definition.id)} · v${esc(definition.version)}${fork ? " · project version" : ""}</small></span>
      </div>
      <p class="node-editor-description">${esc(definition.description)}</p>
      ${portSection("Inlets", definition.inlets)}
      ${portSection("Outlets", definition.outlets)}
      ${parameterSection(definition.parameters, parameterValues)}
      ${visibleGraph ? graphSection(visibleGraph) : ""}
      ${sourcePanels.map(sourcePanelTemplate).join("")}
      <details class="node-editor-section">
        <summary>Version and capabilities</summary>
        <div class="node-editor-tags">${(definition.capabilities || []).map((value) => `<span>${esc(value)}</span>`).join("") || "<span>none</span>"}</div>
      </details>
      ${editable ? `
        <div class="node-editor-actions">
          <button type="button" data-save-node-fork>${fork ? "Save project version" : "Create project version"}</button>
          ${fork ? `<button type="button" class="secondary" data-reset-node-fork>Use built-in version</button>` : ""}
        </div>
        <p class="soft-note">Shader edits become live after saving. JavaScript and graph source are stored in the project version for node tooling without adding work to the render loop.</p>
      ` : ""}
    </div>
  `;
}

export function withProjectNodeFork(nodes, baseDefinition, partSources = {}) {
  const current = nodes && typeof nodes === "object" ? nodes : {};
  const existing = activeForkFor(current, baseDefinition);
  const sourceParts = existing?.definition?.parts || baseDefinition.parts || [];
  const parts = sourceParts.map((part) => Object.prototype.hasOwnProperty.call(partSources, part.id)
    ? { ...part, source: String(partSources[part.id] ?? "") }
    : part);
  const fork = createProjectNodeFork(baseDefinition, {
    forkId: existing?.id?.split("/fork/").at(-1) || "project",
    name: existing?.definition?.name || `${baseDefinition.name} (Project version)`,
    description: existing?.definition?.description || baseDefinition.description,
    overrides: {
      ...existing?.definition,
      parts,
    },
  });
  return {
    ...current,
    forks: [
      ...(current.forks || []).filter((item) => item?.base?.id !== baseDefinition.id),
      { ...fork, active: true, updatedAt: new Date().toISOString() },
    ],
  };
}

export function withoutProjectNodeFork(nodes, baseDefinition) {
  const current = nodes && typeof nodes === "object" ? nodes : {};
  return {
    ...current,
    forks: (current.forks || []).filter((item) => item?.base?.id !== baseDefinition.id),
  };
}

function activeForkFor(nodes, definition) {
  return (nodes?.forks || []).findLast?.((fork) =>
    fork?.active !== false &&
    fork?.base?.id === definition.id &&
    fork?.base?.version === definition.version
  ) || [...(nodes?.forks || [])].reverse().find((fork) =>
    fork?.active !== false &&
    fork?.base?.id === definition.id &&
    fork?.base?.version === definition.version
  ) || null;
}

function materializeForkSafely(baseDefinition, fork) {
  if (!fork) return baseDefinition;
  try { return materializeProjectNodeFork(baseDefinition, fork); } catch { return baseDefinition; }
}

function findTopologyNode(nodes, id) {
  const target = String(id || "");
  for (const item of nodes || []) {
    if (item.role !== "control" && String(item.id || "") === target) return item;
    const nested = findTopologyNode(item.nodes || [], target);
    if (nested) return nested;
  }
  return null;
}

function portSection(label, ports = {}) {
  const entries = Object.values(ports || {});
  if (!entries.length) return "";
  return `
    <details class="node-editor-section">
      <summary>${esc(label)} · ${entries.length}</summary>
      <div class="node-editor-port-list">${entries.map((port) => `
        <div><strong>${esc(port.label || port.id)}</strong><span>${esc(typeName(port.type))}${rangeLabel(port)}</span></div>
      `).join("")}</div>
    </details>`;
}

function parameterSection(parameters = {}, values = {}) {
  const entries = Object.values(parameters || {});
  if (!entries.length) return "";
  return `
    <details class="node-editor-section">
      <summary>Parameters · ${entries.length}</summary>
      <div class="node-editor-port-list">${entries.map((parameter) => `
        <div><strong>${esc(parameter.label || parameter.id)}</strong><span>${esc(typeName(parameter.type))}${rangeLabel(parameter)} · ${esc(formatValue(values?.[parameter.id] ?? parameter.defaultValue))}</span></div>
      `).join("")}</div>
    </details>`;
}

function graphSection(graph) {
  const nodes = graph.nodes || [];
  const connections = graph.connections || [];
  return `
    <details class="node-editor-section">
      <summary>Internal graph · ${nodes.length} nodes</summary>
      <div class="node-editor-graph">
        ${nodes.map((node) => `<div><strong>${esc(node.id)}</strong><span>${esc(node.nodeId || node.type || "node")}</span></div>`).join("") || `<div><span>Code-owned relationships</span></div>`}
        ${connections.map((edge) => `<code>${esc(edge.from)} → ${esc(edge.to)}</code>`).join("")}
      </div>
    </details>`;
}

function sourcePanelTemplate(panel) {
  return panel.data.parts.map((part) => `
    <details class="node-editor-section node-editor-source" ${panel.id === "shaders" ? "open" : ""}>
      <summary>${esc(panel.name)} · ${esc(part.name || part.id)}</summary>
      <textarea spellcheck="false" data-node-part-source="${esc(part.id)}" ${part.editable === false ? "readonly" : ""}>${esc(part.source || "")}</textarea>
    </details>
  `).join("");
}

function typeName(type) {
  return typeof type === "string" ? type : type?.type || type?.id || "any";
}

function rangeLabel(port) {
  const range = port.expectedRange || port.allowedRange;
  return Array.isArray(range) ? ` · ${range[0]}–${range[1]}` : "";
}

function formatValue(value) {
  if (value === undefined) return "unset";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}
