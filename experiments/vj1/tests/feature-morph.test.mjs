import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFeatureMorphField, buildFeatureMorphMesh, matchSuperPointFeatures } from "../js/output/specialized/feature-morph-field.js";
import { featureMorphPersistentKey, superPointAnalysisModule, SuperPointPairService } from "../js/output/specialized/superpoint-service.js";
import {
  createGeneratorSource,
  FeatureMorphToImageNode,
  getGeneratorNodeComponent as getGeneratorComponent,
  MediaImageResourceNode,
  MobileNetMorphAnalysisNode,
  VisualStageNodeDefinitions,
  SuperPointMorphAnalysisNode,
} from "../js/libraries/visual-nodes/index.js";
import { compileVisualRenderPlan } from "../js/libraries/composition-engine/shared/visual-render-plan.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/index.js";
import {
  compileJavaScriptNodeModule,
  createProjectNodeFork,
  materializeProjectNodeFork,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";
import { OutputRenderer } from "../js/output/output-renderer.js";
import { createVj1NodePackage } from "../js/app-node-package.js";
import { FeatureMorphRuntime } from "../js/output/specialized/feature-morph-runtime.js";
import { FEATURE_MORPH_FRAGMENT_SHADER, FEATURE_MORPH_VERTEX_SHADER } from "../js/output/specialized/feature-morph-shader.js";
import { featureMorphNodeRuntimeModule, featureMorphNodeShaderSource } from "../js/output/specialized/specialized-source-runtime.js";
import {
  graphNodeFromDefinition,
  NODE_GRAPH_AUTHORING_TARGETS,
  nodeDefinitionPlaceableInGraph,
} from "../js/control/node-graph-canvas.js";
import {
  createComponentLayer,
  createDefaultComponent,
  createInitialState,
  createSceneComponent,
} from "../js/domain/models.js";

function feature(x, y, descriptor) {
  return { x, y, descriptor: Float32Array.from(descriptor) };
}

test("Feature Morph capability owns compiled analysis readiness", () => {
  let analysisState = "loading";
  const images = new Map([
    ["a", { image: {}, file: { name: "a.png" } }],
    ["b", { image: {}, file: { name: "b.png" } }],
  ]);
  const runtime = new FeatureMorphRuntime({
    acquireMedia: (id) => images.get(id) || null,
  });
  runtime.registerAnalysisProvider("readiness-test", {
    service: () => ({ status: () => analysisState }),
  });
  const program = {
    forEachOperation(callback) {
      callback({
        valueProgram: {
          steps: [{
            externalResolver: { capability: "feature-morph-analysis" },
            outputValues: {
              analysis: {
                providerId: "readiness-test",
                settings: { imageAId: "a", imageBId: "b" },
              },
            },
          }],
        },
      });
    },
  };

  assert.equal(runtime.readinessStatus(program).state, "pending");
  analysisState = "ready";
  assert.equal(runtime.readinessStatus(program).state, "ready");
  analysisState = "error";
  assert.equal(runtime.readinessStatus(program).state, "error");
  runtime.dispose();
});

function compileFeatureMorphPlan(definition, parameters = {}) {
  const definitions = new Map([
    ...VisualStageNodeDefinitions,
    definition,
  ].map((item) => [item.id, item]));
  const configuration = {
    id: "feature-morph",
    kind: "source",
    enabled: true,
    source: {
      type: "generator",
      generatorId: "featureMorph",
      instanceId: "feature-morph",
      params: { ...parameters },
    },
  };
  const plan = compileVisualRenderPlan({
    id: "feature-morph-test",
    nodes: [{
      id: "feature-morph",
      nodeId: definition.id,
      nodeVersion: definition.version,
      role: "source",
      parameters: { ...parameters },
      configuration,
      compilerHook: definition.metadata.visualCompilerHook,
    }],
    connections: [],
  }, {
    id: "component",
    chain: [configuration],
  }, {
    resolveDefinition: ({ nodeId }) => definitions.get(nodeId),
  });
  return { plan, group: plan.operations[0], render: plan.operations[0].operations[0] };
}

test("prepared Feature Morph programs start one retained analysis before their first render", () => {
  const images = new Map([
    ["a.png", {
      image: { width: 640, height: 480 },
      file: { name: "a.png", size: 10, lastModified: 1 },
    }],
    ["b.png", {
      image: { width: 640, height: 480 },
      file: { name: "b.png", size: 20, lastModified: 2 },
    }],
  ]);
  const runtime = new FeatureMorphRuntime({
    acquireMedia: (id) => images.get(id) || null,
  });
  runtime.superPointPairs.dispose();
  let analysisState = "idle";
  const requests = [];
  runtime.superPointPairs = {
    status: () => analysisState,
    externalKey: () => `${analysisState}:1`,
    request: (settings, imageA, imageB, media) => {
      requests.push({ settings, imageA, imageB, media });
      analysisState = "loading";
      return { status: analysisState };
    },
    dispose() {},
  };
  const { plan, group, render } = compileFeatureMorphPlan(
    getGeneratorComponent("featureMorph").nodeDefinition,
    {
      imageAId: "a.png",
      imageBId: "b.png",
      landmarkCount: 88,
    },
  );
  const analysisStep = group.valueProgram.steps.find(
    (step) =>
      step.externalResolver?.capability ===
      "feature-morph-analysis",
  );
  assert.equal(
    analysisStep.outputValues.analysis,
    undefined,
    "a newly prepared program has not executed its value graph",
  );

  assert.equal(runtime.readinessStatus(plan).state, "pending");
  assert.equal(requests.length, 1);
  assert.equal(analysisStep.outputValues.analysis.providerId, "superpoint");
  assert.equal(render.runtimeValueInputs.get("analysis").settings.landmarkCount, 88);
  assert.strictEqual(requests[0].imageA, images.get("a.png").image);
  assert.strictEqual(requests[0].imageB, images.get("b.png").image);
  assert.equal(requests[0].media.algorithmRevision, render.nodeCodeRevision);
  assert.equal("width" in requests[0].media, false);
  assert.equal("height" in requests[0].media, false);

  assert.equal(runtime.readinessStatus(plan).state, "pending");
  assert.equal(
    requests.length,
    1,
    "readiness polling cannot restart analysis or tie it to preview scale",
  );
  analysisState = "ready";
  assert.equal(runtime.readinessStatus(plan).state, "ready");
  assert.equal(requests.length, 1);

  runtime.dispose();
  plan.dispose();
});

test("Feature Morph resources, analysis providers, and renderer are ordinary visual-editor nodes", () => {
  for (const definition of [
    MediaImageResourceNode,
    SuperPointMorphAnalysisNode,
    MobileNetMorphAnalysisNode,
    FeatureMorphToImageNode,
  ]) {
    assert.equal(
      nodeDefinitionPlaceableInGraph(
        definition,
        NODE_GRAPH_AUTHORING_TARGETS.VISUAL,
      ),
      true,
      `${definition.id} must be placeable in an authored visual Group`,
    );
  }
  assert.equal(
    graphNodeFromDefinition(SuperPointMorphAnalysisNode, {
      id: "analysis",
      visualProgram: true,
    }).role,
    "value",
  );
  const render = graphNodeFromDefinition(FeatureMorphToImageNode, {
    id: "render",
    visualProgram: true,
  });
  assert.equal(render.role, "source");
  assert.equal(render.compilerHook.id, "vj1.visual.native-source");
});

test("Feature Morph is a two-image generator with cached animation controls", () => {
  const component = getGeneratorComponent("featureMorph");
  const ids = component.params.map((param) => param.id);
  assert.equal(component.category, "ai");
  assert.ok(ids.includes("morph"));
  assert.ok(ids.includes("autoSpeed"));
  assert.ok(ids.includes("landmarkCount"));
  assert.equal(component.params.find((param) => param.id === "landmarkCount").max, 300);
  assert.equal(component.runtime.timeDependent({ autoSpeed: 0 }), false);
  assert.equal(component.runtime.timeDependent({ autoSpeed: 0.5 }), true);
  assert.equal(component.nodeDefinition.metadata.nodeOwnedNativeModule, true);
  assert.equal(component.nodeDefinition.metadata.nodeOwnedNativeProcess, false);
  assert.deepEqual(FeatureMorphToImageNode.parts.filter((part) => part.kind === NODE_PART_KINDS.SHADER).map((part) => part.id), [
    "feature-morph-vertex",
    "feature-morph-fragment",
  ]);
  assert.equal(component.nodeDefinition.parts.some((part) => part.kind === NODE_PART_KINDS.SHADER), false);
  assert.equal(component.nodeDefinition.parts.some((part) => part.id === "feature-morph-analysis-module"), false);
  const analysisModule = compileJavaScriptNodeModule(SuperPointMorphAnalysisNode.parts, SuperPointMorphAnalysisNode);
  const renderModule = compileJavaScriptNodeModule(FeatureMorphToImageNode.parts, FeatureMorphToImageNode);
  assert.equal(typeof analysisModule.process, "function");
  assert.equal(typeof analysisModule.exports.matchSuperPointFeatures, "function");
  assert.equal(typeof analysisModule.exports.buildFeatureMorphField, "function");
  assert.equal(typeof renderModule.exports.imageFitUniform, "function");

  const { plan, group, render } = compileFeatureMorphPlan(component.nodeDefinition, {
    imageAId: "a.png",
    imageBId: "b.png",
    landmarkCount: 88,
    morph: 0.4,
  });
  assert.equal(group.backend, "compiled-visual-group");
  assert.equal(render.backend, "native-specialized");
  assert.equal(render.renderer, "output/specialized:featureMorph");
  assert.deepEqual(group.valueProgram.steps.map((step) => step.nodeId), [
    MediaImageResourceNode.id,
    MediaImageResourceNode.id,
    SuperPointMorphAnalysisNode.id,
  ]);
  group.valueProgram.evaluate();
  assert.equal(render.runtimeValueInputs.get("imageA").mediaId, "a.png");
  assert.equal(render.runtimeValueInputs.get("imageB").mediaId, "b.png");
  assert.equal(render.runtimeValueInputs.get("analysis").providerId, "superpoint");
  assert.equal(render.runtimeValueInputs.get("analysis").settings.landmarkCount, 88);
  assert.equal(
    render.externalResourceDependent,
    true,
    "the compiler marks the exact render consumer of the asynchronous analysis revision",
  );
  assert.equal(render.configuration.source.params.morph, 0.4);
  assert.ok(plan.inspect().readiness.requirements.some((item) =>
    item.kind === "capability" && item.id === "feature-morph-analysis"));
  plan.dispose();

  const source = createGeneratorSource("featureMorph", { imageAId: "a.png", imageBId: "b.png" });
  assert.equal(source.params.imageAId, "a.png");
  assert.equal(source.params.imageBId, "b.png");
});

test("Feature Morph compounds preserve authored time invalidation alongside typed values", () => {
  const component = getGeneratorComponent("featureMorph");
  const animated = compileFeatureMorphPlan(component.nodeDefinition, {
    imageAId: "a.png",
    imageBId: "b.png",
    autoSpeed: 0.5,
  }).plan;
  const staticPlan = compileFeatureMorphPlan(component.nodeDefinition, {
    imageAId: "a.png",
    imageBId: "b.png",
    autoSpeed: 0,
  }).plan;

  assert.equal(animated.inspect().dynamics.frameDependent, true);
  assert.equal(animated.inspect().dynamics.invalidation.mode, "frame");
  assert.ok(
    animated.inspect().dynamics.invalidation.reasons.includes("runtime-time"),
  );
  assert.equal(staticPlan.inspect().dynamics.frameDependent, false);
  assert.equal(staticPlan.inspect().dynamics.invalidation.mode, "revision");
  animated.dispose();
  staticPlan.dispose();
});

test("Feature Morph analysis is a typed provider substitution rather than a second renderer", () => {
  const definition = getGeneratorComponent("featureMorph").nodeDefinition;
  const edited = {
    ...definition,
    parts: definition.parts.map((part) => part.kind === NODE_PART_KINDS.GRAPH
      ? {
          ...part,
          nodes: part.nodes.map((node) => node.id === "analysis"
            ? {
                ...node,
                type: MobileNetMorphAnalysisNode.id,
                nodeId: MobileNetMorphAnalysisNode.id,
                parameters: { providerId: "mobilenet", featureGrid: 15 },
              }
            : node),
        }
      : part),
  };
  const { plan, group, render } = compileFeatureMorphPlan(edited, {
    imageAId: "a",
    imageBId: "b",
  });
  group.valueProgram.evaluate();
  assert.equal(render.runtimeValueInputs.get("analysis").providerId, "mobilenet");
  assert.equal(render.runtimeValueInputs.get("analysis").settings.featureGrid, 15);
  assert.strictEqual(
    render.runtimeValueInputs.get("analysis").nodeModule,
    MobileNetMorphAnalysisNode.moduleExports,
  );

  const renderer = new OutputRenderer({ mode: "component" });
  const superPointService = renderer.specializedSources.featureMorph.superPointPairs;
  const mobileNetService = renderer.specializedSources.featureMorph.mobileNetMorphPairs;
  const projectService = {};
  renderer.specializedSources.featureMorph.registerAnalysisProvider("project-analysis", {
    service: () => projectService,
  });
  assert.strictEqual(renderer.sourceRuntime.featureMorphPairService("project-analysis"), projectService);
  assert.equal(renderer.sourceRuntime.featureMorphPairService("unknown-analysis"), null);
  renderer.visualNodeRuntime.generator = () => ({ nodeDefinition: edited });
  assert.strictEqual(
    renderer.sourceRuntime.featureMorphPairService("mobilenet"),
    mobileNetService,
    "dirty/readiness analysis follows the authored provider rather than the legacy visual ID",
  );
  assert.equal(
    renderer.sourceRuntime.featureMorphAnalysisContract("featureMorph", {
      imageAId: "a",
      imageBId: "b",
    }).params.featureGrid,
    15,
    "dirty/readiness keys include internal provider literals used by rendering",
  );
  renderer.visualNodeRuntime.generator = () => ({ nodeDefinition: definition });
  assert.strictEqual(renderer.sourceRuntime.featureMorphPairService("superpoint"), superPointService);
  const specializedSource = readFileSync(
    new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url),
    "utf8",
  );
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.doesNotMatch(specializedSource, /source\.generatorId === "featureMorphV2"|isMobileNet/);
  assert.doesNotMatch(rendererSource, /generatorId === "featureMorph"|generatorId === "featureMorphV2"/);
  renderer.dispose();
  plan.dispose();
});

