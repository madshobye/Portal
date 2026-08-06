import { materializeProjectNodeDefinition, nodeDefinitionEditorModel } from "./node-editor-view.js";
import { NODE_GRAPH_AUTHORING_TARGETS, nodeDefinitionPlaceableInGraph } from "./node-graph-canvas.js";

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

export function nodeLibraryRailModel(state, nodePackage) {
  const definitions = nodeDefinitions(nodePackage);
  const selected = selectedLibraryNode(state, nodePackage);
  const target = selectedNodeWorkspaceTarget(state, nodePackage);
  const authoringTarget = nodeGraphAuthoringTarget(target);
  const projectGroups = (state?.nodes?.groups || []).filter((group) => String(group.id || "").startsWith("vj1."));
  const sections = [];
  if (projectGroups.length) {
    sections.push({
      id: "project-programs",
      label: "Project programs",
      count: projectGroups.length,
      actions: [
        { id: "create-visual-group", label: "New visual Group", icon: "add" },
        { id: "create-scene3d-group", label: "New 3D Group", icon: "add" },
      ],
      items: projectGroups.map((group) => ({
        id: group.id,
        kind: "project-group",
        label: group.name || group.id,
        detail: group.id,
        meta: projectGroupKind(group),
        icon: "account_tree",
        selected: group.id === String(state?.ui?.selectedNodeGroupId || ""),
        search: `${group.name || group.id} ${group.id} project program ${projectGroupKind(group)}`.toLowerCase(),
      })),
    });
  }
  const references = state?.nodes?.packages || [];
  const installed = nodePackage?.installedPackages || [];
  const available = nodePackage?.availablePackages || [];
  const packageIds = [...new Set([...references, ...installed, ...available].map((entry) => entry.id).filter(Boolean))].sort();
  if (packageIds.length || (state?.nodes?.definitions || []).length || (state?.nodes?.forks || []).length) {
    const referencesById = new Map(references.map((entry) => [entry.id, entry]));
    const installedById = new Map(installed.map((entry) => [entry.id, entry]));
    const availableById = groupPackagesById(available);
    sections.push({
      id: "packages",
      label: "Package repository",
      count: packageIds.length,
      actions: [
        { id: "import-package", label: "Import package", icon: "upload" },
        { id: "export-selected-package", label: "Export selected", icon: "download" },
      ],
      items: packageIds.map((id) => {
        const reference = referencesById.get(id);
        const versions = availableById.get(id) || [];
        const pkg = installedById.get(id) || versions.find((item) => item.version === reference?.version) || versions[0] || {};
        const direct = Boolean(reference);
        const enabled = reference?.enabled !== false;
        const version = reference?.version || pkg.version || "";
        return {
          id,
          kind: "package",
          presentation: "card",
          selectable: false,
          label: pkg.name || id,
          detail: `${id}${version ? ` · v${version}` : ""}`,
          meta: direct ? enabled ? "active" : "disabled" : installedById.has(id) ? "dependency" : "available",
          icon: "inventory_2",
          disabled: !enabled,
          description: pkg.description || (enabled ? "Package manifest is not loaded." : "Package is disabled for this project."),
          facts: [
            `${pkg.definitions?.length || 0} nodes`,
            `${pkg.visualLibrary?.length || 0} visuals`,
            `${pkg.resources?.length || 0} resources`,
          ],
          fields: versions.length && !installedById.has(id) ? [{
            id: "version",
            label: "Version",
            value: version,
            action: "install-package",
            options: versions.map((entry) => ({ value: entry.version, label: entry.version })),
          }] : [],
          actions: [
            ...(versions.length && !installedById.has(id) ? [{ id: "install-package", label: direct ? "Use version" : "Install", value: version }] : []),
            ...(direct ? [{ id: "toggle-package", label: enabled ? "Disable" : "Enable", value: enabled ? "false" : "true" }, { id: "remove-package", label: "Remove reference" }] : []),
            ...(pkg.id ? [{ id: "export-package-folder", label: "Export package", value: version }] : []),
          ],
          search: `${pkg.name || id} ${id} package ${(pkg.resources || []).map((entry) => entry.path).join(" ")}`.toLowerCase(),
        };
      }),
    });
  }
  for (const group of groupByLibraryRole(definitions, nodePackage)) {
    sections.push({
      id: `definitions-${group.label}`,
      label: group.label,
      count: group.items.length,
      items: group.items.map((definition) => {
        const placeable = Boolean(authoringTarget) && definition.id !== target?.id && nodeDefinitionPlaceableInGraph(definition, authoringTarget);
        return {
          id: definition.id,
          kind: "definition",
          label: definition.name,
          detail: definition.id,
          meta: definition.implementation.kind,
          icon: nodeIcon(definition),
          selected: definition.id === selected?.id,
          draggable: placeable,
          disabled: Boolean(authoringTarget) && !placeable,
          search: `${definition.name} ${definition.id} ${group.label} ${(definition.capabilities || []).join(" ")}`.toLowerCase(),
        };
      }),
    });
  }
  return {
    title: "Node library",
    icon: "schema",
    searchPlaceholder: "Filter nodes",
    emptyText: "No registered nodes",
    sections,
  };
}

