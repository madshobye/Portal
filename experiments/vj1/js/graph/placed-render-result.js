export function directPlacementKind({
  source = {},
  blend = "normal",
  dependency = null,
  mediaDrawable = false,
  mediaIsModel = false,
  cameraDrawable = false,
} = {}) {
  if (blend === "overlay") return "";
  if (source.type === "component") {
    return dependency && dependency.type !== "canvas" ? "component-texture" : "";
  }
  if (source.type === "media") {
    return mediaDrawable && !mediaIsModel ? "media-texture" : "";
  }
  if (source.type === "camera") return cameraDrawable ? "camera-texture" : "";
  return "";
}

export function createPlacedRenderResult(texture, {
  destinationRect = {},
  transform = {},
  fit = "stretch",
  sourceIsWebGL = false,
} = {}) {
  return {
    texture,
    destinationRect: {
      x: Number(destinationRect.x) || 0,
      y: Number(destinationRect.y) || 0,
      width: Math.max(1, Number(destinationRect.width) || 1),
      height: Math.max(1, Number(destinationRect.height) || 1),
    },
    transform: normalizePlacedTransform(transform),
    fit: ["contain", "cover", "stretch"].includes(fit) ? fit : "stretch",
    sourceIsWebGL: sourceIsWebGL === true,
  };
}

export function transformedPlacementDemandRect(rect = {}, transform = {}) {
  const scale = Math.max(0.0001, Number(transform.scale) || 1);
  return {
    ...rect,
    width: Math.max(1, (Number(rect.width) || 1) * scale),
    height: Math.max(1, (Number(rect.height) || 1) * scale),
  };
}

export function normalizePlacedTransform(transform = {}) {
  return {
    x: Number(transform.x) || 0,
    y: Number(transform.y) || 0,
    scale: Math.max(0.0001, Number(transform.scale) || 1),
    rotation: Number(transform.rotation) || 0,
  };
}
