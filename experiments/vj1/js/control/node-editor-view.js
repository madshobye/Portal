import { createProjectNodeFork, materializeProjectNodeFork, validateProjectNodeFork } from "../libraries/node-engine/node-editor.js";
import { compileSdf2dSketchSource } from "../libraries/procedural-2d/compiler.js";

export function selectedNodeEditorModel(component, state, nodePackage) {
  if (!component || !nodePackage?.registry) return null;
  const group = (state?.nodes?.groups || []).find((item) => item.componentId === component.id);
  const topology = findTopologyNode(group?.nodes || [], state?.ui?.selectedChainItemId);
  if (!topology) return null;
  let baseDefinition;
  try {
    baseDefinition = nodePackage.registry.get(topology.nodeId, topology.nodeVersion);
  } catch {
    return null;
  }
  const graph = topology.nodes?.length
    ? { nodes: topology.nodes, connections: topology.connections || [] }
    : null;
  return nodeDefinitionEditorModel(baseDefinition, state, nodePackage, {
    graph,
    parameterValues: topology.parameters,
  });
}

export function nodeDefinitionEditorModel(baseDefinition, state, nodePackage, {
  graph = null,
  parameterValues = {},
} = {}) {
  if (!baseDefinition || !nodePackage?.registry) return null;
  const fork = activeForkFor(state?.nodes, baseDefinition);
  const definition = materializeForkSafely(baseDefinition, fork);
  const projection = nodePackage.editorProjection(definition, { projectForks: state?.nodes?.forks || [] });
  const visibleGraph = graph || projection.panel("graph")?.data?.parts?.[0] || null;
  const sourcePanels = [projection.panel("javascript"), projection.panel("shaders")]
    .filter((panel) => panel?.available);
  const graphPanel = projection.panel("graph");
  const editablePanels = [...sourcePanels, ...(graphPanel?.available ? [graphPanel] : [])];
  const editable = editablePanels.some((panel) => panel.data.parts.some((part) => part.editable !== false));
  return {
    baseId: baseDefinition.id,
    baseVersion: baseDefinition.version,
    name: definition.name,
    id: definition.id,
    version: definition.version,
    icon: definition.implementation.kind === "shader" ? "code_blocks"
      : definition.implementation.kind === "group" ? "account_tree"
        : "data_object",
    description: definition.description,
    activation: authoringActivationLabel(definition),
    forked: Boolean(fork),
    sections: [
      editorPortModel("Inlets", definition.inlets),
      editorPortModel("Outlets", definition.outlets),
      editorParameterModel(definition.parameters, parameterValues),
      visibleGraph ? editorGraphModel(visibleGraph) : null,
    ].filter(Boolean),
    sources: [
      ...(graphPanel?.available ? graphPanel.data.parts.map((part) => ({
        id: part.id,
        label: `${graphPanel.name} · ${part.name || part.id}`,
        value: JSON.stringify({
          nodes: part.nodes || [],
          connections: part.connections || [],
          publicInlets: part.publicInlets || {},
          publicOutlets: part.publicOutlets || {},
        }, null, 2),
        readOnly: part.editable === false,
        open: false,
      })) : []),
      ...sourcePanels.flatMap((panel) => panel.data.parts.map((part) => ({
        id: part.id,
        label: `${panel.name} · ${part.name || part.id}`,
        value: part.source || "",
        readOnly: part.editable === false,
        open: panel.id === "shaders",
      }))),
    ],
    capabilities: definition.capabilities || [],
    editable,
    saveLabel: fork ? "Save project version" : "Create project version",
    resetLabel: fork ? "Use built-in version" : "",
    note: editable
      ? "Shader and executable JavaScript edits become live after saving. Edited utility graphs use the call-driven node program; visual graphs retain their specialized compiler path."
      : "",
  };
}

function editorPortModel(label, ports = {}) {
  const entries = Object.values(ports || {});
  if (!entries.length) return null;
  return {
    id: label.toLowerCase(),
    label: `${label} · ${entries.length}`,
    rows: entries.map((port) => ({
      label: port.label || port.id,
      value: `${typeName(port.type)}${rangeLabel(port)}`,
    })),
  };
}

function editorParameterModel(parameters = {}, values = {}) {
  const entries = Object.values(parameters || {});
  if (!entries.length) return null;
  return {
    id: "parameters",
    label: `Parameters · ${entries.length}`,
    rows: entries.map((parameter) => ({
      label: parameter.label || parameter.id,
      value: `${typeName(parameter.type)}${rangeLabel(parameter)} · ${formatValue(values?.[parameter.id] ?? parameter.defaultValue)}`,
    })),
  };
}

