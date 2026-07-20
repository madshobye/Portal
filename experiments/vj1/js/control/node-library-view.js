import { materializeProjectNodeDefinition, nodeDefinitionEditorTemplate } from "./node-editor-view.js";
import { nodeGraphCanvasTemplate } from "./node-graph-canvas.js?v=application-bootstrap-10";
import { emptyNote, esc, icon } from "./template-utils.js";

export function selectedLibraryNode(state, nodePackage) {
  const definitions = nodeDefinitions(nodePackage);
  const selectedId = String(state?.ui?.selectedNodeDefinitionId || "");
  return definitions.find((definition) => definition.id === selectedId) || definitions[0] || null;
}

export function selectedNodeWorkspaceTarget(state, nodePackage) {
  const groupId = String(state?.ui?.selectedNodeGroupId || "");
  const group = (state?.nodes?.groups || []).find((item) => item.id === groupId);
  if (group) return { kind: "project-group", id: group.id, group, definition: projectGroupDefinition(group, nodePackage?.registry) };
  const baseDefinition = selectedLibraryNode(state, nodePackage);
  return baseDefinition ? { kind: "definition", id: baseDefinition.id, baseDefinition, definition: materializeProjectNodeDefinition(baseDefinition, state) } : null;
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
        ${projectProgramSection(state)}
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
  const target = selectedNodeWorkspaceTarget(state, nodePackage);
  if (!target) return `<section class="node-library-workspace">${emptyNote("No registered nodes")}</section>`;
  const definition = target.definition;
  const graph = definition.parts?.find((part) => part.kind === "graph");
  const visualProjectProgram = target.kind === "project-group" && !!target.group.componentId;
  const routeProjectProgram = target.kind === "project-group" && (
    target.group.sceneId !== undefined || target.group.id === "vj1.output.main"
  );
  const applicationProjectProgram = target.kind === "project-group" && target.group.id === "vj1.application.program";
  return `
    <section class="node-library-workspace" data-node-library-workspace>
      <header class="node-library-header">
        <span class="material-symbols-rounded">${nodeIcon(definition)}</span>
        <span><strong>${esc(definition.name)}</strong><small>${esc(definition.id)} · v${esc(definition.version)}</small></span>
        <em>${target.kind === "project-group" ? "project program" : esc(definition.implementation.kind)}</em>
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
      ${graph ? nodeGraphCanvasTemplate(definition, nodePackage.registry, {
        topologyEditable: target.kind !== "project-group" || visualProjectProgram,
        connectionsEditable: target.kind !== "project-group" || visualProjectProgram || routeProjectProgram || applicationProjectProgram,
        editableConnectionTypes: applicationProjectProgram ? ["service", "state"] : null,
        nodesEditable: target.kind !== "project-group" || visualProjectProgram,
        layoutEditable: true,
        visualProgram: visualProjectProgram,
      }) : ""}
      <div class="node-library-parts">
        <h2>Editable parts</h2>
        <div>${(definition.parts || []).map((part) => `
          <article><span class="material-symbols-rounded">${partIcon(part.kind)}</span><strong>${esc(part.name || part.id)}</strong><small>${esc(part.kind)}${part.editable === false ? " · read only" : " · editable"}</small></article>
        `).join("") || emptyNote("Native node contract; no editable source parts")}</div>
      </div>
    </section>`;
}

export function nodeLibraryInspectorTemplate(state, nodePackage) {
  const target = selectedNodeWorkspaceTarget(state, nodePackage);
  if (!target) return emptyNote("Select a node");
  if (target.kind === "project-group") return projectGroupInspectorTemplate(target.group, {
    applicationStatus: target.group.id === "vj1.application.program"
      ? nodePackage?.applicationProgramStatus?.(state) || null
      : null,
  });
  return nodeDefinitionEditorTemplate(target.baseDefinition, state, nodePackage);
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
  for (const item of scope.querySelectorAll("[data-node-library-definition]")) {
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("application/x-vj1-node-definition", item.dataset.nodeLibraryDefinition);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
  }
}

function nodeDefinitions(nodePackage) {
  return (nodePackage?.registry?.list?.() || []).slice().sort((left, right) =>
    libraryRole(left).localeCompare(libraryRole(right)) || left.name.localeCompare(right.name));
}

function projectProgramSection(state) {
  const groups = (state?.nodes?.groups || []).filter((group) => String(group.id || "").startsWith("vj1."));
  if (!groups.length) return "";
  const selectedId = String(state?.ui?.selectedNodeGroupId || "");
  return `<section class="node-library-section node-project-programs">
    <h3>Project programs <small>${groups.length}</small></h3>
    ${groups.map((group) => `<button type="button" class="node-library-item ${group.id === selectedId ? "is-selected" : ""}" data-select-node-group="${esc(group.id)}" data-node-library-item="${esc(`${group.name || group.id} ${group.id} project program`.toLowerCase())}">
      <span class="material-symbols-rounded">account_tree</span>
      <span><strong>${esc(group.name || group.id)}</strong><small>${esc(group.id)}</small></span>
      <em>${esc(projectGroupKind(group))}</em>
    </button>`).join("")}
  </section>`;
}

