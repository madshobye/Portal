import test from "node:test";
import assert from "node:assert/strict";

import { createNodeInstance } from "../js/libraries/node-engine/index.js";
import {
  AnimatedTransform3dNode,
  animatedTransform3dProcess,
  createCamera3d,
  createEllipsoidMesh,
  createMaterial3d,
  createMeshCollection,
  createObject3d,
  createPathTubeMesh,
  createProfileMesh,
  createScene3d,
  createTransform3d,
  Material3dNode,
  MaterialBinding3dNode,
  CombineMaterialBindings3dNode,
  EllipsoidMeshNode,
  MediaMeshNode,
  mediaMeshNodeProcess,
  modelTriangle,
  MeshToImageNode,
  MeshCollectionObjects3dNode,
  MeshDisplayLodNode,
  meshDisplayLodProcess,
  normalizePlanarGridOptions,
  PlanarGridMeshNode,
  PathTubeMeshNode,
  PerspectiveCamera3dNode,
  ProfileMeshNode,
  releaseMeshRenderCacheOwner,
  retainMeshRenderCacheOwner,
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

test("planar grid is a retained canonical mesh source for ordinary Scene graphs", async () => {
  const instance = createNodeInstance(PlanarGridMeshNode);
  const first = await instance.run({
    columns: 2,
    rows: 3,
    width: 4,
    depth: 6,
    axis: "xz",
  });
  const firstMesh = first.mesh;
  const same = await instance.run({
    columns: 2,
    rows: 3,
    width: 4,
    depth: 6,
    axis: "xz",
  });
  const sameMesh = same.mesh;
  const changed = await instance.run({
    columns: 3,
    rows: 3,
    width: 4,
    depth: 6,
    axis: "xz",
  });

  assert.strictEqual(sameMesh, firstMesh, "unchanged grid settings retain one canonical mesh resource");
  assert.notStrictEqual(changed.mesh, firstMesh, "topology changes replace the mesh resource");
  assert.equal(firstMesh.kind, "mesh");
  assert.equal(firstMesh.representation, "indexed");
  assert.equal(firstMesh.triangleCount, 12);
  assert.deepEqual(firstMesh.bounds, {
    min: [-2, 0, -3],
    max: [2, 0, 3],
  });
  assert.deepEqual(modelTriangle(firstMesh, 0).normal, [0, 1, 0]);
  assert.equal(PlanarGridMeshNode.capabilities.includes("mesh-source"), true);
  assert.equal(PlanarGridMeshNode.presentation.placeableOn.includes("node-graph"), true);
  assert.deepEqual(normalizePlanarGridOptions({
    columns: 0,
    rows: -4,
    width: 0,
    depth: -1,
    axis: "invalid",
  }), {
    columns: 1,
    rows: 1,
    width: 0.001,
    depth: 0.001,
    axis: "xz",
  }, "finite zero and negative values clamp instead of being mistaken for missing values");
  instance.dispose();
});

test("profile path-tube and ellipsoid meshes are reusable retained graph sources", async () => {
  const transform = createTransform3d({
    position: [2, 3, 4],
    rotation: [0, 0, Math.PI * 0.5],
    scale: [1, 1, 2],
  });
  const profileInputs = {
    profile: [
      { y: -1, radiusX: 1, radiusZ: 0.5 },
      { y: 1, radiusX: 2, radiusZ: 1 },
    ],
    segments: 6,
    transform,
  };
  const profileInstance = createNodeInstance(ProfileMeshNode);
  const profile = await profileInstance.run(profileInputs);
  const repeatedProfile = await profileInstance.run({
    transform,
    segments: 6,
    profile: profileInputs.profile.map((slice) => ({ ...slice })),
  });
  assert.strictEqual(repeatedProfile.mesh, profile.mesh,
    "semantic input equality retains the canonical procedural mesh");
  assert.equal(profile.mesh.triangleCount, 24);
  assert.equal(profile.mesh.metadata.generator, ProfileMeshNode.id);

  const path = [
    { point: [0, 0, 0], radius: 1, depthScale: 0.5 },
    { point: [0, 2, 0], radius: 0.5, depthScale: 0.75 },
  ];
  const pathInstance = createNodeInstance(PathTubeMeshNode);
  const tube = await pathInstance.run({ path, segments: 8 });
  const tubeMesh = tube.mesh;
  assert.equal(tubeMesh.triangleCount, 32);
  assert.equal(tubeMesh.metadata.generator, PathTubeMeshNode.id);
  assert.notStrictEqual(
    (await pathInstance.run({
      path: [{ ...path[0] }, { ...path[1], radius: 0.75 }],
      segments: 8,
    })).mesh,
    tubeMesh,
    "geometry input changes replace the retained resource",
  );

  const ellipsoidInstance = createNodeInstance(EllipsoidMeshNode);
  const ellipsoid = await ellipsoidInstance.run({
    center: [0, 0, 0],
    radii: [2, 3, 4],
    segments: 8,
    latitudeSegments: 4,
  });
  assert.equal(ellipsoid.mesh.triangleCount, 64);
  assert.equal(ellipsoid.mesh.metadata.generator, EllipsoidMeshNode.id);
  assert.equal(createProfileMesh(profileInputs).kind, "mesh");
  assert.equal(createPathTubeMesh({ path, segments: 8 }).kind, "mesh");
  assert.equal(createEllipsoidMesh({ radii: [1, 1, 1], segments: 6 }).kind, "mesh");
  profileInstance.dispose();
  pathInstance.dispose();
  ellipsoidInstance.dispose();
});

test("mesh collections expand material slots into retained ordinary Scene objects", async () => {
  const skinMesh = triangleMesh();
  const detailMesh = {
    ...triangleMesh(),
    bounds: { min: [-20, -10, -5], max: [30, 40, 5] },
    sourceBounds: { min: [-20, -10, -5], max: [30, 40, 5] },
  };
  const collection = createMeshCollection({
    id: "anatomy-part",
    parts: [
      { id: "skin", mesh: skinMesh, materialSlot: "skin" },
      { id: "detail", mesh: detailMesh, materialSlot: "detail" },
    ],
  });
  assert.deepEqual(collection.bounds, {
    min: [-50, -50, -5],
    max: [50, 50, 5],
  });
  assert.throws(() => createMeshCollection({
    id: "duplicates",
    parts: [
      { id: "same", mesh: skinMesh },
      { id: "same", mesh: detailMesh },
    ],
  }), /MESH_COLLECTION_PART_DUPLICATE/);

  const skinMaterial = createMaterial3d({ id: "skin", surfaceColor: "#d9d4c9ff" });
  const detailMaterial = createMaterial3d({ id: "detail", surfaceColor: "#20242aff" });
  const skinBinding = (await createNodeInstance(MaterialBinding3dNode).run({
    slot: "skin",
    material: skinMaterial,
  })).binding;
  const detailBinding = (await createNodeInstance(MaterialBinding3dNode).run({
    slot: "detail",
    material: detailMaterial,
  })).binding;
  const bindingInstance = createNodeInstance(CombineMaterialBindings3dNode);
  const bindings = (await bindingInstance.run({ a: skinBinding, b: detailBinding })).bindings;
  const objectInstance = createNodeInstance(MeshCollectionObjects3dNode);
  const first = await objectInstance.run({ collection, materialBindings: bindings, visible: true });
  const second = await objectInstance.run({ collection, materialBindings: bindings, visible: true });

  assert.strictEqual(second.objects, first.objects);
  assert.equal(first.objects.length, 2);
  assert.strictEqual(first.objects[0].material, skinMaterial);
  assert.strictEqual(first.objects[1].material, detailMaterial);
  assert.strictEqual(first.objects[0].mesh, skinMesh);
  assert.equal(first.objects[1].metadata.materialSlot, "detail");
  await assert.rejects(
    createNodeInstance(CombineMaterialBindings3dNode).run({
      a: skinBinding,
      b: { ...skinBinding },
    }),
    /MATERIAL_BINDING_3D_DUPLICATE:skin/,
  );
  bindingInstance.dispose();
  objectInstance.dispose();
});

test("animated transform is a reusable typed graph node with legacy-equivalent rotation and scale", async () => {
  const inputs = {
    componentTime: 2,
    positionX: 0.25,
    positionY: -0.5,
    positionZ: 0.1,
    rotationX: -0.18,
    rotationY: -0.45,
    rotationZ: 0.2,
    spinX: 0.1,
    spinY: -0.2,
    spinZ: 0.3,
    uniformScale: 2,
    scaleX: 1,
    scaleY: 0.5,
    scaleZ: 1.5,
  };
  const direct = animatedTransform3dProcess(inputs).transform;
  const executed = await createNodeInstance(AnimatedTransform3dNode).run(inputs);

  assert.equal(AnimatedTransform3dNode.outlets.transform.type.type, "transform3d");
  assert.equal(AnimatedTransform3dNode.capabilities.includes("graph-placeable"), true);
  assert.equal(executed.transform.kind, "transform3d");
  assert.deepEqual(executed.transform.position, [0.25, -0.5, 0.1]);
  assert.deepEqual(executed.transform.rotation, [0.020000000000000018, -0.8500000000000001, 0.8]);
  assert.deepEqual(executed.transform.scale, [2, 1, 3]);
  assert.deepEqual(executed.transform, direct);
});

test("project meshes are explicit reusable graph nodes with declared host resources", () => {
  const mesh = triangleMesh();
  const output = mediaMeshNodeProcess(
    { mediaId: "media/skull.stl" },
    { resolveMesh: (id) => id === "media/skull.stl" ? mesh : null },
  );

  assert.strictEqual(output.mesh, mesh);
  assert.deepEqual(output.importRotation, [0, 0, Math.PI]);
  assert.deepEqual(mediaMeshNodeProcess(
    { mediaId: "media/skull.obj" },
    { resolveMesh: () => mesh },
  ).importRotation, [0, 0, 0]);
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

test("model import basis remains an explicit replaceable transform input", () => {
  const result = animatedTransform3dProcess({
    componentTime: 2,
    rotationOffset: [0.1, 0.2, Math.PI],
    rotationX: 0.3,
    rotationY: -0.1,
    rotationZ: 0.5,
    spinZ: 0.25,
  }).transform;

  assert.deepEqual(result.rotation, [0.4, 0.1, Math.PI + 1]);
});

test("display LOD is a retained semantic mesh operation driven by image demand", () => {
  const fine = { ...triangleMesh(), triangleCount: 120000 };
  const medium = { ...triangleMesh(), triangleCount: 25000 };
  const coarse = { ...triangleMesh(), triangleCount: 6000 };
  const mesh = { ...fine, lods: [fine, medium, coarse] };
  const state = {};
  const first = meshDisplayLodProcess({
    mesh,
    viewport: { width: 320, height: 180 },
    renderMode: "wireframe",
    wireDetail: 0,
  }, { state });
  const second = meshDisplayLodProcess({
    mesh,
    viewport: { width: 1920, height: 1080 },
    renderMode: "surface",
    renderQuality: 1,
  }, { state });

  assert.equal(MeshDisplayLodNode.capabilities.includes("mesh-lod-selection"), true);
  assert.strictEqual(first, second, "frame evaluation mutates one retained result record");
  assert.strictEqual(first.mesh, fine);
  assert.equal(first.targetTriangles, 120000);
});

test("canonical Mesh resources share retained GPU cache ownership across Scene programs", () => {
  const mesh = triangleMesh();
  const first = retainMeshRenderCacheOwner(mesh);
  const second = retainMeshRenderCacheOwner(mesh);
  assert.strictEqual(second, first);

  releaseMeshRenderCacheOwner(first);
  const third = retainMeshRenderCacheOwner(mesh);
  assert.strictEqual(third, first, "one released Scene cannot dispose a mesh retained by another");
  releaseMeshRenderCacheOwner(second);
  releaseMeshRenderCacheOwner(third);

  const afterFinalRelease = retainMeshRenderCacheOwner(mesh);
  assert.notStrictEqual(afterFinalRelease, first, "the final release disposes and detaches the shared owner");
  releaseMeshRenderCacheOwner(afterFinalRelease);
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
