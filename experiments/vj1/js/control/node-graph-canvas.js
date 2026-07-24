import { valueTypeId } from "../libraries/node-engine/node-types.js";
import { esc, icon } from "./template-utils.js";

const CARD_WIDTH = 184;
const BOUNDARY_WIDTH = 132;
const PORT_ROW = 22;
const PORT_TOP = 58;

export const NODE_GRAPH_AUTHORING_TARGETS = Object.freeze({
  VISUAL: "visual-graph",
  SCENE_3D: "scene-3d-graph",
  GENERIC: "node-graph",
});

export function nodeDefinitionPlaceableInGraph(definition = {}, target = "") {
  const destination = String(target || "");
  if (!destination) return false;
  const placeableOn = new Set(definition.presentation?.placeableOn || []);
  if (destination === NODE_GRAPH_AUTHORING_TARGETS.VISUAL) {
    try {
      graphNodeFromDefinition(definition, {
        id: "$placement-check",
        position: { x: 0, y: 0 },
        visualProgram: true,
      });
      return true;
    } catch {
      return false;
    }
  }
  if (destination === NODE_GRAPH_AUTHORING_TARGETS.SCENE_3D) {
    return placeableOn.has("node-graph") && liveGraphProcess(definition);
  }
  return destination === NODE_GRAPH_AUTHORING_TARGETS.GENERIC
    && placeableOn.has("node-graph");
}

export function nodeGraphCanvasTemplate(definition, registry, options = {}) {
  const topologyEditable = options.topologyEditable !== false;
  const connectionsEditable = options.connectionsEditable ?? topologyEditable;
  const editableConnectionTypes = Array.isArray(options.editableConnectionTypes)
    ? new Set(options.editableConnectionTypes.map((type) => String(type || "")))
    : null;
  const nodesEditable = options.nodesEditable ?? topologyEditable;
  const parametersEditable = options.parametersEditable ?? nodesEditable;
  const providersEditable = options.providersEditable ?? nodesEditable;
  const publicInterfaceEditable = options.publicInterfaceEditable === true;
  const layoutEditable = options.layoutEditable !== false;
  const visualProgram = options.visualProgram === true;
  const authoringTarget = String(options.authoringTarget || "");
  const graph = definition?.parts?.find((part) => part.kind === "graph");
  if (!graph) return "";
  const model = graphCanvasModel(definition, graph, registry);
  return `
    <section class="node-graph-authoring" data-node-graph-authoring>
      <header>
        <span><strong>Graph canvas</strong><small>${model.childNodes.length} nodes · ${graph.connections?.length || 0} connections</small></span>
        <small>${nodesEditable
          ? "Drag library nodes here · select an outlet, then an inlet"
          : connectionsEditable
            ? "Compiler-owned nodes · select an outlet, then an inlet"
            : parametersEditable || providersEditable
              ? "Compiler-owned topology · values and declared providers are editable"
              : "Compiler-owned topology · node layout is editable"}</small>
      </header>
      <div class="node-graph-canvas" data-node-graph-canvas data-node-graph-definition="${esc(definition.metadata?.baseNode?.id || definition.id)}" data-topology-editable="${nodesEditable || connectionsEditable}" data-connections-editable="${connectionsEditable}" data-nodes-editable="${nodesEditable}" data-parameters-editable="${parametersEditable}" data-providers-editable="${providersEditable}" data-public-interface-editable="${publicInterfaceEditable}" data-layout-editable="${layoutEditable}" data-visual-program="${visualProgram}" data-authoring-target="${esc(authoringTarget)}" style="--node-graph-width:${model.width}px;--node-graph-height:${model.height}px">
        <svg class="node-graph-wires" viewBox="0 0 ${model.width} ${model.height}" aria-label="Node connections">
          ${(graph.connections || []).map((edge, index) => graphEdgeTemplate(edge, index, model, {
            editable: connectionsEditable && connectionTypeEditable(edge.type, editableConnectionTypes),
          })).join("")}
        </svg>
        ${model.cards.map((card) => graphCardTemplate(card, { nodesEditable, parametersEditable, providersEditable, publicInterfaceEditable })).join("")}
        <script type="application/json" data-node-graph-data>${safeJson(graph)}</script>
        <script type="application/json" data-node-graph-editable-connection-types>${safeJson(editableConnectionTypes ? [...editableConnectionTypes] : null)}</script>
      </div>
    </section>`;
}