test("Feature Morph child forks supply analysis, image fitting, and GLSL to the retained host", () => {
  const analysisBase = SuperPointMorphAnalysisNode;
  const analysisFork = createProjectNodeFork(analysisBase, {
    forkId: "feature-morph-analysis-project",
    overrides: {
      parts: analysisBase.parts.map((part) => {
        if (part.id === "feature-morph-analysis-module") {
          return {
            ...part,
            source: [
              "function matchSuperPointFeatures() { return ['project-fork']; }",
              "function buildFeatureMorphField() { return { width: 7 }; }",
              "function buildFeatureMorphMesh() { return { vertices: ['project-fork'], triangles: [] }; }",
            ].join("\n"),
          };
        }
        return part;
      }),
    },
  });
  const renderBase = FeatureMorphToImageNode;
  const renderFork = createProjectNodeFork(renderBase, {
    forkId: "feature-morph-render-project",
    overrides: {
      parts: renderBase.parts.map((part) => {
        if (part.id === "feature-morph-fit-module") {
          return { ...part, source: "function imageFitUniform() { return [2, 3, 4, 5]; }" };
        }
        if (part.id === "feature-morph-fragment") {
          return { ...part, source: "precision mediump float; void main() { gl_FragColor = vec4(0.25); }" };
        }
        return part;
      }),
    },
  });
  const resolvedAnalysis = materializeProjectNodeFork(analysisBase, analysisFork);
  const resolvedRender = materializeProjectNodeFork(renderBase, renderFork);
  const operation = {
    nodeModule: { ...resolvedAnalysis.moduleExports, ...resolvedRender.moduleExports },
    nodeShaders: Object.fromEntries(resolvedRender.parts.filter((part) => part.kind === NODE_PART_KINDS.SHADER).map((part) => [part.id, part.source])),
  };

  assert.deepEqual(featureMorphNodeRuntimeModule(operation).imageFitUniform({}, 1, 1), [2, 3, 4, 5]);
  assert.deepEqual(superPointAnalysisModule(featureMorphNodeRuntimeModule(operation)).matchSuperPointFeatures(), ["project-fork"]);
  assert.deepEqual(superPointAnalysisModule(featureMorphNodeRuntimeModule(operation)).buildFeatureMorphField(), { width: 7 });
  assert.equal(featureMorphNodeShaderSource(operation, "vertex"), FEATURE_MORPH_VERTEX_SHADER);
  assert.match(featureMorphNodeShaderSource(operation, "fragment"), /vec4\(0\.25\)/);
});

