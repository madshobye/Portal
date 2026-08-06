import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createNodeInstance, NodeGroupInstance, NodeInstance } from "../js/libraries/node-engine/index.js";
import { Detect3dFormatNode, detect3dFormat } from "../js/libraries/mesh-engine/detect-3d-format/index.js";
import { isMesh, modelTriangleCount } from "../js/libraries/mesh-engine/mesh-types.js";
import { ObjParserNode, parseObjMesh } from "../js/libraries/mesh-engine/obj-parser/index.js";
import { MeshParserNodeRegistry, Parse3dObjectGroup } from "../js/libraries/mesh-engine/parse-3d-object/index.js";
import { MeshResolutionNode } from "../js/libraries/mesh-engine/mesh-resolution/index.js";
import { Convert3dFileToImageGroup, Convert3dFileToImageRegistry, convert3dFileToImage } from "../js/libraries/mesh-engine/convert-3d-file-to-image/index.js";
import { MeshRenderNode, renderMeshNodeProcess } from "../js/libraries/mesh-engine/mesh-render/index.js";
import { Prepare3dAssetGroup, prepare3dAsset } from "../js/libraries/mesh-engine/prepare-3d-asset/index.js";
import { parseStlMesh, StlParserNode } from "../js/libraries/mesh-engine/stl-parser/index.js";

test("STL Parser Node owns binary and ASCII parsing code", async () => {
  const binary = binaryStl();
  const direct = parseStlMesh(binary);
  const instance = new NodeInstance(StlParserNode);
  const result = await instance.run({ source: binary });

  assert.equal(modelTriangleCount(direct), 1);
  assert.equal(modelTriangleCount(result.mesh), 1);
  assert.equal(isMesh(result.mesh), true);
  assert.ok(result.mesh.positions instanceof Float32Array);
  assert.match(StlParserNode.parts[0].source, /function parseBinaryStl/);
  assert.match(StlParserNode.parts[0].source, /function parseAsciiStl/);

  const ascii = new TextEncoder().encode(`
solid triangle
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
endsolid triangle
`).buffer;
  assert.equal(modelTriangleCount((await instance.run({ source: ascii })).mesh), 1);
});

test("OBJ Parser Node owns indexed polygon parsing code", async () => {
  const source = `
v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
f 1 2 3 4
`;
  const direct = parseObjMesh(source);
  const result = await new NodeInstance(ObjParserNode).run({ source });

  assert.equal(modelTriangleCount(direct), 2);
  assert.equal(modelTriangleCount(result.mesh), 2);
  assert.ok(result.mesh.vertexPositions instanceof Float32Array);
  assert.ok(result.mesh.triangleIndices instanceof Uint32Array);
  assert.match(ObjParserNode.parts[0].source, /function parseObjMesh/);
  assert.match(ObjParserNode.parts[0].source, /function resolveObjIndex/);
});

test("3D format detection uses hints filenames and content", async () => {
  assert.equal(await detect3dFormat("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3"), "obj");
  assert.equal(await detect3dFormat(new Uint8Array(binaryStl()), { name: "shape.stl" }), "stl");
  const detector = new NodeInstance(Detect3dFormatNode);
  assert.deepEqual(await detector.run({ source: "solid test\nfacet normal 0 0 1", name: "" }), { format: "stl" });
});

test("Parse 3D Object is an expandable executable group without a scheduler", async () => {
  const group = createNodeInstance(Parse3dObjectGroup, { registry: MeshParserNodeRegistry });
  const stl = await group.run({ source: binaryStl(), name: "asset.stl" });
  const obj = await group.run({
    source: "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3",
    name: "asset.obj",
  });

  assert.equal(stl.format, "stl");
  assert.equal(obj.format, "obj");
  assert.equal(modelTriangleCount(stl.mesh), 1);
  assert.equal(modelTriangleCount(obj.mesh), 1);
  const graph = Parse3dObjectGroup.parts.find((part) => part.kind === "graph");
  assert.deepEqual(graph.nodes.map((node) => node.id), ["detect", "stl", "obj"]);
  assert.equal(graph.connections.some((connection) => connection.when?.equals === "stl"), true);
});

test("parser nodes reject invalid sources through their own algorithms", async () => {
  await assert.rejects(() => new NodeInstance(StlParserNode).run({ source: new ArrayBuffer(4) }), /STL file is empty/);
  await assert.rejects(() => new NodeInstance(ObjParserNode).run({ source: "v 0 0 0" }), /OBJ contained no polygon faces/);
  await assert.rejects(() => createNodeInstance(Parse3dObjectGroup, { registry: MeshParserNodeRegistry })
    .run({ source: "unrecognized data" }), /Could not detect/);
});