function editorGraphModel(graph = {}) {
  const nodes = graph.nodes || [];
  return {
    id: "internal-graph",
    label: `Internal graph · ${nodes.length} nodes`,
    rows: nodes.map((node) => ({ label: node.id, value: node.nodeId || node.type || "node" })),
    connections: (graph.connections || []).map((edge) => `${edge.from} → ${edge.to}`),
    emptyText: "Code-owned relationships",
  };
}

function authoringActivationLabel(definition = {}) {
  const activation = definition.authoring?.activation || "recompile";
  const labels = {
    live: "Edits activate live.",
    recompile: "Edits activate after the node program recompiles.",
    restart: "Edits activate after saving and restarting the application.",
    "new-instance": "Edits apply to newly created node instances.",
    "read-only": "This node is inspectable but not editable.",
    unsupported: "This host cannot activate edits to this node.",
  };
  const reason = String(definition.authoring?.reason || "");
  return `${labels[activation] || labels.recompile}${reason ? ` ${reason}` : ""}`;
}

export function materializeProjectNodeDefinition(baseDefinition, state = {}) {
  return materializeForkSafely(baseDefinition, activeForkFor(state?.nodes, baseDefinition));
}

export function withProjectNodeGraph(nodes, baseDefinition, graph) {
  const graphPart = (baseDefinition.parts || []).find((part) => part.kind === "graph");
  if (!graphPart) throw new Error(`NODE_GRAPH_PART_MISSING:${baseDefinition.id}`);
  return withProjectNodeFork(nodes, baseDefinition, {
    [graphPart.id]: JSON.stringify({
      nodes: graph.nodes || [],
      connections: graph.connections || [],
      publicInlets: graph.publicInlets || {},
      publicOutlets: graph.publicOutlets || {},
    }),
  });
}

export function withProjectNodeParameterExposure(nodes, baseDefinition, {
  nodeId,
  parameterId,
  publicParameterId = "",
  parameter,
  sectionLabel = "",
  exposed = true,
} = {}) {
  if (baseDefinition?.metadata?.projectOwned !== true) {
    throw new Error(`NODE_PUBLIC_PARAMETER_REQUIRES_PROJECT_GROUP:${baseDefinition?.id || "missing"}`);
  }
  const childId = String(nodeId || "");
  const childParameterId = String(parameterId || "");
  if (!childId || !childParameterId) throw new Error("NODE_PUBLIC_PARAMETER_TARGET_INVALID");
  const current = nodes && typeof nodes === "object" ? nodes : {};
  const existing = activeForkFor(current, baseDefinition);
  const materialized = materializeForkSafely(baseDefinition, existing);
  const graph = materialized.parts?.find((part) => part.kind === "graph");
  if (!(graph?.nodes || []).some((node) => String(node.id || "") === childId)) {
    throw new Error(`NODE_PUBLIC_PARAMETER_CHILD_MISSING:${baseDefinition.id}:${childId}`);
  }

  const projection = cloneControlProjection(materialized.metadata?.controlProjection);
  const parameters = { ...(materialized.parameters || {}) };
  let removedPublicId = "";
  for (const section of projection.sections) {
    section.controls = section.controls.filter((control) => {
      const targetsParameter = (control.bindings || []).some((binding) =>
        binding.nodeId === childId && binding.parameterId === childParameterId);
      if (targetsParameter) removedPublicId = control.parameterId;
      return !targetsParameter;
    });
  }
  projection.sections = projection.sections.filter((section) => section.controls.length);
  if (removedPublicId && !projection.sections.some((section) =>
    section.controls.some((control) => control.parameterId === removedPublicId))) {
    if (baseDefinition.parameters?.[removedPublicId]) {
      parameters[removedPublicId] = baseDefinition.parameters[removedPublicId];
    } else {
      delete parameters[removedPublicId];
    }
  }

  if (exposed) {
    const publicId = normalizePublicParameterId(publicParameterId || `${childId}-${childParameterId}`);
    const collision = projection.sections.some((section) =>
      section.controls.some((control) => control.parameterId === publicId));
    if (collision) throw new Error(`NODE_PUBLIC_PARAMETER_DUPLICATE:${baseDefinition.id}:${publicId}`);
    if (!parameter || typeof parameter !== "object") {
      throw new Error(`NODE_PUBLIC_PARAMETER_SPEC_MISSING:${baseDefinition.id}:${childId}.${childParameterId}`);
    }
    parameters[publicId] = {
      ...parameter,
      id: publicId,
      label: String(parameter.label || childParameterId),
      role: "parameter",
    };
    let section = projection.sections.find((item) => item.id === childId);
    if (!section) {
      section = {
        id: childId,
        label: String(sectionLabel || childId),
        controls: [],
      };
      projection.sections.push(section);
    }
    section.controls.push({
      parameterId: publicId,
      bindings: [{ nodeId: childId, parameterId: childParameterId }],
    });
  }

  const fork = createProjectNodeFork(baseDefinition, {
    forkId: existing?.id?.split("/fork/").at(-1) || "project",
    name: existing?.definition?.name || `${baseDefinition.name} (Project version)`,
    description: existing?.definition?.description || baseDefinition.description,
    overrides: {
      ...existing?.definition,
      parameters,
      parts: existing?.definition?.parts || baseDefinition.parts || [],
      metadata: {
        ...materialized.metadata,
        controlProjection: {
          format: "vj1.control-projection@1",
          sections: projection.sections,
        },
      },
    },
  });
  validateProjectNodeFork(baseDefinition, fork);
  return {
    ...current,
    forks: [
      ...(current.forks || []).filter((item) => item?.base?.id !== baseDefinition.id),
      { ...fork, active: true, updatedAt: new Date().toISOString() },
    ],
  };
}

