import test from "node:test";
import assert from "node:assert/strict";

import {
  compileVisualRenderPlan,
  mapControlValue,
  visualRenderPlanConfiguration,
} from "../js/libraries/composition-engine/index.js";
import {
  createProjectVisualGroupDefinition,
  createNodePackageFromProject,
  defineNode,
  materializeProjectNodeFork,
  NodeRegistry,
} from "../js/libraries/node-engine/index.js";
import { graphNodeFromDefinition } from "../js/control/node-graph-canvas.js";
import {
  withProjectNodeGraph,
  withProjectNodeParameterExposure,
  withProjectNodePortExposure,
} from "../js/control/node-editor-view.js";
import {
  ComponentTimeControlNode,
  MidiControlInputNode,
  OscillatorControlNode,
  SliderNode,
  SmoothControlNode,
} from "../js/libraries/control-engine/index.js";
import {
  FeedbackTextureNode,
  MaskTextureNode,
  MixTextureNode,
  SelectTextureNode,
  TransitionTextureNode,
} from "../js/libraries/composition-engine/index.js";
import { createIsfNodeDefinition } from "../js/libraries/isf-engine/index.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/index.js";

function renderNode(id, role) {
  return {
    id,
    nodeId: role === "effect" ? `vj1.visual.effect.${id}` : `vj1.visual.generator.${id}`,
    nodeVersion: "0.1.0",
    role,
    compilerHook: { id: role === "effect" ? "vj1.visual.shader-effect" : "vj1.visual.shader-generator", fusible: role === "effect" },
    configuration: role === "effect"
      ? { id, kind: "effect", componentId: id, params: {} }
      : { id, kind: "source", source: { type: "generator", generatorId: id, params: {} } },
  };
}

test("project-owned visual Groups compile their authored graph into nested optimized operations", () => {
  const Generator = defineNode({
    id: "test.visual.project-group-source",
    name: "Project Group Source",
    description: "A source fixture for project-owned visual compound compilation.",
    implementation: "shader",
    parameters: { gain: { type: "number", defaultValue: 0.5 } },
    outlets: { texture: "texture" },
    metadata: {
      visualId: "project-group-source",
      visualKind: "generator",
      shaderInterface: "generator",
    },
  });
  const serializedGroup = createProjectVisualGroupDefinition({
    id: "org.vj1.project.compound-fixture",
    name: "Compound Fixture",
  });
  const registry = new NodeRegistry([Generator, serializedGroup]);
  const baseGroup = registry.get(serializedGroup.id);
  const source = graphNodeFromDefinition(Generator, { id: "source", visualProgram: true });
  const graph = {
    ...baseGroup.parts.find((part) => part.kind === "graph"),
    nodes: [source],
    connections: [{ from: "source.texture", to: "$out.texture", type: "texture" }],
  };
  const nodes = withProjectNodeGraph({}, baseGroup, graph);
  const group = materializeProjectNodeFork(baseGroup, nodes.forks[0]);
  const exported = createNodePackageFromProject({
    ...nodes,
    definitions: [serializedGroup],
  }, {
    id: "org.vj1.package.compound-fixture",
    name: "Compound Fixture",
    version: "0.1.0",
    description: "Portable project-owned visual compound fixture.",
    nodeIds: [{ id: serializedGroup.id, version: serializedGroup.version }],
    forkIds: [nodes.forks[0].id],
  });
  const resolver = createProjectVisualNodeResolver({
    nodes: {
      definitions: [serializedGroup],
      forks: nodes.forks,
      packages: [],
    },
    media: [],
  });
  const resolvedGroup = resolver.definition(serializedGroup.id);
  const outer = graphNodeFromDefinition(group, { id: "compound", visualProgram: true });
  const plan = compileVisualRenderPlan({
    id: "vj1.component.project-compound",
    nodes: [outer],
    connections: [{ from: "compound.texture", to: "$out.texture", type: "texture" }],
  }, {}, {
    resolveDefinition: (node) => node.nodeId === group.id ? group : registry.get(node.nodeId),
  });

  assert.equal(outer.role, "group");
  assert.equal(resolvedGroup.parts.find((part) => part.kind === "graph").nodes.length, 1);
  assert.equal(exported.definitions.some((definition) => definition.id === serializedGroup.id), true);
  assert.equal(exported.forks.length, 1);
  assert.equal(exported.nodeDependencies.some((dependency) => dependency.id === Generator.id), true);
  assert.equal(outer.compilerHook.id, "vj1.visual.compound");
  assert.equal(plan.operations[0].backend, "compiled-visual-group");
  assert.equal(plan.operations[0].operations[0].backend, "shader-generator");
  assert.equal(plan.operations[0].operations[0].configuration.source.params.gain, 0.5);
  assert.equal(plan.executionModel, "compiled-chain");
});

