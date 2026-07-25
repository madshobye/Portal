import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import {
  releaseMeshRenderCacheOwner,
  renderMeshNodeProcess,
  retainMeshRenderCacheOwner,
} from "../mesh-render/index.js?v=mesh-geometry-detail-2";
import { Scene3dType } from "../scene-types.js";
import { defineVisualNodeContract } from "../../render-engine/visual-node-contract.js";
import {
  createVisualRenderProcessContext,
  updateVisualRenderProcessContext,
  VISUAL_RENDER_PROCESS_CONTEXT_FORMAT,
  visualRenderProcessContext,
} from "../../render-engine/render-process-context.js?v=mesh-geometry-detail-2";
import { withOwnedRawWebGlState } from "../../render-engine/raw-webgl-state.js?v=mesh-geometry-detail-2";

const SCENE_TO_IMAGE_VISUAL_CONTRACT = defineVisualNodeContract({
  transform: { domain: "content" },
  roi: {
    mode: "projective",
    coordinateSpace: "projective",
    inputMapping: "sub-frustum",
    pixelEquivalentToFullFrame: true,
  },
  allocation: { mode: "retained" },
  alpha: { input: "premultiplied", output: "premultiplied" },
});

export const SceneToImageNode = defineNode({
  id: "core.scene3d.render",
  name: "3D Scene to Image",
  version: "0.1.0",
  description: "Lowers a reusable 3D Scene value to retained mesh draws in one target without introducing a second renderer authority.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    scene: { type: Scene3dType, required: true },
    resourceStatus: { type: "resource-status", required: false },
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
    "render-operation",
    "live-fast-path",
    "composable-render-operation",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "render", "scene-3d", "visual"],
    placeableOn: ["visual-graph", "node-graph"],
    previewOutput: "texture",
  },
  metadata: {
    nodeOwnedNativeModule: true,
    nodeOwnedNativeProcess: true,
    renderProcessContext: VISUAL_RENDER_PROCESS_CONTEXT_FORMAT,
    renderTarget: { depth: true },
    allocationStable: true,
    allocationStableDirectPath: true,
    visualContract: SCENE_TO_IMAGE_VISUAL_CONTRACT,
    nativeArtifactRequirements: {
      moduleExports: ["sceneToImageNodeProcess"],
      shaders: [],
    },
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
    retainMeshRenderCacheOwner,
    releaseMeshRenderCacheOwner,
  },
  moduleExports: {
    sceneToImageNodeProcess,
  },
  process: sceneToImageNodeProcess,
});

export function sceneToImageNodeProcess(inputs = {}, context = {}) {
  const {
    state = {},
    output = null,
  } = context;
  const renderProcess = visualRenderProcessContext(context);
  const target = renderProcess.target;
  const scene =
    inputs.scene ||
    inputs.runtimeValues?.get?.("scene") ||
    null;
  const resourceStatus =
    inputs.resourceStatus ||
    inputs.runtimeValues?.get?.("resourceStatus") ||
    null;
  const componentTime = renderProcess.time;
  const viewport = renderProcess.view || renderProcess.request;
  const contentTransform = renderProcess.contentTransform || {};
  const nodeOutput = output || state.nodeOutput || (state.nodeOutput = {
    image: null,
    texture: null,
  });
  if (!target) throw new Error("SCENE_TO_IMAGE_TARGET_REQUIRED");
  if (!scene || resourceStatus?.ready === false) {
    const label = resourceStatus?.error
      ? `3D model error: ${resourceStatus.error}`
      : resourceStatus?.label || "Prepare 3D mesh";
    context.drawStandby?.(target, label, { forceVisible: true });
    nodeOutput.image = target;
    nodeOutput.texture = target;
    return nodeOutput;
  }
  const objectStates = state.objectStates || (state.objectStates = new Map());
  const meshCacheOwners = state.meshCacheOwners || (state.meshCacheOwners = new Map());
  const activeObjectIds = state.activeObjectIds || (state.activeObjectIds = new Set());
  const activeMeshes = state.activeMeshes || (state.activeMeshes = new Set());
  activeObjectIds.clear();
  activeMeshes.clear();

  const drawScene = () => withOwnedRawWebGlState(target, () => {
    // The retained source/framebuffer-pass owner clears its target before
    // invoking compiled render nodes. Standalone callers may still request a
    // clear explicitly through the render-process contract. Never clear both:
    // large color+depth targets made that duplicate ownership a dominant cost.
    if (renderProcess.clear) target?.clear?.();
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
        cacheOwner = retainMeshRenderCacheOwner(object.mesh);
        meshCacheOwners.set(object.mesh, cacheOwner);
      }
      const objectRenderProcess =
        renderState.renderProcess ||
        (renderState.renderProcess = createVisualRenderProcessContext());
      updateVisualRenderProcessContext(objectRenderProcess, {
        target,
        time: componentTime,
        request: renderProcess.request,
        view: viewport,
        contentTransform,
        cacheOwner,
        clear: false,
      });
      renderMeshNodeProcess({
        mesh: object.mesh,
        material: object.material,
        transform: object.transform,
        camera: scene.camera,
      }, {
        state: renderState,
        renderProcess: objectRenderProcess,
        renderHost: context.renderHost,
      });
    }
  });
  drawScene();

  for (const objectId of objectStates.keys()) {
    if (!activeObjectIds.has(objectId)) objectStates.delete(objectId);
  }
  for (const [mesh, cacheOwner] of meshCacheOwners) {
    if (activeMeshes.has(mesh)) continue;
    releaseMeshRenderCacheOwner(cacheOwner);
    meshCacheOwners.delete(mesh);
  }

  nodeOutput.image = target;
  nodeOutput.texture = target;
  return nodeOutput;
}

export function disposeSceneRenderState(state = {}) {
  for (const cacheOwner of state.meshCacheOwners?.values?.() || []) {
    releaseMeshRenderCacheOwner(cacheOwner);
  }
  state.meshCacheOwners?.clear?.();
  state.objectStates?.clear?.();
  state.activeObjectIds?.clear?.();
  state.activeMeshes?.clear?.();
}
