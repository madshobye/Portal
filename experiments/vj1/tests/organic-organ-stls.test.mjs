import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { parseStlMesh } from "../js/libraries/mesh-engine/stl-parser/index.js";

const directory = new URL("../assets/stl/anatomical-organs/", import.meta.url);

test("organic anatomical collection contains normalized detailed organ meshes", async () => {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".stl")).sort();
  assert.deepEqual(filenames, [
    "01_anatomical_heart.stl",
    "02_bronchial_lungs.stl",
    "03_liver_and_stomach.stl",
    "04_kidney_pair.stl",
    "05_cerebral_brain.stl",
    "06_eye_and_optic_nerve.stl",
    "07_inner_outer_ear.stl",
    "08_vascular_tree.stl",
  ]);
  for (const filename of filenames) {
    const data = await readFile(new URL(filename, directory));
    const mesh = parseStlMesh(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    assert.ok(mesh.triangles.length >= 500, `${filename} has a detailed organic surface`);
    assert.ok(mesh.triangles.every((triangle) => triangle.vertices.flat().every(Number.isFinite)), `${filename} contains finite vertices`);
    const dimensions = mesh.sourceBounds.max.map((value, axis) => value - mesh.sourceBounds.min[axis]);
    assert.ok(Math.abs(Math.max(...dimensions) - 100) < 0.001, `${filename} has a normalized 100-unit maximum dimension`);
    assert.ok(Math.abs(mesh.sourceBounds.min[2]) < 0.001, `${filename} rests on Z=0`);
  }
});