test("project-owned Group controls compile into direct child-operation parameter bindings", () => {
  const Generator = defineNode({
    id: "test.visual.public-control-source",
    name: "Public Control Source",
    description: "A source fixture whose gain is published through a project Group.",
    implementation: "shader",
    parameters: {
      gain: {
        type: "number",
        label: "Gain",
        defaultValue: 0.5,
        allowedRange: [0, 1],
      },
    },
    outlets: { texture: "texture" },
    metadata: {
      visualId: "public-control-source",
      visualKind: "generator",
      shaderInterface: "generator",
    },
  });
  const serialized = createProjectVisualGroupDefinition({
    id: "org.vj1.project.public-control-fixture",
    name: "Public Control Fixture",
  });
  const registry = new NodeRegistry([Generator, SliderNode, serialized]);
  const base = registry.get(serialized.id);
  const source = graphNodeFromDefinition(Generator, { id: "source", visualProgram: true });
  let nodes = withProjectNodeGraph({}, base, {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes: [source],
    connections: [{ from: "source.texture", to: "$out.texture", type: "texture" }],
  });
  nodes = withProjectNodeParameterExposure(nodes, base, {
    nodeId: "source",
    parameterId: "gain",
    publicParameterId: "level",
    parameter: Generator.parameters.gain,
    sectionLabel: Generator.name,
    exposed: true,
  });
  const group = materializeProjectNodeFork(base, nodes.forks[0]);
  const compound = graphNodeFromDefinition(group, { id: "compound", visualProgram: true });
  const slider = graphNodeFromDefinition(SliderNode, { id: "level-control", visualProgram: true });
  slider.parameters.value = 0.9;
  const plan = compileVisualRenderPlan({
    id: "vj1.component.public-control",
    nodes: [slider, compound],
    connections: [
      { from: "level-control.value", to: "compound.$parameter.level", type: "number" },
      { from: "compound.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: (node) => {
      if (node.nodeId === group.id) return group;
      return registry.get(node.nodeId);
    },
  });

  const operation = plan.operations[0];
  const child = operation.operations[0];
  assert.equal(group.parameters.level.defaultValue, 0.5);
  assert.deepEqual(group.metadata.controlProjection.sections[0].controls[0].bindings, [
    { nodeId: "source", parameterId: "gain" },
  ]);
  assert.equal(operation.configuration.kind, "source");
  assert.equal(child.configuration.source.params.gain, 0.5);
  const restore = plan.controlProgram.apply();
  assert.equal(child.configuration.source.params.gain, 0.9);
  restore();
  assert.equal(child.configuration.source.params.gain, 0.5);

  const prunedNodes = withProjectNodeGraph(nodes, base, {
    ...group.parts.find((part) => part.kind === "graph"),
    nodes: [],
    connections: [],
  });
  const pruned = materializeProjectNodeFork(base, prunedNodes.forks[0]);
  assert.equal("level" in pruned.parameters, false, "removing a child also removes its orphaned public control");
  assert.deepEqual(pruned.metadata.controlProjection.sections, []);
});

test("controls inside a project visual Group compile with its nested operations", () => {
  const Generator = defineNode({
    id: "test.visual.internal-control-source",
    name: "Internal Control Source",
    description: "A source fixture driven by a control inside a project Group.",
    implementation: "shader",
    parameters: { gain: { type: "number", defaultValue: 0.25 } },
    outlets: { texture: "texture" },
    metadata: {
      visualId: "internal-control-source",
      visualKind: "generator",
      shaderInterface: "generator",
    },
  });
  const serialized = createProjectVisualGroupDefinition({
    id: "org.vj1.project.internal-control-fixture",
    name: "Internal Control Fixture",
  });
  const registry = new NodeRegistry([Generator, SliderNode, serialized]);
  const base = registry.get(serialized.id);
  const source = graphNodeFromDefinition(Generator, { id: "source", visualProgram: true });
  const slider = graphNodeFromDefinition(SliderNode, { id: "gain", visualProgram: true });
  slider.parameters.value = 0.75;
  const nodes = withProjectNodeGraph({}, base, {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes: [slider, source],
    connections: [
      { from: "gain.value", to: "source.$parameter.gain", type: "number" },
      { from: "source.texture", to: "$out.texture", type: "texture" },
    ],
  });
  const group = materializeProjectNodeFork(base, nodes.forks[0]);
  const compound = graphNodeFromDefinition(group, { id: "compound", visualProgram: true });
  const plan = compileVisualRenderPlan({
    id: "vj1.component.internal-control",
    nodes: [compound],
    connections: [{ from: "compound.texture", to: "$out.texture", type: "texture" }],
  }, {}, {
    resolveDefinition: (node) => {
      if (node.nodeId === group.id) return group;
      return registry.get(node.nodeId);
    },
  });
  const operation = plan.operations[0];
  const child = operation.operations[0];

  assert.equal(operation.controlProgram.steps.length, 1);
  assert.equal(operation.controlProgram.bindings.length, 1);
  assert.equal(child.configuration.source.params.gain, 0.25);
  const restore = operation.controlProgram.apply();
  assert.equal(child.configuration.source.params.gain, 0.75);
  restore();
  assert.equal(child.configuration.source.params.gain, 0.25);
});

test("project visual Groups publish control-node configuration into the direct control program", () => {
  const Generator = defineNode({
    id: "test.visual.public-control-node-source",
    name: "Public Control Node Source",
    description: "A source fixture driven by a configurable internal oscillator.",
    implementation: "shader",
    parameters: { gain: { type: "number", defaultValue: 0.25 } },
    outlets: { texture: "texture" },
    metadata: {
      visualId: "public-control-node-source",
      visualKind: "generator",
      shaderInterface: "generator",
    },
  });
  const serialized = createProjectVisualGroupDefinition({
    id: "org.vj1.project.public-control-node-fixture",
    name: "Public Control Node Fixture",
  });
  const registry = new NodeRegistry([
    Generator,
    ComponentTimeControlNode,
    OscillatorControlNode,
    SliderNode,
    serialized,
  ]);
  const base = registry.get(serialized.id);
  const time = graphNodeFromDefinition(ComponentTimeControlNode, { id: "time", visualProgram: true });
  const oscillator = graphNodeFromDefinition(OscillatorControlNode, { id: "oscillator", visualProgram: true });
  const source = graphNodeFromDefinition(Generator, { id: "source", visualProgram: true });
  let nodes = withProjectNodeGraph({}, base, {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes: [time, oscillator, source],
    connections: [
      { from: "time.time", to: "oscillator.time", type: "number" },
      { from: "oscillator.value", to: "source.$parameter.gain", type: "number" },
      { from: "source.texture", to: "$out.texture", type: "texture" },
    ],
  });
  nodes = withProjectNodeParameterExposure(nodes, base, {
    nodeId: "oscillator",
    parameterId: "frequency",
    publicParameterId: "speed",
    parameter: OscillatorControlNode.parameters.frequency,
    sectionLabel: "Motion",
    exposed: true,
  });
  const group = materializeProjectNodeFork(base, nodes.forks[0]);
  const compound = graphNodeFromDefinition(group, { id: "compound", visualProgram: true });
  const speed = graphNodeFromDefinition(SliderNode, { id: "speed-control", visualProgram: true });
  speed.parameters.value = 0.5;
  const plan = compileVisualRenderPlan({
    id: "vj1.component.public-control-node",
    nodes: [speed, compound],
    connections: [
      { from: "speed-control.value", to: "compound.$parameter.speed", type: "number" },
      { from: "compound.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: (node) => {
      if (node.nodeId === group.id) return group;
      return registry.get(node.nodeId);
    },
  });
  const operation = plan.operations[0];
  const oscillatorStep = operation.controlProgram.steps.find((step) => step.instanceId === "oscillator");
  const child = operation.operations[0];

  assert.equal(group.parameters.speed.defaultValue, 1);
  assert.deepEqual(group.metadata.controlProjection.sections[0].controls[0].bindings, [
    { nodeId: "oscillator", parameterId: "frequency" },
  ]);
  assert.equal(oscillatorStep.parameters.frequency, 1);
  const restorePublicControl = plan.controlProgram.apply();
  assert.equal(oscillatorStep.parameters.frequency, 0.5);
  const restoreInternalControl = operation.controlProgram.apply({ componentTime: 0.25 });
  assert.notEqual(child.configuration.source.params.gain, 0.25);
  restoreInternalControl();
  assert.equal(child.configuration.source.params.gain, 0.25);
  restorePublicControl();
  assert.equal(oscillatorStep.parameters.frequency, 1);
});

test("a project visual Group can compile as a reusable texture-input effect module", () => {
  const Source = defineNode({
    id: "test.visual.compound-input-source",
    name: "Compound Input Source",
    description: "A source fixture feeding a project visual effect Group.",
    implementation: "shader",
    outlets: { texture: "texture" },
    metadata: {
      visualId: "compound-input-source",
      visualKind: "generator",
      shaderInterface: "generator",
    },
  });
  const Effect = defineNode({
    id: "test.visual.compound-inner-effect",
    name: "Compound Inner Effect",
    description: "An effect fixture consuming the project Group texture inlet.",
    implementation: "shader",
    inlets: { texture: "texture" },
    outlets: { texture: "texture" },
    parameters: { amount: { type: "number", defaultValue: 0.5 } },
    metadata: {
      visualId: "compound-inner-effect",
      visualKind: "effect",
      shaderInterface: "effect",
      sampling: "local",
      fusible: true,
    },
  });
  const serialized = createProjectVisualGroupDefinition({
    id: "org.vj1.project.effect-module",
    name: "Effect Module",
  });
  const registry = new NodeRegistry([Source, Effect, serialized]);
  const base = registry.get(serialized.id);
  const effect = graphNodeFromDefinition(Effect, { id: "effect", visualProgram: true });
  const nodes = withProjectNodeGraph({}, base, {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes: [effect],
    connections: [
      { from: "$in.texture", to: "effect.texture", type: "texture" },
      { from: "effect.texture", to: "$out.texture", type: "texture" },
    ],
  });
  const group = materializeProjectNodeFork(base, nodes.forks[0]);
  const source = graphNodeFromDefinition(Source, { id: "source", visualProgram: true });
  const compound = graphNodeFromDefinition(group, { id: "compound", visualProgram: true });
  const plan = compileVisualRenderPlan({
    id: "vj1.component.effect-module",
    nodes: [source, compound],
    connections: [
      { from: "source.texture", to: "compound.texture", type: "texture" },
      { from: "compound.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: (node) => {
      if (node.nodeId === group.id) return group;
      return registry.get(node.nodeId);
    },
  });

  assert.equal(plan.operations[1].backend, "compiled-visual-group");
  assert.deepEqual(plan.operations[1].textureInputs, { texture: "source" });
  assert.equal(plan.operations[1].operations[0].backend, "shader-effect");
  assert.deepEqual(plan.operations[1].operations[0].textureInputs, { texture: "$in.texture" });
});

test("project visual Groups compile named public texture inputs into a retained nested DAG", () => {
  const Source = defineNode({
    id: "test.visual.public-input-source",
    name: "Public Input Source",
    description: "A source fixture feeding a named public Group input.",
    implementation: "shader",
    outlets: { texture: "texture" },
    metadata: {
      visualId: "public-input-source",
      visualKind: "generator",
      shaderInterface: "generator",
    },
  });
  const serialized = createProjectVisualGroupDefinition({
    id: "org.vj1.project.named-texture-inputs",
    name: "Named Texture Inputs",
  });
  const registry = new NodeRegistry([Source, MixTextureNode, serialized]);
  const base = registry.get(serialized.id);
  const mix = graphNodeFromDefinition(MixTextureNode, { id: "mix", visualProgram: true });
  let nodes = withProjectNodeGraph({}, base, {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes: [mix],
    connections: [{ from: "mix.texture", to: "$out.texture", type: "texture" }],
  });
  nodes = withProjectNodePortExposure(nodes, base, {
    nodeId: "mix",
    portId: "a",
    publicPortId: "foreground",
    port: MixTextureNode.inlets.a,
    direction: "inlet",
    exposed: true,
  });
  nodes = withProjectNodePortExposure(nodes, base, {
    nodeId: "mix",
    portId: "b",
    publicPortId: "background",
    port: MixTextureNode.inlets.b,
    direction: "inlet",
    exposed: true,
  });
  nodes = withProjectNodePortExposure(nodes, base, {
    nodeId: "mix",
    portId: "a",
    publicPortId: "primary",
    port: MixTextureNode.inlets.a,
    direction: "inlet",
    exposed: true,
  });
  const group = materializeProjectNodeFork(base, nodes.forks[0]);
  const sourceA = graphNodeFromDefinition(Source, { id: "source-a", visualProgram: true });
  const sourceB = graphNodeFromDefinition(Source, { id: "source-b", visualProgram: true });
  const compound = graphNodeFromDefinition(group, { id: "compound", visualProgram: true });
  const plan = compileVisualRenderPlan({
    id: "vj1.component.named-texture-inputs",
    nodes: [sourceA, sourceB, compound],
    connections: [
      { from: "source-a.texture", to: "compound.primary", type: "texture" },
      { from: "source-b.texture", to: "compound.background", type: "texture" },
      { from: "compound.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: (node) => {
      if (node.nodeId === group.id) return group;
      return registry.get(node.nodeId);
    },
  });

  const operation = plan.operations[2];
  const exported = createNodePackageFromProject({
    ...nodes,
    definitions: [serialized],
  }, {
    id: "org.vj1.package.named-texture-inputs",
    name: "Named Texture Inputs",
    version: "0.1.0",
    description: "Portable named-input visual Group fixture.",
    nodeIds: [{ id: serialized.id, version: serialized.version }],
    forkIds: [nodes.forks[0].id],
  });
  assert.equal(plan.executionModel, "texture-dag");
  assert.equal(operation.executionModel, "texture-dag");
  assert.deepEqual(operation.publicTextureInputs, {
    background: "mix.b",
    primary: "mix.a",
  });
  assert.deepEqual(operation.textureInputs, {
    primary: "source-a",
    background: "source-b",
  });
  assert.deepEqual(operation.operations[0].textureInputs, {
    a: "$in.primary",
    b: "$in.background",
  });
  assert.equal(operation.runtimeStates instanceof Map, true);
  assert.equal(operation.retainedOperators instanceof Map, true);
  assert.equal("foreground" in exported.forks[0].definition.inlets, false);
  assert.equal(exported.forks[0].definition.inlets.primary.type.type, "texture");
  assert.equal(
    exported.forks[0].definition.parts.find((part) => part.kind === "graph")
      .publicInlets.background,
    "mix.b",
  );

  const prunedNodes = withProjectNodeGraph(nodes, base, {
    ...group.parts.find((part) => part.kind === "graph"),
    nodes: [],
    connections: [],
  });
  const pruned = materializeProjectNodeFork(base, prunedNodes.forks[0]);
  const prunedGraph = pruned.parts.find((part) => part.kind === "graph");
  assert.equal("primary" in pruned.inlets, false);
  assert.equal("background" in pruned.inlets, false);
  assert.deepEqual(prunedGraph.publicInlets, {});
});

test("visual Group placements compile distinct simultaneous image outputs as retained value identities", () => {
  const Source = defineNode({
    id: "test.visual.multiple-output-source",
    name: "Multiple Output Source",
    description: "A fixture proving that visual output limitations fail explicitly.",
    implementation: "shader",
    outlets: { texture: "texture" },
    metadata: {
      visualId: "multiple-output-source",
      visualKind: "generator",
      shaderInterface: "generator",
    },
  });
  const serialized = createProjectVisualGroupDefinition({
    id: "org.vj1.project.multiple-output-rejection",
    name: "Multiple Output Rejection",
  });
  const registry = new NodeRegistry([Source, MixTextureNode, serialized]);
  const base = registry.get(serialized.id);
  const sourceA = graphNodeFromDefinition(Source, { id: "source-a", visualProgram: true });
  const sourceB = graphNodeFromDefinition(Source, { id: "source-b", visualProgram: true });
  let nodes = withProjectNodeGraph({}, base, {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes: [sourceA, sourceB],
    connections: [{ from: "source-a.texture", to: "$out.texture", type: "texture" }],
  });
  nodes = withProjectNodePortExposure(nodes, base, {
    nodeId: "source-b",
    portId: "texture",
    publicPortId: "alternate",
    port: Source.outlets.texture,
    direction: "outlet",
    exposed: true,
  });
  const group = materializeProjectNodeFork(base, nodes.forks[0]);
  const compound = graphNodeFromDefinition(group, { id: "compound", visualProgram: true });
  const resolveDefinition = (node) => {
    if (node.nodeId === group.id) return group;
    return registry.get(node.nodeId);
  };
  const primary = compileVisualRenderPlan({
    id: "vj1.component.multiple-output-primary",
    nodes: [compound],
    connections: [{ from: "compound.texture", to: "$out.texture", type: "texture" }],
  }, {}, { resolveDefinition });
  const alternate = compileVisualRenderPlan({
    id: "vj1.component.multiple-output-alternate",
    nodes: [compound],
    connections: [{ from: "compound.alternate", to: "$out.texture", type: "texture" }],
  }, {}, { resolveDefinition });
  const mix = graphNodeFromDefinition(MixTextureNode, { id: "mix", visualProgram: true });

  assert.equal(primary.operations[0].outputPort, "texture");
  assert.deepEqual(primary.operations[0].operations.map((operation) => operation.id), ["source-a"]);
  assert.equal(alternate.operations[0].outputPort, "alternate");
  assert.deepEqual(alternate.operations[0].operations.map((operation) => operation.id), ["source-b"]);
  const fanOut = compileVisualRenderPlan({
    id: "vj1.component.multiple-output-fan-out",
    nodes: [compound, mix],
    connections: [
      { from: "compound.texture", to: "mix.a", type: "texture" },
      { from: "compound.alternate", to: "mix.b", type: "texture" },
      { from: "mix.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, { resolveDefinition });
  const compiledGroup = fanOut.operations[0];

  assert.equal(fanOut.executionModel, "texture-dag");
  assert.equal(compiledGroup.backend, "compiled-visual-group");
  assert.equal(compiledGroup.executionModel, "texture-dag");
  assert.deepEqual(compiledGroup.outputPorts, ["texture", "alternate"]);
  assert.deepEqual(compiledGroup.outputBindings, {
    texture: "source-a",
    alternate: "source-b",
  });
  assert.deepEqual(
    compiledGroup.operations.map((operation) => operation.id),
    ["source-a", "source-b"],
    "the reachable union is compiled once rather than cloning the Group for each output",
  );
  assert.deepEqual(fanOut.operations[1].textureInputs, {
    a: "compound",
    b: "compound.alternate",
  });
});

test("visual render plans follow authored texture connections and omit disconnected editor nodes", () => {
  const group = {
    id: "vj1.component.plan",
    componentId: "plan",
    nodes: [renderNode("unused", "effect"), renderNode("source", "source"), renderNode("active", "effect")],
    connections: [
      { from: "$in.texture", to: "source.image", type: "texture" },
      { from: "source.texture", to: "active.texture", type: "texture" },
      { from: "active.texture", to: "$out.texture", type: "texture" },
    ],
  };
  const plan = compileVisualRenderPlan(group, { id: "plan", chain: [] });

  assert.deepEqual(plan.operations.map((operation) => operation.id), ["source", "active"]);
  assert.deepEqual(plan.operations.map((operation) => operation.opcode), ["source", "effect"]);
  assert.equal(plan.operations[1].transformDomain, null, "legacy graph metadata remains explicit for definition fallback");
  assert.equal(plan.contractVersion, 1);
  assert.equal(plan.diagnostics.some((diagnostic) => diagnostic.code === "VISUAL_PLAN_UNUSED_NODE" && diagnostic.path.endsWith("/unused")), true);
  assert.deepEqual(visualRenderPlanConfiguration(plan).map((item) => item.id), ["source", "active"]);
});

test("visual render plans retain normalized semantic contracts for optimized hosts", () => {
  const source = renderNode("source", "source");
  source.compilerHook.contract = {
    transform: { domain: "content" },
    roi: { mode: "neighborhood", halo: 4, coordinateSpace: "boundary" },
    alpha: { input: "premultiplied", output: "premultiplied" },
  };
  const plan = compileVisualRenderPlan({
    id: "vj1.component.contract",
    nodes: [source],
    connections: [
      { from: "$in.texture", to: "source.image", type: "texture" },
      { from: "source.texture", to: "$out.texture", type: "texture" },
    ],
  });

  assert.equal(plan.operations[0].contract.roi.mode, "neighborhood");
  assert.equal(plan.operations[0].contract.roi.halo, 4);
  assert.equal(plan.operations[0].contract.transform.domain, "content");
  assert.deepEqual(plan.compilerPasses, [
    "contract-normalization",
    "contract-compatibility",
    "roi-backpropagation",
    "transform-normalization",
    "allocation-lowering",
  ]);
});

test("compiled media model spin keeps the component frame-dependent", () => {
  const source = renderNode("spinning-model", "source");
  source.configuration.source = {
    type: "media",
    mediaId: "media/skull.obj",
    params: { spinX: 0.22, spinY: 0, spinZ: -0.14 },
  };
  const plan = compileVisualRenderPlan({
    id: "vj1.component.spinning-model",
    componentId: "spinning-model",
    nodes: [source],
    connections: [
      { from: "$in.texture", to: "spinning-model.image", type: "texture" },
      { from: "spinning-model.texture", to: "$out.texture", type: "texture" },
    ],
  });

  assert.equal(plan.inspect().dynamics.frameDependent, true);
});

test("animated file-backed shader definitions remain frame-dependent without host-specific exceptions", () => {
  const definition = createIsfNodeDefinition({
    path: "shaders/animated.fs",
    source: `/*{ "ISFVSN": "2.0", "LABEL": "Animated" }*/
      void main() { gl_FragColor = vec4(fract(TIME)); }`,
  });
  const node = {
    id: "animated-isf",
    nodeId: definition.id,
    nodeVersion: definition.version,
    role: "source",
    configuration: {
      id: "animated-isf",
      kind: "source",
      source: { type: "generator", generatorId: definition.metadata.visualId, params: {} },
    },
  };
  const plan = compileVisualRenderPlan({
    id: "vj1.component.animated-isf",
    nodes: [node],
    connections: [
      { from: "$in.texture", to: "animated-isf.image", type: "texture" },
      { from: "animated-isf.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: () => definition,
  });

  assert.equal(plan.inspect().dynamics.frameDependent, true);
  assert.equal(plan.inspect().dynamics.invalidation.mode, "frame");
  assert.ok(plan.inspect().dynamics.invalidation.reasons.includes("isf-time"));
});

test("named multi-image ISF nodes lower directly onto the compiled texture DAG", () => {
  const definition = createIsfNodeDefinition({
    path: "shaders/two-image-compositor.fs",
    source: `/*{
      "ISFVSN": "2.0",
      "LABEL": "Two Image Compositor",
      "INPUTS": [
        { "NAME": "foreground", "TYPE": "image" },
        { "NAME": "background", "TYPE": "image" }
      ]
    }*/
    void main() {
      gl_FragColor = mix(
        IMG_THIS_NORM_PIXEL(background),
        IMG_THIS_NORM_PIXEL(foreground),
        0.5
      );
    }`,
  });
  const foreground = renderNode("foreground-source", "source");
  const background = renderNode("background-source", "source");
  const compositor = {
    id: "two-image-compositor",
    nodeId: definition.id,
    nodeVersion: definition.version,
    role: "source",
    configuration: {
      id: "two-image-compositor",
      kind: "source",
      source: {
        type: "generator",
        generatorId: definition.metadata.visualId,
        params: {},
      },
    },
  };
  const plan = compileVisualRenderPlan({
    id: "vj1.component.named-isf-inputs",
    nodes: [compositor, foreground, background],
    connections: [
      { from: "foreground-source.texture", to: "two-image-compositor.foreground", type: "texture" },
      { from: "background-source.texture", to: "two-image-compositor.background", type: "texture" },
      { from: "two-image-compositor.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: (node) => node.nodeId === definition.id ? definition : null,
  });

  assert.equal(plan.executionModel, "texture-dag");
  assert.deepEqual(
    plan.operations.map((operation) => operation.id),
    ["foreground-source", "background-source", "two-image-compositor"],
  );
  assert.equal(plan.operations[2].backend, "shader-generator");
  assert.deepEqual(plan.operations[2].textureInputs, {
    foreground: "foreground-source",
    background: "background-source",
  });
  assert.deepEqual(plan.operations[2].textureInputPorts, ["foreground", "background"]);
});

test("visual compiler propagates neighborhood demand backward and lowers full-frame allocation", () => {
  const source = renderNode("source", "source");
  const effect = renderNode("effect", "effect");
  source.compilerHook.contract = {
    roi: { mode: "neighborhood", halo: 2, coordinateSpace: "boundary" },
  };
  effect.compilerHook.contract = {
    roi: {
      mode: "neighborhood",
      halo: 4,
      coordinateSpace: "boundary",
      pixelEquivalentToFullFrame: false,
    },
  };
  const plan = compileVisualRenderPlan({
    id: "vj1.component.roi-lowering",
    nodes: [source, effect],
    connections: [
      { from: "$in.texture", to: "source.image", type: "texture" },
      { from: "source.texture", to: "effect.texture", type: "texture" },
      { from: "effect.texture", to: "$out.texture", type: "texture" },
    ],
  });

  assert.equal(plan.operations[1].contract.roi.mode, "full-frame");
  assert.equal(plan.operations[1].lowering.allocation.mode, "full-frame");
  assert.equal(plan.operations[0].lowering.outputDemand.mode, "full-frame");
  assert.equal(plan.operations[0].lowering.inputDemand.mode, "full-frame");
  assert.equal(plan.diagnostics.some((item) => item.code === "VISUAL_CONTRACT_ROI_ESCALATED"), true);
});

test("visual compiler rejects coordinate and alpha mismatches before the frame loop", () => {
  const mismatchPlan = (sourceContract, effectContract) => {
    const source = renderNode("source", "source");
    const effect = renderNode("effect", "effect");
    source.compilerHook.contract = sourceContract;
    effect.compilerHook.contract = effectContract;
    return compileVisualRenderPlan({
      id: "vj1.component.contract-mismatch",
      nodes: [source, effect],
      connections: [
        { from: "$in.texture", to: "source.image", type: "texture" },
        { from: "source.texture", to: "effect.texture", type: "texture" },
        { from: "effect.texture", to: "$out.texture", type: "texture" },
      ],
    });
  };

  assert.throws(() => mismatchPlan(
    { coordinates: { output: "boundary" } },
    { coordinates: { input: "composition" } },
  ), /VISUAL_CONTRACT_COORDINATE_MISMATCH/);
  assert.throws(() => mismatchPlan(
    { alpha: { output: "straight" } },
    { alpha: { input: "premultiplied" } },
  ), /VISUAL_CONTRACT_ALPHA_MISMATCH/);
});

test("visual render operations bind to runtime Component configuration by identity", () => {
  const sourceNode = renderNode("source", "source");
  const effectNode = renderNode("active", "effect");
  const runtimeSource = {
    id: "source",
    kind: "source",
    source: { type: "generator", generatorId: "source", params: { scale: 1 } },
  };
  const runtimeEffect = {
    id: "active",
    kind: "effect",
    componentId: "active",
    params: { amount: 0.25 },
  };
  const plan = compileVisualRenderPlan({
    id: "vj1.component.runtime-identity",
    componentId: "runtime-identity",
    nodes: [sourceNode, effectNode],
    connections: [
      { from: "$in.texture", to: "source.image", type: "texture" },
      { from: "source.texture", to: "active.texture", type: "texture" },
      { from: "active.texture", to: "$out.texture", type: "texture" },
    ],
  }, { id: "runtime-identity", chain: [runtimeSource, runtimeEffect] });

  assert.strictEqual(plan.operations[0].configuration, runtimeSource);
  assert.strictEqual(plan.operations[1].configuration, runtimeEffect);
  runtimeEffect.params.amount = 0.8;
  assert.equal(plan.operations[1].configuration.params.amount, 0.8);
});

test("native node processes compile into the direct visual operation", () => {
  const node = renderNode("calibration", "source");
  node.compilerHook = {
    id: "vj1.visual.native-source",
    renderer: "output/specialized:testPattern",
    allocationStable: true,
  };
  const process = () => "target";
  const plan = compileVisualRenderPlan({
    id: "vj1.component.native-process",
    nodes: [node],
    connections: [
      { from: "$in.texture", to: "calibration.image", type: "texture" },
      { from: "calibration.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: () => ({
      id: "vj1.visual.generator.testPattern",
      version: "0.1.0",
      metadata: { nodeOwnedNativeProcess: true },
      process,
    }),
  });

  assert.strictEqual(plan.operations[0].nodeProcess, process);
  assert.equal(plan.operations[0].nodeProcessId, "vj1.visual.generator.testPattern@0.1.0");
  assert.match(plan.operations[0].nodeProcessRevision, /^[a-z0-9]+$/);
  assert.equal(plan.operations[0].allocationStable, true);
});

test("a disconnected Component output compiles to a transparent plan instead of falling back to node order", () => {
  const plan = compileVisualRenderPlan({
    id: "vj1.component.disconnected",
    nodes: [renderNode("source", "source")],
    connections: [{ from: "$in.texture", to: "source.image", type: "texture" }],
  });

  assert.deepEqual(plan.operations, []);
  assert.equal(plan.diagnostics[0].code, "VISUAL_PLAN_OUTPUT_DISCONNECTED");
});

test("visual compilation rejects ambiguous texture inputs before the render frame", () => {
  assert.throws(() => compileVisualRenderPlan({
    id: "vj1.component.ambiguous",
    nodes: [renderNode("source-a", "source"), renderNode("source-b", "source"), renderNode("effect", "effect")],
    connections: [
      { from: "$in.texture", to: "source-a.image", type: "texture" },
      { from: "$in.texture", to: "source-b.image", type: "texture" },
      { from: "source-a.texture", to: "effect.texture", type: "texture" },
      { from: "source-b.texture", to: "effect.texture", type: "texture" },
      { from: "effect.texture", to: "$out.texture", type: "texture" },
    ],
  }), /VISUAL_RENDER_MULTIPLE_TEXTURE_INPUTS/);
});

test("restricted texture DAGs compile reusable multi-input operators into direct operations", () => {
  const sourceA = renderNode("source-a", "source");
  const sourceB = renderNode("source-b", "source");
  const mix = {
    id: "mix",
    nodeId: MixTextureNode.id,
    nodeVersion: MixTextureNode.version,
    role: "operator",
    parameters: { amount: 0.25 },
  };
  const definitions = new Map([
    MixTextureNode,
    MaskTextureNode,
    SelectTextureNode,
    TransitionTextureNode,
    FeedbackTextureNode,
  ].map((definition) => [definition.id, definition]));
  const plan = compileVisualRenderPlan({
    id: "vj1.component.texture-dag",
    nodes: [mix, sourceB, sourceA],
    connections: [
      { from: "source-a.texture", to: "mix.a", type: "texture" },
      { from: "source-b.texture", to: "mix.b", type: "texture" },
      { from: "mix.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: (node) => definitions.get(node.nodeId) || null,
  });

  assert.equal(plan.executionModel, "texture-dag");
  assert.deepEqual(plan.operations.map((operation) => operation.id), ["source-a", "source-b", "mix"]);
  assert.equal(plan.operations[2].opcode, "mix");
  assert.deepEqual(plan.operations[2].textureInputs, { a: "source-a", b: "source-b" });
  assert.equal(plan.operations[2].configuration.params.amount, 0.25);
  assert.equal(plan.operations[2].configuration.params.mode, "crossfade");
  assert.equal(plan.operations[0].lowering.outputDemand.mode, "local");
  assert.equal(plan.operations[1].lowering.outputDemand.mode, "local");
});

test("compiled control DAGs map values into visual parameters and restore authored configuration", () => {
  const DoubleControl = defineNode({
    id: "test.control.double",
    name: "Double",
    description: "Doubles a numeric control value.",
    inlets: { input: { type: "number", required: true } },
    outlets: { value: { type: "number" } },
    execution: { trigger: "frame", pure: true, asynchronous: false },
    capabilities: ["numeric-control", "graph-placeable"],
    process: ({ input }) => ({ value: input * 2 }),
  });
  const source = renderNode("source", "source");
  source.configuration.source.params.scale = 2;
  const plan = compileVisualRenderPlan({
    id: "vj1.component.controls",
    nodes: [
      { id: "slider", nodeId: "core.control.slider", role: "control", parameters: { value: 0.25 } },
      { id: "double", nodeId: DoubleControl.id, role: "control", parameters: {} },
      { id: "unused", nodeId: "core.control.slider", role: "control", parameters: { value: 1 } },
      source,
    ],
    connections: [
      { from: "$in.texture", to: "source.image", type: "texture" },
      { from: "source.texture", to: "$out.texture", type: "texture" },
      { from: "slider.value", to: "double.input", type: "number" },
      { from: "double.value", to: "source.$parameter.scale", type: "number", sourceRange: [0, 1], targetRange: [10, 20] },
    ],
  }, {}, {
    resolveDefinition: (node) => node.nodeId === DoubleControl.id ? DoubleControl : null,
  });

  assert.deepEqual(plan.controlProgram.steps.map((step) => step.nodeId), ["core.control.slider", DoubleControl.id]);
  assert.equal(plan.diagnostics.some((item) => item.code === "VISUAL_CONTROL_UNUSED_NODE" && item.path.endsWith("/unused")), true);
  const restore = plan.controlProgram.apply({ componentTime: 4 });
  const retainedOutputs = plan.controlProgram.steps.map((step) => step.outputValues);
  assert.equal(source.configuration.source.params.scale, 15);
  restore();
  assert.equal(source.configuration.source.params.scale, 2);
  const secondRestore = plan.controlProgram.apply({ componentTime: 5 });
  assert.strictEqual(secondRestore, restore);
  assert.deepEqual(plan.controlProgram.steps.map((step) => step.outputValues), retainedOutputs);
  secondRestore();
  assert.equal(mapControlValue(0.5, [0, 1], [-2, 2]), 0);
});

test("generated parameter controls track compatibility patches without taking authority from authored controls", () => {
  const generatedSource = renderNode("generated-source", "source");
  generatedSource.configuration.source.params.scale = 25;
  const authoredSource = renderNode("authored-source", "source");
  authoredSource.configuration.source.params.scale = 25;
  const plan = compileVisualRenderPlan({
    id: "vj1.component.control-patch-sync",
    nodes: [
      {
        id: "generated",
        nodeId: "core.control.slider",
        role: "control",
        generatedBy: "vj1-component-compiler",
        parameters: { value: 0.25 },
      },
      { id: "authored", nodeId: "core.control.slider", role: "control", parameters: { value: 0.75 } },
      generatedSource,
      authoredSource,
    ],
    connections: [
      { from: "$in.texture", to: "generated-source.image", type: "texture" },
      { from: "generated-source.texture", to: "authored-source.image", type: "texture" },
      { from: "authored-source.texture", to: "$out.texture", type: "texture" },
      { from: "generated.value", to: "generated-source.$parameter.scale", type: "number", sourceRange: [0, 1], targetRange: [0, 100] },
      { from: "authored.value", to: "authored-source.$parameter.scale", type: "number", sourceRange: [0, 1], targetRange: [0, 100] },
    ],
  });

  generatedSource.configuration.source.params.scale = 60;
  authoredSource.configuration.source.params.scale = 60;
  plan.controlProgram.syncGeneratedControlsFromConfiguration();
  const restore = plan.controlProgram.apply();
  assert.equal(generatedSource.configuration.source.params.scale, 60);
  assert.equal(authoredSource.configuration.source.params.scale, 75);
  restore();
});

test("control compilation rejects cycles and asynchronous nodes before rendering", () => {
  const Sync = defineNode({
    id: "test.control.sync",
    name: "Sync",
    description: "Passes through a control value.",
    inlets: { input: { type: "number", defaultValue: 0 } },
    outlets: { value: { type: "number" } },
    capabilities: ["numeric-control"],
    process: ({ input }) => ({ value: input }),
  });
  const Async = defineNode({
    id: "test.control.async",
    name: "Async",
    description: "Represents work that cannot enter a live visual control program.",
    outlets: { value: { type: "number" } },
    execution: { trigger: "frame", asynchronous: true },
    capabilities: ["numeric-control"],
    process: async () => ({ value: 1 }),
  });
  const source = renderNode("source", "source");
  const textureEdges = [
    { from: "$in.texture", to: "source.image", type: "texture" },
    { from: "source.texture", to: "$out.texture", type: "texture" },
  ];

  assert.throws(() => compileVisualRenderPlan({
    id: "vj1.component.control-cycle",
    nodes: [
      { id: "a", nodeId: Sync.id, role: "control", parameters: {} },
      { id: "b", nodeId: Sync.id, role: "control", parameters: {} },
      source,
    ],
    connections: [
      ...textureEdges,
      { from: "a.value", to: "b.input", type: "number" },
      { from: "b.value", to: "a.input", type: "number" },
      { from: "a.value", to: "source.$parameter.scale", type: "number" },
    ],
  }, {}, { resolveDefinition: () => Sync }), /VISUAL_CONTROL_CYCLE/);

  assert.throws(() => compileVisualRenderPlan({
    id: "vj1.component.control-async",
    nodes: [{ id: "async", nodeId: Async.id, role: "control", parameters: {} }, source],
    connections: [
      ...textureEdges,
      { from: "async.value", to: "source.$parameter.scale", type: "number" },
    ],
  }, {}, { resolveDefinition: () => Async }), /VISUAL_CONTROL_NOT_LIVE_SAFE/);
});

test("component time and oscillator nodes modulate the optimized visual plan without generic graph execution", () => {
  const effect = renderNode("effect", "effect");
  effect.configuration.amount = 0.2;
  effect.configuration.params.amount = 0.2;
  const plan = compileVisualRenderPlan({
    id: "vj1.component.animated-control",
    nodes: [
      { id: "time", nodeId: ComponentTimeControlNode.id, role: "control", parameters: { scale: 1, offset: 0 } },
      { id: "lfo", nodeId: OscillatorControlNode.id, role: "control", parameters: { waveform: "sine", frequency: 1, phase: 0 } },
      effect,
    ],
    connections: [
      { from: "$in.texture", to: "effect.texture", type: "texture" },
      { from: "effect.texture", to: "$out.texture", type: "texture" },
      { from: "time.time", to: "lfo.time", type: "number" },
      { from: "lfo.value", to: "effect.$parameter.amount", type: "number" },
    ],
  });

  const restore = plan.controlProgram.apply({ componentTime: 0.25 });
  assert.equal(effect.configuration.amount, 1);
  assert.equal(effect.configuration.params.amount, 1);
  assert.equal(plan.controlProgram.steps.some((step) => step.nodeId === ComponentTimeControlNode.id), true);
  assert.equal(String(plan.controlProgram.constructor.name).includes("NodeGraph"), false);
  restore();
  assert.equal(effect.configuration.amount, 0.2);
  assert.equal(effect.configuration.params.amount, 0.2);
});

test("host signals and smoothing compile into retained direct control steps", () => {
  const source = renderNode("source", "source");
  source.configuration.source.params.scale = 0;
  const plan = compileVisualRenderPlan({
    id: "vj1.component.host-control",
    nodes: [
      {
        id: "midi",
        nodeId: MidiControlInputNode.id,
        role: "control",
        parameters: { kind: "midi", address: "1:cc:7", fallback: 0 },
      },
      {
        id: "smooth",
        nodeId: SmoothControlNode.id,
        role: "control",
        parameters: { timeConstant: 0 },
      },
      source,
    ],
    connections: [
      { from: "$in.texture", to: "source.image", type: "texture" },
      { from: "source.texture", to: "$out.texture", type: "texture" },
      { from: "midi.number", to: "smooth.value", type: "number" },
      { from: "smooth.value", to: "source.$parameter.scale", type: "number" },
    ],
  });

  const stepOutputs = plan.controlProgram.steps.map((step) => step.outputValues);
  const restore = plan.controlProgram.apply({
    timestamp: 1,
    renderRequest: {
      controlSignals: {
        midi: new Map([["1:cc:7", { value: 0.65, sequence: 2 }]]),
      },
    },
  });
  assert.equal(source.configuration.source.params.scale, 0.65);
  assert.deepEqual(plan.controlProgram.steps.map((step) => step.nodeId), [
    MidiControlInputNode.id,
    SmoothControlNode.id,
  ]);
  assert.deepEqual(plan.controlProgram.steps.map((step) => step.outputValues), stepOutputs);
  assert.equal(plan.inspect().dynamics.frameDependent, true);
  restore();
  assert.equal(source.configuration.source.params.scale, 0);
});

test("compiled-plan introspection exposes dependencies media dynamics readiness and editable operations", () => {
  const source = renderNode("source", "source");
  source.configuration.source = {
    type: "component",
    componentId: "child-component",
    params: { imageId: "texture-a" },
  };
  const plan = compileVisualRenderPlan({
    id: "vj1.component.introspection",
    nodes: [
      { id: "time", nodeId: ComponentTimeControlNode.id, role: "control", parameters: {} },
      source,
    ],
    connections: [
      { from: "$in.texture", to: "source.image", type: "texture" },
      { from: "source.texture", to: "$out.texture", type: "texture" },
      { from: "time.time", to: "source.$parameter.amount", type: "number" },
    ],
  }, {}, {
    resolveDefinition: (node) => node.nodeId === ComponentTimeControlNode.id ? ComponentTimeControlNode : null,
  });
  const inspection = plan.inspect();

  assert.deepEqual(inspection.dependencies.components, ["child-component"]);
  assert.deepEqual(inspection.mediaDemand.ids, ["texture-a"]);
  assert.deepEqual(inspection.readiness.requirements, [{ kind: "media", id: "texture-a" }]);
  assert.equal(inspection.dynamics.frameDependent, true);
  assert.equal(inspection.dynamics.hasControlProgram, true);
  assert.equal(inspection.editableItems[0].id, "source");
  assert.equal(inspection.operations[0].backend, "shader-generator");
  const visited = [];
  plan.introspection.forEachOperation((operation) => visited.push(operation.id));
  assert.deepEqual(visited, ["source"]);
});
