import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { featureMorphMediaControlsTemplate } from "../js/control/feature-morph-view.js";
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
import { OutputRenderer } from "../js/output/output-renderer.js";
import {
  compileJavaScriptNodeModule,
  createProjectNodeFork,
  materializeProjectNodeFork,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";
import {
  buildMobileNetMorphField,
  buildRigidMlsMorphField,
  matchMobileNetFeatures,
  mobileNetAnalysisModule,
  mobileNetGraphNodeNames,
  mobileNetMorphFieldForStrategy,
  MobileNetMorphPairService,
  mobileNetMorphPersistentKey,
  mobileNetSpatialEndpointCandidates,
} from "../js/output/specialized/mobilenet-morph-service.js";

function compileFeatureMorphV2Plan(definition, parameters = {}) {
  const definitions = new Map([
    ...VisualStageNodeDefinitions,
    definition,
  ].map((item) => [item.id, item]));
  const configuration = {
    id: "feature-morph-v2",
    kind: "source",
    enabled: true,
    source: {
      type: "generator",
      generatorId: "featureMorphV2",
      instanceId: "feature-morph-v2",
      params: { ...parameters },
    },
  };
  const plan = compileVisualRenderPlan({
    id: "feature-morph-v2-test",
    nodes: [{
      id: "feature-morph-v2",
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

test("Feature Morph V2 exposes MobileNet semantic analysis controls", () => {
  const component = getGeneratorComponent("featureMorphV2");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));

  assert.equal(component.name, "Feature Morph V2");
  assert.equal(component.category, "ai");
  assert.equal(params.featureGrid.min, 3);
  assert.equal(params.featureGrid.max, 48);
  assert.equal(params.featureGrid.defaultValue, 8);
  assert.equal(params.patchScale.defaultValue, 1);
  assert.equal(params.patchScale.max, 12);
  assert.deepEqual(params.morphStrategy.values, ["elastic", "rigid", "flow", "fluid"]);
  assert.equal(params.morphStrategy.defaultValue, "elastic");
  assert.equal(params.spatialCoherence.defaultValue, 0.12);
  assert.equal(params.warpStrength.defaultValue, 1.5);
  assert.deepEqual(params.fit.values, ["cover", "contain", "stretch"]);
  assert.equal(component.runtime.timeDependent({ autoSpeed: 0 }), false);
  assert.equal(component.runtime.timeDependent({ autoSpeed: 0.5 }), true);
  assert.equal(component.nodeDefinition.metadata.nodeOwnedNativeModule, true);
  assert.equal(component.nodeDefinition.metadata.nodeOwnedNativeProcess, false);
  assert.deepEqual(FeatureMorphToImageNode.parts.filter((part) => part.kind === NODE_PART_KINDS.SHADER).map((part) => part.id), [
    "feature-morph-vertex",
    "feature-morph-fragment",
  ]);
  assert.equal(component.nodeDefinition.parts.some((part) => part.kind === NODE_PART_KINDS.SHADER), false);
  const compiled = compileJavaScriptNodeModule(MobileNetMorphAnalysisNode.parts, MobileNetMorphAnalysisNode);
  assert.equal(typeof compiled.process, "function");
  assert.equal(compiled.exports.matchSuperPointFeatures, undefined);
  assert.equal(typeof compiled.exports.matchMobileNetFeatures, "function");
  assert.equal(typeof compiled.exports.buildMobileNetMorphField, "function");
  assert.equal(typeof compiled.exports.buildRigidMlsMorphField, "function");
  assert.ok(MobileNetMorphAnalysisNode.parts.some((part) => part.id === "feature-morph-v2-analysis-module"));
  const { plan, group, render } = compileFeatureMorphV2Plan(component.nodeDefinition, {
    imageAId: "a",
    imageBId: "b",
    featureGrid: 12,
    morphStrategy: "rigid",
  });
  assert.equal(group.backend, "compiled-visual-group");
  assert.equal(render.backend, "native-specialized");
  assert.equal(render.renderer, "output/specialized:featureMorph");
  assert.deepEqual(group.valueProgram.steps.map((step) => step.nodeId), [
    MediaImageResourceNode.id,
    MediaImageResourceNode.id,
    MobileNetMorphAnalysisNode.id,
  ]);
  group.valueProgram.evaluate();
  assert.equal(render.runtimeValueInputs.get("analysis").providerId, "mobilenet");
  assert.equal(render.runtimeValueInputs.get("analysis").settings.featureGrid, 12);
  assert.equal(render.configuration.source.params.morphStrategy, "rigid");
  assert.ok(plan.inspect().readiness.requirements.some((item) =>
    item.kind === "capability" && item.id === "feature-morph-analysis"));
  plan.dispose();

  const substituted = {
    ...component.nodeDefinition,
    parts: component.nodeDefinition.parts.map((part) => part.kind === NODE_PART_KINDS.GRAPH
      ? {
          ...part,
          nodes: part.nodes.map((node) => node.id === "analysis"
            ? {
                ...node,
                type: SuperPointMorphAnalysisNode.id,
                nodeId: SuperPointMorphAnalysisNode.id,
                parameters: { providerId: "superpoint", landmarkCount: 72 },
              }
            : node),
        }
      : part),
  };
  const substitution = compileFeatureMorphV2Plan(substituted, {
    imageAId: "a",
    imageBId: "b",
  });
  substitution.group.valueProgram.evaluate();
  assert.equal(substitution.render.runtimeValueInputs.get("analysis").providerId, "superpoint");
  assert.equal(substitution.render.runtimeValueInputs.get("analysis").settings.landmarkCount, 72);
  substitution.plan.dispose();
});

test("Feature Morph V2 project forks supply its real analysis algorithms", () => {
  const base = MobileNetMorphAnalysisNode;
  const fork = createProjectNodeFork(base, {
    forkId: "feature-morph-v2-project",
    overrides: {
      parts: base.parts.map((part) => part.id === "feature-morph-v2-analysis-module" ? {
        ...part,
        source: [
          "function matchMobileNetFeatures() { return ['v2-project-fork']; }",
          "function buildMobileNetMorphField() { return { width: 9 }; }",
          "function mobileNetMorphFieldForStrategy() { return { strategy: 'forked' }; }",
          "function buildRigidMlsMorphField() { return { phases: 13 }; }",
        ].join("\n"),
      } : part),
    },
  });
  const module = mobileNetAnalysisModule(materializeProjectNodeFork(base, fork).moduleExports);

  assert.deepEqual(module.matchMobileNetFeatures(), ["v2-project-fork"]);
  assert.deepEqual(module.buildMobileNetMorphField(), { width: 9 });
  assert.deepEqual(module.mobileNetMorphFieldForStrategy(), { strategy: "forked" });
});

test("rigid MLS builds paired inverse maps with anchored endpoints", () => {
  const matches = [
    { a: { x: 0.25, y: 0.5 }, b: { x: 0.4, y: 0.5 }, confidence: 1 },
    { a: { x: 0.5, y: 0.5 }, b: { x: 0.65, y: 0.5 }, confidence: 1 },
    { a: { x: 0.75, y: 0.5 }, b: { x: 0.9, y: 0.5 }, confidence: 1 },
  ];
  const field = buildRigidMlsMorphField(matches, { width: 12, height: 12, phases: 5 });

  assert.equal(field.layout, "inverse-pair");
  assert.equal(field.phases, 5);
  assert.equal(field.layers, 2);
  assert.equal(field.pixels.length, 12 * 12 * 5 * 2 * 4);
  assert.deepEqual(Array.from(field.pixels.slice(0, 4)), [128, 128, 128, 255], "the outer edge stays fixed");
  const middle = ((2 * 12 + 6) * 12 + 6) * 4;
  assert.ok(field.pixels[middle] < 128, "the intermediate frame maps back toward image A");
  const secondLayerMiddle = middle + 12 * 12 * 5 * 4;
  assert.ok(field.pixels[secondLayerMiddle] > 128, "the intermediate frame maps forward toward image B");
});

test("rigid MLS preserves opposing local feature motion instead of averaging it into a fade", () => {
  const field = buildRigidMlsMorphField([
    { a: { x: 0.28, y: 0.5 }, b: { x: 0.42, y: 0.5 }, confidence: 1 },
    { a: { x: 0.72, y: 0.5 }, b: { x: 0.58, y: 0.5 }, confidence: 1 },
  ], { width: 32, height: 16, phases: 5 });
  const left = ((2 * 16 + 8) * 32 + 11) * 4;
  const right = ((2 * 16 + 8) * 32 + 21) * 4;

  assert.ok(field.pixels[left] < 124, "the left feature retains its backward inverse motion");
  assert.ok(field.pixels[right] > 132, "the right feature retains its opposing inverse motion");
});

test("elastic strategy builds a softer inverse field without rerunning MobileNet", () => {
  const result = {
    matches: [
      { a: { x: 0.35, y: 0.5 }, b: { x: 0.55, y: 0.42 }, confidence: 1 },
      { a: { x: 0.65, y: 0.5 }, b: { x: 0.48, y: 0.62 }, confidence: 1 },
    ],
    field: { width: 16, height: 16, phases: 1, maxFlow: 0.5, pixels: new Uint8ClampedArray(16 * 16 * 4) },
  };
  const elastic = mobileNetMorphFieldForStrategy(result, "elastic");

  assert.equal(elastic.layout, "inverse-pair");
  assert.equal(elastic.phases, 11);
  assert.equal(mobileNetMorphFieldForStrategy(result, "elastic"), elastic, "the derived field is reused");
  assert.equal(mobileNetMorphFieldForStrategy(result, "flow"), result.field, "the original field remains available");
});

test("MobileNet matcher creates a correspondence for each reliable source region", () => {
  const featuresA = [
    { x: 0.2, y: 0.2, descriptor: Float32Array.from([1, 0, 0]) },
    { x: 0.8, y: 0.2, descriptor: Float32Array.from([0, 1, 0]) },
    { x: 0.5, y: 0.8, descriptor: Float32Array.from([0, 0, 1]) },
  ];
  const featuresB = [
    { x: 0.45, y: 0.75, descriptor: Float32Array.from([0, 0, 1]) },
    { x: 0.75, y: 0.25, descriptor: Float32Array.from([0, 1, 0]) },
    { x: 0.25, y: 0.25, descriptor: Float32Array.from([1, 0, 0]) },
  ];
  const matches = matchMobileNetFeatures(featuresA, featuresB, {
    similarityThreshold: 0.5,
    spatialCoherence: 0.2,
  });

  assert.equal(matches.length, 3);
  assert.deepEqual(matches.map((match) => [match.a.x, match.a.y, match.b.x, match.b.y]), [
    [0.2, 0.2, 0.25, 0.25],
    [0.8, 0.2, 0.75, 0.25],
    [0.5, 0.8, 0.45, 0.75],
  ]);
  assert.ok(matches.every((match) => match.confidence === 1));
});

test("MobileNet correspondences become one smooth anchored grid field without mesh phases", () => {
  const matches = [];
  const gridSize = 4;
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const a = { x: (x + 0.5) / gridSize, y: (y + 0.5) / gridSize };
      matches.push({
        a,
        b: { x: a.x + (x === 2 && y === 2 ? 0.45 : 0.05), y: a.y },
        confidence: 1,
      });
    }
  }
  const field = buildMobileNetMorphField(matches, { gridSize, width: 16, height: 16 });

  assert.equal(field.phases, 1);
  assert.equal(field.pixels.length, 16 * 16 * 4);
  assert.equal(field.pixels[0], 128, "border flow stays anchored");
  assert.equal(field.pixels[1], 128, "border flow stays anchored");
  const centerX = field.pixels[(8 * 16 + 8) * 4];
  assert.ok(centerX > 128, "the coherent interior displacement survives smoothing");
  assert.ok(centerX < 180, "one isolated vector cannot fold the whole field");
});

test("MobileNet pair cache ignores render-only controls and fingerprints image files", () => {
  const service = new MobileNetMorphPairService({ cache: { load: async () => null, save: async () => {} } });
  const base = {
    imageAId: "a",
    imageBId: "b",
    featureGrid: 8,
    patchScale: 1,
    matchThreshold: 0.2,
    spatialCoherence: 0.12,
    influence: 0.2,
    fit: "cover",
  };

  assert.equal(service.pairKey(base), service.pairKey({ ...base, morph: 0.8, autoSpeed: 1, warpStrength: 2 }));
  assert.equal(service.pairKey(base), service.pairKey({ ...base, influence: 0.5 }));
  assert.equal(service.pairKey(base), service.pairKey({ ...base, morphStrategy: "fluid" }));
  assert.notEqual(service.pairKey(base), service.pairKey({ ...base, featureGrid: 6 }));
  assert.notEqual(
    mobileNetMorphPersistentKey(service.pairKey(base), { name: "a.png", size: 10, lastModified: 1 }, {}),
    mobileNetMorphPersistentKey(service.pairKey(base), { name: "a.png", size: 11, lastModified: 1 }, {})
  );
});

test("MobileNet analysis cache follows V2 node code revisions", () => {
  const service = new MobileNetMorphPairService({ cache: { load: async () => null, save: async () => {} } });
  const params = { imageAId: "a", imageBId: "b", featureGrid: 8 };
  const files = { imageAFile: { name: "a.png" }, imageBFile: { name: "b.png" } };
  const pairKey = service.pairKey(params);

  assert.notEqual(
    mobileNetMorphPersistentKey(pairKey, files.imageAFile, files.imageBFile, "v2-analysis-a"),
    mobileNetMorphPersistentKey(pairKey, files.imageAFile, files.imageBFile, "v2-analysis-b")
  );
});

test("MobileNet runtime status rejects analysis from replaced image files", () => {
  const service = new MobileNetMorphPairService({ cache: { load: async () => null, save: async () => {} } });
  const params = { imageAId: "status-a", imageBId: "status-b", featureGrid: 8, patchScale: 1, matchThreshold: 0.2, spatialCoherence: 0.12, fit: "cover" };
  const files = { imageAFile: { name: "a.png", size: 10, lastModified: 1 }, imageBFile: { name: "b.png", size: 10, lastModified: 1 } };
  const key = service.pairKey(params);
  service.entries.set(key, { status: "ready", revision: 7, persistentKey: mobileNetMorphPersistentKey(key, files.imageAFile, files.imageBFile) });
  assert.equal(service.status(params, files), "ready");
  assert.equal(service.externalKey(params, files), "ready:7");
  assert.equal(service.status(params, { ...files, imageAFile: { ...files.imageAFile, size: 11 } }), "idle");
});

test("MobileNet analysis waits for slider scrubbing to settle", async () => {
  const invalidations = [];
  const service = new MobileNetMorphPairService({
    cache: { load: async () => null, save: async () => {} },
    debounceMs: 15,
    onInvalidate: (reason) => invalidations.push(reason),
  });
  const analyses = [];
  service.resolvePair = async (params) => {
    analyses.push(params.matchThreshold);
    return {
      matches: [],
      field: { width: 2, height: 2, phases: 1, maxFlow: 0.5, pixels: new Uint8ClampedArray(16) },
    };
  };
  const base = {
    imageAId: "debounce-a",
    imageBId: "debounce-b",
    featureGrid: 8,
    patchScale: 1,
    spatialCoherence: 0.12,
    fit: "cover",
  };
  const first = service.request({ ...base, matchThreshold: 0.4 }, {}, {});
  const second = service.request({ ...base, matchThreshold: 0.2 }, {}, {});
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.deepEqual(analyses, [0.2]);
  assert.equal(first.status, "error");
  assert.equal(second.status, "ready");
  assert.ok(invalidations.includes("feature-morph-analysis-loading"));
  assert.ok(invalidations.includes("feature-morph-analysis-superseded"));
  assert.ok(invalidations.includes("feature-morph-analysis-ready"));
  service.dispose();
});

test("Feature Morph V2 remains dynamic only while media or MobileNet analysis is pending", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  let analysisStatus = "idle";
  renderer.specializedSources.featureMorph.mobileNetMorphPairs = { status: () => analysisStatus, externalKey: () => analysisStatus };
  const source = createGeneratorSource("featureMorphV2", {
    imageAId: "image-a",
    imageBId: "image-b",
    autoSpeed: 0,
  });

  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), true);
  renderer.media.set("image-a", { ready: true });
  renderer.media.set("image-b", { ready: true });
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), true);
  analysisStatus = "ready";
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), false);
  source.params.autoSpeed = 1;
  assert.equal(renderer.sourceRuntime.sourceIsFrameDynamic(source), true);
});

