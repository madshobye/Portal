import test from "node:test";
import assert from "node:assert/strict";

import { createNodeInstance } from "../js/libraries/node-engine/index.js";
import {
  createCamera3d,
  createMaterial3d,
  createObject3d,
  createScene3d,
  createTransform3d,
  Material3dNode,
  MediaMeshNode,
  mediaMeshNodeProcess,
  MeshToImageNode,
  PerspectiveCamera3dNode,
  SceneToImageNode,
  SceneObject3dNode,
  Transform3dNode,
  disposeSceneRenderState,
  sceneToImageNodeProcess,
  updateMediaMeshRenderValues,
} from "../js/libraries/mesh-engine/index.js";
import { rawModelMatrices } from "../js/libraries/mesh-engine/mesh-render-math.js";

function triangleMesh() {
  return {
    positions: new Float32Array([
      -50, -50, 0,
      50, -50, 0,
      0, 50, 0,
    ]),
    faceNormals: new Float32Array([0, 0, 1]),
    triangleCount: 1,
    bounds: { min: [-50, -50, 0], max: [50, 50, 0] },
    sourceBounds: { min: [-1, -1, 0], max: [1, 1, 0] },
  };
}

test("3D values stay independent and can be assembled without a scene renderer authority", () => {
  const mesh = triangleMesh();
  const transform = createTransform3d({
    position: [0.25, -0.1, 0],
    rotation: [0, 0.2, 0],
    scale: [1, 2, 1],
  });
  const material = createMaterial3d({
    id: "heat",
    surfaceColor: [255, 100, 20, 255],
    shaderSource: `
vec4 vj1Surface(vec3 normal, vec3 position, vec2 uv, vec4 baseColor) {
  return vec4(baseColor.rgb * (normal.z * 0.5 + 0.5), baseColor.a);
}`,
  });
  const camera = createCamera3d({ position: [0, 0, 1.2] });
  const object = createObject3d({ id: "triangle", mesh, transform, material });
  const scene = createScene3d({ objects: [object], camera });

  assert.equal(scene.objects[0].mesh, mesh);
  assert.equal(scene.objects[0].material, material);
  assert.equal(scene.objects[0].transform, transform);
  assert.equal(scene.camera, camera);
  assert.throws(() => createMaterial3d({
    id: "invalid",
    shaderSource: "void main() {}",
  }), /MATERIAL_3D_SHADER_ENTRY_MISSING/);
});

test("mesh-to-image is the composable render operation and exposes every replaceable 3D element", async () => {
  assert.equal(MeshToImageNode.id, "core.mesh.render", "the semantic alias does not create a second renderer");
  for (const inlet of ["mesh", "material", "transform", "camera", "target", "componentTime", "clear"]) {
    assert.ok(MeshToImageNode.inlets[inlet], `missing ${inlet} inlet`);
  }
  assert.equal(MeshToImageNode.inlets.scene, undefined);
  assert.equal(MeshToImageNode.outlets.image.type.type, "image");
  assert.equal(MeshToImageNode.capabilities.includes("composable-render-operation"), true);

  const target = { clearCalls: 0, clear() { this.clearCalls++; } };
  const instance = createNodeInstance(MeshToImageNode);
  const output = await instance.run({ mesh: triangleMesh(), target });
  assert.equal(output.image, target);
  assert.equal(output.result.rendered, false, "a host without WebGL still preserves the typed image flow");
  assert.equal(target.clearCalls, 1);
  instance.dispose();
});

