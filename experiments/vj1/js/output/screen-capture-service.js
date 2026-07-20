const SERVICE_KEY = "__vj1ScreenCaptureServiceV1";

export class ScreenCaptureService {
  constructor() {
    this.captures = new Map();
    this.captureSequence = 0;
    this.error = "";
    this.status = "idle";
    this.listeners = new Set();
    this.requestToken = 0;
    this.boundPageHide = () => this.stopAll();
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
      this.addCapture(stream, video);
      candidateStream = null;
      return video;
    } catch (error) {
      stopStream(candidateStream);
      if (token === this.requestToken) this.fail(error);
      throw error;
    }
  }

  addCapture(stream, video) {
    const sequence = ++this.captureSequence;
    const id = createCaptureId(sequence);
    const track = stream.getVideoTracks?.()[0];
    const capture = {
      id,
      name: automaticCaptureName(track, sequence),
      stream,
      video,
      createdAt: Date.now(),
    };
    this.captures.set(id, capture);
    this.status = "active";
    this.error = "";
    if (track) track.addEventListener("ended", () => {
      if (this.captures.get(id)?.stream !== stream) return;
      this.removeCapture(id, { stop: false });
    }, { once: true });
    this.emit();
    return capture;
  }

  rename(id, name) {
    const capture = this.captures.get(String(id || ""));
    if (!capture) return false;
    const nextName = String(name || "").trim();
    if (!nextName || nextName === capture.name) return !!nextName;
    capture.name = nextName.slice(0, 120);
    this.emit();
    return true;
  }

  stop(id = "") {
    if (id) return this.removeCapture(id);
    this.stopAll();
    return true;
  }

  stopAll() {
    this.requestToken++;
    for (const id of [...this.captures.keys()]) this.removeCapture(id, { emit: false });
    this.status = "idle";
    this.error = "";
    this.emit();
  }

  removeCapture(id, { stop = true, emit = true } = {}) {
    const capture = this.captures.get(String(id || ""));
    if (!capture) return false;
    this.captures.delete(capture.id);
    if (stop) stopStream(capture.stream);
    if (capture.video) capture.video.srcObject = null;
    this.status = this.captures.size ? "active" : "idle";
    this.error = "";
    if (emit) this.emit();
    return true;
  }

  videoFor(id) {
    return this.captures.get(String(id || ""))?.video || null;
  }

  fail(error) {
    // Cancelling a replacement selection must not invalidate a capture that is
    // already serving the session. The failure describes the attempted switch;
    // user truth remains "active" while the old track is still available.
    this.status = this.captures.size ? "active" : "error";
    this.error = error?.message || String(error || "Screen sharing failed");
    console.error("[VJ1_SCREEN_CAPTURE_FAILED]", { message: this.error });
    this.emit();
  }

  snapshot() {
    return {
      status: this.status,
      error: this.error,
      active: this.captures.size > 0,
      inputs: [...this.captures.values()].map(captureSnapshot),
    };
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
  return localScreenCaptureService().stopAll();
}

export function stopScreenCaptureInput(id) {
  return localScreenCaptureService().stop(id);
}

export function renameScreenCaptureInput(id, name) {
  return localScreenCaptureService().rename(id, name);
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

function captureSnapshot(capture) {
  const settings = capture.stream?.getVideoTracks?.()[0]?.getSettings?.() || {};
  return {
    id: capture.id,
    name: capture.name,
    width: Math.max(0, Number(capture.video?.videoWidth || settings.width) || 0),
    height: Math.max(0, Number(capture.video?.videoHeight || settings.height) || 0),
  };
}

function automaticCaptureName(track, sequence) {
  const label = String(track?.label || "").trim();
  return (label || `Shared window ${sequence}`).slice(0, 120);
}

function createCaptureId(sequence) {
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `screen-${random}` : `screen-${Date.now().toString(36)}-${sequence.toString(36)}`;
}
