import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { parseStlMesh } from "../js/output/specialized/model-parsers.js";

const directory = new URL("../assets/stl/dantes-inferno/", import.meta.url);

test("Dante's Inferno collection contains fourteen valid normalized STL models", async () => {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".stl")).sort();
  assert.equal(filenames.length, 14);

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