test("mutual descriptor matching rejects ambiguous and excessive motion", () => {
  const featuresA = [
    feature(0.2, 0.2, [1, 0, 0]),
    feature(0.8, 0.8, [0, 1, 0]),
    feature(0.1, 0.9, [0, 0, 1]),
  ];
  const featuresB = [
    feature(0.25, 0.2, [1, 0, 0]),
    feature(0.75, 0.8, [0, 1, 0]),
    feature(0.95, 0.05, [0, 0, 1]),
  ];
  const matches = matchSuperPointFeatures(featuresA, featuresB, {
    similarityThreshold: 0.7,
    maximumDisplacement: 0.4,
  });
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => match.a), [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }]);
});

test("landmarks become a bounded reusable displacement texture", () => {
  const field = buildFeatureMorphField([{
    a: { x: 0.4, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    confidence: 1,
  }], { width: 5, height: 5, phases: 5, influence: 0.2, maxFlow: 0.5 });
  assert.equal(field.pixels.length, 5 * 5 * 5 * 4);
  const center = ((2 * 5 + 2) * 5 + 2) * 4;
  assert.ok(field.pixels[center] > 128);
  assert.ok(Math.abs(field.pixels[center + 1] - 128) <= 1);
  assert.equal(field.pixels[center + 3], 255);
});

test("deformation influence follows landmarks through intermediate phases", () => {
  const field = buildFeatureMorphField([{
    a: { x: 0.2, y: 0.5 },
    b: { x: 0.8, y: 0.5 },
    confidence: 1,
  }], { width: 9, height: 5, phases: 5, influence: 0.12, maxFlow: 0.7 });
  const red = (phase, x) => field.pixels[((phase * field.height + 2) * field.width + x) * 4];
  assert.ok(red(0, 2) > red(0, 7), "the initial field is strongest around landmark A");
  assert.ok(red(4, 7) > red(4, 2), "the final field follows the landmark to B");
});

test("Feature Morph builds a boundary-anchored triangle mesh around landmarks", () => {
  const mesh = buildFeatureMorphMesh([
    { a: { x: 0.25, y: 0.3 }, b: { x: 0.35, y: 0.4 }, confidence: 1 },
    { a: { x: 0.7, y: 0.25 }, b: { x: 0.65, y: 0.35 }, confidence: 1 },
    { a: { x: 0.55, y: 0.75 }, b: { x: 0.45, y: 0.65 }, confidence: 1 },
  ]);
  assert.equal(mesh.vertices.filter((vertex) => vertex.anchor).length, 8);
  assert.equal(mesh.vertices.filter((vertex) => !vertex.anchor).length, 3);
  assert.ok(mesh.triangles.length >= 10);
  assert.ok(mesh.triangles.every((triangle) => triangle.length === 3));
});

test("SuperPoint cache invalidates only pair-analysis parameters", () => {
  const service = new SuperPointPairService();
  const base = { imageAId: "a", imageBId: "b", landmarkCount: 64, matchThreshold: 0.72, influence: 0.18, fit: "cover" };
  assert.equal(service.pairKey({ ...base, morph: 0 }), service.pairKey({ ...base, morph: 1, warpStrength: 2 }));
  assert.notEqual(service.pairKey(base), service.pairKey({ ...base, imageBId: "c" }));
  assert.notEqual(service.pairKey(base), service.pairKey({ ...base, fit: "contain" }));
});

test("SuperPoint cache identity follows node analysis code but not render-only parameters", () => {
  const service = new SuperPointPairService();
  const params = { imageAId: "a", imageBId: "b", landmarkCount: 64 };
  const files = { imageAFile: { name: "a.png" }, imageBFile: { name: "b.png" } };
  const pairKey = service.pairKey(params);
  assert.notEqual(
    featureMorphPersistentKey(pairKey, files.imageAFile, files.imageBFile, "analysis-a"),
    featureMorphPersistentKey(pairKey, files.imageAFile, files.imageBFile, "analysis-b")
  );
  assert.equal(
    featureMorphPersistentKey(pairKey, files.imageAFile, files.imageBFile, "analysis-a"),
    featureMorphPersistentKey(service.pairKey({ ...params, morph: 1, warpStrength: 2 }), files.imageAFile, files.imageBFile, "analysis-a")
  );
});

test("SuperPoint runtime status rejects analysis from replaced image files", () => {
  const service = new SuperPointPairService();
  const params = { imageAId: "status-a", imageBId: "status-b", landmarkCount: 64, matchThreshold: 0.72, influence: 0.18, fit: "cover" };
  const files = { imageAFile: { name: "a.png", size: 10, lastModified: 1 }, imageBFile: { name: "b.png", size: 10, lastModified: 1 } };
  const key = service.pairKey(params);
  service.entries.set(key, { status: "ready", revision: 4, persistentKey: featureMorphPersistentKey(key, files.imageAFile, files.imageBFile) });
  assert.equal(service.status(params, files), "ready");
  assert.equal(service.externalKey(params, files), "ready:4");
  assert.equal(service.status(params, { ...files, imageBFile: { ...files.imageBFile, lastModified: 2 } }), "idle");
});

test("shared SuperPoint analysis publishes resource-driven invalidation", async () => {
  const reasons = [];
  const service = new SuperPointPairService({
    cache: { load: async () => null, save: async () => {} },
    onInvalidate: (reason) => reasons.push(reason),
  });
  service.resolvePair = async () => ({
    matches: [],
    field: {
      width: 1,
      height: 1,
      phases: 1,
      pixels: new Uint8ClampedArray(4),
    },
  });
  service.request({
    imageAId: "invalidation-superpoint-a",
    imageBId: "invalidation-superpoint-b",
  }, {}, {});
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(reasons, [
    "feature-morph-analysis-loading",
    "feature-morph-analysis-ready",
  ]);
  service.dispose();
});

test("Feature Morph stays dynamic until images and landmark analysis settle", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  let analysisStatus = "idle";
  renderer.specializedSources.featureMorph.superPointPairs = { status: () => analysisStatus };
  const source = createGeneratorSource("featureMorph", {
    imageAId: "image-a",
    imageBId: "image-b",
    autoSpeed: 0,
  });

  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), true, "missing decoded images must not be cached");
  renderer.media.set("image-a", { ready: true });
  renderer.media.set("image-b", { ready: false });
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), true, "partially decoded images must not be cached");

  renderer.media.set("image-b", { ready: true });
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), true, "idle analysis must receive another render frame");
  analysisStatus = "loading";
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), true, "loading analysis must receive another render frame");
  analysisStatus = "ready";
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), false, "settled static morph can be cached");
  analysisStatus = "error";
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), false, "settled error can be cached");

  source.params.autoSpeed = 1;
  analysisStatus = "ready";
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), true, "automatic morphing remains frame-dynamic");
});

