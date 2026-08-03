const CAMERA_READY_TIMEOUT_MS = 8000;

export async function createBrowserCameraCapture({
  front = true,
  width = 640,
  height = 480,
  mirrored = false,
  maxResolution = false,
} = {}, {
  mediaDevices = globalThis.navigator?.mediaDevices,
  documentRef = globalThis.document,
  timeoutMs = CAMERA_READY_TIMEOUT_MS,
} = {}) {
  if (typeof mediaDevices?.getUserMedia !== "function") {
    throw new Error("Camera capture is not supported by this browser");
  }
  const requestedWidth = clampDimension(width, 640);
  const requestedHeight = clampDimension(height, 480);
  const stream = await mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: maxResolution ? { ideal: 7680 } : { ideal: requestedWidth },
      height: maxResolution ? { ideal: 4320 } : { ideal: requestedHeight },
      facingMode: { ideal: front ? "user" : "environment" },
    },
  });
  const video = documentRef?.createElement?.("video");
  if (!video) {
    stopStream(stream);
    throw new Error("Camera capture requires an HTML video element");
  }
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.dataset ||= {};
  video.dataset.vj1Mirrored = mirrored ? "true" : "false";
  try {
    await video.play();
    await waitForDecodedVideo(video, timeoutMs);
  } catch (error) {
    stopStream(stream);
    video.srcObject = null;
    throw error;
  }
  return Object.assign(video, {
    remove() {
      stopStream(stream);
      video.srcObject = null;
      globalThis.HTMLElement?.prototype?.remove?.call?.(video);
    },
  });
}

function waitForDecodedVideo(video, timeoutMs) {
  if (video.readyState >= 2 && video.videoWidth > 1 && video.videoHeight > 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => finish(new Error("Camera did not produce a decoded frame")), Math.max(1, timeoutMs));
    const ready = () => {
      if (video.readyState >= 2 && video.videoWidth > 1 && video.videoHeight > 1) finish();
    };
    const failed = () => finish(video.error || new Error("Camera video failed"));
    const finish = (error = null) => {
      globalThis.clearTimeout(timeout);
      video.removeEventListener?.("loadeddata", ready);
      video.removeEventListener?.("canplay", ready);
      video.removeEventListener?.("error", failed);
      error ? reject(error) : resolve();
    };
    video.addEventListener?.("loadeddata", ready);
    video.addEventListener?.("canplay", ready);
    video.addEventListener?.("error", failed, { once: true });
  });
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop?.();
}

function clampDimension(value, fallback) {
  return Math.max(1, Math.min(7680, Math.floor(Number(value) || fallback)));
}
