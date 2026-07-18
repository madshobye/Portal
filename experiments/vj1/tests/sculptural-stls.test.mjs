import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { parseStlMesh } from "../js/output/specialized/model-parsers.js";

const directory = new URL("../assets/stl/sculptural-forms/", import.meta.url);

test("sculptural collection contains valid normalized abstract and anatomy STL models", async () => {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".stl")).sort();
  assert.equal(filenames.length, 22);
  for (const required of [
    "15_human_skull.stl",
    "16_anatomical_heart.stl",
    "17_human_brain.stl",
    "18_human_lungs.stl",
    "19_human_kidneys.stl",
    "20_human_ribcage.stl",
    "21_human_hand.stl",
    "22_human_pelvis.stl",
  ]) assert.ok(filenames.includes(required), `missing ${required}`);

  for (const filename of filenames) {
    const data = await readFile(new URL(filename, directory));
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const mesh = parseStlMesh(buffer);
    assert.ok(mesh.triangles.length >= 30, `${filename} has renderable geometry`);
    assert.ok(mesh.triangles.every((triangle) => triangle.vertices.flat().every(Number.isFinite)), `${filename} contains finite vertices`);
    const dimensions = mesh.sourceBounds.max.map((value, axis) => value - mesh.sourceBounds.min[axis]);
    assert.ok(Math.abs(Math.max(...dimensions) - 100) < 0.001, `${filename} has a normalized 100-unit maximum dimension`);
    assert.ok(Math.abs(mesh.sourceBounds.min[2]) < 0.001, `${filename} rests on Z=0`);
  }
});
