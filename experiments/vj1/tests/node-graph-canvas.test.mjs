import test from "node:test";
import assert from "node:assert/strict";

import {
  graphWithConnection,
  graphWithNode,
  graphWithNodePosition,
  graphNodeFromDefinition,
  graphWithoutConnection,
  graphWithoutNode,
  nodeGraphCanvasTemplate,
  nodePortTypesCompatible,
} from "../js/control/node-graph-canvas.js";
import { withProjectGroupGraph, withProjectNodeGraph } from "../js/control/node-editor-view.js";
import { defineNode, defineNodeGroup, materializeProjectNodeFork, NodeRegistry } from "../js/libraries/node-engine/index.js";

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
  assert.match(html, /Drag library nodes here/);
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

test("graph connections enforce declared value-type compatibility", () => {
  assert.equal(nodePortTypesCompatible("number", "number"), true);
  assert.equal(nodePortTypesCompatible("any", "mesh"), true);
  assert.equal(nodePortTypesCompatible("texture", "mesh"), false);
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
