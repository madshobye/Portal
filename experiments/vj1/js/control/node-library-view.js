import { nodeDefinitionEditorTemplate } from "./node-editor-view.js";
import { emptyNote, esc, icon } from "./template-utils.js";

export function selectedLibraryNode(state, nodePackage) {
  const definitions = nodeDefinitions(nodePackage);
  const selectedId = String(state?.ui?.selectedNodeDefinitionId || "");
  return definitions.find((definition) => definition.id === selectedId) || definitions[0] || null;
}

export function nodeLibraryRailTemplate(state, nodePackage) {
  const definitions = nodeDefinitions(nodePackage);
  const selected = selectedLibraryNode(state, nodePackage);
  const sections = groupByLibraryRole(definitions);
  return `
    <div class="ui-section rail-section rail-list-section node-library-rail">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">schema</span><span>Node library</span></div>
      <label class="node-library-search"><span class="material-symbols-rounded">search</span><input type="search" placeholder="Filter nodes" data-node-library-filter /></label>
      <div class="node-library-list rail-scroll-list" data-scroll-region data-scroll-key="node-library">
        ${sections.map(({ label, items }) => `
          <section class="node-library-section">
            <h3>${esc(label)} <small>${items.length}</small></h3>
            ${items.map((definition) => nodeListItem(definition, definition.id === selected?.id)).join("")}
          </section>
        `).join("") || emptyNote("No registered nodes")}
      </div>
    </div>`;
}

export function nodeLibraryStudioTemplate(state, nodePackage) {
  const definition = selectedLibraryNode(state, nodePackage);
  if (!definition) return `<section class="node-library-workspace">${emptyNote("No registered nodes")}</section>`;
  const graph = definition.parts?.find((part) => part.kind === "graph");
  return `
    <section class="node-library-workspace" data-node-library-workspace>
      <header class="node-library-header">
        <span class="material-symbols-rounded">${nodeIcon(definition)}</span>
        <span><strong>${esc(definition.name)}</strong><small>${esc(definition.id)} · v${esc(definition.version)}</small></span>
        <em>${esc(definition.implementation.kind)}</em>
      </header>
      <p>${esc(definition.description)}</p>
      <div class="node-structure-canvas">
        ${portColumn("Inlets", definition.inlets, "inlet")}
        <article class="node-structure-card">
          <span class="material-symbols-rounded">${nodeIcon(definition)}</span>
          <strong>${esc(definition.name)}</strong>
          <small>${Object.keys(definition.parameters || {}).length} params · ${definition.parts?.length || 0} parts</small>
        </article>
        ${portColumn("Outlets", definition.outlets, "outlet")}
      </div>
      ${graph ? internalGraphTemplate(graph, nodePackage) : ""}
      <div class="node-library-parts">
        <h2>Editable parts</h2>
        <div>${(definition.parts || []).map((part) => `
          <article><span class="material-symbols-rounded">${partIcon(part.kind)}</span><strong>${esc(part.name || part.id)}</strong><small>${esc(part.kind)}${part.editable === false ? " · read only" : " · editable"}</small></article>
        `).join("") || emptyNote("Native node contract; no editable source parts")}</div>
      </div>
    </section>`;
}

export function nodeLibraryInspectorTemplate(state, nodePackage) {
  const definition = selectedLibraryNode(state, nodePackage);
  return definition
    ? nodeDefinitionEditorTemplate(definition, state, nodePackage)
    : emptyNote("Select a node");
}

export function bindNodeLibraryFilter(scope) {
  const input = scope?.querySelector?.("[data-node-library-filter]");
  if (!input || input.dataset.bound) return;
  input.dataset.bound = "true";
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    for (const item of scope.querySelectorAll("[data-node-library-item]")) {
      item.classList.toggle("is-hidden", !!query && !item.dataset.nodeLibraryItem.includes(query));
    }
    for (const section of scope.querySelectorAll(".node-library-section")) {
      section.classList.toggle("is-hidden", !section.querySelector("[data-node-library-item]:not(.is-hidden)"));
    }
  });
}

function nodeDefinitions(nodePackage) {
  return (nodePackage?.registry?.list?.() || []).slice().sort((left, right) =>
    libraryRole(left).localeCompare(libraryRole(right)) || left.name.localeCompare(right.name));
}

function groupByLibraryRole(definitions) {
  const groups = new Map();
  for (const definition of definitions) {
    const label = libraryRole(definition);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(definition);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

function libraryRole(definition) {
  if (definition.metadata?.visualKind === "generator") return "Generators";
  if (definition.metadata?.visualKind === "effect") return "Effects";
  if (definition.implementation.kind === "group") return "Groups";
  if (definition.capabilities?.some((value) => value.includes("mesh"))) return "Mesh";
  if (definition.capabilities?.includes("control-node")) return "Controls";
  return "Core systems";
}

function nodeListItem(definition, selected) {
  const search = `${definition.name} ${definition.id} ${libraryRole(definition)} ${(definition.capabilities || []).join(" ")}`.toLowerCase();
  return `<button type="button" class="node-library-item ${selected ? "is-selected" : ""}" data-select-node-definition="${esc(definition.id)}" data-node-library-item="${esc(search)}">
    <span class="material-symbols-rounded">${nodeIcon(definition)}</span>
    <span><strong>${esc(definition.name)}</strong><small>${esc(definition.id)}</small></span>
    <em>${esc(definition.implementation.kind)}</em>
  </button>`;
}

function portColumn(label, ports, role) {
  const entries = Object.values(ports || {});
  return `<div class="node-structure-ports is-${role}"><h2>${label}</h2>${entries.map((port) => `
    <div><i></i><span><strong>${esc(port.label || port.id)}</strong><small>${esc(typeName(port.type))}${rangeLabel(port)}</small></span></div>
  `).join("") || `<small>None</small>`}</div>`;
}

function internalGraphTemplate(graph, nodePackage) {
  return `<div class="node-internal-graph">
    <h2>Internal group structure <small>${graph.nodes?.length || 0} nodes · ${graph.connections?.length || 0} connections</small></h2>
    <div class="node-internal-flow">
      ${(graph.nodes || []).map((node) => {
        let name = node.type;
        try { name = nodePackage.registry.get(node.type, node.version).name; } catch {}
        return `<article><span class="material-symbols-rounded">data_object</span><strong>${esc(node.id)}</strong><small>${esc(name)}</small></article>`;
      }).join("") || emptyNote("This group accepts project-defined child nodes")}
    </div>
    <div class="node-internal-connections">${(graph.connections || []).map((edge) => `<code>${esc(edge.from)} → ${esc(edge.to)}</code>`).join("")}</div>
  </div>`;
}

function nodeIcon(definition) {
  if (definition.implementation.kind === "shader") return "gradient";
  if (definition.implementation.kind === "group") return "account_tree";
  if (definition.implementation.kind === "data") return "database";
  return "data_object";
}

function partIcon(kind) {
  return kind === "shader" ? "gradient" : kind === "graph" ? "account_tree" : kind === "asset" ? "deployed_code" : kind === "documentation" ? "description" : "code_blocks";
}

function typeName(type) {
  return typeof type === "string" ? type : type?.type || type?.id || "any";
}

function rangeLabel(port) {
  const range = port.expectedRange || port.allowedRange;
  return Array.isArray(range) ? ` · ${range[0]}–${range[1]}` : "";
}
