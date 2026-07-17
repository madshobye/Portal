import { frameSize } from "./render-geometry.js?v=adaptive-component-demand-29";
import { drawCover, isDrawableMedia, pauseVideoPlayback, syncVideoPlayback } from "./media-utils.js?v=video-active-ownership-1";
import { mediaRenditionKey, mediaSourceRevision } from "../services/media-rendition-service.js?v=media-rendition-revision-1";
import { graphicsToPngBlob } from "./thumbnail-utils.js?v=thumbnail-utils-extraction-1";
import { parseObjMesh, parseStlMesh } from "./specialized/model-parsers.js?v=model-geometry-fix-30";
import { disposeRawModelItemResources } from "./specialized/raw-model-webgl-renderer.js?v=media-resource-disposal-1";

export class OutputMediaRuntime {
  constructor({ getRenderSettings, requestMediaFiles, sendMediaRendition, applyGraphicsFont, maxCachedVideos = 8 } = {}) {
    this.getRenderSettings = getRenderSettings || (() => ({}));
    this.requestMediaFiles = requestMediaFiles;
    this.sendMediaRendition = sendMediaRendition;
    this.applyGraphicsFont = applyGraphicsFont || (() => {});
    this.media = new Map();
    this.pendingRenditionSaves = new Set();
    this.lastMediaRequestAt = 0;
    this.cameraCapture = null;
    this.cameraRequested = false;
    this.cameraError = "";
    this.cameraCaptureSignature = "";
    this.cameraRequestToken = 0;
    this.cameraRetryAt = 0;
    this.reportedCameraErrorKey = "";
    this.activeVideos = new Set();
    this.activeVideoItems = new Set();
    this.videoUseSerial = 0;
    this.maxCachedVideos = Math.max(0, Math.floor(Number(maxCachedVideos) || 0));
  }

  importFiles(files) {
    const entries = Array.from(files || []);
    const incomingIds = new Set(entries.map((entry) => {
      const file = entry?.file || entry;
      return entry?.id || file?.relativePath || file?.webkitRelativePath || file?.name || "";
    }).filter(Boolean));
    // The control bridge and embedded preview both send complete media
    // snapshots. Reconcile ownership before loading additions so a deleted
    // file or project switch cannot leave an old texture/model addressable by
    // the same renderer.
    for (const [id, item] of this.media) {
      if (incomingIds.has(id)) continue;
      disposeMediaRuntimeItem(item);
      this.media.delete(id);
    }
    for (const entry of entries) {
      const file = entry?.file || entry;
      const id = entry?.id || file?.relativePath || file?.webkitRelativePath || file?.name;
      if (!id || !file) continue;
      const fileKey = mediaFileFingerprint(file);
      let item = this.media.get(id);
      if (!item || item.fileKey !== fileKey || item.loadError) {
        if (item) disposeMediaRuntimeItem(item);
        item = createMediaRuntimeItem(id, file);
        this.media.set(id, item);
        if (!isVideoRuntimeItem(item)) loadMediaItem(item);
      }
      this.importRenditions(item, entry?.renditions || []);
    }
  }

  importRenditions(item, renditions) {
    if (!item || !Array.isArray(renditions)) return;
    item.imageRenditions ||= new Map();
    item.imageRenditionOrder ||= [];
    item.renditionUrls ||= new Map();
    item.persistedRenditionKeys ||= new Set();
    const incoming = new Map((renditions || [])
      .filter((rendition) => rendition?.key && rendition?.file)
      .map((rendition) => [rendition.key, rendition]));
    for (const key of item.persistedRenditionKeys) {
      if (incoming.has(key)) continue;
      item.imageRenditions.get(key)?.remove?.();
      item.imageRenditions.delete(key);
      item.imageRenditionOrder = item.imageRenditionOrder.filter((entry) => entry !== key);
      releaseRenditionUrl(item, key);
    }
    item.persistedRenditionKeys = new Set(incoming.keys());
    for (const rendition of incoming.values()) {
      if (!rendition?.key || !rendition?.file || item.imageRenditions.has(rendition.key)) continue;
      const url = URL.createObjectURL(rendition.file);
      item.renditionUrls.set(rendition.key, url);
      const loadToken = item.loadToken;
      loadImage(
        url,
        (image) => {
          if (item.loadToken !== loadToken || item.renditionUrls.get(rendition.key) !== url) {
            image?.remove?.();
            return;
          }
          item.imageRenditions.set(rendition.key, image);
          if (!item.imageRenditionOrder.includes(rendition.key)) item.imageRenditionOrder.push(rendition.key);
          releaseRenditionUrl(item, rendition.key, url);
        },
        () => {
          releaseRenditionUrl(item, rendition.key, url);
        }
      );
    }
  }