test("Feature Morph V2 uses CDN MobileNet and the shared compiled morph renderer", () => {
  const component = getGeneratorComponent("featureMorphV2");
  const serviceSource = readFileSync(new URL("../js/output/specialized/mobilenet-morph-service.js", import.meta.url), "utf8");
  const rendererSource = [
    readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
  ].join("\n");
  const controls = featureMorphMediaControlsTemplate("components.0.source", { params: {} }, { media: [] }, {
    note: "MobileNet regions",
    emptyDetail: "MobileNet input",
  });

  assert.ok(serviceSource.includes("@tensorflow/tfjs@4.22.0"));
  assert.ok(serviceSource.includes("@tensorflow-models/mobilenet@2.1.1"));
  assert.ok(serviceSource.includes("extractMobileNetSpatialGrid"));
  assert.ok(serviceSource.includes("imageFeatureCache"));
  assert.ok(!serviceSource.includes("superpoint"));
  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "");
  const { plan, group, render } = compileFeatureMorphV2Plan(component.nodeDefinition);
  assert.equal(group.backend, "compiled-visual-group");
  assert.equal(render.renderer, "output/specialized:featureMorph");
  assert.match(rendererSource, /registerNativeRenderer\(\s*"output\/specialized:featureMorph"/);
  assert.match(controls, /Image A/);
  assert.match(controls, /Image B/);
  assert.match(controls, /MobileNet input/);
  plan.dispose();
});

test("MobileNet spatial endpoint discovery selects a layer that can serve the authored analysis grid", () => {
  const prefix = "module_apply_default/MobilenetV2";
  const nodes = new Map([
    [`${prefix}/expanded_conv_2/project/BatchNorm/FusedBatchNorm`, {}],
    [`${prefix}/expanded_conv_5/project/BatchNorm/FusedBatchNorm`, {}],
    [`${prefix}/expanded_conv_12/project/BatchNorm/FusedBatchNorm`, {}],
    [`${prefix}/Logits/AvgPool`, {}],
  ]);
  const names = mobileNetGraphNodeNames({ executor: { graph: { nodes } } });

  assert.equal(names.length, 4);
  assert.match(mobileNetSpatialEndpointCandidates(names, 8)[0], /expanded_conv_12\/project/);
  assert.match(mobileNetSpatialEndpointCandidates(names, 24)[0], /expanded_conv_5\/project/);
  assert.match(
    mobileNetSpatialEndpointCandidates(names, 48)[0],
    /expanded_conv_2\/project/,
    "large analysis grids use an earlier spatial layer instead of rejecting the fixed block-12 probe set",
  );
});
