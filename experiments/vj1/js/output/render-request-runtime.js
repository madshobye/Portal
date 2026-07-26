import { createRenderRequest } from "./render-geometry.js";

// Owns the normalized render-demand contract shared by compiled visual
// runtimes. Nodes consume retained request values directly; the renderer shell
// only supplies current project settings.
export class RenderRequestRuntime {
  constructor({
    getRenderSettings,
    getFrameSize,
    getPixelDensity,
    controlSignals = null,
  }) {
    this.getRenderSettings = getRenderSettings;
    this.getFrameSize = getFrameSize;
    this.getPixelDensity = getPixelDensity;
    this.controlSignals = controlSignals;
  }

  normalize(request, role = "texture") {
    if (request && typeof request === "object") {
      const normalized = createRenderRequest(
        request.role || role,
        request,
        request,
      );
      if (
        normalized.controlSignals === undefined &&
        this.controlSignals
      ) {
        normalized.controlSignals = this.controlSignals;
      }
      return normalized;
    }
    const render = this.getRenderSettings?.() || {};
    return createRenderRequest(role, this.getFrameSize?.(render) || {}, {
      ...(this.controlSignals ? { controlSignals: this.controlSignals } : {}),
    });
  }

  pixelDensity(request = {}) {
    if (request.pixelDensityApplied) return 1;
    return this.getPixelDensity?.(this.getRenderSettings?.() || {}) || 1;
  }

  setControlSignals(controlSignals = null) {
    this.controlSignals = controlSignals;
  }
}
