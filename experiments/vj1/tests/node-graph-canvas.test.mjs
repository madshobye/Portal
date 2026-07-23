import test from "node:test";
import assert from "node:assert/strict";

import {
  graphWithConnection,
  graphWithNode,
  graphWithNodePosition,
  graphWithNodeParameter,
  graphWithNodeProvider,
  graphNodeFromDefinition,
  graphWithoutConnection,
  graphWithoutNode,
  nodeGraphCanvasTemplate,
  nodePortTypesCompatible,
} from "../js/control/node-graph-canvas.js";
import { withProjectGroupGraph, withProjectNodeGraph } from "../js/control/node-editor-view.js";
import { defineNode, defineNodeGroup, materializeProjectNodeFork, NodeRegistry } from "../js/libraries/node-engine/index.js";
import { MixTextureNode } from "../js/libraries/composition-engine/index.js";

const AddNode = defineNode({
  id: "test.canvas.add",
  name: "Add",
  description: "Adds a configured value.",
  inlets: { value: "number" },
  parameters: { amount: { type: "number", defaultValue: 1 } },
  outlets: { value: "number" },
  process: ({ value, amount }) => ({ value: value + amount }),
});

const directProgram = async (inputs, { run }) => run("add", inputs);
const GroupNode = defineNodeGroup({
  id: "test.canvas.group",
  name: "Canvas group",
  description: "An editable graph canvas fixture.",
  executionModel: "graph",
  inlets: { value: "number" },
  outlets: { value: "number" },
  nodes: [{ id: "add", type: AddNode.id, version: AddNode.version, parameters: { amount: 2 } }],
  connections: [
    { from: "$in.value", to: "add.value" },
    { from: "add.value", to: "$out.value" },
  ],
  program: directProgram,
});

test("graph canvas renders draggable nodes, typed ports, and selectable wires", () => {
  const registry = new NodeRegistry([AddNode, GroupNode]);
  const html = nodeGraphCanvasTemplate(GroupNode, registry);

  assert.match(html, /data-node-graph-canvas/);
  assert.match(html, /data-node-graph-node="add"/);
  assert.match(html, /data-node-graph-port="add\.value"/);
  assert.match(html, /data-value-type="number"/);
  assert.match(html, /data-node-graph-edge="0"/);
  assert.match(html, /data-node-graph-parameter="amount"/);
  assert.match(html, /value="2"/);
  assert.match(html, /Drag library nodes here/);
});

test("project Group canvases expose typed child ports as public interface actions", () => {
  const registry = new NodeRegistry([AddNode]);
  const projectGroup = {
    ...GroupNode,
    metadata: { ...GroupNode.metadata, projectOwned: true },
    parts: GroupNode.parts.map((part) => part.kind !== "graph" ? part : {
      ...part,
      nodes: part.nodes.map((node) => ({ ...node, role: "control" })),
      publicInlets: { primary: "add.value" },
      publicOutlets: { result: "add.value" },
    }),
  };
  const html = nodeGraphCanvasTemplate(projectGroup, registry, {
    publicInterfaceEditable: true,
  });

  assert.match(html, /data-node-graph-publish-port="value"/);
  assert.match(html, /data-node-graph-port-direction="inlet"/);
  assert.match(html, /data-node-graph-port-direction="outlet"/);
  assert.match(html, /data-node-graph-public-port="primary"[^>]*>primary<\/button>/);
  assert.match(html, /data-node-graph-public-port="result"[^>]*>result<\/button>/);
  assert.match(
    html,
    /data-node-graph-publish-parameter="amount"/,
    "declared control-node configuration can use the same public Group control action",
  );
});

test("graph canvas preserves compiler-owned dynamic service ports independently of current wires", () => {
  const registry = new NodeRegistry([AddNode, GroupNode]);
  const dynamicGroup = {
    ...GroupNode,
    parts: GroupNode.parts.map((part) => part.kind !== "graph" ? part : {
      ...part,
      connections: [],
      nodes: [{
        ...part.nodes[0],
        ports: {
          inlets: {
            "$dependency.store": { id: "$dependency.store", label: "uses store", type: "service" },
          },
          outlets: {
            $service: { id: "$service", label: "service", type: "service" },
          },
        },
      }],
    }),
  };
  const html = nodeGraphCanvasTemplate(dynamicGroup, registry);

  assert.match(html, /data-node-graph-port="add\.\$dependency\.store"/);
  assert.match(html, /data-node-graph-port="add\.\$service"/);
  assert.match(html, /data-value-type="service"/);
});

