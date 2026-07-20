import { isSharedFramebufferTarget } from "./shared-framebuffer-target.js?v=render-diagnostics-1";
import { renderTargetDescriptor, RENDER_TARGET_KIND } from "./render-target-contract.js?v=render-core-contract-1";

const reportedMediaFallbacks = new WeakMap();
const webGlMediaBridges = new WeakMap();
const reportedVideoPlaybackFailures = new WeakSet();
const pendingVideoPlays = new WeakMap();

export function drawCover(pg, media, x, y, w, h) {
  drawMediaFit(pg, media, x, y, w, h, "cover");
}

export function drawContain(pg, media, x, y, w, h) {
  drawMediaFit(pg, media, x, y, w, h, "contain");
}

export function drawMediaFit(pg, media, x, y, w, h, fit = "cover") {
  const element = media.elt || media.canvas || media;
  const mw = element.videoWidth || element.naturalWidth || media.width || element.width || w;
  const mh = element.videoHeight || element.naturalHeight || media.height || element.height || h;
  const stretch = fit === "stretch";
  const scale = fit === "contain" ? Math.min(w / mw, h / mh) : Math.max(w / mw, h / mh);
  const dw = stretch ? w : mw * scale;
  const dh = stretch ? h : mh * scale;
  const dx = stretch ? x : x + (w - dw) / 2;
  const dy = stretch ? y : y + (h - dh) / 2;
  const targetKind = renderTargetDescriptor(pg).kind;
  const webglTarget = targetKind === RENDER_TARGET_KIND.sharedFramebuffer ||
    targetKind === RENDER_TARGET_KIND.p5GraphicsWebgl ||
    targetKind === RENDER_TARGET_KIND.rawWebgl;
  const canvasContext = !webglTarget
    ? pg?.drawingContext || pg?.canvas?.getContext?.("2d") || pg?.elt?.getContext?.("2d")
    : null;
  if (typeof canvasContext?.drawImage === "function") {
    // Raw IMG/VIDEO/CANVAS sources belong to the browser Canvas2D API. Routing
    // them through p5.Graphics.image() makes p5 look for private p5.Image
    // metadata and can fail while reading an internal `width` field.
    try {
      canvasContext.drawImage(element, dx, dy, dw, dh);
      return;
    } catch (error) {
      console.error("[VJ1_MEDIA_DRAW_FAILED]", {
        source: mediaSourceKind(media),
        target: mediaTargetKind(pg),
        message: error?.message || String(error || "media draw failed"),
      });
      throw error;
    }
  }
  let primarySource = null;
  try {
    primarySource = webglTarget ? webGlTextureSource(media, element) : element;
    // p5 WebGL requires its p5.Image / p5.Graphics / p5.MediaElement wrapper
    // so getTexture() can bind the browser resource. Targets without a native
    // Canvas2D context retain the ordinary p5 image call.
    pg.image(primarySource, dx, dy, dw, dh);
  } catch (primaryError) {
    reportMediaDrawFallback(media, webglTarget ? "webgl-texture-source" : "canvas-image-source", pg, primaryError);
    const context = pg.drawingContext;
    if (!webglTarget && typeof context?.drawImage === "function") {
      context.drawImage(element, dx, dy, dw, dh);
      return;
    }
    console.error("[VJ1_MEDIA_DRAW_FAILED]", {
      source: mediaSourceKind(media),
      target: mediaTargetKind(pg),
      message: primaryError?.message || String(primaryError || "media draw failed"),
    });
    throw primaryError;
  }
}

function webGlTextureSource(media, element) {
  if (isP5TextureSource(media)) return media;
  if (!element || (typeof element !== "object" && typeof element !== "function")) {
    throw new TypeError("WebGL media has no drawable browser element");
  }
  const width = Math.max(1, Number(element.videoWidth || element.naturalWidth || element.width || media?.width) || 1);
  const height = Math.max(1, Number(element.videoHeight || element.naturalHeight || element.height || media?.height) || 1);
  let bridge = webGlMediaBridges.get(element);
  if (!bridge || bridge.width !== width || bridge.height !== height) {
    if (typeof globalThis.createImage !== "function") {
      throw new TypeError(`p5 WebGL cannot texture ${mediaSourceKind(media)} and createImage is unavailable`);
    }
    bridge = {
      image: globalThis.createImage(width, height),
      width,
      height,
      initialized: false,
    };
    webGlMediaBridges.set(element, bridge);
  }
  const dynamic = element.tagName === "VIDEO" || element.tagName === "CANVAS" || Number(element.videoWidth) > 0;
  if (!bridge.initialized || dynamic) {
    const context = bridge.image?.canvas?.getContext?.("2d") || bridge.image?.drawingContext;
    if (typeof context?.drawImage !== "function") {
      throw new TypeError("p5 image bridge has no Canvas2D drawing context");
    }
    context.clearRect?.(0, 0, width, height);
    context.drawImage(element, 0, 0, width, height);
    bridge.image.setModified?.(true);
    bridge.initialized = true;
    if (!isP5TextureSource(bridge.image)) {
      throw new TypeError("createImage did not return a p5-compatible texture source");
    }
  }
  return bridge.image;
}

function isP5TextureSource(media) {
  if (!media || (typeof media !== "object" && typeof media !== "function")) return false;
  if (isSharedFramebufferTarget(media)) return true;
  if (media.framebuffer?.color || media.rawTexture) return true;
  if (media._renderer?.isP3D || media.canvas && typeof media.loadPixels === "function") return true;
  if (media.elt && (typeof media._ensureCanvas === "function" || typeof media.hide === "function" || typeof media.play === "function")) return true;
  return false;
}