export function withProjectNodePortExposure(nodes, baseDefinition, {
  nodeId,
  portId,
  publicPortId = "",
  port,
  direction = "inlet",
  exposed = true,
} = {}) {
  if (baseDefinition?.metadata?.projectOwned !== true) {
    throw new Error(`NODE_PUBLIC_PORT_REQUIRES_PROJECT_GROUP:${baseDefinition?.id || "missing"}`);
  }
  const childId = String(nodeId || "");
  const childPortId = String(portId || "");
  const role = direction === "outlet" ? "outlet" : "inlet";
  if (!childId || !childPortId) throw new Error("NODE_PUBLIC_PORT_TARGET_INVALID");
  const current = nodes && typeof nodes === "object" ? nodes : {};
  const existing = activeForkFor(current, baseDefinition);
  const materialized = materializeForkSafely(baseDefinition, existing);
  const graph = materialized.parts?.find((part) => part.kind === "graph");
  if (!(graph?.nodes || []).some((node) => String(node.id || "") === childId)) {
    throw new Error(`NODE_PUBLIC_PORT_CHILD_MISSING:${baseDefinition.id}:${childId}`);
  }

  const endpoint = `${childId}.${childPortId}`;
  const mappingKey = role === "inlet" ? "publicInlets" : "publicOutlets";
  const portKey = role === "inlet" ? "inlets" : "outlets";
  const mappings = { ...(graph?.[mappingKey] || {}) };
  const ports = { ...(materialized[portKey] || {}) };
  for (const [id, mappedEndpoint] of Object.entries(mappings)) {
    if (String(mappedEndpoint || "") !== endpoint) continue;
    delete mappings[id];
    delete ports[id];
  }

  if (exposed) {
    const publicId = normalizePublicParameterId(publicPortId || `${childId}-${childPortId}`);
    if (mappings[publicId] || ports[publicId]) {
      throw new Error(`NODE_PUBLIC_PORT_DUPLICATE:${baseDefinition.id}:${role}:${publicId}`);
    }
    if (!port || typeof port !== "object") {
      throw new Error(`NODE_PUBLIC_PORT_SPEC_MISSING:${baseDefinition.id}:${endpoint}`);
    }
    ports[publicId] = {
      ...port,
      id: publicId,
      label: String(port.label || childPortId),
      role,
    };
    mappings[publicId] = endpoint;
  }

  const parts = (materialized.parts || []).map((part) => part.kind !== "graph"
    ? part
    : {
        ...part,
        [mappingKey]: mappings,
      });
  const fork = createProjectNodeFork(baseDefinition, {
    forkId: existing?.id?.split("/fork/").at(-1) || "project",
    name: existing?.definition?.name || `${baseDefinition.name} (Project version)`,
    description: existing?.definition?.description || baseDefinition.description,
    overrides: {
      ...existing?.definition,
      [portKey]: ports,
      parts,
    },
  });
  validateProjectNodeFork(baseDefinition, fork);
  return {
    ...current,
    forks: [
      ...(current.forks || []).filter((item) => item?.base?.id !== baseDefinition.id),
      { ...fork, active: true, updatedAt: new Date().toISOString() },
    ],
  };
}

