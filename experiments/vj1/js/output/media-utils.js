import { isSharedFramebufferTarget } from "./shared-framebuffer-target.js?v=render-diagnostics-1";
import { renderTargetDescriptor, RENDER_TARGET_KIND } from "./render-target-contract.js?v=source-target-ownership-1";
import { fitOverflowDestination } from "../libraries/render-engine/fit-geometry/index.js?v=fit-geometry-1";

const reportedMediaDrawFailures = new WeakMap();
const webGlMediaBridges = new WeakMap();
const reportedVideoPlaybackFailures = new WeakSet();
const pendingVideoPlays = new WeakMap();
const videoSegmentStates = new WeakMap();
const videoSegmentBoundaryElements = new WeakSet();

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
  const fitted = fitOverflowDestination(
    { x: 0, y: 0, width: mw, height: mh },
    { x, y, width: w, height: h },
    fit
  );
  const { x: dx, y: dy, width: dw, height: dh } = fitted.destination;
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
    reportMediaDrawFailure(media, webglTarget ? "webgl-texture-source" : "canvas-image-source", pg, primaryError);
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

function reportMediaDrawFailure(media, path, target, error) {
  if (!media || (typeof media !== "object" && typeof media !== "function")) {
    console.error("[VJ1_MEDIA_DRAW_FAILED]", { path, target: mediaTargetKind(target), message: error?.message || String(error || "draw failed") });
    return;
  }
  let paths = reportedMediaDrawFailures.get(media);
  if (!paths) {
    paths = new Set();
    reportedMediaDrawFailures.set(media, paths);
  }
  if (paths.has(path)) return;
  paths.add(path);
  console.error("[VJ1_MEDIA_DRAW_FAILED]", {
    path,
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
  // Use one boundary controller for trimmed and full-length playback. Native
  // HTMLVideoElement looping is allowed to exhaust the decoder before it
  // restarts, which can expose an empty frame. Seeking while the retained last
  // frame is still valid gives both cases the same gap-free lifecycle.
  const hasLoopBoundary = end > start;
  let segmentState = videoSegmentStates.get(elt);
  if (!segmentState) {
    segmentState = {
      video,
      start,
      end,
      hasLoopBoundary,
      pendingSeekTarget: null,
    };
    videoSegmentStates.set(elt, segmentState);
  } else {
    const boundaryChanged = segmentState.start !== start || segmentState.end !== end;
    segmentState.video = video;
    segmentState.start = start;
    segmentState.end = end;
    segmentState.hasLoopBoundary = hasLoopBoundary;
    if (boundaryChanged) segmentState.pendingSeekTarget = null;
  }
  bindVideoSegmentBoundary(elt);
  enforceVideoSegmentBoundary(elt, segmentState);
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
  elt.loop = !hasLoopBoundary;
  if (elt.paused) requestVideoPlayback(video, elt);
}

function bindVideoSegmentBoundary(element) {
  if (!element?.addEventListener || videoSegmentBoundaryElements.has(element)) return;
  videoSegmentBoundaryElements.add(element);
  // The media clock owns the trim boundary. Renderer invalidation normally
  // checks it too, but timeupdate keeps the authored end reliable while a
  // retained presentation is asleep or decoded-frame callbacks are sparse.
  element.addEventListener("timeupdate", () => {
    const state = videoSegmentStates.get(element);
    if (state) enforceVideoSegmentBoundary(element, state);
  });
}

function enforceVideoSegmentBoundary(element, state) {
  if (!state?.hasLoopBoundary) return false;
  const current = Number(element.currentTime) || 0;
  // Leave enough decode headroom to seek before the browser presents its
  // exhausted end-of-stream surface. The retained render node continues to
  // display the last confirmed frame until the loop-start frame is decoded.
  if (current >= state.start - 0.04 && (!state.end || current < state.end - 0.075)) return false;
  try {
    element.currentTime = state.start;
    state.pendingSeekTarget = state.start;
    return true;
  } catch (error) {
    reportVideoPlaybackFailure(state.video, error, "seek");
    return false;
  }
}

// requestVideoFrameCallback callbacks already queued before a seek may be
// delivered after currentTime has moved to the loop start. A callback is
// publishable only when it belongs to the current seek target; otherwise the
// retained pre-seek frame remains authoritative.
export function acceptVideoDecodedFrame(element, mediaTime) {
  // A callback can arrive while the decoder is leaving its seek transition
  // but before the element is drawable by the renderer. Publishing that
  // revision would clear the retained source buffer and replace its last good
  // frame with the decoder's temporary empty surface.
  if (!element || element.seeking === true || !isDrawableMedia(element)) return false;
  const state = videoSegmentStates.get(element);
  if (!state || state.pendingSeekTarget == null) return true;
  const presentedTime = Number(mediaTime);
  const target = Number(state.pendingSeekTarget) || 0;
  if (!Number.isFinite(presentedTime) ||
      presentedTime < target - 0.04 ||
      presentedTime > target + 0.25) return false;
  state.pendingSeekTarget = null;
  return true;
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
