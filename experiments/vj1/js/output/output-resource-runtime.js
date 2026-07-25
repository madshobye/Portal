import { OutputRenderCache } from "../libraries/cache-engine/render-cache/index.js?v=periodic-preview-maintenance-1";
import { applyFontToGlobal, applyFontToTarget } from "./font-loader.js?v=adaptive-component-demand-29";
import { disposeGraphics } from "./shader-target-runtime.js?v=premultiplied-alpha-write-1";
import { createSharedFramebufferTarget } from "./shared-framebuffer-target.js?v=premultiplied-alpha-5";

// Owns shared presentation resources and their context-safe lifecycle. Exact
// render requests and per-node retained targets remain owned by their existing
// capabilities; this runtime owns only the common cache collections and final
// presentation targets that those capabilities share.
export class OutputResourceRuntime {
  constructor(host, { font = null } = {}) {
    this.host = host;
    this.font = font || null;
    this.renderCache = new OutputRenderCache();
    this.componentSource = this.renderCache.sources;
    this.componentOutput = new Map();
    this.sourcePg = null;
    this.mainMix = null;
    this.lastPixelDensity = 0;
  }

  applyGlobalFont() {
    applyFontToGlobal(this.font);
    this.applyFontToAllGraphics();
  }

  applyGraphicsFont(target) {
    applyFontToTarget(target, this.font);
  }

  applyFontToAllGraphics() {
    const host = this.host;
    this.applyGraphicsFont(this.sourcePg);
    this.applyGraphicsFont(this.mainMix);
    host.surfaceRuntime.applyFont((target) =>
      this.applyGraphicsFont(target),
    );
    host.shaderEffectRuntime.applyToTargets((target) =>
      this.applyGraphicsFont(target),
    );
    for (const target of this.componentSource.values()) {
      this.applyGraphicsFont(target);
    }
    for (const target of this.componentOutput.values()) {
      this.applyGraphicsFont(target);
    }
    host.renderTargetRuntime.forEachCpu((target) =>
      this.applyGraphicsFont(target),
    );
  }

  createBuffers() {
    const host = this.host;
    // Resizing keeps specialized 3D contexts alive; their retained targets
    // resize on next use. Final disposal releases them.
    this.disposeBuffers({ preserveSpecialized: true });
    this.applyPixelDensity();
    const { width, height } =
      host.presentationGeometry.outputFrameSize(host.state.render);
    this.sourcePg = createGraphics(width, height);
    this.mainMix = createSharedFramebufferTarget(width, height);
    this.applyGraphicsPixelDensity(this.sourcePg);
    this.applyGraphicsPixelDensity(this.mainMix);
    this.applyGraphicsFont(this.sourcePg);
    this.applyGraphicsFont(this.mainMix);
  }

  matchesRenderSize() {
    const host = this.host;
    if (!host.state) return false;
    const { width, height } =
      host.presentationGeometry.outputFrameSize(host.state.render);
    return (
      this.sourcePg?.width === width &&
      this.sourcePg?.height === height &&
      this.mainMix?.width === width &&
      this.mainMix?.height === height
    );
  }

  disposeBuffers({ preserveSpecialized = false } = {}) {
    const host = this.host;
    if (!preserveSpecialized) host.specializedSources.dispose();
    // Programs are context-bound. Release them before their owning targets and
    // GL contexts, preserving the previous renderer lifecycle exactly.
    host.shaderGeneratorRuntime.dispose();
    host.shaderEffectRuntime.dispose();
    host.textureOperatorRuntime.dispose();
    host.compositeRuntime.dispose();
    disposeGraphics(this.sourcePg);
    disposeGraphics(this.mainMix);
    host.surfaceRuntime.dispose();
    host.isfRuntime.dispose();
    this.componentOutput.clear();
    this.renderCache.dispose();
    host.renderEvaluationRuntime.dispose();
    host.componentRenderRuntime.clear();
    this.sourcePg = null;
    this.mainMix = null;
  }

  applyPixelDensity() {
    const density = this.host.presentationGeometry.pixelDensity(
      this.host.state?.render || {},
    );
    if (this.lastPixelDensity === density) return;
    if (typeof pixelDensity === "function") pixelDensity(density);
    this.lastPixelDensity = density;
  }

  applyGraphicsPixelDensity(
    target,
    density = this.host.presentationGeometry.pixelDensity(
      this.host.state?.render || {},
    ),
  ) {
    if (!target?.pixelDensity) return;
    target.pixelDensity(
      Math.max(0.25, Math.min(4, Number(density) || 1)),
    );
  }
}
