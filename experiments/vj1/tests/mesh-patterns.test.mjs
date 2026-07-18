import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  generateMeshPatternTopology,
  MESH_PATTERN_FAMILIES,
  meshPatternTopologySignature,
} from "../js/output/specialized/mesh-pattern-algorithms.js";
import { meshPatternPalette } from "../js/output/specialized/mesh-pattern-renderer.js";
import { createGeneratorSource } from "../js/graph/generator-registry.js";

const representative = {
  scale: 8,
  density: 1,
  irregularity: 0.75,
  seed: 17,
};

test("every mesh family produces bounded deterministic vector topology", () => {
  assert.deepEqual(MESH_PATTERN_FAMILIES, [
    "cells", "veins", "mountains", "soap", "cracks",
    "coral", "fabric", "rivers", "magnetic fields", "bone",
  ]);
  for (const pattern of MESH_PATTERN_FAMILIES) {
    const first = generateMeshPatternTopology({ ...representative, pattern }, 1.5);
    const second = generateMeshPatternTopology({ ...representative, pattern }, 1.5);
    assert.equal(first.signature, second.signature, `${pattern} signature changed`);
    assert.deepEqual(first.fillVertices, second.fillVertices, `${pattern} fill is not deterministic`);
    assert.deepEqual(first.lineSegments, second.lineSegments, `${pattern} wire topology is not deterministic`);
    assert.ok(first.lineSegmentCount > 0, `${pattern} has no vector edges`);
    assert.ok(first.fillVertexCount > 0, `${pattern} has no fill geometry`);
    assert.ok(first.fillVertexCount < 20000, `${pattern} exceeded bounded fill budget`);
    assert.ok(first.lineSegmentCount < 15000, `${pattern} exceeded bounded line budget`);
  }
});

test("topology signatures ignore render styling and include structural controls", () => {
  const base = meshPatternTopologySignature({ ...representative, pattern: "cells" }, 1.5);
  const styled = meshPatternTopologySignature({
    ...representative,
    pattern: "cells",
    drawMode: "wire",
    wireWidth: 12,
    baseColor: "#ff0000ff",
    palette: "monochrome",
    fillOpacity: 0,
  }, 1.5);
  assert.equal(base, styled);
  assert.notEqual(base, meshPatternTopologySignature({ ...representative, pattern: "cells", seed: 18 }, 1.5));
  assert.notEqual(base, meshPatternTopologySignature({ ...representative, pattern: "cells", density: 2 }, 1.5));
  assert.notEqual(base, meshPatternTopologySignature({ ...representative, pattern: "fabric" }, 1.5));
});

test("legacy visual names map to their real topology families", () => {
  const legacy = generateMeshPatternTopology({ ...representative, pattern: "tectonic plates" }, 1);
  const current = generateMeshPatternTopology({ ...representative, pattern: "cells" }, 1);
  assert.equal(legacy.family, "cells");
  assert.deepEqual(legacy.fillVertices, current.fillVertices);
  assert.deepEqual(legacy.lineSegments, current.lineSegments);
  assert.equal(createGeneratorSource("meshPatterns", { pattern: "soap bubble foam" }).params.pattern, "soap");
  assert.equal(createGeneratorSource("meshPatterns", { pattern: "river delta" }).params.pattern, "rivers");
});

test("mesh palette returns four GPU-ready colors for every harmony", () => {
  for (const palette of ["custom", "analogous", "complementary", "triadic", "split complementary", "tetradic", "monochrome"]) {
    const colors = meshPatternPalette({
      palette,
      colorCount: 4,
      baseColor: "#8040c0cc",
      colorB: "#11223344",
      colorC: "#55667788",
      colorD: "#99aabbcc",
    });
    assert.equal(colors.length, 4);
    colors.forEach((color) => {
      assert.equal(color.length, 4);
      color.forEach((channel) => assert.ok(channel >= 0 && channel <= 1));
    });
  }
  const pair = meshPatternPalette({ palette: "triadic", colorCount: 2, baseColor: "#8040c0ff" });
  assert.deepEqual(pair[0], pair[2]);
  assert.deepEqual(pair[1], pair[3]);
});

test("mesh topology uses a cached specialized raw-WebGL render path", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const meshRenderer = readFileSync(new URL("../js/output/specialized/mesh-pattern-renderer.js", import.meta.url), "utf8");
  const algorithms = readFileSync(new URL("../js/output/specialized/mesh-pattern-algorithms.js", import.meta.url), "utf8");

  assert.match(renderer, /source\.generatorId === "meshPatterns"/);
  assert.match(runtime, /this\.meshPatterns\.draw\(target, source, componentTime, renderRequest\)/);
  assert.match(meshRenderer, /this\.cpuTopologies = new Map\(\)/);
  assert.match(meshRenderer, /gl\.bufferData\(gl\.ARRAY_BUFFER, topology\.fillVertices, gl\.STATIC_DRAW\)/);
  assert.match(meshRenderer, /gl\.drawArrays\(gl\.TRIANGLES/);
  assert.match(meshRenderer, /createTopologyResources\(gl, topology, currentFrame\);\s*context\.topologies\.set\(signature, resources\);\s*pruneGpuTopologies\(gl, context\.topologies, signature\)/);
  assert.match(meshRenderer, /\.filter\(\(\[key\]\) => key !== protectedKey\)/);
  assert.match(meshRenderer, /topologyResourcesValid\(gl, resources\)/);
  assert.match(algorithms, /function voronoiCells/);
  assert.match(algorithms, /function marchingSquares/);
  assert.match(algorithms, /function rk4Step/);
  assert.match(algorithms, /function solveTruss/);
});
