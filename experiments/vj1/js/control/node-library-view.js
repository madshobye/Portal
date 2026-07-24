import { materializeProjectNodeDefinition, nodeDefinitionEditorTemplate } from "./node-editor-view.js?v=project-group-authoring-public-group-ports-1";
import { NODE_GRAPH_AUTHORING_TARGETS, nodeDefinitionPlaceableInGraph, nodeGraphCanvasTemplate } from "./node-graph-canvas.js?v=public-control-node-configuration-editable-inlets-placement-contract-2";
import { emptyNote, esc, icon } from "./template-utils.js";
import { railListSectionTemplate } from "./view-primitives.js?v=uniform-section-hierarchy-card-type-icons-1";

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
  const target = selectedNodeWorkspaceTarget(state, nodePackage);
  const authoringTarget = nodeGraphAuthoringTarget(target);
  const sections = groupByLibraryRole(definitions, nodePackage);
  const content = `${projectProgramSection(state)}
        ${installedPackageSection(state, nodePackage)}
        ${sections.map(({ label, items }) => `
          <section class="node-library-section">
            <h3>${esc(label)} <small>${items.length}</small></h3>
            ${items.map((definition) => nodeListItem(
              definition,
              definition.id === selected?.id,
              nodePackage,
              {
                authoringTarget,
                targetId: target?.id || "",
              },
            )).join("")}
          </section>
        `).join("")}`;
  return railListSectionTemplate({
    iconName: "schema",
    title: "Node library",
    beforeListHtml: `<label class="node-library-search"><span class="material-symbols-rounded">search</span><input type="search" placeholder="Filter nodes" data-node-library-filter /></label>`,
    content,
    emptyText: "No registered nodes",
    className: "node-library-rail",
    listClassName: "node-library-list",
    scrollKey: "node-library",
  });
}

export function nodeLibraryStudioTemplate(state, nodePackage) {
  const target = selectedNodeWorkspaceTarget(state, nodePackage);
  if (!target) return `<section class="node-library-workspace">${emptyNote("No registered nodes")}</section>`;
  const definition = target.definition;
  const graph = definition.parts?.find((part) => part.kind === "graph");
  const definitionGraphEditable = graph?.editable !== false;
  const visualProjectProgram = target.kind === "project-group" && (
    !!target.group.componentId || target.group.kind === "visual-group"
  ) || target.kind === "definition" &&
    definition.metadata?.visualCompilerHook?.id === "vj1.visual.compound";
  const routeProjectProgram = target.kind === "project-group" && (
    target.group.mappingId !== undefined || target.group.id === "vj1.output.main"
  );
  const applicationProjectProgram = target.kind === "project-group" && target.group.id === "vj1.application.program";
  const authoringTarget = nodeGraphAuthoringTarget(target);
  const specializedVisualProgram = target.kind === "definition" &&
    definition.metadata?.visualCompilerHook?.id === "vj1.visual.specialized-compound";
  const nodesEditable = definitionGraphEditable && !!authoringTarget;
  const connectionsEditable = definitionGraphEditable && (
    nodesEditable || routeProjectProgram || applicationProjectProgram
  );
  const installedPackage = target.kind === "definition"
    ? nodePackage.packageForDefinition?.(target.baseDefinition)
    : null;
  return `
    <section class="node-library-workspace" data-node-library-workspace>
      <header class="node-library-header">
        <span class="material-symbols-rounded">${nodeIcon(definition)}</span>
        <span><strong>${esc(definition.name)}</strong><small>${esc(definition.id)} · v${esc(definition.version)}</small></span>
        <em>${target.kind === "project-group"
          ? "project program"
          : installedPackage
            ? esc(installedPackage.name || installedPackage.id)
            : esc(definition.implementation.kind)}</em>
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
        topologyEditable: nodesEditable || connectionsEditable,
        connectionsEditable,
        editableConnectionTypes: applicationProjectProgram ? ["service", "state"] : null,
        nodesEditable,
        parametersEditable: definitionGraphEditable && (
          target.kind === "definition" || visualProjectProgram
        ),
        providersEditable: nodesEditable || specializedVisualProgram,
        publicInterfaceEditable: target.kind === "definition" && definition.metadata?.projectOwned === true,
        layoutEditable: true,
        visualProgram: authoringTarget === NODE_GRAPH_AUTHORING_TARGETS.VISUAL,
        authoringTarget,
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
      if (item.dataset.nodePlaceable !== "true") {
        event.preventDefault();
        return;
      }
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
    <div class="node-project-group-actions">
      <button type="button" class="secondary node-create-visual-group" data-create-visual-group data-create-project-group="visual" title="Create an empty reusable texture Group compiled before rendering">New visual Group</button>
      <button type="button" class="secondary" data-create-project-group="scene3d" title="Create an editable mesh, material, camera, Scene, and image Group compiled into retained 3D render steps">New 3D Group</button>
    </div>
    ${groups.map((group) => `<button type="button" class="node-library-item ${group.id === selectedId ? "is-selected" : ""}" data-select-node-group="${esc(group.id)}" data-node-library-item="${esc(`${group.name || group.id} ${group.id} project program`.toLowerCase())}">
      <span class="material-symbols-rounded">account_tree</span>
      <span><strong>${esc(group.name || group.id)}</strong><small>${esc(group.id)}</small></span>
      <em>${esc(projectGroupKind(group))}</em>
    </button>`).join("")}
  </section>`;
}