  ensureCameraCapture() {
    const render = this.getRenderSettings();
    const settings = cameraCaptureSettings(render);
    const signature = cameraSettingsSignature(render);
    if (this.cameraCapture && this.cameraCaptureSignature === signature) return this.cameraCapture;
    if (this.cameraRequested && this.cameraCaptureSignature === signature) return null;
    if (this.cameraError && this.cameraCaptureSignature === signature && runtimeMillis() < this.cameraRetryAt) return null;
    if (this.cameraCapture || this.cameraRequested) this.releaseCameraCapture();
    this.cameraRequested = true;
    this.cameraError = "";
    this.cameraCaptureSignature = signature;
    const requestToken = ++this.cameraRequestToken;
    const setupWebcamera = getPortalWebcameraSetup();
    if (!setupWebcamera) {
      this.setCameraError("camera unavailable", signature);
      this.cameraRequested = false;
      return null;
    }
    setupWebcamera(settings.front, settings.width, settings.height, settings.mirrored, settings.maxResolution)
      .then((camera) => {
        if (requestToken !== this.cameraRequestToken) {
          camera?.remove?.();
          return;
        }
        this.cameraCapture = camera;
        this.cameraRequested = false;
        this.cameraError = "";
        this.cameraRetryAt = 0;
        this.reportedCameraErrorKey = "";
      })
      .catch((error) => {
        if (requestToken !== this.cameraRequestToken) return;
        this.setCameraError(error?.message || "camera blocked", signature);
        this.cameraRequested = false;
      });
    return null;
  }

  releaseCameraCapture() {
    this.cameraRequestToken++;
    this.cameraCapture?.remove?.();
    this.cameraCapture = null;
    this.cameraRequested = false;
    this.cameraCaptureSignature = "";
    this.cameraRetryAt = 0;
  }

  setCameraError(message, signature = this.cameraCaptureSignature) {
    this.cameraError = message || "camera unavailable";
    this.cameraRetryAt = runtimeMillis() + 3000;
    const key = `${signature}:${this.cameraError}`;
    if (this.reportedCameraErrorKey === key) return;
    this.reportedCameraErrorKey = key;
    console.error("[VJ1_CAMERA_CAPTURE_FAILED]", {
      signature,
      message: this.cameraError,
      retryMs: 3000,
    });
  }

  requestMissingMedia(mediaId) {
    this.requestMissingMediaBatch(mediaId ? [mediaId] : []);
  }

  beginFrame() {
    this.activeVideos.clear();
    this.activeVideoItems.clear();
  }

  acquireVideo(item, options = {}) {
    if (!isVideoRuntimeItem(item)) return null;
    item.lastVideoUse = ++this.videoUseSerial;
    this.activeVideoItems.add(item);
    ensureVideoRuntimeItemLoaded(item);
    if (!item.video) return null;
    this.claimVideoPlayback(item.video, options);
    return item.video;
  }

  claimVideoPlayback(video, options = {}) {
    if (!video) return;
    this.activeVideos.add(video);
    syncVideoPlayback(video, options);
  }

  endFrame() {
    for (const item of this.media.values()) {
      if (item?.video && !this.activeVideos.has(item.video)) pauseVideoPlayback(item.video);
    }
    this.evictInactiveVideos();
  }

  evictInactiveVideos() {
    const loaded = Array.from(this.media.values()).filter((item) => item?.video);
    const inactive = loaded
      .filter((item) => !this.activeVideoItems.has(item))
      .sort((a, b) => (Number(a.lastVideoUse) || 0) - (Number(b.lastVideoUse) || 0));
    let excess = loaded.length - Math.max(this.maxCachedVideos, this.activeVideoItems.size);
    for (const item of inactive) {
      if (excess-- <= 0) break;
      unloadVideoRuntimeItem(item);
    }
  }

  requestMissingMediaBatch(mediaIds = []) {
    const ids = Array.from(new Set((mediaIds || []).filter(Boolean)));
    if (!ids.length || runtimeMillis() - this.lastMediaRequestAt < 1200) return;
    this.lastMediaRequestAt = runtimeMillis();
    this.requestMediaFiles?.(ids);
  }

