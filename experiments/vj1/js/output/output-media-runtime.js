import { frameSize } from "./render-geometry.js?v=adaptive-component-demand-29";
import { drawCover, isDrawableMedia, pauseVideoPlayback, syncVideoPlayback } from "./media-utils.js?v=video-active-ownership-1";
import { mediaRenditionKey, mediaSourceRevision } from "../services/media-rendition-service.js?v=madstodo-4";
import { graphicsToPngBlob } from "./thumbnail-utils.js?v=thumbnail-utils-extraction-1";
import { parseObjMesh, parseStlMesh } from "./specialized/model-parsers.js?v=model-geometry-fix-30";
import { disposeRawModelItemResources } from "./specialized/raw-model-webgl-renderer.js?v=media-resource-disposal-1";
import { readRasterDimensions } from "./raster-metadata.js?v=media-demand-6";

export class OutputMediaRuntime {
  constructor({
    getRenderSettings,
    requestMediaFiles,
    sendMediaRendition,
    applyGraphicsFont,
    maxCachedMedia = 12,
    maxCachedMediaBytes = 256 * 1024 * 1024,
  } = {}) {
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
    this.activeMediaItems = new Set();
    this.mediaUseSerial = 0;
    this.maxCachedMedia = Math.max(0, Math.floor(Number(maxCachedMedia) || 0));
    this.maxCachedMediaBytes = Math.max(0, Math.floor(Number(maxCachedMediaBytes) || 0));
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
      }
      this.importRenditions(item, entry?.renditions || []);
    }
  }

  importRenditions(item, renditions) {
    if (!item || !Array.isArray(renditions)) return;
    item.imageRenditions ||= new Map();
    item.imageRenditionOrder ||= [];
    item.renditionUrls ||= new Map();
    item.persistedRenditions ||= new Map();
    const incoming = new Map((renditions || [])
      .filter((rendition) => rendition?.key && rendition?.file)
      .map((rendition) => [rendition.key, rendition]));
    for (const key of item.persistedRenditions.keys()) {
      if (incoming.has(key)) continue;
      item.imageRenditions.get(key)?.remove?.();
      item.imageRenditions.delete(key);
      item.imageRenditionOrder = item.imageRenditionOrder.filter((entry) => entry !== key);
      releaseRenditionUrl(item, key);
    }
    // Persist only the File handles here. A rendition gets an object URL and
    // decoded image only if an active render request asks for its exact key.
    item.persistedRenditions = incoming;
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
    this.activeMediaItems.clear();
  }

  acquireMedia(item, { playback = null, width = 0 } = {}) {
    if (!item) return null;
    item.lastMediaUse = ++this.mediaUseSerial;
    this.activeMediaItems.add(item);
    recordRasterDemand(item, width);
    ensureMediaRuntimeItemLoaded(item, { width: item.imageDemandWidth || width });
    if (isVideoRuntimeItem(item) && item.video && playback) this.claimVideoPlayback(item.video, playback);
    return item;
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
    this.evictInactiveMedia();
  }

  evictInactiveMedia() {
    const loaded = Array.from(this.media.values()).filter(isMediaRuntimeItemLoaded);
    const inactive = loaded
      .filter((item) => !this.activeMediaItems.has(item))
      .sort((a, b) => (Number(a.lastMediaUse) || 0) - (Number(b.lastMediaUse) || 0));
    let loadedBytes = loaded.reduce((total, item) => total + estimateMediaRuntimeBytes(item), 0);
    let excess = loaded.length - Math.max(this.maxCachedMedia, this.activeMediaItems.size);
    for (const item of inactive) {
      if (excess <= 0 && loadedBytes <= this.maxCachedMediaBytes) break;
      loadedBytes -= estimateMediaRuntimeBytes(item);
      excess--;
      unloadMediaRuntimeItem(item);
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
    if (item.persistedRenditions?.has?.(key)) {
      ensurePersistedRenditionLoaded(item, key);
      return item.image;
    }
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
    this.activeMediaItems.clear();
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
    imageVariantWidth: 0,
    imageSourceWidth: 0,
    imageDemandWidth: 0,
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
    persistedRenditions: new Map(),
    ready: false,
    loading: false,
    lastMediaUse: 0,
  };
}