export function withProjectGroupGraph(nodes, groupId, graph) {
  const current = nodes && typeof nodes === "object" ? nodes : {};
  const id = String(groupId || "");
  let found = false;
  const groups = (current.groups || []).map((group) => {
    if (group.id !== id) return group;
    found = true;
    return {
      ...group,
      nodes: graph.nodes || [],
      connections: graph.connections || [],
      publicInlets: graph.publicInlets || {},
      publicOutlets: graph.publicOutlets || {},
      authoredConnections: true,
    };
  });
  if (!found) throw new Error(`NODE_PROJECT_GROUP_MISSING:${id || "missing"}`);
  return { ...current, groups };
}

export function prepareProjectNodeGraphEdit(nodes, target, graph, {
  preflight = null,
  validate = true,
} = {}) {
  if (!target) throw new Error("NODE_GRAPH_EDIT_TARGET_MISSING");
  const nextNodes = target.kind === "project-group"
    ? withProjectGroupGraph(nodes, target.id, graph)
    : withProjectNodeGraph(nodes, target.baseDefinition, graph);
  if (!validate || typeof preflight !== "function") return nextNodes;
  if (target.kind !== "project-group") {
    return prepareProjectNodeDefinitionEdit(nextNodes, target.baseDefinition, {
      preflight,
    });
  }
  preflight({
    ...target,
    group: nextNodes.groups.find((group) => group.id === target.id),
  }, graph);
  return nextNodes;
}

export function prepareProjectNodeDefinitionEdit(nodes, baseDefinition, {
  preflight = null,
} = {}) {
  if (!baseDefinition) throw new Error("NODE_DEFINITION_EDIT_TARGET_MISSING");
  if (typeof preflight !== "function") return nodes;
  const definition = materializeProjectNodeDefinition(baseDefinition, { nodes });
  const graph = (definition.parts || []).find((part) => part.kind === "graph");
  if (!graph) return nodes;
  preflight({
    kind: "definition",
    id: baseDefinition.id,
    baseDefinition,
    definition,
  }, graph);
  return nodes;
}

export function withProjectNodeFork(nodes, baseDefinition, partSources = {}) {
  const current = nodes && typeof nodes === "object" ? nodes : {};
  const existing = activeForkFor(current, baseDefinition);
  const sourceParts = existing?.definition?.parts || baseDefinition.parts || [];
  const compiledSources = generatedPartSources(baseDefinition, sourceParts, partSources);
  const parts = sourceParts.map((part) => Object.prototype.hasOwnProperty.call(compiledSources, part.id)
    ? editedPart(part, compiledSources[part.id])
    : part);
  const interfaceOverrides = baseDefinition.metadata?.projectOwned === true
    ? pruneProjectGroupInterface(baseDefinition, existing, parts)
    : {};
  const fork = createProjectNodeFork(baseDefinition, {
    forkId: existing?.id?.split("/fork/").at(-1) || "project",
    name: existing?.definition?.name || `${baseDefinition.name} (Project version)`,
    description: existing?.definition?.description || baseDefinition.description,
    overrides: {
      ...existing?.definition,
      parts,
      ...interfaceOverrides,
    },
  });
  validateProjectNodeFork(baseDefinition, fork);
  return {
    ...current,
    forks: [
      ...(current.forks || []).filter((item) => item?.base?.id !== baseDefinition.id),
      { ...fork, active: true, updatedAt: new Date().toISOString() },
    ],
  };
}