function installedPackageSection(state, nodePackage) {
  const references = state?.nodes?.packages || [];
  const installedPackages = nodePackage?.installedPackages || [];
  const availablePackages = nodePackage?.availablePackages || [];
  const hasProjectOwnedNodes = ["groups", "definitions", "forks"]
    .some((key) => (state?.nodes?.[key] || []).length);
  if (!references.length && !installedPackages.length && !availablePackages.length && !hasProjectOwnedNodes) return "";
  const referencesById = new Map(references.map((reference) => [reference.id, reference]));
  const installedById = new Map(installedPackages.map((installedPackage) => [
    installedPackage.id, installedPackage,
  ]));
  const availableById = groupPackagesById(availablePackages);
  const ids = [...new Set([
    ...referencesById.keys(),
    ...installedById.keys(),
    ...availableById.keys(),
  ])].sort();
  return `<section class="node-library-section node-installed-packages">
    <h3>Package repository <small>${ids.length}</small></h3>
    <div class="node-package-repository-actions">
      <button type="button" class="secondary" data-node-package-import title="Validate and copy a complete package folder into this project's library">Import package</button>
      <button type="button" class="secondary" data-node-package-export title="Write the selected project-owned Group, fork, or definition as a new exact package manifest">Export selected</button>
    </div>
    ${ids.map((id) => {
      const reference = referencesById.get(id);
      const versions = availableById.get(id) || [];
      const installedPackage = installedById.get(id)
        || versions.find((item) => item.version === reference?.version)
        || versions[0];
      const enabled = reference?.enabled !== false;
      const direct = !!reference;
      const dependency = !direct && installedById.has(id);
      const resources = installedPackage?.resources || [];
      const visuals = installedPackage?.visualLibrary || [];
      const definitions = installedPackage?.definitions || [];
      const dependencies = installedPackage?.dependencies || [];
      const search = `${installedPackage?.name || id} ${id} package ${resources.map((item) => item.path).join(" ")}`.toLowerCase();
      return `<article class="node-package-card${enabled ? "" : " is-disabled"}" data-node-library-item="${esc(search)}">
        <header>
          <span class="material-symbols-rounded">inventory_2</span>
          <span><strong>${esc(installedPackage?.name || id)}</strong><small>${esc(id)} · v${esc(reference?.version || installedPackage?.version || "")}</small></span>
          <em>${direct ? enabled ? "active" : "disabled" : dependency ? "dependency" : "available"}</em>
        </header>
        <p>${esc(installedPackage?.description || (enabled ? "Package manifest is not loaded." : "Package is disabled for this project."))}</p>
        ${installedPackage ? `<details>
          <summary>${definitions.length} nodes · ${visuals.length} visuals · ${resources.length} resources</summary>
          ${visuals.length ? `<strong>Visual artifacts</strong><ul>${visuals.map((artifact) =>
            `<li>${esc(artifact.name || artifact.id)} <small>${esc(artifact.artifactType)}</small></li>`).join("")}</ul>` : ""}
          ${resources.length ? `<strong>Resources</strong><ul>${resources.map((resource) =>
            `<li>${esc(resource.path)} <small>${esc(resource.kind || resource.mediaType || "resource")}</small></li>`).join("")}</ul>` : ""}
          ${dependencies.length ? `<strong>Dependencies</strong><ul>${dependencies.map((dependency) =>
            `<li>${esc(dependency.id)} <small>${esc(dependency.range || dependency.version || "*")}</small></li>`).join("")}</ul>` : ""}
        </details>` : ""}
        ${installedPackage ? `<footer>
          ${!dependency && versions.length ? `<label><span>Version</span><select data-node-package-version-select="${esc(id)}" aria-label="${esc(`${installedPackage?.name || id} version`)}">${versions.map((availablePackage) =>
            `<option value="${esc(availablePackage.version)}"${availablePackage.version === (reference?.version || installedPackage?.version) ? " selected" : ""}>${esc(availablePackage.version)}</option>`).join("")}</select></label>
          <button type="button" class="secondary" data-node-package-install="${esc(id)}">${direct ? "Use version" : "Install"}</button>` : ""}
          ${direct ? `<button type="button" class="secondary" data-node-package-toggle="${esc(id)}" data-node-package-enabled="${enabled ? "true" : "false"}">${enabled ? "Disable" : "Enable"}</button>
          <button type="button" class="secondary" data-node-package-remove="${esc(id)}" title="Remove the project reference; package files remain in the folder">Remove reference</button>` : ""}
          <button type="button" class="secondary" data-node-package-export-folder="${esc(id)}" data-node-package-version="${esc(reference?.version || installedPackage.version)}" title="Copy this exact package and every declared resource to another folder">Export package</button>
        </footer>` : ""}
      </article>`;
    }).join("")}
  </section>`;
}

