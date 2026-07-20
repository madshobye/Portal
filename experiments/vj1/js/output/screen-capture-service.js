const SERVICE_KEY = "__vj1ScreenCaptureServiceV1";

export class ScreenCaptureService {
  constructor() {
    this.stream = null;
    this.video = null;
    this.error = "";
    this.status = "idle";
    this.listeners = new Set();
    this.requestToken = 0;
    this.boundPageHide = () => this.stop();
    globalThis.addEventListener?.("pagehide", this.boundPageHide, { once: true });
  }

  async start(settings = {}) {
    const getDisplayMedia = globalThis.navigator?.mediaDevices?.getDisplayMedia;
    if (typeof getDisplayMedia !== "function") {
      const error = new Error("Screen sharing is not supported by this browser");
      this.fail(error);
      throw error;
    }
    const token = ++this.requestToken;
    this.status = "requesting";
    this.error = "";
    this.emit();
    let candidateStream = null;
    try {
      const stream = await getDisplayMedia.call(globalThis.navigator.mediaDevices, {
        audio: false,
        video: screenCaptureConstraints(settings),
        preferCurrentTab: settings.preferCurrentTab === true,
        selfBrowserSurface: settings.includeCurrentTab === false ? "exclude" : "include",
        surfaceSwitching: settings.surfaceSwitching === false ? "exclude" : "include",
      });
      candidateStream = stream;
      if (token !== this.requestToken) {
        stopStream(stream);
        return null;
      }
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (token !== this.requestToken) {
        stopStream(stream);
        return null;
      }
      this.replaceCapture(stream, video);
      candidateStream = null;
      return video;
    } catch (error) {
      stopStream(candidateStream);
      if (token === this.requestToken) this.fail(error);
      throw error;
    }
  }

  replaceCapture(stream, video) {
    stopStream(this.stream);
    this.stream = stream;
    this.video = video;
    this.status = "active";
    this.error = "";
    const track = stream.getVideoTracks?.()[0];
    if (track) track.addEventListener("ended", () => {
      if (this.stream !== stream) return;
      this.clearCapture("idle");
    }, { once: true });
    this.emit();
  }

  stop() {
    this.requestToken++;
    this.clearCapture("idle");
  }

  clearCapture(status) {
    stopStream(this.stream);
    if (this.video) this.video.srcObject = null;
    this.stream = null;
    this.video = null;
    this.status = status;
    this.error = "";
    this.emit();
  }

  fail(error) {
    // Cancelling a replacement selection must not invalidate a capture that is
    // already serving the session. The failure describes the attempted switch;
    // user truth remains "active" while the old track is still available.
    this.status = this.video ? "active" : "error";
    this.error = error?.message || String(error || "Screen sharing failed");
    console.error("[VJ1_SCREEN_CAPTURE_FAILED]", { message: this.error });
    this.emit();
  }

  snapshot() {
    return { status: this.status, error: this.error, active: !!this.video };
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function screenCaptureService() {
  const openerService = sameOriginOpenerService();
  if (openerService) return openerService;
  if (!globalThis[SERVICE_KEY]) globalThis[SERVICE_KEY] = new ScreenCaptureService();
  return globalThis[SERVICE_KEY];
}

export function startScreenCapture(settings = {}) {
  return localScreenCaptureService().start(settings);
}

export function stopScreenCapture() {
  return localScreenCaptureService().stop();
}

export function screenCaptureStatus() {
  return localScreenCaptureService().snapshot();
}

export function subscribeScreenCapture(listener) {
  return localScreenCaptureService().subscribe(listener);
}

function localScreenCaptureService() {
  if (!globalThis[SERVICE_KEY]) globalThis[SERVICE_KEY] = new ScreenCaptureService();
  return globalThis[SERVICE_KEY];
}

function sameOriginOpenerService() {
  try {
    if (!globalThis.opener || globalThis.opener.closed) return null;
    return globalThis.opener[SERVICE_KEY] || null;
  } catch (error) {
    console.error("[VJ1_SCREEN_CAPTURE_HOST_UNAVAILABLE]", { message: error?.message || String(error) });
    return null;
  }
}

function screenCaptureConstraints(settings = {}) {
  const constraints = {
    frameRate: { ideal: clampInt(settings.frameRate, 1, 60, 30) },
  };
  if (["always", "motion", "never"].includes(settings.cursor)) constraints.cursor = settings.cursor;
  return constraints;
}

function clampInt(value, min, max, fallback) {
  const number = Math.floor(Number(value) || fallback);
  return Math.max(min, Math.min(max, number));
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop?.();
}
