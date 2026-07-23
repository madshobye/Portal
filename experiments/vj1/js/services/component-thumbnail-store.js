export const THUMBNAIL_ROOT = "vj1-cache";
export const THUMBNAIL_DIR = "thumbnails";

export function componentThumbnailFilename(componentId, surfaceId = "", extension = "webp") {
  const component = encodeURIComponent(String(componentId || ""));
  const surface = surfaceId ? `__surface__${encodeURIComponent(String(surfaceId))}` : "__component";
  return `${component}${surface}.${extension === "png" ? "png" : "webp"}`;
}

export function parseComponentThumbnailFilename(filename = "") {
  const match = String(filename).match(/^(.+?)(__component|__surface__(.+))\.(webp|png)$/i);
  if (!match) return null;
  try {
    return {
      componentId: decodeURIComponent(match[1]),
      surfaceId: match[3] ? decodeURIComponent(match[3]) : "",
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

export function thumbnailValueToBlob(value) {
  if (typeof Blob === "function" && value instanceof Blob) {
    if (value.type !== "image/webp" && value.type !== "image/png") {
      throw new TypeError("Thumbnail Blob must be WebP or PNG.");
    }
    return value;
  }
  return thumbnailDataUrlToBlob(value);
}

export function thumbnailExtension(blob) {
  return blob?.type === "image/png" ? "png" : "webp";
}

export function applyThumbnailUrls(components = [], entries = []) {
  const byId = new Map((components || []).map((component) => [String(component.id), component]));
  for (const entry of entries || []) {
    const component = byId.get(String(entry.componentId));
    if (!component || !entry.url) continue;
    if (entry.surfaceId && component.type === "scene") {
      component.scene ||= {};
      component.scene.surfaceThumbnails ||= {};
      component.scene.surfaceThumbnails[entry.surfaceId] = entry.url;
    } else if (!entry.surfaceId) {
      component.thumbnail = entry.url;
    }
  }
  return components;
}

export function clearThumbnailUrls(components = []) {
  for (const component of components || []) {
    component.thumbnail = "";
    if (component.type === "scene" && component.scene) component.scene.surfaceThumbnails = {};
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
        ...(component.type === "scene" && component.scene
          ? { scene: { ...component.scene, surfaceThumbnails: {} } }
          : {}),
      })),
    } : {}),
  };
}

export function createThumbnailUrlLease({
  revoke = (url) => URL.revokeObjectURL(url),
  defer = deferUntilAfterPaint,
  isReferenced = thumbnailUrlIsReferenced,
  watchUntilUnused = watchUntilThumbnailUrlUnused,
} = {}) {
  let active = new Set();
  const retired = new Set();
  const watchers = new Map();

  function activate(urls = []) {
    const next = new Set(urls || []);
    const previous = active;
    active = next;
    for (const url of next) {
      watchers.get(url)?.();
      watchers.delete(url);
      retired.delete(url);
    }
    const stale = [...previous].filter((url) => !next.has(url));
    for (const url of stale) retired.add(url);
    if (stale.length) defer(() => {
      for (const url of stale) {
        retireWhenUnused(url);
      }
    });
  }

  function retireWhenUnused(url) {
    if (active.has(url) || !retired.has(url)) return;
    if (isReferenced(url)) {
      if (!watchers.has(url)) {
        watchers.set(url, watchUntilUnused(url, () => {
          watchers.delete(url);
          retireWhenUnused(url);
        }));
      }
      return;
    }
    retired.delete(url);
    revoke(url);
  }

  function release() {
    for (const cancel of watchers.values()) cancel?.();
    watchers.clear();
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

function thumbnailUrlIsReferenced(url) {
  if (!url || typeof document === "undefined") return false;
  return [...document.querySelectorAll("img[src]")].some((image) =>
    image.getAttribute("src") === url || image.currentSrc === url);
}

function watchUntilThumbnailUrlUnused(url, callback) {
  if (
    typeof MutationObserver !== "function"
    || typeof document === "undefined"
    || !document.documentElement
  ) {
    const timer = setTimeout(callback, 250);
    return () => clearTimeout(timer);
  }
  const observer = new MutationObserver(() => {
    if (thumbnailUrlIsReferenced(url)) return;
    observer.disconnect();
    callback();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["src"],
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}
