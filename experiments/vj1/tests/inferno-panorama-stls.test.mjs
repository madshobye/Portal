import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { parseStlMesh } from "../js/output/specialized/model-parsers.js";

const directory = new URL("../assets/stl/inferno-panoramas/", import.meta.url);

test("inferno panorama collection contains nine valid wide performance meshes", async () => {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".stl")).sort();
  assert.equal(filenames.length, 9);
  assert.deepEqual(filenames, [
    "01_limbo_colonnade.stl",
    "02_storm_of_souls.stl",
    "03_gluttony_mire.stl",
    "04_hoarders_collision.stl",
    "05_styx_city_of_dis.stl",
    "06_flaming_tombs.stl",
    "07_violence_triptych.stl",
    "08_malebolge_bridges.stl",
    "09_frozen_cocytus.stl",
  ]);

  let combinedTriangles = 0;
  for (const filename of filenames) {
    const data = await readFile(new URL(filename, directory));
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const mesh = parseStlMesh(buffer);
    const dimensions = mesh.sourceBounds.max.map((value, axis) => value - mesh.sourceBounds.min[axis]);
    combinedTriangles += mesh.triangles.length;
    assert.ok(mesh.triangles.length >= 1000, `${filename} contains a populated scene`);
    assert.ok(mesh.triangles.length <= 5500, `${filename} respects the realtime triangle ceiling`);
    assert.ok(mesh.triangles.every((triangle) => triangle.vertices.flat().every(Number.isFinite)), `${filename} contains finite vertices`);
    assert.ok(Math.abs(dimensions[0] - 100) < 0.001, `${filename} has normalized width`);
    assert.ok(dimensions[0] / dimensions[2] >= 3.5, `${filename} is panoramic rather than object-shaped`);
    assert.ok(dimensions[1] <= 20, `${filename} keeps shallow panorama depth`);
    assert.ok(Math.abs(mesh.sourceBounds.min[2]) < 0.001, `${filename} rests on Z=0`);
  }
  assert.ok(combinedTriangles <= 35000, "the complete collection stays layerable");
});
