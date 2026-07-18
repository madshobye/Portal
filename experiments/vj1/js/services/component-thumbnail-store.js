export const THUMBNAIL_ROOT = "vj1-cache";
export const THUMBNAIL_DIR = "thumbnails";

export function componentThumbnailFilename(componentId, frameId = "", extension = "webp") {
  const component = encodeURIComponent(String(componentId || ""));
  const frame = frameId ? `__frame__${encodeURIComponent(String(frameId))}` : "__component";
  return `${component}${frame}.${extension === "png" ? "png" : "webp"}`;
}

export function parseComponentThumbnailFilename(filename = "") {
  const match = String(filename).match(/^(.+?)(__component|__frame__(.+))\.(webp|png)$/i);
  if (!match) return null;
  try {
    return {
      componentId: decodeURIComponent(match[1]),
      frameId: match[3] ? decodeURIComponent(match[3]) : "",
      extension: match[4].toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function thumbnailDataUrlToBlob(dataUrl = "") {
  const match = String(dataUrl).match(/^data:(image\/(?:webp|png));base64,([a-z\d+/=\s]+)$/i);
  if (!match) throw new TypeError("Thumbnail must be a base64 WebP or PNG data URL.");
  const bytes = globalThis.atob(match[2].replace(/\s/g, ""));
  const data = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index++) data[index] = bytes.charCodeAt(index);
  return new Blob([data], { type: match[1].toLowerCase() });
}

export function thumbnailExtension(blob) {
  return blob?.type === "image/png" ? "png" : "webp";
}

export function applyThumbnailUrls(components = [], entries = []) {
  const byId = new Map((components || []).map((component) => [String(component.id), component]));
  for (const entry of entries || []) {
    const component = byId.get(String(entry.componentId));
    if (!component || !entry.url) continue;
    if (entry.frameId && component.type === "canvas") {
      component.canvas ||= {};
      component.canvas.frameThumbnails ||= {};
      component.canvas.frameThumbnails[entry.frameId] = entry.url;
    } else if (!entry.frameId) {
      component.thumbnail = entry.url;
    }
  }
  return components;
}

export function clearThumbnailUrls(components = []) {
  for (const component of components || []) {
    component.thumbnail = "";
    if (component.type === "canvas" && component.canvas) component.canvas.frameThumbnails = {};
  }
  return components;
}

export function stateWithoutThumbnailUrls(state = {}) {
  return {
    ...state,
    ...(Array.isArray(state.components) ? {
      components: state.components.map((component) => ({
        ...component,
        thumbnail: "",
        ...(component.type === "canvas" && component.canvas
          ? { canvas: { ...component.canvas, frameThumbnails: {} } }
          : {}),
      })),
    } : {}),
  };
}

export function createThumbnailUrlLease({
  revoke = (url) => URL.revokeObjectURL(url),
  defer = deferUntilAfterPaint,
} = {}) {
  let active = new Set();
  const retired = new Set();

  function activate(urls = []) {
    const next = new Set(urls || []);
    const previous = active;
    active = next;
    const stale = [...previous].filter((url) => !next.has(url));
    for (const url of stale) retired.add(url);
    if (stale.length) defer(() => {
      for (const url of stale) {
        if (active.has(url) || !retired.delete(url)) continue;
        revoke(url);
      }
    });
  }

  function release() {
    for (const url of new Set([...active, ...retired])) revoke(url);
    active.clear();
    retired.clear();
  }

  return { activate, release };
}

function deferUntilAfterPaint(callback) {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(callback, 0);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(callback));
}
