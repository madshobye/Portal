export function drawCover(pg, media, x, y, w, h) {
  const element = media.elt || media;
  const mw = element.videoWidth || element.naturalWidth || media.width || element.width || w;
  const mh = element.videoHeight || element.naturalHeight || media.height || element.height || h;
  const scale = Math.max(w / mw, h / mh);
  const dw = mw * scale;
  const dh = mh * scale;
  pg.image(media, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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

export function syncVideoSpeed(video, speedValue = 1) {
  const speed = Math.max(0, Number(speedValue) || 0);
  const elt = video?.elt || video;
  if (!elt) return;
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
      video.loop?.();
      video.play?.();
    } catch {}
  }
}
