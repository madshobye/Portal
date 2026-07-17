import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { featureMorphMediaControlsTemplate } from "../js/control/feature-morph-view.js";
import { createGeneratorSource, getGeneratorComponent } from "../js/graph/generator-registry.js";
import { OutputRenderer } from "../js/output/output-renderer.js";
import {
  buildMobileNetMorphField,
  buildRigidMlsMorphField,
  matchMobileNetFeatures,
  mobileNetMorphFieldForStrategy,
  MobileNetMorphPairService,
  mobileNetMorphPersistentKey,
} from "../js/output/specialized/mobilenet-morph-service.js";

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
  const service = new MobileNetMorphPairService({
    cache: { load: async () => null, save: async () => {} },
    debounceMs: 15,
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
});

test("Feature Morph V2 remains dynamic only while media or MobileNet analysis is pending", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  let analysisStatus = "idle";
  renderer.mobileNetMorphPairs = { status: () => analysisStatus, externalKey: () => analysisStatus };
  const source = createGeneratorSource("featureMorphV2", {
    imageAId: "image-a",
    imageBId: "image-b",
    autoSpeed: 0,
  });

  assert.equal(renderer.sourceIsFrameDynamic(source), true);
  renderer.media.set("image-a", { ready: true });
  renderer.media.set("image-b", { ready: true });
  assert.equal(renderer.sourceIsFrameDynamic(source), true);
  analysisStatus = "ready";
  assert.equal(renderer.sourceIsFrameDynamic(source), false);
  source.params.autoSpeed = 1;
  assert.equal(renderer.sourceIsFrameDynamic(source), true);
});

test("Feature Morph V2 uses CDN MobileNet without SuperPoint and exposes two image inputs", () => {
  const serviceSource = readFileSync(new URL("../js/output/specialized/mobilenet-morph-service.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const controls = featureMorphMediaControlsTemplate("components.0.source", { params: {} }, { media: [] }, {
    note: "MobileNet regions",
    emptyDetail: "MobileNet input",
  });

  assert.ok(serviceSource.includes("@tensorflow/tfjs@4.22.0"));
  assert.ok(serviceSource.includes("@tensorflow-models/mobilenet@2.1.1"));
  assert.ok(serviceSource.includes("extractMobileNetSpatialGrid"));
  assert.ok(serviceSource.includes("imageFeatureCache"));
  assert.ok(!serviceSource.includes("superpoint"));
  assert.ok(rendererSource.includes('source.generatorId === "featureMorphV2"'));
  assert.match(controls, /Image A/);
  assert.match(controls, /Image B/);
  assert.match(controls, /MobileNet input/);
});