function loadMediaItem(item, request = {}) {
  if (item.loading) return;
  item.loading = true;
  const loadToken = ++item.loadToken;
  const isCurrent = () => item.loadToken === loadToken;
  const markReady = () => {
    if (!isCurrent()) return false;
    item.loading = false;
    item.ready = true;
    item.loadError = "";
    item.revision++;
    return true;
  };
  const markError = (error, fallback) => {
    if (!isCurrent()) return;
    item.loading = false;
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
    if (!item.url) item.url = URL.createObjectURL(item.file);
    loadSvgImage(item.url, item, { isCurrent, markReady, markError });
  } else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(item.id)) {
    loadRasterImage(item, request, { isCurrent, markReady, markError });
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

function ensureMediaRuntimeItemLoaded(item, request = {}) {
  if (!item || !item.file || item.loading || item.loadError) return item;
  if (shouldUpgradeRasterVariant(item)) {
    loadMediaItem(item, { width: item.imageDemandWidth });
    return item;
  }
  if (isMediaRuntimeItemLoaded(item)) return item;
  if (isVideoRuntimeItem(item)) ensureVideoRuntimeItemLoaded(item);
  else loadMediaItem(item, request);
  return item;
}

function loadRasterImage(item, request, lifecycle) {
  const resizeWidth = rasterVariantWidth(request?.width);
  const canResizeDecode = !/\.gif$/i.test(item.id || "") && resizeWidth > 0 &&
    typeof globalThis.createImageBitmap === "function" && typeof globalThis.createImage === "function";
  if (!canResizeDecode) {
    loadRasterImageFromUrl(item, lifecycle);
    return;
  }
  if (item.file?.slice) {
    readRasterDimensions(item.file).then((dimensions) => {
      if (!lifecycle.isCurrent()) return;
      if (!dimensions) {
        console.warn("[VJ1_MEDIA_DIMENSION_PROBE_FAILED]", {
          id: item.id,
          message: "unsupported or incomplete raster header; using native decode",
        });
        loadRasterImageFromUrl(item, lifecycle);
        return;
      }
      item.imageSourceWidth = dimensions.width;
      if (dimensions.width <= resizeWidth) {
        loadRasterImageFromUrl(item, lifecycle);
        return;
      }
      decodeRasterVariant(item, resizeWidth, lifecycle);
    }).catch((error) => {
      if (!lifecycle.isCurrent()) return;
      console.warn("[VJ1_MEDIA_DIMENSION_PROBE_FAILED]", {
        id: item.id,
        message: error?.message || String(error || "raster header read failed"),
      });
      loadRasterImageFromUrl(item, lifecycle);
    });
    return;
  }
  decodeRasterVariant(item, resizeWidth, lifecycle);
}

function decodeRasterVariant(item, resizeWidth, lifecycle) {
  globalThis.createImageBitmap(item.file, {
    resizeWidth,
    resizeQuality: "high",
  }).then((bitmap) => {
    if (!lifecycle.isCurrent()) {
      bitmap?.close?.();
      return;
    }
    const image = globalThis.createImage(bitmap.width, bitmap.height);
    const context = image?.canvas?.getContext?.("2d") || image?.drawingContext;
    if (!image || typeof context?.drawImage !== "function") {
      bitmap?.close?.();
      throw new TypeError("resized image target has no Canvas2D context");
    }
    const bitmapWidth = bitmap.width;
    const bitmapHeight = bitmap.height;
    context.drawImage(bitmap, 0, 0, bitmapWidth, bitmapHeight);
    bitmap.close?.();
    image.setModified?.(true);
    replaceRuntimeImage(item, image);
    item.imageError = "";
    item.imageVariantWidth = bitmapWidth;
    lifecycle.markReady();
  }).catch((error) => {
    if (!lifecycle.isCurrent()) return;
    console.warn("[VJ1_MEDIA_RESIZE_DECODE_FALLBACK]", {
      id: item.id,
      requestedWidth: resizeWidth,
      message: error?.message || String(error || "resize decode failed"),
    });
    loadRasterImageFromUrl(item, lifecycle);
  });
}

function loadRasterImageFromUrl(item, lifecycle) {
  if (!item.url) item.url = URL.createObjectURL(item.file);
  loadImage(item.url, (image) => {
    if (!lifecycle.isCurrent()) return;
    replaceRuntimeImage(item, image);
    item.imageError = "";
    item.imageVariantWidth = Number(image?.width) || Number(image?.naturalWidth) || 0;
    item.imageSourceWidth = Number(image?.naturalWidth) || Number(image?.width) || item.imageVariantWidth;
    lifecycle.markReady();
  }, (error) => {
    if (!lifecycle.isCurrent()) return;
    item.imageError = error?.message || String(error || "image load failed");
    lifecycle.markError(error, "image load failed");
  });
}

function isVideoRuntimeItem(item) {
  return !!item && (/\.(mp4|m4v|mov|webm|ogv)$/i.test(item.id || "") || /^video\//i.test(item.file?.type || ""));
}

function ensureVideoRuntimeItemLoaded(item) {
  if (!isVideoRuntimeItem(item) || item.loading || item.video) return item?.video || null;
  item.loading = true;
  const loadToken = ++item.loadToken;
  const isCurrent = () => item.loadToken === loadToken;
  item.url = URL.createObjectURL(item.file);
  const markReady = () => {
    if (!isCurrent()) return false;
    item.loading = false;
    if (!item.ready || item.loadError) item.revision++;
    item.ready = true;
    item.loadError = "";
    return true;
  };
  const markError = (error) => {
    if (!isCurrent()) return;
    item.loading = false;
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

function ensurePersistedRenditionLoaded(item, key) {
  const rendition = item?.persistedRenditions?.get?.(key);
  if (!rendition?.file || item.imageRenditions?.has?.(key) || item.renditionUrls?.has?.(key)) return;
  const url = URL.createObjectURL(rendition.file);
  item.renditionUrls.set(key, url);
  const loadToken = item.loadToken;
  loadImage(
    url,
    (image) => {
      if (item.loadToken !== loadToken || item.renditionUrls.get(key) !== url) {
        image?.remove?.();
        return;
      }
      item.imageRenditions.set(key, image);
      if (!item.imageRenditionOrder.includes(key)) item.imageRenditionOrder.push(key);
      releaseRenditionUrl(item, key, url);
      // Stable render nodes key their output by the media revision. Without
      // this bump, an asynchronously decoded persisted rendition could remain
      // invisible behind the base-image cache indefinitely.
      item.revision++;
    },
    () => releaseRenditionUrl(item, key, url)
  );
}

function getPortalWebcameraSetup() {
  if (typeof globalThis.setupWebcamera === "function") return globalThis.setupWebcamera;
  try {
    return Function("return typeof setupWebcamera === 'function' ? setupWebcamera : null")();
  } catch (error) {
    console.warn("[VJ1_CAMERA_SETUP_LOOKUP_FAILED]", { fallback: "camera source unavailable", message: error?.message || String(error) });
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
  unloadMediaRuntimeItem(item);
  for (const url of item.renditionUrls?.values?.() || []) URL.revokeObjectURL(url);
  for (const rendition of item.imageRenditions?.values?.() || []) rendition?.remove?.();
  item.imageRenditions?.clear?.();
  item.persistedRenditions?.clear?.();
}

function unloadMediaRuntimeItem(item) {
  if (!item) return;
  item.loadToken++;
  item.loading = false;
  item.video?.stop?.();
  item.video?.remove?.();
  item.video = null;
  item.image?.remove?.();
  if (typeof Image !== "undefined" && item.image instanceof Image) item.image.src = "";
  item.image = null;
  item.imageVariantWidth = 0;
  item.imageSourceWidth = 0;
  item.imageDemandWidth = 0;
  disposeRawModelItemResources(item);
  item.model = null;
  item.modelData = null;
  item.modelGeometry = null;
  item.modelGeometryFailed = false;
  item.modelPointCloud = null;
  item.modelPointCloudKey = "";
  item.ready = false;
  if (item.url) URL.revokeObjectURL(item.url);
  item.url = null;
  for (const url of item.renditionUrls?.values?.() || []) URL.revokeObjectURL(url);
  item.renditionUrls?.clear?.();
  for (const rendition of item.imageRenditions?.values?.() || []) rendition?.remove?.();
  item.imageRenditions?.clear?.();
  item.imageRenditionOrder = [];
  item.revision++;
}

function isMediaRuntimeItemLoaded(item) {
  return !!(item && (item.video || item.image || item.model || item.modelData || item.url));
}

function recordRasterDemand(item, width) {
  if (!isRasterRuntimeItem(item)) return;
  item.imageDemandWidth = Math.max(Number(item.imageDemandWidth) || 0, rasterVariantWidth(width));
}

function rasterVariantWidth(width) {
  const requestedWidth = Math.max(0, Math.floor(Number(width) || 0));
  return requestedWidth
    ? Math.max(512, Math.min(4096, Math.ceil(requestedWidth / 256) * 256))
    : 0;
}

function shouldUpgradeRasterVariant(item) {
  if (!isRasterRuntimeItem(item) || !item.image) return false;
  const demand = Number(item.imageDemandWidth) || 0;
  const variant = Number(item.imageVariantWidth) || Number(item.image?.width) || 0;
  const source = Number(item.imageSourceWidth) || 0;
  if (!demand || demand <= variant) return false;
  return !source || source > variant;
}

function isRasterRuntimeItem(item) {
  return !!item && /\.(png|jpe?g|gif|webp|bmp)$/i.test(item.id || "");
}

function replaceRuntimeImage(item, image) {
  const previous = item.image;
  item.image = image;
  if (previous && previous !== image) previous.remove?.();
}

function estimateMediaRuntimeBytes(item) {
  if (!item) return 0;
  if (item.video) {
    const element = item.video.elt || item.video;
    const width = Math.max(1, Number(element.videoWidth) || Number(element.width) || 1);
    const height = Math.max(1, Number(element.videoHeight) || Number(element.height) || 1);
    // A decoder commonly retains multiple YUV/RGBA frames. This conservative
    // estimate is for eviction pressure, not accounting telemetry.
    return Math.max(Number(item.file?.size) || 0, width * height * 12);
  }
  if (item.image) {
    const element = item.image.elt || item.image;
    const width = Math.max(1, Number(element.naturalWidth) || Number(element.width) || Number(item.image.width) || 1);
    const height = Math.max(1, Number(element.naturalHeight) || Number(element.height) || Number(item.image.height) || 1);
    const derivedBytes = Array.from(item.imageRenditions?.values?.() || [])
      .reduce((total, rendition) => total + estimateDrawableBytes(rendition), 0);
    return Math.max(Number(item.file?.size) || 0, width * height * 4) + derivedBytes;
  }
  if (item.modelData || item.model) return Math.max(Number(item.file?.size) || 0, typedArrayBytes(item.modelData || item.model));
  return Number(item.file?.size) || 0;
}

function estimateDrawableBytes(drawable) {
  const element = drawable?.elt || drawable;
  const width = Math.max(1, Number(element?.naturalWidth) || Number(element?.width) || Number(drawable?.width) || 1);
  const height = Math.max(1, Number(element?.naturalHeight) || Number(element?.height) || Number(drawable?.height) || 1);
  return width * height * 4;
}

function typedArrayBytes(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  seen.add(value);
  let total = 0;
  for (const nested of Object.values(value)) total += typedArrayBytes(nested, seen);
  return total;
}

function releaseRenditionUrl(item, key, expectedUrl = null) {
  const url = item?.renditionUrls?.get?.(key);
  if (!url || (expectedUrl && url !== expectedUrl)) return;
  URL.revokeObjectURL(url);
  item.renditionUrls.delete(key);
}
