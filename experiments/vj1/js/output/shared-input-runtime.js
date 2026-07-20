import { frameSize } from "./render-geometry.js?v=adaptive-component-demand-29";
import { screenCaptureService } from "./screen-capture-service.js?v=screen-share-1";

const CAMERA_RETRY_MS = 3000;
const CAMERA_IDLE_GRACE_MS = 750;

// Owns live inputs independently from Components. Render paths acquire the
// latest frame during a renderer frame; stored Components and catalog work do
// not participate in input lifecycle.
export class SharedInputRuntime {
  constructor({ getRenderSettings, cameraIdleGraceMs = CAMERA_IDLE_GRACE_MS } = {}) {
    this.getRenderSettings = getRenderSettings || (() => ({}));
    this.cameraIdleGraceMs = Math.max(0, Number(cameraIdleGraceMs) || 0);
    this.camera = createCameraInputState();
    this.reportedScreenError = "";
  }

  beginFrame() {
    this.camera.demanded = false;
  }

  acquireCamera() {
    const render = this.getRenderSettings();
    const settings = cameraCaptureSettings(render);
    const signature = cameraSettingsSignature(render);
    const input = this.camera;
    input.demanded = true;
    cancelCameraRelease(input);
    if (input.capture && input.signature === signature) return input.capture;
    if (input.requested && input.signature === signature) return null;
    if (input.error && input.signature === signature && runtimeMillis() < input.retryAt) return null;
    if (input.capture || input.requested) this.releaseCamera();
    input.demanded = true;
    input.requested = true;
    input.error = "";
    input.signature = signature;
    const requestToken = ++input.requestToken;
    const setupWebcamera = getPortalWebcameraSetup();
    if (!setupWebcamera) {
      this.setCameraError("camera unavailable", signature);
      input.requested = false;
      return null;
    }
    setupWebcamera(settings.front, settings.width, settings.height, settings.mirrored, settings.maxResolution)
      .then((camera) => {
        if (requestToken !== input.requestToken) {
          camera?.remove?.();
          return;
        }
        input.capture = camera;
        input.requested = false;
        input.error = "";
        input.retryAt = 0;
        input.reportedErrorKey = "";
      })
      .catch((error) => {
        if (requestToken !== input.requestToken) return;
        this.setCameraError(error?.message || "camera blocked", signature);
        input.requested = false;
      });
    return null;
  }

  acquireScreen() {
    const service = screenCaptureService();
    if (service.video) {
      this.reportedScreenError = "";
      return service.video;
    }
    const message = service.error || (service.status === "requesting" ? "waiting for screen selection" : "choose a screen or window in Settings");
    if (this.reportedScreenError !== message) {
      this.reportedScreenError = message;
      console.warn("[VJ1_SCREEN_CAPTURE_UNAVAILABLE]", { status: service.status, message });
    }
    return null;
  }

  endFrame() {
    const input = this.camera;
    if (input.demanded || input.releaseTimer || (!input.capture && !input.requested)) return;
    const requestToken = input.requestToken;
    input.releaseTimer = setTimeout(() => {
      input.releaseTimer = 0;
      if (input.demanded || input.requestToken !== requestToken) return;
      this.releaseCamera();
    }, this.cameraIdleGraceMs);
  }

  releaseCamera() {
    const input = this.camera;
    cancelCameraRelease(input);
    input.requestToken++;
    input.capture?.remove?.();
    input.capture = null;
    input.requested = false;
    input.signature = "";
    input.retryAt = 0;
    input.demanded = false;
  }

  setCameraError(message, signature = this.camera.signature) {
    const input = this.camera;
    input.error = message || "camera unavailable";
    input.retryAt = runtimeMillis() + CAMERA_RETRY_MS;
    const key = `${signature}:${input.error}`;
    if (input.reportedErrorKey === key) return;
    input.reportedErrorKey = key;
    console.error("[VJ1_CAMERA_CAPTURE_FAILED]", {
      signature,
      message: input.error,
      retryMs: CAMERA_RETRY_MS,
    });
  }

  get cameraCapture() {
    return this.camera.capture;
  }

  get cameraError() {
    return this.camera.error;
  }

  get screenError() {
    const service = screenCaptureService();
    if (service.error) return service.error;
    if (service.status === "requesting") return "waiting for screen selection";
    return "choose a screen or window in Settings";
  }

  dispose() {
    this.releaseCamera();
  }
}

function createCameraInputState() {
  return {
    capture: null,
    requested: false,
    demanded: false,
    error: "",
    signature: "",
    requestToken: 0,
    retryAt: 0,
    reportedErrorKey: "",
    releaseTimer: 0,
  };
}

function cancelCameraRelease(input) {
  if (!input.releaseTimer) return;
  clearTimeout(input.releaseTimer);
  input.releaseTimer = 0;
}

function runtimeMillis() {
  return typeof globalThis.millis === "function" ? globalThis.millis() : Date.now();
}

function getPortalWebcameraSetup() {
  if (typeof globalThis.setupWebcamera === "function") return globalThis.setupWebcamera;
  try {
    return Function("return typeof setupWebcamera === 'function' ? setupWebcamera : null")();
  } catch (error) {
    console.warn("[VJ1_CAMERA_SETUP_LOOKUP_FAILED]", { fallback: "camera source unavailable", message: error?.message || String(error) });
    return null;
  }
}

export function cameraCaptureSettings(render = {}) {
  const frame = frameSize(render);
  const camera = render?.camera || {};
  return {
    width: Math.max(160, Math.min(7680, Math.floor(Number(camera.width) || frame.width))),
    height: Math.max(120, Math.min(4320, Math.floor(Number(camera.height) || frame.height))),
    front: camera.facingMode !== "environment",
    mirrored: camera.mirrored === true,
    maxResolution: camera.maxResolution === true,
  };
}

export function cameraSettingsSignature(render = {}) {
  const camera = cameraCaptureSettings(render);
  return `${camera.width}x${camera.height}:${camera.front ? "front" : "rear"}:${camera.mirrored ? "mirror" : "normal"}:${camera.maxResolution ? "max" : "target"}`;
}
