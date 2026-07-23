// Compatibility adapter for file-backed STL/OBJ controls. It lowers the
// existing media parameter shape to the same typed values consumed by the
// mesh-to-image node while retaining object/array identity across frames.
export function updateMediaMeshRenderValues(state = null, {
  id = "model",
  renderMode = "surface",
  surfaceColor = [220, 225, 220, 255],
  wireColor = [20, 20, 20, 220],
  wireThickness = 1,
  pointBudget = 4000,
  visibleDepth = 1,
  rotation = [0, 0, 0],
  modelScale = 1,
  depth = 1,
  fieldOfView = Math.PI / 3,
} = {}) {
  const result = state || {
    transform: {
      kind: "transform3d",
      contractVersion: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    camera: {
      kind: "camera3d",
      contractVersion: 1,
      projection: "perspective",
      position: [0, 0, 0.92],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fieldOfView: Math.PI / 3,
      near: 0.0005,
      far: 25,
      zoom: 1,
    },
    material: {
      kind: "material3d",
      contractVersion: 1,
      id: String(id),
      version: "0.1.0",
      renderMode: "surface",
      surfaceColor: [220, 225, 220, 255],
      wireColor: [20, 20, 20, 220],
      wireThickness: 1,
      pointBudget: 4000,
      visibleDepth: 1,
      shader: { source: "", uniforms: {} },
      metadata: {},
    },
  };
  copyVector(result.transform.rotation, rotation, [0, 0, 0]);
  const normalizedScale = Math.max(0.01, Number(modelScale) || 1);
  result.transform.scale[0] = normalizedScale;
  result.transform.scale[1] = normalizedScale;
  result.transform.scale[2] = normalizedScale * Math.max(0.05, Number(depth) || 1);
  copyVector(result.material.surfaceColor, surfaceColor, [220, 225, 220, 255]);
  copyVector(result.material.wireColor, wireColor, [20, 20, 20, 220]);
  result.material.id = String(id || "model");
  result.material.renderMode = String(renderMode || "surface");
  result.material.wireThickness = Number(wireThickness) || 1;
  result.material.pointBudget = Math.max(128, Math.round(Number(pointBudget) || 4000));
  result.material.visibleDepth = Math.max(0.02, Math.min(1, Number(visibleDepth) || 1));
  result.camera.fieldOfView = Number(fieldOfView) || Math.PI / 3;
  return result;
}

function copyVector(target, source, fallback) {
  for (let index = 0; index < target.length; index++) {
    const value = Number(source?.[index]);
    target[index] = Number.isFinite(value) ? value : fallback[index];
  }
}