test("transform material object and camera are ordinary graph-placeable nodes", async () => {
  const transform = await createNodeInstance(Transform3dNode).run({
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  const material = await createNodeInstance(Material3dNode).run({
    id: "plain",
    surfaceColor: [255, 255, 255, 255],
    wireColor: [0, 0, 0, 255],
    shaderSource: "",
    uniforms: {},
  });
  const camera = await createNodeInstance(PerspectiveCamera3dNode).run({
    position: [0, 0, 0.92],
    target: [0, 0, 0],
    up: [0, 1, 0],
  });
  const object = await createNodeInstance(SceneObject3dNode).run({
    id: "mesh",
    mesh: triangleMesh(),
    transform: transform.transform,
    material: material.material,
    visible: true,
  });

  assert.equal(object.object.kind, "object3d");
  assert.equal(camera.camera.kind, "camera3d");
});

test("project meshes are explicit reusable graph nodes with declared host resources", () => {
  const mesh = triangleMesh();
  const output = mediaMeshNodeProcess(
    { mediaId: "media/skull.stl" },
    { resolveMesh: (id) => id === "media/skull.stl" ? mesh : null },
  );

  assert.strictEqual(output.mesh, mesh);
  assert.equal(MediaMeshNode.outlets.mesh.type.type, "mesh");
  assert.equal(MediaMeshNode.capabilities.includes("graph-placeable"), true);
  assert.deepEqual(MediaMeshNode.metadata.resourceDependencies, [{
    kind: "media",
    valueType: "mesh",
    parameterId: "mediaId",
    required: true,
  }]);
  assert.throws(
    () => mediaMeshNodeProcess({ mediaId: "media/missing.stl" }, { resolveMesh: () => null }),
    /MEDIA_MESH_UNAVAILABLE:media\/missing\.stl/,
  );
});

test("scene-to-image lowers arbitrary object collections to retained shared mesh draws", () => {
  const mesh = triangleMesh();
  const scene = createScene3d({
    objects: [
      createObject3d({ id: "left", mesh, transform: createTransform3d({ position: [-0.2, 0, 0] }) }),
      createObject3d({ id: "right", mesh, transform: createTransform3d({ position: [0.2, 0, 0] }) }),
    ],
  });
  const target = { clearCalls: 0, clear() { this.clearCalls++; } };
  const state = {};
  const first = sceneToImageNodeProcess({ scene, target, componentTime: 1 }, { state });
  const second = sceneToImageNodeProcess({ scene, target, componentTime: 2 }, { state });

  assert.equal(SceneToImageNode.id, "core.scene3d.render");
  assert.strictEqual(second, first);
  assert.equal(target.clearCalls, 2, "the Scene target clears once per frame, not once per object");
  assert.equal(state.objectStates.size, 2);
  assert.equal(state.meshCacheOwners.size, 1, "mesh instances share one retained GPU cache owner");
  assert.strictEqual(first.texture, target);

  disposeSceneRenderState(state);
  assert.equal(state.objectStates.size, 0);
  assert.equal(state.meshCacheOwners.size, 0);
});

test("normalized 3D translation and camera enter the retained matrix path directly", () => {
  const matrices = rawModelMatrices(
    400,
    200,
    1,
    1,
    [0, 0, 0],
    {},
    Math.PI / 3,
    [0, 0, 1, 1],
    createTransform3d({ position: [0.25, -0.5, 0.1] }),
    createCamera3d({ position: [0, 0, 1.2] })
  );

  assert.equal(matrices.model[12], 50);
  assert.equal(matrices.model[13], -100);
  assert.equal(matrices.model[14], 20);
});

test("legacy STL controls lower to retained composable 3D values without per-frame record churn", () => {
  const first = updateMediaMeshRenderValues(null, {
    id: "stl",
    renderMode: "surfaceWire",
    rotation: [0.1, 0.2, 0.3],
    modelScale: 2,
    depth: 0.5,
    fieldOfView: 0.9,
  });
  const second = updateMediaMeshRenderValues(first, {
    id: "stl",
    renderMode: "wireframe",
    rotation: [0.4, 0.5, 0.6],
    modelScale: 3,
    depth: 2 / 3,
    fieldOfView: 1.1,
  });

  assert.strictEqual(second, first);
  assert.strictEqual(second.material, first.material);
  assert.strictEqual(second.transform.rotation, first.transform.rotation);
  assert.deepEqual(second.transform.rotation, [0.4, 0.5, 0.6]);
  assert.deepEqual(second.transform.scale, [3, 3, 2]);
  assert.equal(second.material.renderMode, "wireframe");
  assert.equal(second.camera.fieldOfView, 1.1);
});