function assertMorphAnalysisInvalidatesRetainedHierarchy({
  generatorId,
  serviceName,
}) {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.chain = [createComponentLayer(0, createGeneratorSource(generatorId, {
    imageAId: "image-a",
    imageBId: "image-b",
    autoSpeed: 0,
  }))];
  const scene = createSceneComponent(1, component.id);
  state.components = [component, scene];
  state.media = [
    { id: "image-a", path: "image-a.png", type: "image", size: 10 },
    { id: "image-b", path: "image-b.png", type: "image", size: 20 },
  ];
  state.ui.selectedComponentId = scene.id;
  renderer.state = state;
  renderer.componentProgramRuntime.rebuild();
  const program = renderer.componentProgramRuntime.programs.get(component.id);
  const operations = [];
  program.forEachOperation((operation) => operations.push(operation));
  const compiledGroup = operations.find(
    (operation) =>
      operation.backend === "compiled-visual-group" &&
      operation.valueProgram,
  );
  const analysisConsumer = operations.find(
    (operation) =>
      operation.externalResourceDependent === true &&
      operation.externalResourceRequirements?.some(
        (requirement) =>
          requirement.id === "feature-morph-analysis",
      ),
  );
  assert.equal(
    program.inspect().readiness.requirements.some(
      (requirement) =>
        requirement.kind === "capability" &&
        requirement.id === "feature-morph-analysis",
    ),
    true,
    `${generatorId} must compile its asynchronous capability into the Component program`,
  );
  assert.ok(
    compiledGroup,
    `${generatorId} must compile its retained typed-value graph`,
  );
  assert.ok(
    analysisConsumer,
    `${generatorId} must project analysis readiness to its exact render consumer`,
  );
  assert.equal(
    operations.some(
      (operation) =>
        operation.backend === "source-runtime" &&
        operation.renderer === "output/source:generator",
    ),
    false,
    `${generatorId} must compile its retained analysis consumer instead of a generic source wrapper`,
  );
  renderer.media.set("image-a", {
    ready: true,
    image: { width: 32, height: 32 },
    file: { name: "image-a.png", size: 10, lastModified: 1 },
  });
  renderer.media.set("image-b", {
    ready: true,
    image: { width: 32, height: 32 },
    file: { name: "image-b.png", size: 20, lastModified: 1 },
  });
  let analysisState = "loading";
  let analysisRevision = "loading:1";
  renderer.specializedSources.featureMorph[serviceName] = {
    status: () => analysisState,
    externalKey: () => analysisRevision,
  };
  compiledGroup.valueProgram.evaluate({
    componentTime: 0,
    timestamp: 0,
    renderRequest: { role: "component", width: 640, height: 360 },
    runtimeContext:
      renderer.visualPlanRuntime.valueRuntimeContext,
  });
  renderer.visualPlanRuntime.synchronizeExternalResourceRevisions(
    compiledGroup,
    component,
  );
  const consumerLoadingRevision = [
    ...analysisConsumer.runtimeExternalRevisionInputs,
  ];
  const request = { role: "component", width: 640, height: 360 };

  const componentLoading = renderer.componentRenderRuntime.stableSignature(
    component,
    request,
  );
  const sceneLoading = renderer.componentRenderRuntime.stableSignature(
    scene,
    request,
  );
  assert.ok(componentLoading);
  assert.ok(sceneLoading);

  analysisState = "ready";
  analysisRevision = "ready:2";
  renderer.visualPlanRuntime.synchronizeExternalResourceRevisions(
    compiledGroup,
    component,
  );
  assert.notDeepEqual(
    [...analysisConsumer.runtimeExternalRevisionInputs],
    consumerLoadingRevision,
    "the asynchronous capability revision must reach the retained render node without a graph edit",
  );
  assert.notEqual(
    renderer.componentRenderRuntime.stableSignature(component, request),
    componentLoading,
    "the Component cannot retain its loading framebuffer after analysis becomes ready",
  );
  assert.notEqual(
    renderer.componentRenderRuntime.stableSignature(scene, request),
    sceneLoading,
    "the async revision propagates through Component references into a Scene cache",
  );
  renderer.dispose();
}