function reportMediaDrawFallback(media, fallback, target, error) {
  if (!media || (typeof media !== "object" && typeof media !== "function")) {
    console.warn("[VJ1_MEDIA_DRAW_FALLBACK]", { fallback, target: mediaTargetKind(target), message: error?.message || String(error || "draw failed") });
    return;
  }
  let fallbacks = reportedMediaFallbacks.get(media);
  if (!fallbacks) {
    fallbacks = new Set();
    reportedMediaFallbacks.set(media, fallbacks);
  }
  if (fallbacks.has(fallback)) return;
  fallbacks.add(fallback);
  console.warn("[VJ1_MEDIA_DRAW_FALLBACK]", {
    fallback,
    source: mediaSourceKind(media),
    target: mediaTargetKind(target),
    message: error?.message || String(error || "draw failed"),
  });
}

function mediaSourceKind(media) {
  const element = media?.elt || media?.canvas || media;
  return element?.tagName || media?.constructor?.name || element?.constructor?.name || typeof media;
}

function mediaTargetKind(target) {
  const kind = renderTargetDescriptor(target).kind;
  if (kind === RENDER_TARGET_KIND.sharedFramebuffer) return "shared-framebuffer";
  if (kind === RENDER_TARGET_KIND.p5GraphicsWebgl || kind === RENDER_TARGET_KIND.rawWebgl) return "p5-webgl";
  return target?.constructor?.name || "canvas2d";
}

export function isDrawableMedia(media) {
  if (!media) return false;
  const elt = media.elt || media;
  if (elt?.tagName === "VIDEO") {
    return elt.videoWidth > 1 && elt.videoHeight > 1 && elt.readyState >= 2;
  }
  if (elt?.videoWidth > 1 && elt?.videoHeight > 1 && elt.readyState >= 2) return true;
  if (elt?.naturalWidth > 1 && elt?.naturalHeight > 1) return true;
  if (media.width > 1 && media.height > 1) return true;
  return false;
}

export function syncVideoPlayback(video, options = {}) {
  const speed = Math.max(0, Number(options.speed ?? options.speedValue ?? 1) || 0);
  const start = Math.max(0, Number(options.start) || 0);
  const requestedEnd = Math.max(0, Number(options.end) || 0);
  const elt = video?.elt || video;
  if (!elt) return;
  const duration = Number.isFinite(elt.duration) && elt.duration > 0 ? elt.duration : 0;
  const end = requestedEnd > start ? Math.min(requestedEnd, duration || requestedEnd) : duration;
  const hasSegment = start > 0 || (end && end > start && end < duration - 0.02);
  const current = Number(elt.currentTime) || 0;
  if (hasSegment && (current < start - 0.04 || (end && current >= end - 0.035))) {
    try {
      elt.currentTime = start;
    } catch (error) {
      reportVideoPlaybackFailure(video, error, "seek");
    }
  }
  if (speed <= 0.001) {
    pauseVideoPlayback(video);
    return;
  }
  if (Math.abs((elt.playbackRate || 1) - speed) > 0.001) {
    try {
      if (typeof video.speed === "function") video.speed(speed);
      else elt.playbackRate = speed;
    } catch (error) {
      reportVideoPlaybackFailure(video, error, "speed");
    }
  }
  elt.loop = !hasSegment;
  if (elt.paused) requestVideoPlayback(video, elt);
}

function requestVideoPlayback(video, element) {
  const key = element || video;
  if (!key || pendingVideoPlays.has(key)) return;
  const token = {};
  pendingVideoPlays.set(key, token);
  try {
    // Call the browser element directly when possible. p5's wrapper reports an
    // AbortError itself when a legitimate lifecycle pause interrupts play().
    const playTarget = typeof element?.play === "function" ? element : video;
    const result = playTarget?.play?.call(playTarget);
    if (!result?.then) {
      if (pendingVideoPlays.get(key) === token) pendingVideoPlays.delete(key);
      return;
    }
    Promise.resolve(result)
      .catch((error) => {
        if (error?.name !== "AbortError") reportVideoPlaybackFailure(video, error);
      })
      .finally(() => {
        if (pendingVideoPlays.get(key) === token) pendingVideoPlays.delete(key);
      });
  } catch (error) {
    if (pendingVideoPlays.get(key) === token) pendingVideoPlays.delete(key);
    if (error?.name !== "AbortError") reportVideoPlaybackFailure(video, error);
  }
}

export function pauseVideoPlayback(video) {
  const elt = video?.elt || video;
  if (!elt || elt.paused) return;
  try {
    (video.pause || elt.pause)?.call(video.pause ? video : elt);
  } catch (error) {
    reportVideoPlaybackFailure(video, error);
  }
}

export function syncVideoSpeed(video, speedValue = 1) {
  syncVideoPlayback(video, { speed: speedValue });
}

function reportVideoPlaybackFailure(video, error, operation = "play") {
  const key = video?.elt || video;
  if (key && (typeof key === "object" || typeof key === "function")) {
    if (reportedVideoPlaybackFailures.has(key)) return;
    reportedVideoPlaybackFailures.add(key);
  }
  console.error("[VJ1_VIDEO_PLAYBACK_FAILED]", {
    source: mediaSourceKind(video),
    operation,
    message: error?.message || String(error || "video playback failed"),
  });
}