function groupPackagesById(packages = []) {
  const grouped = new Map();
  for (const nodePackage of packages) {
    if (!grouped.has(nodePackage.id)) grouped.set(nodePackage.id, []);
    grouped.get(nodePackage.id).push(nodePackage);
  }
  return grouped;
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
  if (group.mappingId !== undefined) return "mapping";
  if (group.id === "vj1.output.main") return "output";
  if (group.id === "vj1.application.program") return "application";
  return "group";
}

function projectGroupInspectorTemplate(group, { applicationStatus = null } = {}) {
  const nodesEditable = !!group.componentId;
  const applicationProgram = group.id === "vj1.application.program";
  const connectionsEditable = nodesEditable || group.mappingId !== undefined || group.id === "vj1.output.main" || applicationProgram;
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

function groupByLibraryRole(definitions, nodePackage) {
  const groups = new Map();
  for (const definition of definitions) {
    const label = libraryRole(definition, nodePackage);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(definition);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

function libraryRole(definition, nodePackage = null) {
  const installedPackage = nodePackage?.packageForDefinition?.(definition);
  if (installedPackage) return `Installed · ${installedPackage.name || installedPackage.id}`;
  if (definition.metadata?.visualKind === "generator") return "Generators";
  if (definition.metadata?.visualKind === "effect") return "Effects";
  if (definition.implementation.kind === "group") return "Groups";
  if (definition.capabilities?.some((value) => value.includes("mesh"))) return "Mesh";
  if (definition.capabilities?.includes("control-node")) return "Controls";
  return "Core systems";
}

function nodeListItem(definition, selected, nodePackage, {
  authoringTarget = "",
  targetId = "",
} = {}) {
  const search = `${definition.name} ${definition.id} ${libraryRole(definition, nodePackage)} ${(definition.capabilities || []).join(" ")}`.toLowerCase();
  const placeable = !!authoringTarget &&
    definition.id !== targetId &&
    nodeDefinitionPlaceableInGraph(definition, authoringTarget);
  const placementTitle = authoringTarget
    ? placeable
      ? `Drag ${definition.name} into the selected graph`
      : `${definition.name} is inspectable but not executable in the selected graph`
    : `Inspect ${definition.name}`;
  return `<button type="button" draggable="${placeable}" class="node-library-item ${selected ? "is-selected" : ""}${authoringTarget && !placeable ? " is-not-placeable" : ""}" data-select-node-definition="${esc(definition.id)}" data-node-library-definition="${esc(definition.id)}" data-node-placeable="${placeable}" data-node-library-item="${esc(search)}" title="${esc(placementTitle)}">
    <span class="material-symbols-rounded">${nodeIcon(definition)}</span>
    <span><strong>${esc(definition.name)}</strong><small>${esc(definition.id)}</small></span>
    <em>${esc(definition.implementation.kind)}</em>
  </button>`;
}

export function nodeGraphAuthoringTarget(target) {
  const definition = target?.definition;
  const graph = definition?.parts?.find((part) => part.kind === "graph");
  if (!graph || graph.editable === false) return "";
  if (target.kind === "project-group") {
    return target.group?.componentId || target.group?.kind === "visual-group"
      ? NODE_GRAPH_AUTHORING_TARGETS.VISUAL
      : "";
  }
  if (definition.implementation?.executionModel === "native-composite") return "";
  const hookId = definition.metadata?.visualCompilerHook?.id;
  if (hookId === "vj1.visual.specialized-compound") return "";
  if (definition.compiler?.target === "scene-3d") return NODE_GRAPH_AUTHORING_TARGETS.SCENE_3D;
  if (hookId === "vj1.visual.compound") return NODE_GRAPH_AUTHORING_TARGETS.VISUAL;
  return definition.implementation?.executionModel === "graph"
    ? NODE_GRAPH_AUTHORING_TARGETS.GENERIC
    : "";
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