  getImageRendition(item, rw, rh) {
    if (!item?.image || !isDrawableMedia(item.image)) return null;
    const widthPx = Math.max(1, Math.floor(Number(rw) || 1));
    const heightPx = Math.max(1, Math.floor(Number(rh) || 1));
    const key = mediaRenditionKey(item.id, widthPx, heightPx, item.sourceRevision);
    const existing = item.imageRenditions?.get?.(key);
    if (existing) return existing;
    const source = item.image.elt || item.image;
    const sourceWidth = source.naturalWidth || source.width || item.image.width || widthPx;
    const sourceHeight = source.naturalHeight || source.height || item.image.height || heightPx;
    if (sourceWidth <= widthPx * 1.15 && sourceHeight <= heightPx * 1.15) return item.image;
    const pg = createGraphics(widthPx, heightPx);
    pg.pixelDensity?.(1);
    this.applyGraphicsFont(pg);
    pg.push();
    pg.clear();
    drawCover(pg, item.image, 0, 0, widthPx, heightPx);
    pg.pop();
    item.imageRenditions ||= new Map();
    item.imageRenditionOrder ||= [];
    item.imageRenditions.set(key, pg);
    item.imageRenditionOrder.push(key);
    this.queueMediaRenditionSave(item.id, widthPx, heightPx, pg, item.sourceRevision);
    while (item.imageRenditionOrder.length > 4) {
      const staleKey = item.imageRenditionOrder.shift();
      const stale = item.imageRenditions.get(staleKey);
      item.imageRenditions.delete(staleKey);
      stale?.remove?.();
    }
    return pg;
  }

  queueMediaRenditionSave(mediaId, widthPx, heightPx, pg, sourceRevision = "") {
    if (!this.sendMediaRendition || !pg || !mediaId) return;
    const key = mediaRenditionKey(mediaId, widthPx, heightPx, sourceRevision);
    if (this.pendingRenditionSaves.has(key)) return;
    this.pendingRenditionSaves.add(key);
    graphicsToPngBlob(pg)
      .then((blob) => {
        const current = this.media.get(mediaId);
        if (!blob || !current || current.sourceRevision !== sourceRevision) return false;
        return this.sendMediaRendition(mediaId, widthPx, heightPx, blob, sourceRevision);
      })
      .then((saved) => {
        if (!saved) this.pendingRenditionSaves.delete(key);
      })
      .catch(() => {
        this.pendingRenditionSaves.delete(key);
      });
  }

  dispose() {
    this.releaseCameraCapture();
    for (const item of this.media.values()) disposeMediaRuntimeItem(item);
    this.media.clear();
    this.pendingRenditionSaves.clear();
    this.activeVideos.clear();
    this.activeVideoItems.clear();
  }
}

function runtimeMillis() {
  return typeof globalThis.millis === "function" ? globalThis.millis() : Date.now();
}

export function cameraCaptureSettings(render = {}) {
  const frame = frameSize(render);
  const camera = render?.camera || {};
  return {
    width: Math.max(160, Math.min(7680, Math.floor(Number(camera.width) || frame.width))),
    height: Math.max(120, Math.min(4320, Math.floor(Number(camera.height) || frame.height))),
    front: camera.facingMode !== "environment",
    mirrored: camera.mirrored === true,
    maxResolution: camera.maxResolution === true,
  };
}

export function cameraSettingsSignature(render = {}) {
  const camera = cameraCaptureSettings(render);
  return `${camera.width}x${camera.height}:${camera.front ? "front" : "rear"}:${camera.mirrored ? "mirror" : "normal"}:${camera.maxResolution ? "max" : "target"}`;
}

export function mediaFileFingerprint(file = {}) {
  return `${file.name || ""}:${file.size || 0}:${file.lastModified || 0}:${file.type || ""}`;
}

function createMediaRuntimeItem(id, file) {
  return {
    id,
    file,
    fileKey: mediaFileFingerprint(file),
    sourceRevision: mediaSourceRevision(file),
    url: null,
    loadToken: 0,
    revision: 0,
    loadError: "",
    video: null,
    image: null,
    imageError: "",
    model: null,
    modelData: null,
    modelGeometry: null,
    modelGeometryFailed: false,
    modelPointCloud: null,
    modelPointCloudKey: "",
    modelRawRenderers: null,
    modelError: "",
    imageRenditions: new Map(),
    imageRenditionOrder: [],
    persistedRenditionKeys: new Set(),
    ready: false,
    lastVideoUse: 0,
  };
}