test("graph canvas can expose setup service wiring while locking descriptive dataflow edges", () => {
  const registry = new NodeRegistry([AddNode, GroupNode]);
  const graph = GroupNode.parts.find((part) => part.kind === "graph");
  const definition = {
    ...GroupNode,
    parts: GroupNode.parts.map((part) => part !== graph ? part : {
      ...part,
      nodes: graph.nodes.map((node) => ({
        ...node,
        ports: {
          inlets: { "$dependency.store": { id: "$dependency.store", type: "service" } },
          outlets: { $service: { id: "$service", type: "service" } },
        },
      })),
      connections: [
        ...graph.connections,
        { from: "add.$service", to: "add.$dependency.store", type: "service", phase: "setup" },
      ],
    }),
  };
  const html = nodeGraphCanvasTemplate(definition, registry, {
    connectionsEditable: true,
    nodesEditable: false,
    editableConnectionTypes: ["service"],
  });

  assert.match(html, /data-node-graph-editable-connection-types>\["service"\]/);
  assert.match(html, /data-edge-editable="true"/);
  assert.match(html, /data-edge-editable="false"/);
  assert.match(html, /compiler locked/);
});

test("graph editing primitives add, connect, move, disconnect, and remove nodes immutably", () => {
  const graph = GroupNode.parts.find((part) => part.kind === "graph");
  const withSecond = graphWithNode(graph, {
    id: "add-2",
    type: AddNode.id,
    version: AddNode.version,
    position: { x: 420, y: 180 },
  });
  const connected = graphWithConnection(withSecond, { from: "add.value", to: "add-2.value" });
  const setupConnected = graphWithConnection(withSecond, {
    from: "add.$service",
    to: "add-2.$dependency.store",
    type: "service",
    phase: "setup",
  });
  const moved = graphWithNodePosition(connected, "add-2", { x: 512, y: 214 });
  const disconnected = graphWithoutConnection(moved, moved.connections.findIndex((edge) => edge.to === "add-2.value"));
  const removed = graphWithoutNode(disconnected, "add-2");

  assert.equal(graph.nodes.length, 1, "source graph is unchanged");
  assert.deepEqual(moved.nodes.find((node) => node.id === "add-2").position, { x: 512, y: 214 });
  assert.equal(connected.connections.some((edge) => edge.to === "add-2.value"), true);
  assert.equal(setupConnected.connections.find((edge) => edge.to === "add-2.$dependency.store").phase, "setup");
  assert.equal(disconnected.connections.some((edge) => edge.to === "add-2.value"), false);
  assert.equal(removed.nodes.some((node) => node.id === "add-2"), false);
});

test("graph parameters are authored immutably and stay synchronized with compiled visual configuration", () => {
  const graph = GroupNode.parts.find((part) => part.kind === "graph");
  const configured = graphWithNodeParameter(graph, "add", "amount", 7);
  assert.equal(configured.nodes[0].parameters.amount, 7);
  assert.equal(graph.nodes[0].parameters.amount, 2);

  const Generator = defineNode({
    id: "vj1.visual.generator.parameter-fixture",
    name: "Parameter Fixture",
    description: "Keeps semantic node values and optimized configuration aligned.",
    implementation: "shader",
    parameters: { gain: { type: "number", defaultValue: 0.5 } },
    outlets: { texture: "texture" },
    metadata: { visualId: "parameter-fixture", visualKind: "generator" },
  });
  const visualNode = graphNodeFromDefinition(Generator, { id: "source", visualProgram: true });
  const visualGraph = graphWithNodeParameter({ nodes: [visualNode], connections: [] }, "source", "gain", 0.75);

  assert.equal(visualGraph.nodes[0].parameters.gain, 0.75);
  assert.equal(visualGraph.nodes[0].configuration.source.params.gain, 0.75);
  assert.equal(visualNode.configuration.source.params.gain, 0.5);
});

