import { isSharedFramebufferTarget } from "./shared-framebuffer-target.js?v=render-diagnostics-1";

const reportedMediaFallbacks = new WeakMap();
const webGlMediaBridges = new WeakMap();
const reportedVideoPlaybackFailures = new WeakSet();

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
  const scale = fit === "contain" ? Math.min(w / mw, h / mh) : Math.max(w / mw, h / mh);
  const dw = mw * scale;
  const dh = mh * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  const webglTarget = isSharedFramebufferTarget(pg) || pg?._renderer?.isP3D === true;
  let primarySource = null;
  try {
    primarySource = webglTarget ? webGlTextureSource(media, element) : element;
    // p5 WebGL requires its p5.Image / p5.Graphics / p5.MediaElement wrapper
    // so getTexture() can bind the browser resource. Canvas2D should use the
    // browser-owned element directly and avoid mutable p5 pixel arrays.
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
  if (isSharedFramebufferTarget(target)) return "shared-framebuffer";
  if (target?._renderer?.isP3D) return "p5-webgl";
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
    } catch {}
  }
  if (speed <= 0.001) {
    pauseVideoPlayback(video);
    return;
  }
  if (Math.abs((elt.playbackRate || 1) - speed) > 0.001) {
    try {
      if (typeof video.speed === "function") video.speed(speed);
      else elt.playbackRate = speed;
    } catch {}
  }
  elt.loop = !hasSegment;
  if (elt.paused) {
    try {
      const result = (video.play || elt.play)?.call(video.play ? video : elt);
      result?.catch?.((error) => reportVideoPlaybackFailure(video, error));
    } catch (error) {
      reportVideoPlaybackFailure(video, error);
    }
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

function reportVideoPlaybackFailure(video, error) {
  const key = video?.elt || video;
  if (key && (typeof key === "object" || typeof key === "function")) {
    if (reportedVideoPlaybackFailures.has(key)) return;
    reportedVideoPlaybackFailures.add(key);
  }
  console.error("[VJ1_VIDEO_PLAYBACK_FAILED]", {
    source: mediaSourceKind(video),
    message: error?.message || String(error || "video playback failed"),
  });
}