function loadMediaItem(item) {
  if (!item.url) item.url = URL.createObjectURL(item.file);
  const loadToken = ++item.loadToken;
  const isCurrent = () => item.loadToken === loadToken;
  const markReady = () => {
    if (!isCurrent()) return false;
    if (item.ready && !item.loadError) return true;
    item.ready = true;
    item.loadError = "";
    item.revision++;
    return true;
  };
  const markError = (error, fallback) => {
    if (!isCurrent()) return;
    const message = error?.message || String(error || fallback);
    if (item.loadError === message) return;
    item.ready = false;
    item.loadError = message;
    item.revision++;
    console.error("[VJ1_MEDIA_LOAD_FAILED]", {
      id: item.id,
      fileKey: item.fileKey,
      loadToken,
      message,
    });
  };
  if (/\.svg$/i.test(item.id)) {
    loadSvgImage(item.url, item, { isCurrent, markReady, markError });
  } else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(item.id)) {
    loadImage(item.url, (image) => {
      if (!isCurrent()) return;
      item.image = image;
      item.imageError = "";
      markReady();
    }, (error) => {
      if (!isCurrent()) return;
      item.imageError = error?.message || String(error || "image load failed");
      markError(error, "image load failed");
    });
  } else if (/\.stl$/i.test(item.id)) {
    item.file.arrayBuffer()
      .then((buffer) => {
        if (!isCurrent()) return;
        item.modelData = parseStlMesh(buffer);
        item.modelError = "";
        markReady();
      })
      .catch((error) => {
        item.modelError = error?.message || String(error || "model load failed");
        markError(error, "model load failed");
      });
  } else if (/\.obj$/i.test(item.id)) {
    item.file.text()
      .then((text) => {
        if (!isCurrent()) return;
        item.modelData = parseObjMesh(text);
        item.modelError = "";
        markReady();
      })
      .catch((error) => {
        item.modelError = error?.message || String(error || "model load failed");
        markError(error, "model load failed");
      });
  } else {
    markError(null, "unsupported media type");
  }
}

function isVideoRuntimeItem(item) {
  return !!item && (/\.(mp4|m4v|mov|webm|ogv)$/i.test(item.id || "") || /^video\//i.test(item.file?.type || ""));
}

function ensureVideoRuntimeItemLoaded(item) {
  if (!isVideoRuntimeItem(item) || item.video) return item?.video || null;
  const loadToken = ++item.loadToken;
  const isCurrent = () => item.loadToken === loadToken;
  item.url = URL.createObjectURL(item.file);
  const markReady = () => {
    if (!isCurrent()) return false;
    if (!item.ready || item.loadError) item.revision++;
    item.ready = true;
    item.loadError = "";
    return true;
  };
  const markError = (error) => {
    if (!isCurrent()) return;
    const message = error?.message || String(error || "video load failed");
    item.ready = false;
    item.loadError = message;
    item.revision++;
    console.error("[VJ1_MEDIA_LOAD_FAILED]", {
      id: item.id,
      fileKey: item.fileKey,
      loadToken,
      message,
    });
  };
  item.video = createVideo(item.url, () => {
    if (!isCurrent()) return;
    item.video?.hide?.();
    item.video?.volume?.(0);
    markReady();
  });
  item.video?.hide?.();
  const element = item.video?.elt;
  if (element) {
    // The decoder only exists after an active render source acquires it.
    // Playback is still separately owned by the current rendered frame.
    element.muted = true;
    element.defaultMuted = true;
    element.playsInline = true;
    element.preload = "auto";
    element.setAttribute?.("muted", "");
    element.setAttribute?.("playsinline", "");
  }
  element?.addEventListener?.("loadeddata", markReady, { once: true });
  element?.addEventListener?.("canplay", markReady, { once: true });
  element?.addEventListener?.("error", () => markError(element?.error), { once: true });
  return item.video;
}

function getPortalWebcameraSetup() {
  if (typeof globalThis.setupWebcamera === "function") return globalThis.setupWebcamera;
  try {
    return Function("return typeof setupWebcamera === 'function' ? setupWebcamera : null")();
  } catch {
    return null;
  }
}

function loadSvgImage(url, item, lifecycle) {
  const image = new Image();
  image.onload = () => {
    if (!lifecycle.isCurrent()) return;
    item.image = image;
    item.imageError = "";
    lifecycle.markReady();
  };
  image.onerror = (error) => {
    if (!lifecycle.isCurrent()) return;
    item.imageError = error?.message || "svg load failed";
    lifecycle.markError(error, "svg load failed");
  };
  image.decoding = "async";
  image.src = url;
}

function disposeMediaRuntimeItem(item) {
  if (!item) return;
  unloadVideoRuntimeItem(item);
  item.loadToken++;
  disposeRawModelItemResources(item);
  if (item.url) URL.revokeObjectURL(item.url);
  item.url = null;
  for (const url of item.renditionUrls?.values?.() || []) URL.revokeObjectURL(url);
  for (const rendition of item.imageRenditions?.values?.() || []) rendition?.remove?.();
  item.imageRenditions?.clear?.();
  item.persistedRenditionKeys?.clear?.();
}

function unloadVideoRuntimeItem(item) {
  if (!item?.video && !isVideoRuntimeItem(item)) return;
  item.loadToken++;
  item.video?.stop?.();
  item.video?.remove?.();
  item.video = null;
  item.ready = false;
  if (item.url) URL.revokeObjectURL(item.url);
  item.url = null;
}

function releaseRenditionUrl(item, key, expectedUrl = null) {
  const url = item?.renditionUrls?.get?.(key);
  if (!url || (expectedUrl && url !== expectedUrl)) return;
  URL.revokeObjectURL(url);
  item.renditionUrls.delete(key);
}
