export const COMPONENT_THUMBNAIL_WIDTH = 768;
export const COMPONENT_THUMBNAIL_HEIGHT = 432;
export const COMPONENT_THUMBNAIL_QUALITY = 0.92;

export function graphicsToPngBlob(graphics) {
  const canvas = graphics?.canvas || graphics?.elt;
  if (!canvas?.toBlob) return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function graphicsToThumbnailBlob(graphics) {
  const canvas = graphics?.canvas || graphics?.elt;
  if (!canvas?.toBlob) return null;
  const webp = await canvasToBlob(canvas, "image/webp", COMPONENT_THUMBNAIL_QUALITY);
  if (webp?.type === "image/webp") return webp;
  return await canvasToBlob(canvas, "image/png");
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

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