test("Morph analysis revisions invalidate enclosing Component and Scene caches", () => {
  for (const subject of [
    {
      generatorId: "featureMorph",
      serviceName: "superPointPairs",
    },
    {
      generatorId: "featureMorphV2",
      serviceName: "mobileNetMorphPairs",
    },
  ]) {
    assertMorphAnalysisInvalidatesRetainedHierarchy(subject);
  }
});

test("a sole Feature Morph source retains generic transform handles without stale selection state", () => {
  const sourceItem = { id: "morph-source", kind: "source", source: createGeneratorSource("featureMorph") };
  const renderer = new OutputRenderer({ mode: "component" });
  renderer.state = createVj1NodePackage().prepareProjectState({
    components: [{ id: "component-a", type: "chain", chain: [sourceItem] }],
    nodes: {},
    ui: { selectedComponentId: "component-a", selectedChainItemId: "" },
  });
  assert.equal(renderer.previewInteraction.selectedTransformableChainItem()?.id, sourceItem.id);
});

test("Feature Morph persistent cache survives service recreation and invalidates changed files", async () => {
  const records = new Map();
  const cache = {
    load: async (key) => records.get(key) || null,
    save: async (key, result) => records.set(key, result),
  };
  const params = { imageAId: "persistent-a", imageBId: "persistent-b", landmarkCount: 64 };
  const media = {
    imageAFile: { name: "a.png", size: 120, lastModified: 10, type: "image/png" },
    imageBFile: { name: "b.png", size: 240, lastModified: 20, type: "image/png" },
  };
  const result = {
    matches: [{ a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, confidence: 1 }],
    field: { width: 2, height: 2, maxFlow: 0.5, pixels: new Uint8ClampedArray(16) },
  };
  let analyses = 0;
  const first = new SuperPointPairService({ cache });
  first.computePair = async () => {
    analyses++;
    return result;
  };
  await first.resolvePair(params, {}, {}, media);

  const afterRefresh = new SuperPointPairService({ cache });
  afterRefresh.computePair = async () => {
    analyses++;
    return result;
  };
  assert.equal(await afterRefresh.resolvePair(params, {}, {}, media), result);
  assert.equal(analyses, 1, "unchanged files reuse saved landmarks after refresh");

  const changedMedia = { ...media, imageBFile: { ...media.imageBFile, lastModified: 21 } };
  await afterRefresh.resolvePair(params, {}, {}, changedMedia);
  assert.equal(analyses, 2, "changed source files trigger a new analysis");
  assert.notEqual(
    featureMorphPersistentKey(first.pairKey(params), media.imageAFile, media.imageBFile),
    featureMorphPersistentKey(first.pairKey(params), changedMedia.imageAFile, changedMedia.imageBFile)
  );
});
