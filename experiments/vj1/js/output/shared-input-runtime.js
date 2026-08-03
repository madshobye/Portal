import { frameSize } from "./render-geometry.js";
import { screenCaptureService } from "../libraries/device-engine/index.js";
import { MediaInputLifecycle } from "../libraries/media-engine/media-input-lifecycle/index.js";
import { isDrawableMedia } from "./media-utils.js";
import { createBrowserCameraCapture } from "./browser-camera-capture.js";

const CAMERA_RETRY_MS = 3000;
const CAMERA_IDLE_GRACE_MS = 750;

// Owns live inputs independently from Components. Render paths acquire the
// latest frame during a renderer frame; stored Components and catalog work do
// not participate in input lifecycle.
export class SharedInputRuntime {
  constructor({
    getRenderSettings,
    cameraIdleGraceMs = CAMERA_IDLE_GRACE_MS,
    cameraFactory = createBrowserCameraCapture,
    screenCapture = screenCaptureService(),
  } = {}) {
    this.getRenderSettings = getRenderSettings || (() => ({}));
    this.cameraIdleGraceMs = Math.max(0, Number(cameraIdleGraceMs) || 0);
    this.cameraFactory = cameraFactory;
    if (!screenCapture) throw new Error("SCREEN_CAPTURE_SERVICE_REQUIRED");
    this.screenCapture = screenCapture;
    this.camera = new MediaInputLifecycle({
      idleGraceMs: this.cameraIdleGraceMs,
      retryMs: CAMERA_RETRY_MS,
      clock: runtimeMillis,
      onError: (message, signature) => this.setCameraError(message, signature),
      onReady: () => { this.reportedCameraErrorKey = ""; },
    });
    this.reportedScreenErrors = new Map();
  }

  beginFrame() {
    this.camera.beginFrame();
  }

  acquireCamera() {
    const render = this.getRenderSettings();
    const settings = cameraCaptureSettings(render);
    const signature = cameraSettingsSignature(render);
    return this.camera.acquire(signature, () =>
      this.cameraFactory(settings));
  }

  acquireScreen(inputId = "") {
    const service = this.screenCapture;
    const video = service.videoFor(inputId);
    if (video) {
      this.reportedScreenErrors.delete(inputId);
      return video;
    }
    const message = service.error || (!inputId
      ? "choose a shared input"
      : service.status === "requesting"
        ? "waiting for screen selection"
        : "selected shared input is unavailable");
    if (this.reportedScreenErrors.get(inputId) !== message) {
      this.reportedScreenErrors.set(inputId, message);
      console.warn("[VJ1_SCREEN_CAPTURE_UNAVAILABLE]", { inputId, status: service.status, message });
    }
    return null;
  }

  cameraStatus({ acquire = true } = {}) {
    const resource = acquire ? this.acquireCamera() : this.camera.resource;
    if (isDrawableMedia(resource)) {
      return Object.freeze({
        kind: "camera",
        id: "default",
        state: "ready",
        error: "",
      });
    }
    return Object.freeze({
      kind: "camera",
      id: "default",
      state: this.camera.error ? "error" : "pending",
      error: String(this.camera.error || ""),
    });
  }

  screenStatus(inputId = "", { acquire = true } = {}) {
    const id = String(inputId || "");
    const service = this.screenCapture;
    const resource = acquire ? this.acquireScreen(id) : service.videoFor(id);
    if (isDrawableMedia(resource)) {
      return Object.freeze({
        kind: "screen-input",
        id,
        state: "ready",
        error: "",
      });
    }
    const pending = service.status === "requesting";
    return Object.freeze({
      kind: "screen-input",
      id,
      state: pending ? "pending" : "error",
      error: pending ? "" : this.screenError(id),
    });
  }

  endFrame() {
    this.camera.endFrame();
  }

  releaseCamera() {
    this.camera.release();
  }

  setCameraError(message, signature = this.camera.signature) {
    const key = `${signature}:${message || "camera unavailable"}`;
    if (this.reportedCameraErrorKey === key) return;
    this.reportedCameraErrorKey = key;
    console.error("[VJ1_CAMERA_CAPTURE_FAILED]", {
      signature,
      message: message || "camera unavailable",
      retryMs: CAMERA_RETRY_MS,
    });
  }

  get cameraCapture() {
    return this.camera.resource;
  }

  get cameraError() {
    return this.camera.error;
  }

  screenError(inputId = "") {
    const service = this.screenCapture;
    if (service.error) return service.error;
    if (!inputId) return "choose a shared input";
    if (service.status === "requesting") return "waiting for screen selection";
    return "selected shared input is unavailable";
  }

  dispose() {
    this.releaseCamera();
    this.reportedScreenErrors.clear();
  }
}

function runtimeMillis() {
  return typeof globalThis.millis === "function" ? globalThis.millis() : Date.now();
}

export function cameraCaptureSettings(render = {}) {
  const frame = frameSize(render);
  const camera = render?.camera || {};
  return {
    width: Math.max(160, Math.min(7680, Math.floor(frame.width))),
    height: Math.max(120, Math.min(4320, Math.floor(frame.height))),
    front: camera.facingMode !== "environment",
    mirrored: camera.mirrored === true,
    maxResolution: camera.maxResolution === true,
  };
}

export function cameraSettingsSignature(render = {}) {
  const camera = cameraCaptureSettings(render);
  return `${camera.width}x${camera.height}:${camera.front ? "front" : "rear"}:${camera.mirrored ? "mirror" : "normal"}:${camera.maxResolution ? "max" : "target"}`;
}