test("Mesh Resolution Node owns the LOD policy while retaining meshoptimizer", async () => {
  const source = parseStlMesh(binaryStl());
  const node = new NodeInstance(MeshResolutionNode, {
    parameters: { mode: "automatic", targetTriangles: 256 },
  });
  const result = await node.run({ mesh: source });

  assert.equal(result.statistics.sourceTriangles, 1);
  assert.equal(result.statistics.resultTriangles, 1);
  assert.deepEqual(result.statistics.levels, [1]);
  assert.match(MeshResolutionNode.parts[0].source, /function buildAutomaticModelLods/);
  assert.match(MeshResolutionNode.parts[0].source, /buildMeshoptimizerLods/);
});

test("Prepare 3D Asset composes parser and resolution nodes for live imports", async () => {
  const result = await prepare3dAsset({ source: binaryStl(), name: "asset.stl", resolution: "automatic" });
  const graph = Prepare3dAssetGroup.parts.find((part) => part.kind === "graph");

  assert.equal(result.format, "stl");
  assert.equal(modelTriangleCount(result.mesh), 1);
  assert.deepEqual(graph.nodes.map((node) => node.id), ["parse", "resolution"]);
  const worker = readFileSync(new URL("../js/output/specialized/model-processing-worker.js", import.meta.url), "utf8");
  assert.match(worker, /prepare3dAsset/);
  assert.doesNotMatch(worker, /parseStlMesh|parseObjMesh/);
});

test("Mesh Render owns WebGL and bounded SVG backends", () => {
  const mesh = parseStlMesh(binaryStl());
  const result = renderMeshNodeProcess({ mesh, backend: "svg" }).result;

  assert.equal(result.rendered, true);
  assert.equal(result.backend, "svg");
  assert.match(result.image.data, /^<svg/);
  assert.equal(MeshRenderNode.parts.some((part) => part.kind === "shader"), true);
  assert.equal(MeshRenderNode.parts.some((part) => part.id === "mesh-svg-renderer"), true);
});

test("Convert 3D File to Image exposes recursive prepare render and resize structure", async () => {
  const converted = await convert3dFileToImage({
    source: binaryStlWithTriangles(1000),
    name: "asset.stl",
    profile: "thumbnail",
  });
  const graph = Convert3dFileToImageGroup.parts.find((part) => part.kind === "graph");

  assert.equal(converted.format, "stl");
  assert.equal(modelTriangleCount(converted.mesh), 600, "thumbnail parsing must remain bounded before rendering");
  assert.equal(converted.renderResult.backend, "svg");
  assert.deepEqual(graph.nodes.map((node) => node.id), ["prepare", "render", "resize"]);
  assert.match(converted.image.data, /^<svg/);
  assert.match(readFileSync(new URL("../js/services/media-thumbnail-service.js", import.meta.url), "utf8"), /libraries\/mesh-engine\/convert-3d-file-to-image\/index\.js/);
});

test("model previews execute the declared recursive child topology", async () => {
  const instance = createNodeInstance(Convert3dFileToImageGroup, {
    registry: Convert3dFileToImageRegistry,
    parameters: { profile: "thumbnail" },
  });
  const calls = [];
  instrumentChildren(instance, calls);
  try {
    const result = await instance.run({ source: binaryStl(), name: "asset.stl" });
    assert.deepEqual(calls, ["prepare", "parse", "detect", "stl", "render"]);
    assert.equal(instance.children.get("prepare") instanceof NodeGroupInstance, true);
    assert.equal(instance.children.get("prepare").children.get("parse") instanceof NodeGroupInstance, true);
    assert.equal(result.renderResult.backend, "svg");
  } finally {
    instance.dispose();
  }
});

function instrumentChildren(group, calls) {
  for (const [id, child] of group.children || []) {
    const run = child.run.bind(child);
    child.run = async (...args) => {
      calls.push(id);
      return run(...args);
    };
    if (child instanceof NodeGroupInstance) instrumentChildren(child, calls);
  }
}

function binaryStl() {
  const buffer = new ArrayBuffer(84 + 50);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  const values = [0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0];
  values.forEach((value, index) => view.setFloat32(84 + index * 4, value, true));
  return buffer;
}

function binaryStlWithTriangles(count) {
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  view.setUint32(80, count, true);
  for (let triangle = 0; triangle < count; triangle++) {
    const offset = 84 + triangle * 50;
    const values = [0, 0, 1, triangle, 0, 0, triangle + 1, 0, 0, triangle, 1, 0];
    values.forEach((value, index) => view.setFloat32(offset + index * 4, value, true));
  }
  return buffer;
}
