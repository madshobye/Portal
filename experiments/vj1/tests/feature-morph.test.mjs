import test from "node:test";
import assert from "node:assert/strict";
import { buildFeatureMorphField, buildFeatureMorphMesh, matchSuperPointFeatures } from "../js/output/specialized/feature-morph-field.js";
import { featureMorphPersistentKey, SuperPointPairService } from "../js/output/specialized/superpoint-service.js";
import { createGeneratorSource, getGeneratorComponent } from "../js/graph/generator-registry.js";
import { OutputRenderer } from "../js/output/output-renderer.js";

function feature(x, y, descriptor) {
  return { x, y, descriptor: Float32Array.from(descriptor) };
}

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

  const source = createGeneratorSource("featureMorph", { imageAId: "a.png", imageBId: "b.png" });
  assert.equal(source.params.imageAId, "a.png");
  assert.equal(source.params.imageBId, "b.png");
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

test("Feature Morph stays dynamic until images and landmark analysis settle", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  let analysisStatus = "idle";
  renderer.superPointPairs = { status: () => analysisStatus };
  const source = createGeneratorSource("featureMorph", {
    imageAId: "image-a",
    imageBId: "image-b",
    autoSpeed: 0,
  });

  assert.equal(renderer.sourceIsFrameDynamic(source), true, "missing decoded images must not be cached");
  renderer.media.set("image-a", { ready: true });
  renderer.media.set("image-b", { ready: false });
  assert.equal(renderer.sourceIsFrameDynamic(source), true, "partially decoded images must not be cached");

  renderer.media.set("image-b", { ready: true });
  assert.equal(renderer.sourceIsFrameDynamic(source), true, "idle analysis must receive another render frame");
  analysisStatus = "loading";
  assert.equal(renderer.sourceIsFrameDynamic(source), true, "loading analysis must receive another render frame");
  analysisStatus = "ready";
  assert.equal(renderer.sourceIsFrameDynamic(source), false, "settled static morph can be cached");
  analysisStatus = "error";
  assert.equal(renderer.sourceIsFrameDynamic(source), false, "settled error can be cached");

  source.params.autoSpeed = 1;
  analysisStatus = "ready";
  assert.equal(renderer.sourceIsFrameDynamic(source), true, "automatic morphing remains frame-dynamic");
});

test("a sole Feature Morph source retains generic transform handles without stale selection state", () => {
  const sourceItem = { id: "morph-source", kind: "source", source: createGeneratorSource("featureMorph") };
  const renderer = new OutputRenderer({ mode: "component" });
  renderer.state = {
    components: [{ id: "component-a", chain: [sourceItem] }],
    ui: { selectedComponentId: "component-a", selectedChainItemId: "" },
  };
  assert.equal(renderer.selectedTransformableChainItem(), sourceItem);
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
