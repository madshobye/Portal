export function drawCover(pg, media, x, y, w, h) {
  drawMediaFit(pg, media, x, y, w, h, "cover");
}

export function drawContain(pg, media, x, y, w, h) {
  drawMediaFit(pg, media, x, y, w, h, "contain");
}

export function drawMediaFit(pg, media, x, y, w, h, fit = "cover") {
  const element = media.elt || media;
  const mw = element.videoWidth || element.naturalWidth || media.width || element.width || w;
  const mh = element.videoHeight || element.naturalHeight || media.height || element.height || h;
  const scale = fit === "contain" ? Math.min(w / mw, h / mh) : Math.max(w / mw, h / mh);
  const dw = mw * scale;
  const dh = mh * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  try {
    pg.image(media, dx, dy, dw, dh);
  } catch {
    pg.drawingContext?.drawImage?.(element, dx, dy, dw, dh);
  }
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
    if (!elt.paused) video.pause?.();
    return;
  }
  if (Math.abs((elt.playbackRate || 1) - speed) > 0.001) {
    try {
      if (typeof video.speed === "function") video.speed(speed);
      else elt.playbackRate = speed;
    } catch {}
  }
  if (elt.paused) {
    try {
      if (!hasSegment) video.loop?.();
      video.play?.();
    } catch {}
  }
}

export function syncVideoSpeed(video, speedValue = 1) {
  syncVideoPlayback(video, { speed: speedValue });
}