export function nodeLibraryStudioModel(state, nodePackage) {
  const target = selectedNodeWorkspaceTarget(state, nodePackage);
  if (!target) return { target: null, definition: null, graph: null, contextLabel: "", graphOptions: {} };
  const definition = target.definition;
  const graph = definition.parts?.find((part) => part.kind === "graph") || null;
  const definitionGraphEditable = graph?.editable !== false;
  const visualProjectProgram = target.kind === "project-group" && (
    !!target.group.componentId || target.group.kind === "visual-group"
  ) || target.kind === "definition" && definition.metadata?.visualCompilerHook?.id === "vj1.visual.compound";
  const routeProjectProgram = target.kind === "project-group" && (
    target.group.mappingId !== undefined || target.group.id === "vj1.output.main"
  );
  const applicationProjectProgram = target.kind === "project-group" && target.group.id === "vj1.application.program";
  const authoringTarget = nodeGraphAuthoringTarget(target);
  const nodesEditable = definitionGraphEditable && !!authoringTarget;
  const connectionsEditable = definitionGraphEditable && (nodesEditable || routeProjectProgram || applicationProjectProgram);
  const installedPackage = target.kind === "definition"
    ? nodePackage.packageForDefinition?.(target.baseDefinition)
    : null;
  return {
    target,
    definition,
    graph,
    contextLabel: target.kind === "project-group"
      ? "project program"
      : installedPackage?.name || installedPackage?.id || definition.implementation.kind,
    graphOptions: {
      topologyEditable: nodesEditable || connectionsEditable,
      connectionsEditable,
      editableConnectionTypes: applicationProjectProgram ? ["service", "state"] : null,
      nodesEditable,
      parametersEditable: definitionGraphEditable && (target.kind === "definition" || visualProjectProgram),
      providersEditable: nodesEditable,
      publicInterfaceEditable: target.kind === "definition" && definition.metadata?.projectOwned === true,
      layoutEditable: true,
      visualProgram: authoringTarget === NODE_GRAPH_AUTHORING_TARGETS.VISUAL,
      authoringTarget,
    },
  };
}

export function nodeLibraryInspectorModel(state, nodePackage) {
  const target = selectedNodeWorkspaceTarget(state, nodePackage);
  if (!target) return null;
  if (target.kind !== "project-group") {
    return nodeDefinitionEditorModel(target.baseDefinition, state, nodePackage);
  }
  const group = target.group;
  const applicationStatus = group.id === "vj1.application.program"
    ? nodePackage?.applicationProgramStatus?.(state) || null
    : null;
  const nodesEditable = Boolean(group.componentId);
  const applicationProgram = group.id === "vj1.application.program";
  const connectionsEditable = nodesEditable || group.mappingId !== undefined || group.id === "vj1.output.main" || applicationProgram;
  const topologyLabel = applicationProgram
    ? applicationStatus?.valid === false ? "Executable wiring invalid"
      : applicationStatus?.requiresRestart ? "Executable wiring · reload required"
        : applicationStatus?.active ? "Executable wiring · active" : "Executable wiring · editable"
    : nodesEditable ? "Visual compiler · editable"
      : connectionsEditable ? "Compiler nodes · connections editable" : "Compiler-owned · layout editable";
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
  return {
    baseId: group.id,
    baseVersion: group.nodeVersion || "",
    name: group.name || group.id,
    id: group.id,
    version: group.nodeVersion || "project",
    icon: "account_tree",
    description: `Persisted project program generated by ${group.generatedBy || "project authoring"}.`,
    activation: note,
    forked: false,
    sections: [{
      id: "program",
      label: "Program",
      rows: [
        { label: "Nodes", value: String(group.nodes?.length || 0) },
        { label: "Connections", value: String(group.connections?.length || 0) },
        { label: "Compiler", value: group.compiler?.id || "application-owned" },
        { label: "Topology", value: topologyLabel },
      ],
    }],
    sources: [],
    capabilities: [projectGroupKind(group), "project-program"],
    editable: false,
  };
}

function nodeDefinitions(nodePackage) {
  return (nodePackage?.registry?.list?.() || []).slice().sort((left, right) =>
    libraryRole(left).localeCompare(libraryRole(right)) || left.name.localeCompare(right.name));
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

function groupByLibraryRole(definitions, nodePackage) {
  const groups = new Map();
  for (const definition of definitions) {
    const label = libraryRole(definition, nodePackage);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(definition);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

function groupPackagesById(packages = []) {
  const groups = new Map();
  for (const pkg of packages) {
    if (!pkg?.id) continue;
    if (!groups.has(pkg.id)) groups.set(pkg.id, []);
    groups.get(pkg.id).push(pkg);
  }
  for (const versions of groups.values()) {
    versions.sort((left, right) => String(right.version || "").localeCompare(String(left.version || ""), undefined, { numeric: true }));
  }
  return groups;
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
  if (definition.compiler?.target === "scene-3d") return NODE_GRAPH_AUTHORING_TARGETS.SCENE_3D;
  if (hookId === "vj1.visual.compound") return NODE_GRAPH_AUTHORING_TARGETS.VISUAL;
  return definition.implementation?.executionModel === "graph"
    ? NODE_GRAPH_AUTHORING_TARGETS.GENERIC
    : "";
}

function nodeIcon(definition) {
  if (definition.implementation.kind === "shader") return "gradient";
  if (definition.implementation.kind === "group") return "account_tree";
  if (definition.implementation.kind === "data") return "database";
  return "data_object";
}