test("media-backed graph parameters use the shared media picker contract", () => {
  const MediaNode = defineNode({
    id: "test.canvas.media",
    name: "Media value",
    description: "Selects one project model as a typed graph resource.",
    parameters: {
      mediaId: {
        type: "string",
        defaultValue: "",
        editor: { type: "media", category: "model" },
      },
    },
    outlets: { value: "string" },
    process: ({ mediaId }) => ({ value: mediaId }),
  });
  const Group = defineNodeGroup({
    id: "test.canvas.media-group",
    name: "Media group",
    description: "Exposes a media-backed child in the graph canvas.",
    executionModel: "graph",
    outlets: { value: "string" },
    nodes: [{ id: "media", type: MediaNode.id, parameters: { mediaId: "media/skull.stl" } }],
    connections: [{ from: "media.value", to: "$out.value" }],
  });
  const html = nodeGraphCanvasTemplate(Group, new NodeRegistry([MediaNode, Group]));

  assert.match(html, /data-node-graph-media-parameter="mediaId"/);
  assert.match(html, /data-node-graph-media-accept="model"/);
  assert.match(html, />skull\.stl<\/button>/);
});

test("graph literal editors honor declared ranges and defer to connected parameter inputs", () => {
  const RangedNode = defineNode({
    id: "test.canvas.ranged",
    name: "Ranged value",
    description: "Exercises shared literal editor constraints.",
    parameters: {
      amount: {
        type: "number",
        defaultValue: 0.5,
        allowedRange: [0, 1],
        editor: { type: "slider", step: 0.01 },
      },
    },
    outlets: { value: "number" },
    process: ({ amount }) => ({ value: amount }),
  });
  const Group = defineNodeGroup({
    id: "test.canvas.connected-parameter",
    name: "Connected parameter",
    description: "Connects a public value to a child parameter.",
    executionModel: "graph",
    inlets: { amount: "number" },
    outlets: { value: "number" },
    nodes: [{ id: "ranged", type: RangedNode.id, parameters: { amount: 0.25 } }],
    connections: [
      { from: "$in.amount", to: "ranged.$parameter.amount", type: "number" },
      { from: "ranged.value", to: "$out.value", type: "number" },
    ],
  });
  const html = nodeGraphCanvasTemplate(Group, new NodeRegistry([RangedNode, Group]));

  assert.match(html, /type="number" value="0.25" min="0" max="1" step="0.01"/);
  assert.match(html, /data-node-graph-parameter="amount"[^>]* disabled/);
  assert.match(html, /Value is supplied by a connected node/);
});

test("graph connections enforce declared value-type compatibility", () => {
  assert.equal(nodePortTypesCompatible("number", "number"), true);
  assert.equal(nodePortTypesCompatible("any", "mesh"), true);
  assert.equal(nodePortTypesCompatible("texture", "mesh"), false);
});

test("provider selection replaces one semantic stage without disturbing its authored wiring", () => {
  const graph = {
    nodes: [{
      id: "geometry",
      type: "core.visual.procedural-geometry-provider",
      version: "0.1.0",
      parameters: { providerId: "terrain-height-field", enabled: true },
    }],
    connections: [{
      from: "geometry.geometry",
      to: "render.geometry",
      type: "geometry-provider",
    }],
  };
  const replaced = graphWithNodeProvider(graph, "geometry", {
    nodeId: "core.visual.planar-grid-geometry-provider",
    nodeVersion: "0.1.0",
    providerId: "planar-grid",
  });

  assert.equal(replaced.nodes[0].type, "core.visual.planar-grid-geometry-provider");
  assert.equal(replaced.nodes[0].parameters.providerId, "planar-grid");
  assert.equal(replaced.nodes[0].parameters.enabled, true);
  assert.deepEqual(replaced.connections, graph.connections);
  assert.equal(graph.nodes[0].parameters.providerId, "terrain-height-field");
});

