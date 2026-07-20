export const COMPONENT_THUMBNAIL_WIDTH = 768;
export const COMPONENT_THUMBNAIL_HEIGHT = 432;
export const COMPONENT_THUMBNAIL_QUALITY = 0.92;

export function graphicsToPngBlob(graphics) {
  const canvas = graphics?.canvas || graphics?.elt;
  if (!canvas?.toBlob) return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function componentThumbnailSignature(component = {}, render = {}) {
  try {
    return JSON.stringify({
      opacity: component.opacity,
      blend: component.blend,
      speed: component.speed,
      frameShape: component.frameShape,
      resolutionScale: component.resolutionScale,
      canvasSize: component.type === "canvas" ? render.canvasSize : null,
      chain: component.chain,
    });
  } catch {
    const clock = typeof globalThis.millis === "function" ? globalThis.millis() : Date.now();
    return `${component.id}:${clock}`;
  }
}

export function graphicsToThumbnail(
  graphics,
  width = COMPONENT_THUMBNAIL_WIDTH,
  height = COMPONENT_THUMBNAIL_HEIGHT,
  cropRect = null
) {
  try {
    const source = graphics?.canvas || graphics?.elt;
    if (!source) return "";
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width || width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height || height;
    const sx = Math.max(0, Math.min(sourceWidth - 1, Number(cropRect?.x) || 0));
    const sy = Math.max(0, Math.min(sourceHeight - 1, Number(cropRect?.y) || 0));
    const sw = Math.max(1, Math.min(sourceWidth - sx, Number(cropRect?.width) || sourceWidth));
    const sh = Math.max(1, Math.min(sourceHeight - sy, Number(cropRect?.height) || sourceHeight));
    const thumbnailSize = fittedThumbnailSize(sw, sh, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = thumbnailSize.width;
    canvas.height = thumbnailSize.height;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (cropRect) context.drawImage(source, sx, sy, sw, sh, 0, 0, thumbnailSize.width, thumbnailSize.height);
    else context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, thumbnailSize.width, thumbnailSize.height);
    const webp = canvas.toDataURL("image/webp", COMPONENT_THUMBNAIL_QUALITY);
    if (webp.startsWith("data:image/webp")) return webp;
    return canvas.toDataURL("image/png");
  } catch (error) {
    console.warn("[VJ1_THUMBNAIL_CAPTURE_FAILED]", { message: error?.message || String(error) });
    return "";
  }
}

export function fittedThumbnailSize(
  sourceWidth,
  sourceHeight,
  maxWidth = COMPONENT_THUMBNAIL_WIDTH,
  maxHeight = COMPONENT_THUMBNAIL_HEIGHT
) {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  const sh = Math.max(1, Number(sourceHeight) || 1);
  const mw = Math.max(1, Number(maxWidth) || COMPONENT_THUMBNAIL_WIDTH);
  const mh = Math.max(1, Number(maxHeight) || COMPONENT_THUMBNAIL_HEIGHT);
  const scale = Math.min(mw / sw, mh / sh);
  return {
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}