export function bindNodeGraphCanvas(scope, {
  registry,
  onGraphChange = () => {},
  onPublicParameterToggle = null,
  onPublicPortToggle = null,
  onStatus = () => {},
  onMediaParameterRequest = null,
} = {}) {
  const canvas = scope?.querySelector?.("[data-node-graph-canvas]");
  if (!canvas || canvas.dataset.bound) return () => {};
  canvas.dataset.bound = "true";
  let graph = readGraph(canvas);
  let pendingOutlet = "";
  const connectionsEditable = canvas.dataset.connectionsEditable === "true";
  const editableConnectionTypes = readEditableConnectionTypes(canvas);
  const nodesEditable = canvas.dataset.nodesEditable === "true";
  const parametersEditable = canvas.dataset.parametersEditable === "true";
  const providersEditable = canvas.dataset.providersEditable === "true";
  const publicInterfaceEditable = canvas.dataset.publicInterfaceEditable === "true";
  const layoutEditable = canvas.dataset.layoutEditable === "true";
  const visualProgram = canvas.dataset.visualProgram === "true";

  for (const input of parametersEditable ? canvas.querySelectorAll("[data-node-graph-parameter]:not([data-node-graph-color-control])") : []) {
    input.addEventListener("change", () => {
      try {
        const value = readGraphParameterValue(input);
        graph = graphWithNodeParameter(
          graph,
          input.dataset.nodeGraphParameterNode,
          input.dataset.nodeGraphParameter,
          value,
        );
        onGraphChange(graph, "change-parameter");
      } catch (error) {
        onStatus(error?.message || "Node parameter was not updated");
      }
    });
  }

  for (const control of parametersEditable ? canvas.querySelectorAll("[data-node-graph-color-control]") : []) {
    const update = () => {
      const rgb = graphColorHex(control.querySelector("[data-node-graph-color-rgb]")?.value).slice(0, 7);
      const alpha = Math.max(0, Math.min(1, Number(control.querySelector("[data-node-graph-color-alpha]")?.value) || 0));
      const value = `${rgb}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
      graph = graphWithNodeParameter(
        graph,
        control.dataset.nodeGraphParameterNode,
        control.dataset.nodeGraphParameter,
        value,
      );
      onGraphChange(graph, "change-parameter");
    };
    control.querySelector("[data-node-graph-color-rgb]")?.addEventListener("change", update);
    control.querySelector("[data-node-graph-color-alpha]")?.addEventListener("change", update);
  }

  for (const button of parametersEditable ? canvas.querySelectorAll("[data-node-graph-media-parameter]") : []) {
    button.addEventListener("click", () => {
      const nodeId = button.dataset.nodeGraphParameterNode;
      const parameterId = button.dataset.nodeGraphMediaParameter;
      const accept = button.dataset.nodeGraphMediaAccept || "";
      const apply = (value) => {
        graph = graphWithNodeParameter(graph, nodeId, parameterId, String(value || ""));
        onGraphChange(graph, "change-parameter");
      };
      if (typeof onMediaParameterRequest === "function") {
        onMediaParameterRequest({ nodeId, parameterId, accept, apply });
      } else {
        onStatus("Media selection is unavailable in this editor");
      }
    });
  }

  for (const button of publicInterfaceEditable ? canvas.querySelectorAll("[data-node-graph-publish-parameter]") : []) {
    button.addEventListener("click", () => {
      if (typeof onPublicParameterToggle !== "function") {
        onStatus("Public parameter authoring is unavailable in this editor");
        return;
      }
      onPublicParameterToggle({
        nodeId: button.dataset.nodeGraphParameterNode,
        parameterId: button.dataset.nodeGraphPublishParameter,
        publicParameterId: button.dataset.nodeGraphPublicParameter || "",
      });
    });
  }

  for (const button of publicInterfaceEditable ? canvas.querySelectorAll("[data-node-graph-publish-port]") : []) {
    button.addEventListener("click", () => {
      if (typeof onPublicPortToggle !== "function") {
        onStatus("Public port authoring is unavailable in this editor");
        return;
      }
      onPublicPortToggle({
        nodeId: button.dataset.nodeGraphPortNode,
        portId: button.dataset.nodeGraphPublishPort,
        direction: button.dataset.nodeGraphPortDirection,
        publicPortId: button.dataset.nodeGraphPublicPort || "",
      });
    });
  }

  const updateWires = () => {
    const canvasRect = canvas.getBoundingClientRect();
    for (const path of canvas.querySelectorAll("[data-node-graph-edge]")) {
      const edge = graph.connections?.[Number(path.dataset.nodeGraphEdge)];
      if (!edge) continue;
      const from = portCenter(canvas, edge.from, "outlet", canvasRect);
      const to = portCenter(canvas, edge.to, "inlet", canvasRect);
      if (from && to) path.setAttribute("d", bezierPath(from, to));
    }
  };

  for (const handle of layoutEditable ? canvas.querySelectorAll("[data-node-graph-drag]") : []) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const card = handle.closest("[data-node-graph-node]");
      if (!card || card.dataset.nodeGraphNode.startsWith("$")) return;
      event.preventDefault();
      handle.setPointerCapture?.(event.pointerId);
      const start = { x: event.clientX, y: event.clientY };
      const origin = { x: Number(card.dataset.x) || 0, y: Number(card.dataset.y) || 0 };
      const move = (nextEvent) => {
        const x = Math.max(8, origin.x + nextEvent.clientX - start.x);
        const y = Math.max(8, origin.y + nextEvent.clientY - start.y);
        positionCard(card, x, y);
        updateWires();
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        graph = graphWithNodePosition(graph, card.dataset.nodeGraphNode, {
          x: Number(card.dataset.x) || 0,
          y: Number(card.dataset.y) || 0,
        });
        onGraphChange(graph, "move-node");
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }

  for (const port of connectionsEditable ? canvas.querySelectorAll("[data-node-graph-port]") : []) {
    if (!connectionTypeEditable(port.dataset.valueType, editableConnectionTypes)) continue;
    port.addEventListener("click", () => {
      const endpoint = port.dataset.nodeGraphPort;
      const direction = port.dataset.direction;
      if (direction === "outlet") {
        pendingOutlet = endpoint;
        canvas.querySelectorAll(".is-pending-connection").forEach((item) => item.classList.remove("is-pending-connection"));
        port.classList.add("is-pending-connection");
        onStatus(`Connect ${endpoint} to an inlet`);
        return;
      }
      if (!pendingOutlet) return;
      const sourcePort = canvas.querySelector(`[data-node-graph-port="${cssEscape(pendingOutlet)}"]`);
      if (!nodePortTypesCompatible(sourcePort?.dataset.valueType, port.dataset.valueType)) {
        onStatus(`Cannot connect ${sourcePort?.dataset.valueType || "unknown"} to ${port.dataset.valueType || "unknown"}`);
        return;
      }
      const valueType = sourcePort?.dataset.valueType || "any";
      graph = graphWithConnection(graph, {
        from: pendingOutlet,
        to: endpoint,
        type: valueType,
        ...(valueType === "service" ? { phase: "setup" } : {}),
      });
      pendingOutlet = "";
      onGraphChange(graph, "connect-nodes");
    });
  }

  for (const path of connectionsEditable ? canvas.querySelectorAll("[data-node-graph-edge]") : []) {
    const edge = graph.connections?.[Number(path.dataset.nodeGraphEdge)];
    if (!edge || !connectionTypeEditable(edge.type, editableConnectionTypes)) continue;
    path.addEventListener("click", () => {
      graph = graphWithoutConnection(graph, Number(path.dataset.nodeGraphEdge));
      onGraphChange(graph, "remove-connection");
    });
  }

  for (const button of nodesEditable ? canvas.querySelectorAll("[data-remove-graph-node]") : []) {
    button.addEventListener("click", () => {
      graph = graphWithoutNode(graph, button.dataset.removeGraphNode);
      onGraphChange(graph, "remove-node");
    });
  }

  for (const select of providersEditable ? canvas.querySelectorAll("[data-node-provider-select]") : []) {
    select.addEventListener("change", () => {
      const option = select.selectedOptions?.[0];
      if (!option) return;
      graph = graphWithNodeProvider(graph, select.dataset.nodeProviderSelect, {
        nodeId: option.dataset.nodeId,
        nodeVersion: option.dataset.nodeVersion,
        providerId: option.dataset.providerId,
      });
      onGraphChange(graph, "change-provider");
    });
  }

  canvas.addEventListener("dragover", (event) => {
    if (!nodesEditable) return;
    if (!event.dataTransfer?.types?.includes("application/x-vj1-node-definition")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  canvas.addEventListener("drop", (event) => {
    if (!nodesEditable) return;
    const nodeId = event.dataTransfer?.getData("application/x-vj1-node-definition") || "";
    if (!nodeId || !registry?.has?.(nodeId)) return;
    event.preventDefault();
    if (nodeId === canvas.dataset.nodeGraphDefinition) {
      onStatus("A group cannot contain itself");
      return;
    }
    const nodeDefinition = registry.get(nodeId);
    if (!nodeDefinitionPlaceableInGraph(nodeDefinition, canvas.dataset.authoringTarget)) {
      onStatus(`${nodeDefinition.name} is not executable in this graph`);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const id = uniqueGraphNodeId(graph, nodeDefinition.id);
    const position = { x: Math.max(8, event.clientX - rect.left), y: Math.max(8, event.clientY - rect.top) };
    try {
      graph = graphWithNode(graph, graphNodeFromDefinition(nodeDefinition, { id, position, visualProgram }));
    } catch (error) {
      onStatus(error?.message || "Node cannot be added to this graph");
      return;
    }
    onGraphChange(graph, "add-node");
  });

  updateWires();
  return () => {};
}

export function graphWithNodePosition(graph, nodeId, position) {
  return cloneGraph(graph, {
    nodes: (graph.nodes || []).map((node) => node.id === nodeId
      ? { ...node, position: normalizedPosition(position) }
      : node),
  });
}

export function graphWithConnection(graph, connection) {
  const edge = {
    ...connection,
    from: String(connection.from || ""),
    to: String(connection.to || ""),
  };
  if (!edge.from || !edge.to || edge.from === edge.to) throw new Error("NODE_GRAPH_CONNECTION_INVALID");
  const connections = (graph.connections || []).filter((item) => item.to !== edge.to && !(item.from === edge.from && item.to === edge.to));
  connections.push(edge);
  return cloneGraph(graph, { connections });
}

export function graphWithoutConnection(graph, index) {
  return cloneGraph(graph, { connections: (graph.connections || []).filter((_, edgeIndex) => edgeIndex !== index) });
}

export function graphWithNode(graph, node) {
  if (!node?.id || !(node?.type || node?.nodeId)) throw new Error("NODE_GRAPH_CHILD_INVALID");
  if ((graph.nodes || []).some((item) => item.id === node.id)) throw new Error(`NODE_GRAPH_CHILD_DUPLICATE:${node.id}`);
  return cloneGraph(graph, { nodes: [...(graph.nodes || []), { ...node, position: normalizedPosition(node.position) }] });
}

export function graphWithNodeProvider(graph, nodeId, {
  nodeId: providerNodeId,
  nodeVersion = "",
  providerId = "",
} = {}) {
  if (!(graph.nodes || []).some((node) => node.id === nodeId)) {
    throw new Error(`NODE_GRAPH_CHILD_MISSING:${nodeId}`);
  }
  if (!providerNodeId || !providerId) throw new Error(`NODE_GRAPH_PROVIDER_INVALID:${nodeId}`);
  return cloneGraph(graph, {
    nodes: (graph.nodes || []).map((node) => node.id === nodeId
      ? {
          ...node,
          type: providerNodeId,
          ...(nodeVersion ? { version: nodeVersion } : {}),
          parameters: {
            ...(node.parameters || {}),
            providerId,
          },
        }
      : node),
  });
}

export function graphWithNodeParameter(graph, nodeId, parameterId, value) {
  const id = String(nodeId || "");
  const parameter = String(parameterId || "");
  if (!id || !parameter) throw new Error("NODE_GRAPH_PARAMETER_INVALID");
  if (!(graph.nodes || []).some((node) => node.id === id)) {
    throw new Error(`NODE_GRAPH_CHILD_MISSING:${id}`);
  }
  return cloneGraph(graph, {
    nodes: (graph.nodes || []).map((node) => node.id === id
      ? nodeWithParameter(node, parameter, value)
      : node),
  });
}

export function graphNodeFromDefinition(definition, {
  id,
  position = {},
  visualProgram = false,
} = {}) {
  const nodeId = String(definition?.id || "");
  const instanceId = String(id || uniqueGraphNodeId({ nodes: [] }, nodeId));
  const parameters = Object.fromEntries(Object.entries(definition?.parameters || {}).flatMap(([parameterId, parameter]) =>
    parameter.defaultValue === undefined ? [] : [[parameterId, parameter.defaultValue]]));
  if (!visualProgram) return {
    id: instanceId,
    type: nodeId,
    version: definition.version,
    parameters,
    position: normalizedPosition(position),
  };
  const visualKind = definition?.metadata?.visualKind;
  if (visualKind === "generator") return {
    id: instanceId,
    nodeId,
    nodeVersion: definition.version,
    role: "source",
    parameters,
    configuration: {
      id: instanceId,
      kind: "source",
      name: definition.name,
      enabled: true,
      opacity: 1,
      blend: "normal",
      source: {
        type: "generator",
        generatorId: definition.metadata.visualId,
        instanceId: instanceId,
        params: { ...parameters },
      },
    },
    compilerHook: visualCompilerHook(definition, "generator"),
    position: normalizedPosition(position),
  };
  if (visualKind === "effect") return {
    id: instanceId,
    nodeId,
    nodeVersion: definition.version,
    role: "effect",
    parameters,
    configuration: {
      id: instanceId,
      kind: "effect",
      name: definition.name,
      componentId: definition.metadata.visualId,
      enabled: true,
      opacity: 1,
      blend: "normal",
      amount: parameters.amount,
      params: { ...parameters },
    },
    compilerHook: visualCompilerHook(definition, "effect"),
    position: normalizedPosition(position),
  };
  if (nodeId === "core.composition.layer-group") return {
    id: instanceId,
    nodeId,
    nodeVersion: definition.version,
    role: "group",
    parameters,
    configuration: { id: instanceId, kind: "group", name: definition.name, enabled: true, opacity: 1, blend: "normal", chain: [] },
    compilerHook: { id: "vj1.visual.layer-group" },
    nodes: [],
    connections: [],
    position: normalizedPosition(position),
  };
  const declaredVisualHook = definition?.metadata?.visualCompilerHook;
  if (declaredVisualHook?.id === "vj1.visual.compound" && definition?.outlets?.texture) return {
    id: instanceId,
    nodeId,
    nodeVersion: definition.version,
    role: "group",
    parameters,
    configuration: {
      id: instanceId,
      kind: "source",
      name: definition.name,
      enabled: true,
      opacity: 1,
      blend: "normal",
      source: {
        type: "generator",
        generatorId: definition.metadata?.visualId || nodeId,
        instanceId,
        params: { ...parameters },
      },
    },
    compilerHook: { ...declaredVisualHook },
    position: normalizedPosition(position),
  };
  if (declaredVisualHook?.id === "vj1.visual.texture-operator" && definition?.outlets?.texture) return {
    id: instanceId,
    nodeId,
    nodeVersion: definition.version,
    role: "operator",
    parameters,
    configuration: {
      id: instanceId,
      kind: "texture-operator",
      operator: declaredVisualHook.operator || definition.metadata?.visualOperator || "",
      enabled: true,
      params: { ...parameters },
    },
    compilerHook: { ...declaredVisualHook },
    position: normalizedPosition(position),
  };
  if (declaredVisualHook?.id && definition?.outlets?.texture) return {
    id: instanceId,
    nodeId,
    nodeVersion: definition.version,
    role: "source",
    parameters,
    configuration: {
      id: instanceId,
      kind: "source",
      name: definition.name,
      enabled: true,
      opacity: 1,
      blend: "normal",
      source: {
        type: "generator",
        generatorId: definition.metadata?.visualId || nodeId,
        instanceId,
        params: { ...parameters },
      },
    },
    compilerHook: { ...declaredVisualHook },
    position: normalizedPosition(position),
  };
  if (isVisualControlDefinition(definition)) return {
    id: instanceId,
    nodeId,
    nodeVersion: definition.version,
    role: "control",
    parameters,
    position: normalizedPosition(position),
  };
  throw new Error(`Only nodes with a declared visual texture compiler can be added to a Component program`);
}

function isVisualControlDefinition(definition = {}) {
  const capabilities = new Set(definition.capabilities || []);
  return typeof definition.process === "function" && [
    "numeric-control",
    "value-control",
    "timing",
    "motion",
    "coordinate-generator",
    "inspector-control",
  ].some((capability) => capabilities.has(capability));
}

function liveGraphProcess(definition = {}) {
  return typeof definition.process === "function"
    && definition.execution?.asynchronous !== true
    && definition.execution?.workload !== "bounded"
    && definition.execution?.workload !== "offline"
    && definition.process.constructor?.name !== "AsyncFunction";
}

export function graphWithoutNode(graph, nodeId) {
  const prefix = `${nodeId}.`;
  return cloneGraph(graph, {
    nodes: (graph.nodes || []).filter((node) => node.id !== nodeId),
    connections: (graph.connections || []).filter((edge) => !edge.from.startsWith(prefix) && !edge.to.startsWith(prefix)),
  });
}

export function nodePortTypesCompatible(source, target) {
  const sourceId = valueTypeId(source || "any");
  const targetId = valueTypeId(target || "any");
  return sourceId === "any" || targetId === "any" || sourceId === targetId;
}

function graphCanvasModel(definition, graph, registry) {
  const childNodes = graph.nodes || [];
  const unknownPorts = connectionPorts(graph.connections || []);
  const publicParameters = publicParameterBindingMap(definition);
  const publicPorts = publicPortBindingMap(definition);
  const childCards = childNodes.map((node, index) => childCard(
    node,
    index,
    registry,
    unknownPorts,
    compoundProviderOptions(definition, node, registry),
    publicParameters,
    publicPorts,
  ));
  const defaultHeight = Math.max(430, 110 + childCards.length * 34);
  const width = Math.max(960, 430 + Math.max(1, childCards.length) * 230);
  const height = Math.max(defaultHeight, ...childCards.map((card) => card.y + card.height + 40));
  const inputCard = boundaryCard("$in", "Graph inputs", definition.inlets, "outlet", 24, 62);
  const outputCard = boundaryCard("$out", "Graph outputs", definition.outlets, "inlet", width - BOUNDARY_WIDTH - 24, 62);
  const cards = [inputCard, ...childCards, outputCard];
  const byId = new Map(cards.map((card) => [card.id, card]));
  return { width, height, cards, childNodes, byId };
}

function childCard(node, index, registry, unknownPorts, providerOptions = [], publicParameters = new Map(), publicPorts = new Map()) {
  let definition = null;
  try { definition = registry?.get?.(node.type || node.nodeId, node.version || node.nodeVersion); } catch {}
  const id = String(node.id || `node-${index + 1}`);
  const inlets = mergedPorts(definition?.inlets, node.ports?.inlets).map((port) =>
    graphPort(id, port, "inlet", false, publicPorts.get(`inlet:${id}.${port.id}`) || ""));
  const parameterDefinitions = Object.values(definition?.parameters || {});
  const parameterIds = new Set(parameterDefinitions.map((parameter) => parameter.id));
  const literalInletDefinitions = Object.values(definition?.inlets || {}).filter((inlet) =>
    inlet.defaultValue !== undefined && !parameterIds.has(inlet.id));
  const parameters = parameterDefinitions.map((port) => graphPort(id, port, "inlet", true));
  const connectedEndpoints = new Set(graphConnectionsForNode(unknownPorts, id));
  const parameterEditors = [
    ...parameterDefinitions.map((parameter) => ({ parameter, endpoint: `${id}.$parameter.${parameter.id}` })),
    ...literalInletDefinitions.map((parameter) => ({ parameter, endpoint: `${id}.${parameter.id}` })),
  ].map(({ parameter, endpoint }) => {
    const inletLiteral = !endpoint.includes(".$parameter.");
    return {
      id: parameter.id,
      label: parameter.label || parameter.id,
      type: valueTypeId(parameter.type),
      values: parameter.type?.values || parameter.editor?.options || [],
      editor: parameter.editor || null,
      value: node.parameters?.[parameter.id] ?? parameter.defaultValue,
      allowedRange: parameter.allowedRange,
      displayRange: parameter.displayRange,
      connected: connectedEndpoints.has(endpoint),
      publicParameterId: publicParameters.get(`${id}.${parameter.id}`) || "",
      inletLiteral,
      // Declared parameters and unconnected inlets with defaults are authored
      // configuration. A wire always supersedes the stored inlet literal.
      publishable: true,
    };
  });
  const outlets = mergedPorts(definition?.outlets, node.ports?.outlets).map((port) =>
    graphPort(id, port, "outlet", false, publicPorts.get(`outlet:${id}.${port.id}`) || ""));
  appendUnknownPorts(inlets, unknownPorts.targets.get(id), id, "inlet");
  appendUnknownPorts(outlets, unknownPorts.sources.get(id), id, "outlet");
  const position = node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
    ? normalizedPosition(node.position)
    : { x: 246 + (index % 4) * 224, y: 48 + Math.floor(index / 4) * 230 };
  const rows = Math.max(inlets.length + parameters.length, outlets.length, 1);
  const parameterTop = PORT_TOP + rows * PORT_ROW + 8;
  const parameterHeight = parameterEditors.length
    ? 22 + parameterEditors.reduce((height, parameter) =>
      height + (parameter.editor?.type === "code" ? 82 : 30), 0)
    : 0;
  const providerHeight = providerOptions.length ? 34 : 0;
  return {
    id,
    name: definition?.name || node.type || node.nodeId || id,
    type: node.type || node.nodeId || "unknown",
    x: position.x,
    y: position.y,
    width: CARD_WIDTH,
    height: parameterTop + parameterHeight + providerHeight + 8,
    inlets: [...inlets, ...parameters],
    outlets,
    parameterEditors,
    parameterTop,
    providerOptions,
    removable: true,
  };
}

// Group instances may expose compiler-owned dynamic ports in addition to the
// reusable node definition. Application service dependencies use this generic
// facility so their setup relationships remain reconnectable after a wire is
// removed; it is not specific to the VJ1 bootstrap graph.
function mergedPorts(definitionPorts = {}, instancePorts = {}) {
  const ports = new Map();
  for (const port of [...Object.values(definitionPorts || {}), ...Object.values(instancePorts || {})]) {
    if (!port?.id) continue;
    ports.set(port.id, port);
  }
  return [...ports.values()];
}

function boundaryCard(id, name, ports, direction, x, y) {
  const list = Object.values(ports || {}).map((port) => ({
    id: port.id,
    label: port.label || port.id,
    endpoint: `${id}.${port.id}`,
    direction,
    type: valueTypeId(port.type),
    parameter: false,
  }));
  return {
    id, name, type: "group-boundary", x, y, width: BOUNDARY_WIDTH,
    height: PORT_TOP + Math.max(list.length, 1) * PORT_ROW + 12,
    inlets: direction === "inlet" ? list : [],
    outlets: direction === "outlet" ? list : [],
    removable: false,
  };
}

function graphPort(nodeId, port, direction, parameter = false, publicPortId = "") {
  return {
    id: port.id,
    label: port.label || port.id,
    endpoint: parameter ? `${nodeId}.$parameter.${port.id}` : `${nodeId}.${port.id}`,
    direction,
    type: valueTypeId(port.type),
    parameter,
    publicPortId,
  };
}

function graphCardTemplate(card, {
  nodesEditable = true,
  parametersEditable = true,
  providersEditable = nodesEditable,
  publicInterfaceEditable = false,
} = {}) {
  return `<article class="node-graph-card ${card.id.startsWith("$") ? "is-boundary" : ""}" data-node-graph-node="${esc(card.id)}" data-x="${card.x}" data-y="${card.y}" style="left:${card.x}px;top:${card.y}px;width:${card.width}px;min-height:${card.height}px">
    <header data-node-graph-drag>${icon(card.id.startsWith("$") ? "input" : "data_object")}<span><strong>${esc(card.name)}</strong><small>${esc(card.type)}</small></span>${card.removable && nodesEditable ? `<button type="button" data-remove-graph-node="${esc(card.id)}" title="Remove node" aria-label="Remove ${esc(card.name)}">${icon("close")}</button>` : ""}</header>
    <div class="node-graph-card-ports is-inlets">${card.inlets.map((port) => graphPortTemplate(port, publicInterfaceEditable && !card.id.startsWith("$"))).join("")}</div>
    <div class="node-graph-card-ports is-outlets">${card.outlets.map((port) => graphPortTemplate(port, publicInterfaceEditable && !card.id.startsWith("$"))).join("")}</div>
    ${card.parameterEditors?.length ? `<div class="node-graph-parameters" style="top:${card.parameterTop}px"><strong>Values</strong>${card.parameterEditors.map((parameter) =>
      graphParameterTemplate(card.id, parameter, parametersEditable, publicInterfaceEditable)).join("")}</div>` : ""}
    ${card.providerOptions?.length ? `<label class="node-graph-provider"><span>Provider</span><select data-node-provider-select="${esc(card.id)}"${providersEditable ? "" : " disabled"}>${card.providerOptions.map((option) =>
      `<option value="${esc(`${option.nodeId}:${option.providerId}`)}" data-node-id="${esc(option.nodeId)}" data-node-version="${esc(option.nodeVersion)}" data-provider-id="${esc(option.providerId)}"${option.selected ? " selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>` : ""}
  </article>`;
}

function graphParameterTemplate(nodeId, parameter, editable, publicInterfaceEditable = false) {
  const disabled = !editable || parameter.connected;
  const common = `data-node-graph-parameter="${esc(parameter.id)}" data-node-graph-parameter-node="${esc(nodeId)}" data-node-graph-parameter-type="${esc(parameter.type)}"${disabled ? " disabled" : ""}`;
  const connectedTitle = parameter.connected ? ' title="Value is supplied by a connected node"' : "";
  const publicAction = publicInterfaceEditable && parameter.publishable
    ? `<button type="button" class="node-graph-publish-parameter${parameter.publicParameterId ? " is-published" : ""}" data-node-graph-publish-parameter="${esc(parameter.id)}" data-node-graph-parameter-node="${esc(nodeId)}" data-node-graph-public-parameter="${esc(parameter.publicParameterId)}" title="${esc(parameter.publicParameterId ? `Rename public control ${parameter.publicParameterId}; clear its ID to remove it` : "Expose as a public Group control")}">${parameter.publicParameterId ? esc(parameter.publicParameterId) : "Expose"}</button>`
    : "";
  if (parameter.editor?.type === "media") {
    const value = String(parameter.value || "");
    const label = parameter.connected ? "Connected" : value.split("/").at(-1) || "Choose media";
    return `<label><span>${esc(parameter.label)}${publicAction}</span><button type="button" data-node-graph-media-parameter="${esc(parameter.id)}" data-node-graph-parameter-node="${esc(nodeId)}" data-node-graph-media-accept="${esc(parameter.editor.category || "")}"${disabled ? " disabled" : ""} title="${esc(parameter.connected ? "Value is supplied by a connected node" : value)}">${esc(label)}</button></label>`;
  }
  if (parameter.type === "boolean") {
    return `<label><span>${esc(parameter.label)}${publicAction}</span><input type="checkbox" ${common}${parameter.value ? " checked" : ""}${connectedTitle}></label>`;
  }
  if (parameter.type === "enum") {
    return `<label><span>${esc(parameter.label)}${publicAction}</span><select ${common}>${parameter.values.map((value) =>
      `<option value="${esc(value)}"${value === parameter.value ? " selected" : ""}>${esc(value)}</option>`).join("")}</select></label>`;
  }
  if (parameter.type === "number") {
    const range = parameter.displayRange || parameter.allowedRange;
    const rangeAttributes = Array.isArray(range)
      ? ` min="${esc(range[0])}" max="${esc(range[1])}"`
      : "";
    const step = Number(parameter.editor?.step);
    return `<label><span>${esc(parameter.label)}${publicAction}</span><input type="number" value="${esc(parameter.value ?? 0)}"${rangeAttributes}${Number.isFinite(step) && step > 0 ? ` step="${esc(step)}"` : ' step="any"'} ${common}${connectedTitle}></label>`;
  }
  if (parameter.type === "color") {
    const rgba = graphColorHex(parameter.value);
    const alpha = Number.parseInt(rgba.slice(7, 9), 16) / 255;
    return `<label><span>${esc(parameter.label)}${publicAction}</span><span class="node-graph-color-control" ${common} data-node-graph-color-control${connectedTitle}><input type="range" min="0" max="1" step="0.01" value="${esc(alpha)}" data-node-graph-color-alpha${disabled ? " disabled" : ""} aria-label="${esc(parameter.label)} alpha"><input type="color" value="${esc(rgba.slice(0, 7))}" data-node-graph-color-rgb${disabled ? " disabled" : ""} aria-label="${esc(parameter.label)} color"></span></label>`;
  }
  if (parameter.editor?.type === "code") {
    return `<label class="is-code"><span>${esc(parameter.label)}${publicAction}</span><textarea rows="4" spellcheck="false" ${common}${connectedTitle}>${esc(parameter.value ?? "")}</textarea></label>`;
  }
  const structured = parameter.value != null && typeof parameter.value === "object";
  return `<label><span>${esc(parameter.label)}${publicAction}</span><input type="text" value="${esc(structured ? JSON.stringify(parameter.value) : parameter.value ?? "")}" ${common}${structured ? ' data-node-graph-parameter-json="true"' : ""}${connectedTitle}></label>`;
}

function publicParameterBindingMap(definition = {}) {
  const result = new Map();
  const projection = definition.metadata?.controlProjection;
  if (projection?.format !== "vj1.control-projection@1") return result;
  for (const section of projection.sections || []) {
    for (const control of section.controls || []) {
      for (const binding of control.bindings || []) {
        result.set(`${binding.nodeId}.${binding.parameterId}`, control.parameterId);
      }
    }
  }
  return result;
}

function publicPortBindingMap(definition = {}) {
  const result = new Map();
  const graph = definition.parts?.find((part) => part.kind === "graph");
  for (const [publicId, endpoint] of Object.entries(graph?.publicInlets || {})) {
    result.set(`inlet:${endpoint}`, publicId);
  }
  for (const [publicId, endpoint] of Object.entries(graph?.publicOutlets || {})) {
    result.set(`outlet:${endpoint}`, publicId);
  }
  return result;
}

function readGraphParameterValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return Number(input.value);
  if (input.dataset.nodeGraphParameterJson === "true") {
    try { return JSON.parse(input.value); } catch { throw new Error(`NODE_GRAPH_PARAMETER_JSON_INVALID:${input.dataset.nodeGraphParameter}`); }
  }
  return input.value;
}

function graphColorHex(value) {
  if (Array.isArray(value)) {
    const channels = [0, 1, 2, 3].map((index) => {
      const fallback = index === 3 ? 255 : 0;
      const channel = Number(value[index] ?? fallback);
      return Math.max(0, Math.min(255, Math.round(Number.isFinite(channel) ? channel : fallback)))
        .toString(16)
        .padStart(2, "0");
    });
    return `#${channels.join("")}`;
  }
  const clean = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(clean) || /^[0-9a-f]{4}$/i.test(clean)) {
    const expanded = [...clean].map((character) => character.repeat(2)).join("");
    return `#${expanded}${expanded.length === 6 ? "ff" : ""}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean.toLowerCase()}ff`;
  if (/^[0-9a-f]{8}$/i.test(clean)) return `#${clean.toLowerCase()}`;
  return "#000000ff";
}

function nodeWithParameter(node, parameterId, value) {
  const parameters = { ...(node.parameters || {}), [parameterId]: value };
  const configuration = node.configuration ? { ...node.configuration } : null;
  if (configuration?.source?.type === "generator") {
    configuration.source = {
      ...configuration.source,
      params: { ...(configuration.source.params || {}), [parameterId]: value },
    };
  } else if (configuration?.kind === "effect") {
    configuration.params = { ...(configuration.params || {}), [parameterId]: value };
    if (parameterId === "amount") configuration.amount = value;
  } else if (configuration?.kind === "texture-operator") {
    configuration.params = { ...(configuration.params || {}), [parameterId]: value };
  }
  return {
    ...node,
    parameters,
    ...(configuration ? { configuration } : {}),
  };
}

function compoundProviderOptions(ownerDefinition, node, registry) {
  const contract = ownerDefinition?.metadata?.nativeCompound || {};
  const alternatives = contract.providerAlternatives?.[node.id] || [];
  if (!alternatives.length) return [];
  const expected = contract.stageContract?.[node.id];
  const candidates = [expected, ...alternatives].filter((item) => item?.nodeId && item?.providerId);
  return candidates.map((candidate) => {
    let definition = null;
    try { definition = registry?.get?.(candidate.nodeId); } catch {}
    return {
      nodeId: candidate.nodeId,
      nodeVersion: definition?.version || "",
      providerId: candidate.providerId,
      label: candidate.label || definition?.name || candidate.providerId,
      selected:
        String(node.type || node.nodeType || "") === String(candidate.nodeId)
        && String(node.parameters?.providerId || "") === String(candidate.providerId),
    };
  });
}

function graphPortTemplate(port, publicInterfaceEditable = false) {
  const publicAction = publicInterfaceEditable && !port.parameter
    ? `<button type="button" class="node-graph-publish-port${port.publicPortId ? " is-published" : ""}" data-node-graph-publish-port="${esc(port.id)}" data-node-graph-port-node="${esc(String(port.endpoint || "").split(".")[0])}" data-node-graph-port-direction="${esc(port.direction)}" data-node-graph-public-port="${esc(port.publicPortId)}" title="${esc(port.publicPortId ? `Rename public ${port.direction} ${port.publicPortId}; clear its ID to remove it` : `Expose as a public Group ${port.direction}`)}">${port.publicPortId ? esc(port.publicPortId) : "Expose"}</button>`
    : "";
  return `<div class="node-graph-port-row is-${port.direction}"><button type="button" class="node-graph-port is-${port.direction}${port.parameter ? " is-parameter" : ""}" data-node-graph-port="${esc(port.endpoint)}" data-direction="${port.direction}" data-value-type="${esc(port.type)}" title="${esc(port.endpoint)} · ${esc(port.type)}"><i></i><span>${esc(port.label)}</span><small>${esc(port.type)}</small></button>${publicAction}</div>`;
}

function graphEdgeTemplate(edge, index, model, { editable = true } = {}) {
  const from = staticPortPoint(model, edge.from, "outlet");
  const to = staticPortPoint(model, edge.to, "inlet");
  const path = from && to ? bezierPath(from, to) : "";
  return `<path d="${path}" data-node-graph-edge="${index}" data-edge-editable="${editable}"${editable ? ' tabindex="0"' : ""}><title>${esc(edge.from)} → ${esc(edge.to)}${editable ? " · click to remove" : " · compiler locked"}</title></path>`;
}

function staticPortPoint(model, endpoint, direction) {
  const parsed = parseEndpoint(endpoint);
  const card = model.byId.get(parsed.node);
  if (!card) return null;
  const ports = direction === "outlet" ? card.outlets : card.inlets;
  let index = ports.findIndex((port) => port.endpoint === endpoint);
  if (index < 0) index = 0;
  return {
    x: direction === "outlet" ? card.x + card.width : card.x,
    y: card.y + PORT_TOP + index * PORT_ROW + PORT_ROW / 2,
  };
}

function portCenter(canvas, endpoint, direction, canvasRect) {
  const port = [...canvas.querySelectorAll("[data-node-graph-port]")].find((item) => item.dataset.nodeGraphPort === endpoint)
    || [...canvas.querySelectorAll(`[data-direction="${direction}"]`)].find((item) => parseEndpoint(item.dataset.nodeGraphPort).node === parseEndpoint(endpoint).node);
  if (!port) return null;
  const rect = port.getBoundingClientRect();
  return { x: rect.left - canvasRect.left + (direction === "outlet" ? rect.width : 0), y: rect.top - canvasRect.top + rect.height / 2 };
}

function positionCard(card, x, y) {
  card.dataset.x = String(Math.round(x));
  card.dataset.y = String(Math.round(y));
  card.style.left = `${Math.round(x)}px`;
  card.style.top = `${Math.round(y)}px`;
}

function connectionPorts(connections) {
  const sources = new Map();
  const targets = new Map();
  for (const edge of connections || []) {
    addPort(sources, parseEndpoint(edge.from));
    addPort(targets, parseEndpoint(edge.to));
  }
  return { sources, targets };
}

function graphConnectionsForNode(unknownPorts, nodeId) {
  const targets = unknownPorts?.targets?.get?.(nodeId);
  return targets ? [...targets].map((portId) => `${nodeId}.${portId}`) : [];
}

function addPort(map, endpoint) {
  if (endpoint.node.startsWith("$")) return;
  if (!map.has(endpoint.node)) map.set(endpoint.node, new Set());
  map.get(endpoint.node).add(endpoint.port);
}

function appendUnknownPorts(ports, unknown, nodeId, direction) {
  for (const id of unknown || []) {
    const endpoint = `${nodeId}.${id}`;
    if (ports.some((port) => port.endpoint === endpoint)) continue;
    ports.push({ id, label: id, endpoint, direction, type: "any", parameter: id.startsWith("$parameter.") });
  }
}

function cloneGraph(graph, overrides = {}) {
  return JSON.parse(JSON.stringify({ ...graph, ...overrides }));
}

function normalizedPosition(position = {}) {
  return { x: Math.max(0, Math.round(Number(position.x) || 0)), y: Math.max(0, Math.round(Number(position.y) || 0)) };
}

function uniqueGraphNodeId(graph, nodeType) {
  const base = String(nodeType || "node").split(/[./]/).at(-1).replace(/[^a-z0-9_-]+/gi, "-") || "node";
  const used = new Set((graph.nodes || []).map((node) => node.id));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

function visualCompilerHook(definition, kind) {
  const metadata = definition?.metadata || {};
  if (kind === "effect") return {
    id: "vj1.visual.shader-effect",
    shaderInterface: metadata.shaderInterface || "effect",
    sampling: metadata.sampling || "unknown",
    fusible: metadata.fusible === true,
    roi: metadata.roi || { mode: "local", halo: 0, coordinateSpace: "boundary" },
    transformDomain: metadata.transformSource === false ? "group-field" : "composition",
  };
  if (metadata.nativeRenderer) return {
    id: "vj1.visual.native-source",
    renderer: metadata.nativeRenderer,
    allocationStable: metadata.allocationStableDirectPath === true,
  };
  return { id: "vj1.visual.shader-generator", shaderInterface: metadata.shaderInterface || "generator" };
}

function parseEndpoint(value) {
  const parts = String(value || "").split(".");
  return { node: parts[0], port: parts.slice(1).join(".") };
}

function bezierPath(from, to) {
  const bend = Math.max(42, Math.abs(to.x - from.x) * 0.45);
  return `M ${round(from.x)} ${round(from.y)} C ${round(from.x + bend)} ${round(from.y)}, ${round(to.x - bend)} ${round(to.y)}, ${round(to.x)} ${round(to.y)}`;
}

function readGraph(canvas) {
  try { return JSON.parse(canvas.querySelector("[data-node-graph-data]")?.textContent || "{}"); } catch { return { nodes: [], connections: [] }; }
}

function readEditableConnectionTypes(canvas) {
  try {
    const value = JSON.parse(canvas.querySelector("[data-node-graph-editable-connection-types]")?.textContent || "null");
    return Array.isArray(value) ? new Set(value.map((type) => String(type || ""))) : null;
  } catch {
    return null;
  }
}

function connectionTypeEditable(type, editableTypes) {
  return !editableTypes || editableTypes.has(String(type || ""));
}

function safeJson(value) {
  return JSON.stringify(value || {}).replace(/</g, "\\u003c");
}

function cssEscape(value) {
  return globalThis.CSS?.escape?.(value) || String(value).replace(/["\\]/g, "\\$&");
}

function round(value) {
  return Math.round(value * 10) / 10;
}
