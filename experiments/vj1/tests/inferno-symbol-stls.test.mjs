import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { parseStlMesh } from "../js/libraries/mesh-engine/stl-parser/index.js";

const directory = new URL("../assets/stl/inferno-symbols/", import.meta.url);

test("inferno moodboard symbols are valid normalized realtime STL assets", async () => {
  const filenames=(await readdir(directory)).filter(name=>name.endsWith(".stl")).sort();
  assert.deepEqual(filenames,[
    "01_eternity_circles.stl",
    "02_spiral_descent.stl",
    "03_faith_cross.stl",
    "04_order_square.stl",
    "05_divine_triangle.stl",
  ]);
  for(const filename of filenames){
    const data=await readFile(new URL(filename,directory));
    const buffer=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
    const mesh=parseStlMesh(buffer);
    const dimensions=mesh.sourceBounds.max.map((value,axis)=>value-mesh.sourceBounds.min[axis]);
    assert.ok(mesh.triangles.length>=36,`${filename} contains visible geometry`);
    assert.ok(mesh.triangles.length<=6000,`${filename} respects the realtime triangle ceiling`);
    assert.ok(mesh.triangles.every(triangle=>triangle.vertices.flat().every(Number.isFinite)),`${filename} contains finite vertices`);
    assert.ok(Math.abs(Math.max(...dimensions)-100)<0.001,`${filename} is normalized to 100 units`);
    assert.ok(Math.abs(mesh.sourceBounds.min[2])<0.001,`${filename} rests on Z=0`);
  }
});