function pruneProjectGroupInterface(baseDefinition, existing, parts) {
  const graph = (parts || []).find((part) => part.kind === "graph");
  const nodeIds = new Set((graph?.nodes || []).map((node) => String(node.id || "")));
  const keepMappedEndpoint = (value) => nodeIds.has(String(value || "").split(".")[0]);
  const publicInlets = Object.fromEntries(Object.entries(graph?.publicInlets || {})
    .filter(([, value]) => keepMappedEndpoint(value)));
  const publicOutlets = Object.fromEntries(Object.entries(graph?.publicOutlets || {})
    .filter(([, value]) => keepMappedEndpoint(value)));
  const nextParts = (parts || []).map((part) => part !== graph
    ? part
    : { ...part, publicInlets, publicOutlets });
  const metadata = {
    ...baseDefinition.metadata,
    ...(existing?.definition?.metadata || {}),
  };
  const projection = cloneControlProjection(metadata.controlProjection);
  projection.sections = projection.sections.flatMap((section) => {
    const controls = section.controls.flatMap((control) => {
      const bindings = control.bindings.filter((binding) => nodeIds.has(binding.nodeId));
      return bindings.length ? [{ ...control, bindings }] : [];
    });
    return controls.length ? [{ ...section, controls }] : [];
  });
  const referenced = new Set(projection.sections.flatMap((section) =>
    section.controls.map((control) => control.parameterId)));
  const parameters = {
    ...baseDefinition.parameters,
    ...(existing?.definition?.parameters || {}),
  };
  for (const id of Object.keys(parameters)) {
    if (!baseDefinition.parameters?.[id] && !referenced.has(id)) delete parameters[id];
  }
  const inlets = {
    ...baseDefinition.inlets,
    ...(existing?.definition?.inlets || {}),
  };
  const outlets = {
    ...baseDefinition.outlets,
    ...(existing?.definition?.outlets || {}),
  };
  for (const id of Object.keys(inlets)) {
    if (!baseDefinition.inlets?.[id] && !publicInlets[id]) delete inlets[id];
  }
  for (const id of Object.keys(outlets)) {
    if (!baseDefinition.outlets?.[id] && !publicOutlets[id]) delete outlets[id];
  }
  return {
    parts: nextParts,
    inlets,
    outlets,
    parameters,
    metadata: {
      ...metadata,
      controlProjection: {
        format: "vj1.control-projection@1",
        sections: projection.sections,
      },
    },
  };
}

function generatedPartSources(baseDefinition, sourceParts, partSources) {
  const sources = { ...partSources };
  const compiler = baseDefinition?.metadata?.sourceCompiler;
  if (compiler?.kind !== "sdf2d" || !Object.prototype.hasOwnProperty.call(sources, compiler.programPartId)) return sources;
  const programPart = sourceParts.find((part) => part.id === compiler.programPartId);
  const shaderPart = sourceParts.find((part) => part.id === compiler.shaderPartId);
  if (!programPart || !shaderPart) throw new Error(`SDF2D_NODE_PARTS_MISSING:${baseDefinition.id}`);
  sources[compiler.shaderPartId] = compileSdf2dSketchSource(sources[compiler.programPartId], {
    exportName: compiler.exportName,
    id: compiler.programId || baseDefinition.id,
    name: compiler.programName || baseDefinition.name,
  });
  return sources;
}

function editedPart(part, source) {
  if (part.kind !== "graph") return { ...part, source: String(source ?? "") };
  let graph;
  try {
    graph = JSON.parse(String(source || "{}"));
  } catch (error) {
    throw new Error(`NODE_GRAPH_SOURCE_INVALID:${part.id}:${error.message}`);
  }
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) throw new Error(`NODE_GRAPH_SOURCE_INVALID:${part.id}`);
  return {
    ...part,
    nodes: Array.isArray(graph.nodes) ? graph.nodes : part.nodes || [],
    connections: Array.isArray(graph.connections) ? graph.connections : part.connections || [],
    publicInlets: graph.publicInlets && typeof graph.publicInlets === "object" ? graph.publicInlets : part.publicInlets || {},
    publicOutlets: graph.publicOutlets && typeof graph.publicOutlets === "object" ? graph.publicOutlets : part.publicOutlets || {},
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

function cloneControlProjection(value = {}) {
  if (value?.format !== "vj1.control-projection@1") {
    return { format: "vj1.control-projection@1", sections: [] };
  }
  return {
    format: "vj1.control-projection@1",
    sections: (value.sections || []).map((section) => ({
      id: String(section.id || ""),
      label: String(section.label || section.id || "Controls"),
      controls: (section.controls || []).map((control) => ({
        parameterId: String(control.parameterId || ""),
        bindings: (control.bindings || []).map((binding) => ({
          nodeId: String(binding.nodeId || ""),
          parameterId: String(binding.parameterId || ""),
        })),
      })),
    })),
  };
}

function normalizePublicParameterId(value) {
  const id = String(value || "").trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id || !/^[A-Za-z_]/.test(id)) throw new Error(`NODE_PUBLIC_PARAMETER_ID_INVALID:${value || "missing"}`);
  return id;
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
