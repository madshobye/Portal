import { createModelPreviewBlob } from "../libraries/mesh-engine/convert-3d-file-to-image/index.js";
import { mediaSourceRevision } from "./media-rendition-service.js";

const MODEL_RE = /\.(stl|obj)$/i;
const VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
const SVG_RE = /\.svg$/i;
const MEDIA_THUMBNAIL_WIDTH = 320;
const MEDIA_THUMBNAIL_HEIGHT = 180;
const MEDIA_THUMBNAIL_QUALITY = 0.86;

// Owns picker thumbnail URLs independently from any retained UI instance.
// Every supported media type becomes a bounded, project-cached derived asset;
// catalog cards never decode or display the full source file directly.
export function createMediaThumbnailHandler({
  createThumbnail = createMediaThumbnailBlob,
  createObjectUrl = (file) => URL.createObjectURL(file),
  revokeObjectUrl = (url) => URL.revokeObjectURL(url),
  maxConcurrentGenerations = 2,
} = {}) {
  const entries = new Map();
  const generationQueue = [];
  let activeGenerations = 0;
  let storage = null;

  function setStorage(nextStorage) {
    storage = nextStorage && typeof nextStorage === "object" ? nextStorage : null;
  }

  function acquire(id, file) {
    const key = String(id || "");
    if (!key || !file) return "";
    const existing = entries.get(key);
    if (existing) return existing.url || existing.promise;

    const sourceRevision = mediaSourceRevision(file);
    const kind = mediaThumbnailKind(key);
    const entry = { url: "", promise: null, invalidated: false };
    entry.promise = resolveThumbnail(key, sourceRevision, kind, file, () => !entry.invalidated).then((blob) => {
      if (!blob) return "";
      const url = createObjectUrl(blob);
      if (entry.invalidated) {
        revokeObjectUrl(url);
        return "";
      }
      entry.url = url;
      return url;
    }).catch((error) => {
      if (entries.get(key) === entry) entries.delete(key);
      console.warn("[VJ1_MEDIA_THUMBNAIL_FAILED]", {
        mediaId: key,
        mediaKind: kind,
        fallback: "show media placeholder",
        message: error?.message || String(error),
      });
      return "";
    });
    entries.set(key, entry);
    return entry.promise;
  }

  async function resolveThumbnail(id, sourceRevision, kind, file, isActive) {
    if (storage?.read) {
      try {
        const cached = await storage.read(id, sourceRevision, thumbnailExtensions(kind));
        if (cached) return cached;
      } catch (error) {
        console.warn("[VJ1_MEDIA_THUMBNAIL_CACHE_READ_FAILED]", {
          mediaId: id,
          fallback: "regenerate thumbnail in memory",
          message: error?.message || String(error),
        });
      }
    }
    const blob = await scheduleGeneration(
      () => createThumbnail(file, { id, kind }),
      isActive,
    );
    if (blob && isActive() && storage?.write) {
      try {
        await storage.write(id, sourceRevision, blob);
      } catch (error) {
        console.warn("[VJ1_MEDIA_THUMBNAIL_CACHE_WRITE_FAILED]", {
          mediaId: id,
          fallback: "retain thumbnail in memory",
          message: error?.message || String(error),
        });
      }
    }
    return blob;
  }

  function scheduleGeneration(generate, isActive) {
    return new Promise((resolve, reject) => {
      generationQueue.push({ generate, isActive, resolve, reject });
      pumpGenerationQueue();
    });
  }

  function pumpGenerationQueue() {
    const limit = Math.max(1, Math.floor(Number(maxConcurrentGenerations) || 1));
    while (activeGenerations < limit && generationQueue.length) {
      const job = generationQueue.shift();
      if (!job.isActive()) {
        job.resolve(null);
        continue;
      }
      activeGenerations++;
      Promise.resolve().then(job.generate).then(job.resolve, job.reject).finally(() => {
        activeGenerations--;
        pumpGenerationQueue();
      });
    }
  }

  function release(id) {
    const key = String(id || "");
    const entry = entries.get(key);
    // Closing a catalog releases its display claim, not the shared derived
    // thumbnail. Source invalidation and project cleanup own final disposal.
    return !!entry;
  }

  function invalidate(id) {
    const key = String(id || "");
    const entry = entries.get(key);
    if (!entry) return false;
    discard(key, entry);
    return true;
  }

  function clear() {
    for (const [key, entry] of entries) discard(key, entry);
  }

  function discard(key, entry) {
    if (entries.get(key) === entry) entries.delete(key);
    entry.invalidated = true;
    if (entry.url) revokeObjectUrl(entry.url);
  }

  return Object.freeze({ acquire, release, invalidate, clear, setStorage });
}