function projectGroupDefinition(group, registry) {
  let base = null;
  try { base = registry?.get?.(group.nodeId, group.nodeVersion); } catch {}
  const inlets = Object.keys(group.publicInlets || {}).length
    ? portsFromPublic(group.publicInlets, "inlet")
    : base?.inlets || {};
  const outlets = Object.keys(group.publicOutlets || {}).length
    ? portsFromPublic(group.publicOutlets, "outlet")
    : base?.outlets || {};
  return {
    id: group.id,
    name: group.name || base?.name || group.id,
    version: group.nodeVersion || base?.version || "0.1.0",
    description: `Persisted ${projectGroupKind(group)} program. Its graph is project-owned and compiled by ${group.compiler?.id || group.generatedBy || "the application"}.`,
    implementation: { kind: "group" },
    inlets,
    outlets,
    parameters: {},
    capabilities: ["project-program", projectGroupKind(group)],
    parts: [{
      id: "project-graph",
      name: "Project graph",
      kind: "graph",
      editable: true,
      nodes: group.nodes || [],
      connections: group.connections || [],
      publicInlets: group.publicInlets || {},
      publicOutlets: group.publicOutlets || {},
    }],
    metadata: { projectGroup: true, generatedBy: group.generatedBy || "", baseNode: { id: group.id } },
  };
}

function portsFromPublic(ports, role) {
  return Object.fromEntries(Object.keys(ports || {}).map((id) => [id, {
    id, label: id, role, type: { type: "any" },
  }]));
}

function projectGroupKind(group) {
  if (group.componentId) return group.artifactType === "canvas" ? "canvas" : "component";
  if (group.sceneId !== undefined) return "scene";
  if (group.id === "vj1.output.main") return "output";
  if (group.id === "vj1.application.program") return "application";
  return "group";
}

function projectGroupInspectorTemplate(group, { applicationStatus = null } = {}) {
  const nodesEditable = !!group.componentId;
  const applicationProgram = group.id === "vj1.application.program";
  const connectionsEditable = nodesEditable || group.sceneId !== undefined || group.id === "vj1.output.main" || applicationProgram;
  const topologyLabel = applicationProgram
    ? applicationStatus?.valid === false
      ? "Executable wiring invalid"
      : applicationStatus?.requiresRestart
        ? "Executable wiring · reload required"
        : applicationStatus?.active
          ? "Executable wiring · active"
          : "Executable wiring · editable"
    : nodesEditable
      ? "Visual compiler · editable"
      : connectionsEditable
        ? "Compiler nodes · connections editable"
        : "Compiler-owned · layout editable";
  const note = applicationProgram
    ? applicationStatus?.valid === false
      ? `The service graph cannot activate: ${applicationStatus.error}. Reconnect the required service port; the running application remains unchanged.`
      : applicationStatus?.requiresRestart
        ? "Setup service wires and state-delivery routes are saved and compile on reload. Other runtime and cross-process wires remain locked until their service ports become executable."
        : "Setup service wires and state-delivery routes are compiled and active. Other runtime and cross-process wires remain compiler-locked."
    : nodesEditable
      ? "Connections compile once into the direct visual render plan. The live frame never traverses the editor graph."
      : connectionsEditable
        ? "Connections compile into setup-time route reachability. Generated Surface nodes stay synchronized with the project and never enter the render loop."
        : "Topology editing unlocks when this program's compiler consumes arbitrary rewiring. Layout changes are persisted now and never enter the render loop.";
  return `<div class="node-editor-projection">
    <div class="node-editor-identity"><span>${icon("account_tree")}</span><span><strong>${esc(group.name || group.id)}</strong><small>${esc(group.id)} · ${esc(projectGroupKind(group))}</small></span></div>
    <p class="node-editor-description">Persisted project program generated by ${esc(group.generatedBy || "project authoring")}.</p>
    <div class="node-editor-port-list">
      <div><strong>Nodes</strong><span>${group.nodes?.length || 0}</span></div>
      <div><strong>Connections</strong><span>${group.connections?.length || 0}</span></div>
      <div><strong>Compiler</strong><span>${esc(group.compiler?.id || "application-owned")}</span></div>
      <div><strong>Topology</strong><span>${esc(topologyLabel)}</span></div>
    </div>
    <p class="soft-note">${esc(note)}</p>
  </div>`;
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
  return `<button type="button" draggable="true" class="node-library-item ${selected ? "is-selected" : ""}" data-select-node-definition="${esc(definition.id)}" data-node-library-definition="${esc(definition.id)}" data-node-library-item="${esc(search)}">
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
