import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { renderMeshNodeProcess, disposeRawModelItemResources } from "../mesh-render/index.js";
import { Scene3dType } from "../scene-types.js";

export const SceneToImageNode = defineNode({
  id: "core.scene3d.render",
  name: "3D Scene to Image",
  version: "0.1.0",
  description: "Lowers a reusable 3D Scene value to retained mesh draws in one target without introducing a second renderer authority.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    scene: { type: Scene3dType, required: true },
    target: { type: "any", required: true },
    componentTime: { type: "number", defaultValue: 0 },
    viewport: { type: "viewport", optional: true },
    contentTransform: { type: "transform2d", defaultValue: {} },
  },
  outlets: {
    image: { type: "image", optional: true },
    texture: { type: "texture" },
  },
  execution: {
    trigger: "frame",
    domain: "main",
    stateful: true,
    asynchronous: false,
    dispose(instance) {
      disposeSceneRenderState(instance.state);
    },
  },
  capabilities: [
    "scene-3d",
    "scene-to-image",
    "mesh-rendering",
    "multi-object-3d",
    "gpu",
    "graph-placeable",
    "live-fast-path",
    "composable-render-operation",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "render", "scene-3d"],
    placeableOn: ["node-graph"],
    previewOutput: "image",
  },
  parts: [{
    id: "scene-render-lowering",
    name: "Scene render lowering",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "sceneToImageNodeProcess",
    entry: "process",
    source: sceneToImageNodeProcess.toString(),
  }],
  moduleBindings: {
    renderMeshNodeProcess,
    disposeRawModelItemResources,
  },
  process: sceneToImageNodeProcess,
});

export function sceneToImageNodeProcess(inputs = {}, { state = {}, output = null } = {}) {
  const target = inputs.target;
  const scene = inputs.scene;
  const nodeOutput = output || state.nodeOutput || (state.nodeOutput = {
    image: null,
    texture: null,
  });
  const objectStates = state.objectStates || (state.objectStates = new Map());
  const meshCacheOwners = state.meshCacheOwners || (state.meshCacheOwners = new Map());
  const activeObjectIds = state.activeObjectIds || (state.activeObjectIds = new Set());
  const activeMeshes = state.activeMeshes || (state.activeMeshes = new Set());
  activeObjectIds.clear();
  activeMeshes.clear();

  target?.clear?.();
  const background = scene?.background;
  if (Number(background?.[3]) > 0) {
    target?.background?.(background[0], background[1], background[2], background[3]);
  }

  for (const object of scene?.objects || []) {
    if (!object?.visible || !object.mesh) continue;
    const objectId = String(object.id || `object-${activeObjectIds.size}`);
    activeObjectIds.add(objectId);
    activeMeshes.add(object.mesh);
    let renderState = objectStates.get(objectId);
    if (!renderState) {
      renderState = {};
      objectStates.set(objectId, renderState);
    }
    let cacheOwner = meshCacheOwners.get(object.mesh);
    if (!cacheOwner) {
      cacheOwner = { modelData: object.mesh };
      meshCacheOwners.set(object.mesh, cacheOwner);
    }
    renderMeshNodeProcess({
      mesh: object.mesh,
      material: object.material,
      transform: object.transform,
      camera: scene.camera,
      target,
      cacheOwner,
      componentTime: inputs.componentTime,
      viewport: inputs.viewport,
      contentTransform: inputs.contentTransform,
      clear: false,
    }, { state: renderState });
  }

  for (const objectId of objectStates.keys()) {
    if (!activeObjectIds.has(objectId)) objectStates.delete(objectId);
  }
  for (const [mesh, cacheOwner] of meshCacheOwners) {
    if (activeMeshes.has(mesh)) continue;
    disposeRawModelItemResources(cacheOwner);
    meshCacheOwners.delete(mesh);
  }

  nodeOutput.image = target;
  nodeOutput.texture = target;
  return nodeOutput;
}

export function disposeSceneRenderState(state = {}) {
  for (const cacheOwner of state.meshCacheOwners?.values?.() || []) {
    disposeRawModelItemResources(cacheOwner);
  }
  state.meshCacheOwners?.clear?.();
  state.objectStates?.clear?.();
  state.activeObjectIds?.clear?.();
  state.activeMeshes?.clear?.();
}
