import { valueTypeId } from "../libraries/node-engine/node-types.js";
import { esc, icon } from "./template-utils.js";

const CARD_WIDTH = 184;
const BOUNDARY_WIDTH = 132;
const PORT_ROW = 22;
const PORT_TOP = 58;

export function nodeGraphCanvasTemplate(definition, registry, options = {}) {
  const topologyEditable = options.topologyEditable !== false;
  const connectionsEditable = options.connectionsEditable ?? topologyEditable;
  const editableConnectionTypes = Array.isArray(options.editableConnectionTypes)
    ? new Set(options.editableConnectionTypes.map((type) => String(type || "")))
    : null;
  const nodesEditable = options.nodesEditable ?? topologyEditable;
  const layoutEditable = options.layoutEditable !== false;
  const visualProgram = options.visualProgram === true;
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
            : "Compiler-owned topology · node layout is editable"}</small>
      </header>
      <div class="node-graph-canvas" data-node-graph-canvas data-node-graph-definition="${esc(definition.metadata?.baseNode?.id || definition.id)}" data-topology-editable="${nodesEditable || connectionsEditable}" data-connections-editable="${connectionsEditable}" data-nodes-editable="${nodesEditable}" data-layout-editable="${layoutEditable}" data-visual-program="${visualProgram}" style="--node-graph-width:${model.width}px;--node-graph-height:${model.height}px">
        <svg class="node-graph-wires" viewBox="0 0 ${model.width} ${model.height}" aria-label="Node connections">
          ${(graph.connections || []).map((edge, index) => graphEdgeTemplate(edge, index, model, {
            editable: connectionsEditable && connectionTypeEditable(edge.type, editableConnectionTypes),
          })).join("")}
        </svg>
        ${model.cards.map((card) => graphCardTemplate(card, { nodesEditable })).join("")}
        <script type="application/json" data-node-graph-data>${safeJson(graph)}</script>
        <script type="application/json" data-node-graph-editable-connection-types>${safeJson(editableConnectionTypes ? [...editableConnectionTypes] : null)}</script>
      </div>
    </section>`;
}

export function bindNodeGraphCanvas(scope, {
  registry,
  onGraphChange = () => {},
  onStatus = () => {},
} = {}) {
  const canvas = scope?.querySelector?.("[data-node-graph-canvas]");
  if (!canvas || canvas.dataset.bound) return () => {};
  canvas.dataset.bound = "true";
  let graph = readGraph(canvas);
  let pendingOutlet = "";
  const connectionsEditable = canvas.dataset.connectionsEditable === "true";
  const editableConnectionTypes = readEditableConnectionTypes(canvas);
  const nodesEditable = canvas.dataset.nodesEditable === "true";
  const layoutEditable = canvas.dataset.layoutEditable === "true";
  const visualProgram = canvas.dataset.visualProgram === "true";

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
  throw new Error(`Only visual generators, effects, and layer groups can be added to a Component program`);
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
  const childCards = childNodes.map((node, index) => childCard(node, index, registry, unknownPorts));
  const defaultHeight = Math.max(430, 110 + childCards.length * 34);
  const width = Math.max(960, 430 + Math.max(1, childCards.length) * 230);
  const height = Math.max(defaultHeight, ...childCards.map((card) => card.y + card.height + 40));
  const inputCard = boundaryCard("$in", "Graph inputs", definition.inlets, "outlet", 24, 62);
  const outputCard = boundaryCard("$out", "Graph outputs", definition.outlets, "inlet", width - BOUNDARY_WIDTH - 24, 62);
  const cards = [inputCard, ...childCards, outputCard];
  const byId = new Map(cards.map((card) => [card.id, card]));
  return { width, height, cards, childNodes, byId };
}

function childCard(node, index, registry, unknownPorts) {
  let definition = null;
  try { definition = registry?.get?.(node.type || node.nodeId, node.version || node.nodeVersion); } catch {}
  const id = String(node.id || `node-${index + 1}`);
  const inlets = mergedPorts(definition?.inlets, node.ports?.inlets).map((port) => graphPort(id, port, "inlet"));
  const parameters = Object.values(definition?.parameters || {}).map((port) => graphPort(id, port, "inlet", true));
  const outlets = mergedPorts(definition?.outlets, node.ports?.outlets).map((port) => graphPort(id, port, "outlet"));
  appendUnknownPorts(inlets, unknownPorts.targets.get(id), id, "inlet");
  appendUnknownPorts(outlets, unknownPorts.sources.get(id), id, "outlet");
  const position = node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
    ? normalizedPosition(node.position)
    : { x: 246 + (index % 4) * 224, y: 48 + Math.floor(index / 4) * 230 };
  const rows = Math.max(inlets.length + parameters.length, outlets.length, 1);
  return {
    id,
    name: definition?.name || node.type || node.nodeId || id,
    type: node.type || node.nodeId || "unknown",
    x: position.x,
    y: position.y,
    width: CARD_WIDTH,
    height: PORT_TOP + rows * PORT_ROW + 12,
    inlets: [...inlets, ...parameters],
    outlets,
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

function graphPort(nodeId, port, direction, parameter = false) {
  return {
    id: port.id,
    label: port.label || port.id,
    endpoint: parameter ? `${nodeId}.$parameter.${port.id}` : `${nodeId}.${port.id}`,
    direction,
    type: valueTypeId(port.type),
    parameter,
  };
}

function graphCardTemplate(card, { nodesEditable = true } = {}) {
  return `<article class="node-graph-card ${card.id.startsWith("$") ? "is-boundary" : ""}" data-node-graph-node="${esc(card.id)}" data-x="${card.x}" data-y="${card.y}" style="left:${card.x}px;top:${card.y}px;width:${card.width}px;min-height:${card.height}px">
    <header data-node-graph-drag>${icon(card.id.startsWith("$") ? "input" : "data_object")}<span><strong>${esc(card.name)}</strong><small>${esc(card.type)}</small></span>${card.removable && nodesEditable ? `<button type="button" data-remove-graph-node="${esc(card.id)}" title="Remove node" aria-label="Remove ${esc(card.name)}">${icon("close")}</button>` : ""}</header>
    <div class="node-graph-card-ports is-inlets">${card.inlets.map(graphPortTemplate).join("")}</div>
    <div class="node-graph-card-ports is-outlets">${card.outlets.map(graphPortTemplate).join("")}</div>
  </article>`;
}

function graphPortTemplate(port) {
  return `<button type="button" class="node-graph-port is-${port.direction}${port.parameter ? " is-parameter" : ""}" data-node-graph-port="${esc(port.endpoint)}" data-direction="${port.direction}" data-value-type="${esc(port.type)}" title="${esc(port.endpoint)} · ${esc(port.type)}"><i></i><span>${esc(port.label)}</span><small>${esc(port.type)}</small></button>`;
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