test("position-only graph forks retain specialized programs while topology edits use graph execution", () => {
  const graph = GroupNode.parts.find((part) => part.kind === "graph");
  const positioned = graphWithNodePosition(graph, "add", { x: 300, y: 120 });
  const positionedNodes = withProjectNodeGraph({}, GroupNode, positioned);
  const positionedDefinition = materializeProjectNodeFork(GroupNode, positionedNodes.forks[0]);
  assert.equal(positionedDefinition.program, directProgram);

  const topology = graphWithNode(positioned, { id: "add-2", type: AddNode.id, version: AddNode.version });
  const topologyNodes = withProjectNodeGraph({}, GroupNode, topology);
  const topologyDefinition = materializeProjectNodeFork(GroupNode, topologyNodes.forks[0]);
  assert.equal(topologyDefinition.program, null);
});

test("persisted project groups accept graph presentation changes without losing compiler metadata", () => {
  const nodes = {
    authority: "node-graph",
    groups: [{
      id: "vj1.component.fixture",
      componentId: "fixture",
      compiler: { id: "specialized.visual" },
      nodes: [{ id: "source", nodeId: "test.canvas.add", nodeVersion: "0.1.0" }],
      connections: [],
    }],
  };
  const graph = graphWithNodePosition(nodes.groups[0], "source", { x: 144, y: 88 });
  const updated = withProjectGroupGraph(nodes, "vj1.component.fixture", graph);

  assert.deepEqual(updated.groups[0].nodes[0].position, { x: 144, y: 88 });
  assert.equal(updated.groups[0].compiler.id, "specialized.visual");
  assert.equal(nodes.groups[0].nodes[0].position, undefined, "source project data is unchanged");
});

test("dropping visual definitions creates compiler-owned Component operations rather than generic wrappers", () => {
  const Generator = defineNode({
    id: "vj1.visual.generator.fixture",
    name: "Fixture Generator",
    description: "Visual graph drop fixture.",
    implementation: "shader",
    parameters: { gain: { type: "number", defaultValue: 0.5 } },
    outlets: { texture: "texture" },
    metadata: {
      visualId: "fixture",
      visualKind: "generator",
      nodeOwnedShader: true,
      shaderInterface: "generator",
    },
  });
  const node = graphNodeFromDefinition(Generator, {
    id: "fixture-source",
    position: { x: 90, y: 70 },
    visualProgram: true,
  });

  assert.equal(node.nodeId, Generator.id);
  assert.equal(node.role, "source");
  assert.equal(node.compilerHook.id, "vj1.visual.shader-generator");
  assert.equal(node.configuration.source.generatorId, "fixture");
  assert.equal(node.configuration.source.params.gain, 0.5);
  assert.equal(node.type, undefined, "the persisted Component operation is not a generic graph wrapper");
});

test("dropping reusable control and motion definitions creates editable visual control nodes", () => {
  const Motion = defineNode({
    id: "test.control.motion",
    name: "Motion",
    description: "Produces a reusable modulation signal.",
    inlets: { time: { type: "number", defaultValue: 0 } },
    outlets: { value: { type: "number" } },
    capabilities: ["motion", "graph-placeable"],
    presentation: { placeableOn: ["node-graph"] },
    process: ({ time }) => ({ value: Math.sin(time) }),
  });
  const node = graphNodeFromDefinition(Motion, {
    id: "motion",
    position: { x: 25, y: 40 },
    visualProgram: true,
  });

  assert.equal(node.nodeId, Motion.id);
  assert.equal(node.role, "control");
  assert.deepEqual(node.parameters, {});
  assert.deepEqual(node.position, { x: 25, y: 40 });
  assert.equal(node.configuration, undefined);
});

test("dropping reusable texture DAG operators preserves their multi-input compiler contract", () => {
  const node = graphNodeFromDefinition(MixTextureNode, {
    id: "mix",
    position: { x: 60, y: 90 },
    visualProgram: true,
  });
  const edited = graphWithNodeParameter({ nodes: [node], connections: [] }, "mix", "amount", 0.7);

  assert.equal(node.role, "operator");
  assert.equal(node.compilerHook.id, "vj1.visual.texture-operator");
  assert.equal(node.configuration.kind, "texture-operator");
  assert.equal(edited.nodes[0].parameters.amount, 0.7);
  assert.equal(edited.nodes[0].configuration.params.amount, 0.7);
});