export function mediaThumbnailKind(id) {
  if (MODEL_RE.test(String(id || ""))) return "model";
  if (VIDEO_RE.test(String(id || ""))) return "video";
  return "image";
}

export async function createMediaThumbnailBlob(file, { id = "", kind = mediaThumbnailKind(id) } = {}) {
  if (kind === "model") return createModelPreviewBlob(file);
  if (kind === "video") return createVideoThumbnailBlob(file);
  return createImageThumbnailBlob(file, { id });
}

async function createImageThumbnailBlob(file, { id = "" } = {}) {
  if (SVG_RE.test(String(id || file?.name || "")) || file?.type === "image/svg+xml") {
    return createElementImageThumbnailBlob(file);
  }
  if (typeof globalThis.createImageBitmap !== "function") throw new Error("createImageBitmap is unavailable");
  let bitmap;
  try {
    bitmap = await globalThis.createImageBitmap(file);
    return await rasterSourceToThumbnailBlob(bitmap, bitmap.width, bitmap.height);
  } catch (error) {
    // Chrome can reject otherwise displayable image containers. The retained
    // thumbnail service owns one DOM decode fallback outside render cadence.
    return createElementImageThumbnailBlob(file, error);
  } finally {
    bitmap?.close?.();
  }
}

async function createElementImageThumbnailBlob(file, bitmapError = null) {
  const document = globalThis.document;
  if (!document?.createElement) throw bitmapError || new Error("image thumbnail document is unavailable");
  const image = document.createElement("img");
  const sourceUrl = URL.createObjectURL(file);
  try {
    const loaded = waitForImage(image);
    image.decoding = "async";
    image.src = sourceUrl;
    await loaded;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!(width > 0 && height > 0)) throw new Error("decoded image has no intrinsic thumbnail size");
    return await rasterSourceToThumbnailBlob(image, width, height);
  } finally {
    image.removeAttribute?.("src");
    URL.revokeObjectURL(sourceUrl);
  }
}

function waitForImage(image) {
  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("image thumbnail decode failed")), { once: true });
  });
}

async function createVideoThumbnailBlob(file) {
  const document = globalThis.document;
  if (!document?.createElement) throw new Error("video thumbnail document is unavailable");
  const video = document.createElement("video");
  const sourceUrl = URL.createObjectURL(file);
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    video.src = sourceUrl;
    video.load?.();
    if (video.readyState < 1) await waitForVideo(video, "loadedmetadata");
    const duration = Number(video.duration);
    const target = Number.isFinite(duration) && duration > 0 ? Math.min(1, duration * 0.1) : 0;
    if (target > 0.01) {
      video.currentTime = target;
      await waitForVideo(video, "seeked");
    } else if (video.readyState < 2) {
      await waitForVideo(video, "loadeddata");
    }
    return await rasterSourceToThumbnailBlob(video, video.videoWidth, video.videoHeight);
  } finally {
    video.pause?.();
    video.removeAttribute?.("src");
    video.load?.();
    URL.revokeObjectURL(sourceUrl);
  }
}

function waitForVideo(video, eventName) {
  return new Promise((resolve, reject) => {
    const onReady = () => finish(resolve);
    const onError = () => finish(() => reject(video.error || new Error(`Video ${eventName} failed`)));
    const timer = setTimeout(() => finish(() => reject(new Error(`Video ${eventName} timed out`))), 15000);
    const finish = (complete) => {
      clearTimeout(timer);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
      complete();
    };
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function rasterSourceToThumbnailBlob(source, sourceWidth, sourceHeight) {
  const size = fittedSize(sourceWidth, sourceHeight);
  const canvas = createThumbnailCanvas(size.width, size.height);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context?.drawImage) throw new Error("Canvas2D thumbnail context is unavailable");
  context.drawImage(source, 0, 0, size.width, size.height);
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/webp", quality: MEDIA_THUMBNAIL_QUALITY });
  }
  const webp = await canvasToBlob(canvas, "image/webp", MEDIA_THUMBNAIL_QUALITY);
  if (webp?.type === "image/webp") return webp;
  return canvasToBlob(canvas, "image/png");
}

function createThumbnailCanvas(width, height) {
  if (typeof globalThis.OffscreenCanvas === "function") return new globalThis.OffscreenCanvas(width, height);
  const canvas = globalThis.document?.createElement?.("canvas");
  if (!canvas) throw new Error("thumbnail canvas is unavailable");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error(`Canvas could not encode ${type}`));
  }, type, quality));
}

function fittedSize(sourceWidth, sourceHeight) {
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const scale = Math.min(1, MEDIA_THUMBNAIL_WIDTH / width, MEDIA_THUMBNAIL_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function thumbnailExtensions(kind) {
  return kind === "model" ? ["svg"] : ["webp", "png"];
}
