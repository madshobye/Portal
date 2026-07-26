import { acceptVideoDecodedFrame, drawCover, isDrawableMedia, pauseVideoPlayback, syncVideoPlayback } from "./media-utils.js";
import { mediaRenditionKey, mediaSourceRevision } from "../services/media-rendition-service.js";
import { graphicsToPngBlob } from "./thumbnail-utils.js";
import { processObjModelBuffer, processStlModelBuffer } from "./specialized/model-processing-client.js";
import { disposeRawModelItemResources, estimateRawModelItemGpuBytes } from "../libraries/mesh-engine/mesh-render/index.js";
import { readRasterDimensions } from "./raster-metadata.js";
import { SharedInputRuntime } from "./shared-input-runtime.js";
import { frameSize } from "./render-geometry.js";

export { cameraCaptureSettings, cameraSettingsSignature } from "./shared-input-runtime.js";

let videoFrameCallbackFailureReported = false;
let rasterDecodeApiFallbackReported = false;
const MAX_IMAGE_VARIANT_WIDTH = 8192;
export const VIDEO_IDLE_GRACE_FRAMES = 120;

export class OutputMediaRuntime {
  constructor({
    getRenderSettings,
    requestMediaFiles,
    sendMediaRendition,
    applyGraphicsFont,
    onInvalidate,
    onMediaMetadata,
    maxCachedMedia = 12,
    maxCachedMediaBytes = 256 * 1024 * 1024,
    cameraIdleGraceMs,
  } = {}) {
    this.getRenderSettings = getRenderSettings || (() => ({}));
    this.requestMediaFiles = requestMediaFiles;
    this.sendMediaRendition = sendMediaRendition;
    this.applyGraphicsFont = applyGraphicsFont || (() => {});
    this.onInvalidate = onInvalidate;
    this.onMediaMetadata = onMediaMetadata;
    this.media = new Map();
    this.pendingRenditionSaves = new Set();
    this.lastMediaRequestAt = 0;
    this.inputRuntime = new SharedInputRuntime({ getRenderSettings: this.getRenderSettings, cameraIdleGraceMs });
    this.activeVideos = new Set();
    this.activeMediaItems = new Set();
    this.reservedMediaIds = new Set();
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
      const sourceRevision = entry?.sourceRevision || mediaSourceRevision(file);
      let item = this.media.get(id);
      if (!item || item.fileKey !== fileKey || item.sourceRevision !== sourceRevision || item.loadError) {
        if (item) disposeMediaRuntimeItem(item);
        item = createMediaRuntimeItem(id, file, sourceRevision);
        this.media.set(id, item);
      }
      item.onInvalidate = this.onInvalidate;
      item.onMediaMetadata = this.onMediaMetadata;
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

  acquireCameraInput() {
    return this.inputRuntime.acquireCamera();
  }

  acquireScreenInput(inputId = "") {
    return this.inputRuntime.acquireScreen(inputId);
  }

  resourceReadiness(requirement = {}) {
    const kind = String(requirement.kind || "");
    if (kind === "camera") return this.inputRuntime.cameraStatus();
    if (kind === "screen-input") {
      return this.inputRuntime.screenStatus(String(requirement.id || ""));
    }
    return null;
  }

  acquireDrawableResource(descriptor = null, width = 0, { playback = null } = {}) {
    if (descriptor?.kind === "screen-input-resource") {
      return this.acquireScreenInput(String(descriptor.inputId || ""));
    }
    if (descriptor?.kind === "camera-input-resource") {
      return this.acquireCameraInput();
    }
    if (descriptor?.kind === "project-media-resource") {
      const mediaId = String(descriptor.mediaId || "");
      const item = mediaId
        ? this.acquireMediaById(mediaId, {
            width,
            playback: playback || {
              start: descriptor.start,
              end: descriptor.end,
              speed: descriptor.speed,
            },
          })
        : null;
      if (!item && mediaId) this.requestMissingMedia(mediaId);
      return item?.video || item?.image || item?.drawable || item || null;
    }
    return descriptor?.drawable || null;
  }

  drawableResourceError(descriptor = null) {
    if (descriptor?.kind === "screen-input-resource") {
      return this.screenError(String(descriptor.inputId || ""));
    }
    if (descriptor?.kind === "camera-input-resource") {
      return this.cameraError || "";
    }
    if (descriptor?.kind === "project-media-resource") {
      const item = this.media.get(String(descriptor.mediaId || ""));
      return item?.loadError || item?.imageError || "";
    }
    return "";
  }

  releaseCameraInput() {
    this.inputRuntime.releaseCamera();
  }

  get cameraCapture() {
    return this.inputRuntime.cameraCapture;
  }

  get cameraError() {
    return this.inputRuntime.cameraError;
  }

  screenError(inputId = "") {
    return this.inputRuntime.screenError(inputId);
  }

  requestMissingMedia(mediaId) {
    this.requestMissingMediaBatch(mediaId ? [mediaId] : []);
  }

  beginFrame() {
    this.inputRuntime.beginFrame();
    this.activeVideos.clear();
    this.activeMediaItems.clear();
  }

  acquireMedia(item, { playback = null, width = 0 } = {}) {
    if (!item) return null;
    this.retainMedia(item);
    recordImageDemand(item, width);
    ensureMediaRuntimeItemLoaded(item, { width: item.imageDemandWidth || width });
    if (isVideoRuntimeItem(item) && item.video && playback) this.claimVideoPlayback(item.video, playback);
    return item;
  }

  // A retained render result still owns its source resource even when the
  // source node itself does not execute this frame. Renewing that lease must
  // be separate from decoding: cache hits keep images, videos, and meshes
  // resident without manufacturing work for resources that were never drawn.
  retainMedia(item) {
    if (!item) return null;
    item.lastMediaUse = ++this.mediaUseSerial;
    item.inactiveFrameCount = 0;
    this.activeMediaItems.add(item);
    return item;
  }

  retainMediaById(mediaId) {
    return this.retainMedia(this.media.get(String(mediaId || "")));
  }

  acquireMediaById(mediaId, options = {}) {
    const defaultWidth = frameSize(this.getRenderSettings() || {}).width;
    return this.acquireMedia(this.media.get(mediaId), {
      ...options,
      width: Math.max(1, Number(options.width) || defaultWidth),
    });
  }

  claimVideoPlayback(video, options = {}) {
    if (!video) return;
    this.activeVideos.add(video);
    syncVideoPlayback(video, options);
  }

  reserveMedia(mediaIds = []) {
    this.reservedMediaIds = new Set(Array.from(mediaIds || []).filter(Boolean));
  }

  endFrame() {
    for (const item of this.media.values()) {
      item.inactiveFrameCount = this.activeMediaItems.has(item) ? 0 : (Number(item.inactiveFrameCount) || 0) + 1;
      if (item?.video && !this.activeVideos.has(item.video)) pauseVideoPlayback(item.video);
    }
    this.evictInactiveMedia();
    this.inputRuntime.endFrame();
  }

  evictInactiveMedia() {
    const loaded = Array.from(this.media.values()).filter(isMediaRuntimeItemLoaded);
    const inactive = loaded
      .filter((item) => !this.activeMediaItems.has(item) && !this.reservedMediaIds.has(item.id))
      .filter((item) => !isVideoRuntimeItem(item)
        || (Number(item.inactiveFrameCount) || 0) >= VIDEO_IDLE_GRACE_FRAMES)
      .sort((a, b) => (Number(a.lastMediaUse) || 0) - (Number(b.lastMediaUse) || 0));
    let loadedBytes = loaded.reduce((total, item) => total + estimateMediaRuntimeBytes(item), 0);
    const protectedCount = loaded.filter((item) => this.activeMediaItems.has(item) || this.reservedMediaIds.has(item.id)).length;
    let excess = loaded.length - Math.max(this.maxCachedMedia, protectedCount);
    for (const item of inactive) {
      const itemBytes = estimateMediaRuntimeBytes(item);
      const heavyweightModelIdle = !!(item.modelData || item.model)
        && itemBytes >= 16 * 1024 * 1024
        && (Number(item.inactiveFrameCount) || 0) >= 30;
      if (excess <= 0 && loadedBytes <= this.maxCachedMediaBytes && !heavyweightModelIdle) continue;
      loadedBytes -= itemBytes;
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
    // SVG is already rasterized at the largest active render demand. Never
    // route it through the persisted raster-rendition cache: an older PNG
    // rendition may have been produced from the SVG's small intrinsic size
    // and would permanently hide a newer, sharper vector rasterization.
    if (isVectorRuntimeItem(item)) return item.image;
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
    this.inputRuntime.dispose();
    for (const item of this.media.values()) disposeMediaRuntimeItem(item);
    this.media.clear();
    this.pendingRenditionSaves.clear();
    this.activeVideos.clear();
    this.activeMediaItems.clear();
    this.reservedMediaIds.clear();
  }
}

function runtimeMillis() {
  return typeof globalThis.millis === "function" ? globalThis.millis() : Date.now();
}

export function mediaFileFingerprint(file = {}) {
  return `${file.name || ""}:${file.size || 0}:${file.lastModified || 0}:${file.type || ""}`;
}

function createMediaRuntimeItem(id, file, sourceRevision = "") {
  return {
    id,
    file,
    fileKey: mediaFileFingerprint(file),
    sourceRevision: sourceRevision || mediaSourceRevision(file),
    url: null,
    loadToken: 0,
    revision: 0,
    loadError: "",
    video: null,
    image: null,
    svgSource: null,
    imageVariantWidth: 0,
    imageVariantDemandWidth: 0,
    imageSourceWidth: 0,
    imageDemandWidth: 0,
    imageError: "",
    model: null,
    modelData: null,
    modelGeometry: null,
    modelGeometryKey: "",
    modelGeometryFailed: false,
    modelPointCloud: null,
    modelPointCloudKey: "",
    modelWireLines: null,
    modelWireLinesKey: "",
    modelThickWireVertices: null,
    modelThickWireVerticesKey: "",
    modelPerceptualEdges: null,
    modelPerceptualEdgesKey: "",
    modelPerceptualWireVertices: null,
    modelPerceptualWireVerticesKey: "",
    modelOutlineFallbackLogged: false,
    modelRawRenderers: null,
    modelError: "",
    loadStatus: "",
    imageRenditions: new Map(),
    imageRenditionOrder: [],
    persistedRenditions: new Map(),
    ready: false,
    loading: false,
    lastMediaUse: 0,
    inactiveFrameCount: 0,
    videoFrameDriven: false,
    videoFrameRevision: 0,
    videoFrameCallbackId: null,
    videoFrameElement: null,
    duration: 0,
    durationUnavailableReported: false,
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
    item.loadStatus = "";
    item.revision++;
    item.onInvalidate?.("media-ready", item);
    return true;
  };
  const markError = (error, fallback) => {
    if (!isCurrent()) return;
    item.loading = false;
    const message = error?.message || String(error || fallback);
    if (item.loadError === message) return;
    item.ready = false;
    item.loadError = message;
    item.loadStatus = "";
    item.revision++;
    item.onInvalidate?.("media-error", item);
    console.error("[VJ1_MEDIA_LOAD_FAILED]", {
      id: item.id,
      fileKey: item.fileKey,
      loadToken,
      message,
    });
  };
  if (/\.svg$/i.test(item.id)) {
    if (!item.url) item.url = URL.createObjectURL(item.file);
    loadSvgImage(item.url, item, request, { isCurrent, markReady, markError });
  } else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(item.id)) {
    loadRasterImage(item, request, { isCurrent, markReady, markError });
  } else if (/\.stl$/i.test(item.id)) {
    item.loadStatus = "reading 3D model";
    item.file.arrayBuffer()
      .then((buffer) => {
        if (!isCurrent()) return;
        item.loadStatus = "processing 3D model";
        return processStlModelBuffer(buffer, { cacheKey: `${item.id}:${item.sourceRevision}` });
      })
      .then((mesh) => {
        if (!isCurrent() || !mesh) return;
        item.modelData = mesh;
        item.modelError = "";
        reportModelLods(item, mesh);
        markReady();
      })
      .catch((error) => {
        item.modelError = error?.message || String(error || "model load failed");
        markError(error, "model load failed");
      });
  } else if (/\.obj$/i.test(item.id)) {
    item.loadStatus = "reading 3D model";
    item.file.arrayBuffer()
      .then((buffer) => {
        if (!isCurrent()) return;
        item.loadStatus = "processing 3D model";
        return processObjModelBuffer(buffer, { cacheKey: `${item.id}:${item.sourceRevision}` });
      })
      .then((mesh) => {
        if (!isCurrent() || !mesh) return;
        item.modelData = mesh;
        item.modelError = "";
        reportModelLods(item, mesh);
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
  if (shouldUpgradeSvgVariant(item)) {
    rasterizeSvgVariant(item, item.imageDemandWidth);
    return item;
  }
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
  const resizeDecodeWanted = !/\.gif$/i.test(item.id || "") && resizeWidth > 0;
  const canResizeDecode = resizeDecodeWanted &&
    typeof globalThis.createImageBitmap === "function" && typeof globalThis.createImage === "function";
  if (!canResizeDecode) {
    if (resizeDecodeWanted && !rasterDecodeApiFallbackReported) {
      rasterDecodeApiFallbackReported = true;
      console.warn("[VJ1_RASTER_RESIZE_DECODE_UNAVAILABLE]", {
        fallback: "decode the native raster through p5 loadImage",
        missing: [
          typeof globalThis.createImageBitmap === "function" ? "" : "createImageBitmap",
          typeof globalThis.createImage === "function" ? "" : "p5 createImage",
        ].filter(Boolean),
      });
    }
    loadRasterImageFromUrl(item, lifecycle);
    return;
  }
  if (item.file?.slice) {
    item.loadStatus = "reading raster metadata";
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
  item.loadStatus = "decoding raster bitmap";
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
  item.loadStatus = "decoding raster URL";
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
  item.loadStatus = "loading video metadata";
  const loadToken = ++item.loadToken;
  const isCurrent = () => item.loadToken === loadToken;
  let element = null;
  item.url = URL.createObjectURL(item.file);
  const markReady = () => {
    if (!isCurrent()) return false;
    const changed = !item.ready || !!item.loadError;
    item.loading = false;
    if (changed) item.revision++;
    item.ready = true;
    item.loadError = "";
    item.loadStatus = "";
    publishVideoDuration(item, element, isCurrent);
    if (changed) item.onInvalidate?.("media-ready", item);
    return true;
  };
  const markError = (error) => {
    if (!isCurrent()) return;
    item.loading = false;
    const message = error?.message || String(error || "video load failed");
    item.ready = false;
    item.loadError = message;
    item.loadStatus = "";
    item.revision++;
    item.onInvalidate?.("media-error", item);
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
  element = item.video?.elt;
  if (element) {
    // The decoder only exists after an active render source acquires it.
    // Playback is still separately owned by the current rendered frame.
    element.muted = true;
    element.defaultMuted = true;
    element.playsInline = true;
    element.preload = "auto";
    element.setAttribute?.("muted", "");
    element.setAttribute?.("playsinline", "");
    startVideoFrameTracking(item, element, isCurrent);
  }
  const publishDuration = () => publishVideoDuration(item, element, isCurrent);
  const reportMissingDuration = () => {
    if (!isCurrent() || item.duration > 0 || item.durationUnavailableReported) return;
    item.durationUnavailableReported = true;
    console.warn("[VJ1_VIDEO_DURATION_UNAVAILABLE]", {
      id: item.id,
      message: "Decoded video metadata did not provide a finite duration; trim controls remain unavailable",
    });
  };
  element?.addEventListener?.("loadedmetadata", publishDuration);
  element?.addEventListener?.("durationchange", publishDuration);
  element?.addEventListener?.("loadeddata", markReady, { once: true });
  element?.addEventListener?.("canplay", markReady, { once: true });
  element?.addEventListener?.("loadeddata", reportMissingDuration, { once: true });
  element?.addEventListener?.("error", () => markError(element?.error), { once: true });
  return item.video;
}

function publishVideoDuration(item, element, isCurrent) {
  if (!isCurrent?.()) return false;
  const duration = Number(element?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (Math.abs(duration - Number(item.duration || 0)) < 0.001) return true;
  item.duration = duration;
  item.durationUnavailableReported = false;
  item.onMediaMetadata?.(item.id, { duration });
  return true;
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
      item.onInvalidate?.("media-rendition-ready", item);
    },
    () => releaseRenditionUrl(item, key, url)
  );
}

function loadSvgImage(url, item, request, lifecycle) {
  const image = new Image();
  image.onload = () => {
    if (!lifecycle.isCurrent()) return;
    item.svgSource = image;
    rasterizeSvgVariant(item, request?.width || item.imageDemandWidth, { bumpRevision: false });
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

function rasterizeSvgVariant(item, width, { bumpRevision = true } = {}) {
  const source = item?.svgSource;
  if (!source) return false;
  const demandWidth = rasterVariantWidth(width) || 512;
  const currentDemandWidth = Number(item.imageVariantDemandWidth) || Number(item.imageVariantWidth) || Number(item.image?.width) || 0;
  if (item.image && demandWidth <= currentDemandWidth) return false;
  const sourceWidth = Math.max(1, Number(source.naturalWidth) || Number(source.width) || 300);
  const sourceHeight = Math.max(1, Number(source.naturalHeight) || Number(source.height) || 150);
  const requestedHeight = Math.max(1, Math.round(demandWidth * sourceHeight / sourceWidth));
  const boundScale = Math.min(1, MAX_IMAGE_VARIANT_WIDTH / Math.max(demandWidth, requestedHeight));
  const targetWidth = Math.max(1, Math.round(demandWidth * boundScale));
  const targetHeight = Math.max(1, Math.round(requestedHeight * boundScale));
  const image = typeof globalThis.createImage === "function"
    ? globalThis.createImage(targetWidth, targetHeight)
    : null;
  const context = image?.canvas?.getContext?.("2d") || image?.drawingContext;
  if (!image || typeof context?.drawImage !== "function") {
    if (!item.image) item.image = source;
    item.imageVariantWidth = sourceWidth;
    item.imageVariantDemandWidth = demandWidth;
    item.imageSourceWidth = Number.POSITIVE_INFINITY;
    return false;
  }
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  image.setModified?.(true);
  replaceRuntimeImage(item, image);
  item.imageVariantWidth = targetWidth;
  item.imageVariantDemandWidth = demandWidth;
  // A vector has no finite source-resolution ceiling. Demand may therefore
  // upgrade the cached raster again without mistaking intrinsic SVG metadata
  // for the maximum useful resolution.
  item.imageSourceWidth = Number.POSITIVE_INFINITY;
  item.ready = true;
  item.loading = false;
  if (bumpRevision) item.revision++;
  return true;
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
  stopVideoFrameTracking(item);
  releaseVideoRuntimeItem(item.video);
  item.video = null;
  item.image?.remove?.();
  if (typeof Image !== "undefined" && item.image instanceof Image) item.image.src = "";
  item.image = null;
  if (typeof Image !== "undefined" && item.svgSource instanceof Image) item.svgSource.src = "";
  item.svgSource = null;
  item.imageVariantWidth = 0;
  item.imageVariantDemandWidth = 0;
  item.imageSourceWidth = 0;
  item.imageDemandWidth = 0;
  disposeRawModelItemResources(item);
  item.model = null;
  item.modelData = null;
  item.modelGeometry = null;
  item.modelGeometryKey = "";
  item.modelGeometryFailed = false;
  item.modelPointCloud = null;
  item.modelPointCloudKey = "";
  item.modelWireLines = null;
  item.modelWireLinesKey = "";
  item.modelThickWireVertices = null;
  item.modelThickWireVerticesKey = "";
  item.modelPerceptualEdges = null;
  item.modelPerceptualEdgesKey = "";
  item.modelPerceptualWireVertices = null;
  item.modelPerceptualWireVerticesKey = "";
  item.modelOutlineFallbackLogged = false;
  item.ready = false;
  item.loadStatus = "";
  if (item.url) URL.revokeObjectURL(item.url);
  item.url = null;
  for (const url of item.renditionUrls?.values?.() || []) URL.revokeObjectURL(url);
  item.renditionUrls?.clear?.();
  for (const rendition of item.imageRenditions?.values?.() || []) rendition?.remove?.();
  item.imageRenditions?.clear?.();
  item.imageRenditionOrder = [];
  item.revision++;
}

function releaseVideoRuntimeItem(video) {
  if (!video) return;
  const element = video.elt;
  // A p5.MediaElement may be removed from the DOM while its underlying video
  // and <source> nodes still own the blob URL. Revoking that URL first leaves
  // Chrome free to complete or retry a queued decoder request against an
  // invalid address. Retire decoder ownership in the opposite order: stop,
  // detach all DOM sources, force the media resource selection algorithm to
  // release them, then let the wrapper remove its element.
  try {
    video.stop?.();
  } catch (_error) {
    try {
      element?.pause?.();
    } catch (_pauseError) {
      // The decoder may already be detached.
    }
  }
  try {
    element?.removeAttribute?.("src");
    for (const source of element?.querySelectorAll?.("source") || []) {
      source.removeAttribute?.("src");
    }
    element?.load?.();
  } catch (_error) {
    // Disposal remains best-effort for browser media implementations.
  }
  video.remove?.();
}

function startVideoFrameTracking(item, element, isCurrent) {
  stopVideoFrameTracking(item);
  if (!item || !element) return;
  if (typeof element.requestVideoFrameCallback !== "function") {
    throw new Error("VJ1_RENDER_CAPABILITY_REQUIRED:HTMLVideoElement.requestVideoFrameCallback");
  }
  item.videoFrameDriven = true;
  item.videoFrameElement = element;
  const onFrame = (_now, metadata = {}) => {
    if (!item.videoFrameDriven || item.videoFrameElement !== element || !isCurrent()) return;
    const callbackMediaTime = Number(metadata.mediaTime);
    if (!acceptVideoDecodedFrame(element, callbackMediaTime)) {
      try {
        item.videoFrameCallbackId = element.requestVideoFrameCallback(onFrame);
      } catch (error) {
        item.videoFrameDriven = false;
        item.videoFrameCallbackId = null;
        reportVideoFrameCallbackFailure(error);
      }
      return;
    }
    const mediaTime = Number.isFinite(callbackMediaTime)
      ? callbackMediaTime
      : Number(element.currentTime);
    // The decoded frame—not the renderer tick—is the media dirty signal. This
    // lets a 30 fps clip retain its rendered component on the intervening
    // frames of a 60 fps Preview/Output loop without changing playback.
    item.videoFrameRevision = Math.max(0, Number(item.videoFrameRevision) || 0) + 1;
    item.videoFrameMediaTime = Math.max(0, mediaTime || 0);
    item.onInvalidate?.("video-frame", item);
    try {
      item.videoFrameCallbackId = element.requestVideoFrameCallback(onFrame);
    } catch (error) {
      // A browser may withdraw the callback while the media element is being
      // torn down. Fall back to renderer-frame invalidation in that case.
      item.videoFrameDriven = false;
      item.videoFrameCallbackId = null;
      reportVideoFrameCallbackFailure(error);
    }
  };
  try {
    item.videoFrameCallbackId = element.requestVideoFrameCallback(onFrame);
  } catch (error) {
    item.videoFrameDriven = false;
    item.videoFrameCallbackId = null;
    item.videoFrameElement = null;
    reportVideoFrameCallbackFailure(error);
  }
}

function reportVideoFrameCallbackFailure(error) {
  if (videoFrameCallbackFailureReported) return;
  videoFrameCallbackFailureReported = true;
  console.error("[VJ1_VIDEO_FRAME_CALLBACK_FAILED]", {
    consequence: "decoded-frame invalidation stopped for this video resource",
    message: error?.message || String(error || "video frame callback failed"),
  });
}

function stopVideoFrameTracking(item) {
  if (!item) return;
  const element = item.videoFrameElement;
  const callbackId = item.videoFrameCallbackId;
  item.videoFrameDriven = false;
  item.videoFrameCallbackId = null;
  item.videoFrameElement = null;
  if (callbackId == null || typeof element?.cancelVideoFrameCallback !== "function") return;
  try {
    element.cancelVideoFrameCallback(callbackId);
  } catch (_error) {
    // The element may already have released its decoder during disposal.
  }
}

function isMediaRuntimeItemLoaded(item) {
  return !!(item && (item.video || item.image || item.model || item.modelData || item.url));
}

function recordImageDemand(item, width) {
  if (!isRasterRuntimeItem(item) && !isVectorRuntimeItem(item)) return;
  item.imageDemandWidth = Math.max(Number(item.imageDemandWidth) || 0, rasterVariantWidth(width));
}

function rasterVariantWidth(width) {
  const requestedWidth = Math.max(0, Math.floor(Number(width) || 0));
  return requestedWidth
    ? Math.max(512, Math.min(MAX_IMAGE_VARIANT_WIDTH, Math.ceil(requestedWidth / 256) * 256))
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

function shouldUpgradeSvgVariant(item) {
  if (!isVectorRuntimeItem(item) || !item.svgSource || !item.image) return false;
  const demand = Number(item.imageDemandWidth) || 0;
  const variantDemand = Number(item.imageVariantDemandWidth) || Number(item.imageVariantWidth) || Number(item.image?.width) || 0;
  return demand > variantDemand;
}

function isRasterRuntimeItem(item) {
  return !!item && /\.(png|jpe?g|gif|webp|bmp)$/i.test(item.id || "");
}

function isVectorRuntimeItem(item) {
  return !!item && /\.svg$/i.test(item.id || "");
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
    // estimate is for eviction pressure, not accounting telemetry. The source
    // File is browser/disk-backed and is not resident decoded memory; counting
    // a large movie's compressed file size made it exceed the cache by itself
    // and churn its decoder whenever Preview switched to a thumbnail.
    return width * height * 12;
  }
  if (item.image) {
    const element = item.image.elt || item.image;
    const width = Math.max(1, Number(element.naturalWidth) || Number(element.width) || Number(item.image.width) || 1);
    const height = Math.max(1, Number(element.naturalHeight) || Number(element.height) || Number(item.image.height) || 1);
    const derivedBytes = Array.from(item.imageRenditions?.values?.() || [])
      .reduce((total, rendition) => total + estimateDrawableBytes(rendition), 0);
    return Math.max(Number(item.file?.size) || 0, width * height * 4) + derivedBytes;
  }
  if (item.modelData || item.model) {
    const meshBytes = typedArrayBytes(item.modelData || item.model);
    const derivedBytes = [
      item.modelPointCloud,
      item.modelWireLines,
      item.modelThickWireVertices,
      item.modelPerceptualEdges,
      item.modelPerceptualWireVertices,
    ].reduce((total, value) => total + typedArrayBytes(value), 0);
    return Math.max(Number(item.file?.size) || 0, meshBytes) + derivedBytes + estimateRawModelItemGpuBytes(item);
  }
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
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  let total = 0;
  for (const nested of Object.values(value)) total += typedArrayBytes(nested, seen);
  return total;
}

function reportModelLods(item, mesh) {
  const sourceTriangles = Math.max(0, Number(mesh?.sourceTriangleCount) || Number(mesh?.triangleCount) || 0);
  const lods = Array.from(mesh?.lods || [mesh]);
  if (!sourceTriangles || lods.length <= 1) return;
  const sourceNonManifoldEdges = Math.max(0, Number(mesh?.sourceNonManifoldEdges) || 0);
  if (sourceNonManifoldEdges) {
    console.warn("[VJ1_MODEL_TOPOLOGY_WARNING]", {
      id: item?.id || "",
      sourceNonManifoldEdges,
      message: "The source model contains non-manifold edges; they were preserved and may limit automatic simplification.",
    });
  }
  const limitedLevels = lods
    .filter((lod) => lod?.topologyLimited)
    .map((lod) => ({ requested: lod.requestedTriangleCount, actual: lod.triangleCount }));
  if (limitedLevels.length) {
    console.warn("[VJ1_MODEL_SIMPLIFICATION_LIMITED]", {
      id: item?.id || "",
      limitedLevels,
      message: "Source topology prevented one or more model detail levels from reaching their requested triangle budget.",
    });
  }
}

function releaseRenditionUrl(item, key, expectedUrl = null) {
  const url = item?.renditionUrls?.get?.(key);
  if (!url || (expectedUrl && url !== expectedUrl)) return;
  URL.revokeObjectURL(url);
  item.renditionUrls.delete(key);
}
