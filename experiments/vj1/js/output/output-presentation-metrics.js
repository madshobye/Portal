import { normalizePixelDensity, renderMaxFrameRate } from "../domain/render-settings.js?v=surface-terminology-1";

export class OutputPresentationMetrics {
  constructor(host) {
    this.host = host;
    this.lastPublishedAt = 0;
    this.smoothedFrameMs = 0;
    this.smoothedFps = 0;
    this.smoothedRenderCost = 0;
    this.smoothedGpuMs = 0;
    this.lastGpuSampleId = -1;
    this.presentedResolution = null;
  }

  beginFrame() {
    this.presentedResolution = null;
  }

  recordPresentedRequest(request = {}) {
    const width = Math.max(1, Math.round(Number(request?.width) || 1));
    const height = Math.max(1, Math.round(Number(request?.height) || 1));
    const current = this.presentedResolution;
    if (current && current.width * current.height >= width * height) return;
    this.presentedResolution = {
      width,
      height,
      density: this.host.presentationGeometry.pixelDensity(this.host.state?.render || {}),
    };
  }

  resolutionSize(render = this.host.state?.render || {}) {
    if (this.host.mode !== "output" && this.presentedResolution) {
      return { ...this.presentedResolution };
    }
    const frame = this.host.presentationGeometry.displayCanvasSize(render);
    const estimatedDensity = this.host.presentationGeometry.pixelDensity(render);
    const context = typeof drawingContext !== "undefined" ? drawingContext : null;
    const actualWidth = Math.round(Number(context?.drawingBufferWidth) || 0);
    const actualHeight = Math.round(Number(context?.drawingBufferHeight) || 0);
    const widthPx = actualWidth > 0 ? actualWidth : Math.round(frame.width * estimatedDensity);
    const heightPx = actualHeight > 0 ? actualHeight : Math.round(frame.height * estimatedDensity);
    const density = Math.max(0.125, Math.min(4, Math.min(widthPx / frame.width, heightPx / frame.height)));
    return {
      width: Math.max(1, widthPx),
      height: Math.max(1, heightPx),
      density,
    };
  }

  resolutionLabel(render = this.host.state?.render || {}) {
    const size = this.resolutionSize(render);
    const densityLabel = size.density === 1 ? "" : ` @${formatDensity(size.density)}x`;
    return `${size.width}x${size.height}${densityLabel}`;
  }

  previewDiagnosticMarkup(fps, render = this.host.state?.render || {}) {
    const viewport = this.host.presentationGeometry.viewport;
    const logical = this.host.presentationGeometry.displayCanvasSize(render);
    const context = typeof drawingContext !== "undefined" ? drawingContext : null;
    const backingWidth = Math.max(1, Math.round(Number(context?.drawingBufferWidth) || logical.width));
    const backingHeight = Math.max(1, Math.round(Number(context?.drawingBufferHeight) || logical.height));
    const browserWidth = Math.max(1, Math.round(Number(globalThis.window?.innerWidth) || logical.width));
    const browserHeight = Math.max(1, Math.round(Number(globalThis.window?.innerHeight) || logical.height));
    const p5WindowWidth = Math.max(1, Math.round(Number(globalThis.windowWidth) || browserWidth));
    const p5WindowHeight = Math.max(1, Math.round(Number(globalThis.windowHeight) || browserHeight));
    const hostWidth = Math.max(1, Math.round(Number(render.hostViewport?.width) || logical.width));
    const hostHeight = Math.max(1, Math.round(Number(render.hostViewport?.height) || logical.height));
    const configuredDensity = normalizePixelDensity(render.pixelDensity);
    const previewScale = Math.max(0.125, Math.min(8, Number(render.previewRasterScale) || 1));
    const effectiveDensity = this.host.presentationGeometry.pixelDensity(render);
    let actualP5Density =
      Number(this.host.resourceRuntime.lastPixelDensity) ||
      effectiveDensity;
    if (typeof pixelDensity === "function") {
      try {
        actualP5Density = Number(pixelDensity()) || actualP5Density;
      } catch (_error) {
        // Diagnostics must not interfere while p5 reallocates its canvas.
      }
    }
    return [
      `<span>${Math.round(this.smoothedFps || fps)} fps</span><span class="output-resolution">render ${this.resolutionLabel(render)}</span><span>${this.host.presentationGeometry.viewportLabel()}</span><span>pan ${viewport.x},${viewport.y}</span>`,
      `<span>p5 canvas ${logical.width}x${logical.height}</span><span>backing ${backingWidth}x${backingHeight}</span>`,
      `<span>windowWidth ${p5WindowWidth}</span><span>windowHeight ${p5WindowHeight}</span><span>browser ${browserWidth}x${browserHeight}</span><span>host ${hostWidth}x${hostHeight}</span>`,
      `<span>density param ${formatDensity(configuredDensity)}x</span><span>preview scale ${formatDensity(previewScale)}x</span><span>effective ${formatDensity(effectiveDensity)}x</span><span>p5 ${formatDensity(actualP5Density)}x</span>`,
    ].map((line) => `<span class="preview-debug-line">${line}</span>`).join("");
  }

  outputChainMarkup(fps, render = this.host.state?.render || {}) {
    const summary = [
      `<span>${Math.round(this.smoothedFps || fps)} fps</span>`,
      `<span class="output-resolution">${this.resolutionLabel(render)}</span>`,
    ].join("");
    const seen = new Set();
    const rows = [];
    for (const entry of this.host.componentRenderRuntime.lastResolutionTrace || []) {
      const signature = [
        entry.componentId,
        entry.itemId,
        entry.kind,
        entry.width,
        entry.height,
      ].join(":");
      if (seen.has(signature)) continue;
      seen.add(signature);
      const depth = Math.max(0, Math.min(8, Number(entry.depth) || 0));
      rows.push(
        `<span class="output-chain-row" style="--output-chain-depth:${depth}">` +
          `<span class="output-chain-kind">${escapeHudText(entry.kind)}</span>` +
          `<span class="output-chain-name">${escapeHudText(entry.name)}</span>` +
          `<span class="output-chain-resolution">${entry.width}x${entry.height}</span>` +
        `</span>`
      );
    }
    return [
      `<span class="output-hud-summary">${summary}</span>`,
      rows.length
        ? `<span class="output-chain-list">${rows.join("")}</span>`
        : "",
    ].join("");
  }

  update({ frameStart } = {}) {
    const host = this.host;
    const gpuTimer = host.presentationRuntime.gpuTimer;
    const startedAt = Number(frameStart);
    if (!Number.isFinite(startedAt)) {
      throw new Error("VJ1_PRESENTATION_FRAME_START_REQUIRED");
    }
    const frameMs = Math.max(0, performance.now() - startedAt);
    const fps = frameRate();
    const renderCost = frameMs / (1000 / renderMaxFrameRate(host.state?.render));
    this.updateSmoothed({ fps, frameMs, renderCost });
    this.updateGpu();
    if (host.hud) {
      const mediaLoading = host.mode === "output" && !!host.readinessRuntime.status?.blocked;
      const resolution = `<span class="output-resolution">${this.resolutionLabel()}</span>`;
      const diagnostic = host.mode !== "output" && host.state?.ui?.previewDiagnostics === true;
      host.hud.classList.toggle("is-hidden", !host.state.global.showHud);
      host.hud.classList.toggle("is-loading", mediaLoading);
      host.hud.classList.toggle("is-diagnostic", diagnostic);
      const outputChainDiagnostic = host.mode === "output";
      host.hud.classList.toggle("is-chain-diagnostic", outputChainDiagnostic);
      const markup = outputChainDiagnostic
        ? this.outputChainMarkup(fps)
        : diagnostic
        ? this.previewDiagnosticMarkup(fps)
        : `${mediaLoading ? `<span class="output-loading-dot" aria-hidden="true"></span>` : ""}<span>${Math.round(this.smoothedFps || fps)} fps</span>${resolution}`;
      if (host.hud.innerHTML !== markup) host.hud.innerHTML = markup;
    }
    if (millis() - this.lastPublishedAt > 500) {
      this.lastPublishedAt = millis();
      const renderResolution = this.resolutionSize();
      host.sendMetrics?.({
        fps: this.smoothedFps || fps,
        frameMs: this.smoothedFrameMs || frameMs,
        gpuMs: this.smoothedGpuMs || gpuTimer.latestMs || 0,
        gpuSupported: gpuTimer.supported,
        renderCost: this.smoothedRenderCost || renderCost,
        renderWidth: renderResolution.width,
        renderHeight: renderResolution.height,
        renderPixelDensity: renderResolution.density,
        profile: host.profileRuntime.lastFrameProfile,
        signalLoad: host.signalMeter?.snapshot?.() || null,
        message: host.presentationRuntime.shouldUseThumbnailPreview()
          ? "thumbnail preview"
          : host.mode === "component" ? "component preview" : `${host.mode} rendering`,
      });
    }
  }

  updateSmoothed({ fps, frameMs, renderCost }) {
    const alpha = 0.12;
    if (!this.smoothedFrameMs) {
      this.smoothedFrameMs = frameMs;
      this.smoothedFps = fps;
      this.smoothedRenderCost = renderCost;
      return;
    }
    this.smoothedFrameMs += (frameMs - this.smoothedFrameMs) * alpha;
    this.smoothedFps += (fps - this.smoothedFps) * alpha;
    this.smoothedRenderCost += (renderCost - this.smoothedRenderCost) * alpha;
  }

  updateGpu() {
    const gpuTimer = this.host.presentationRuntime.gpuTimer;
    if (gpuTimer.sampleId === this.lastGpuSampleId) return;
    this.lastGpuSampleId = gpuTimer.sampleId;
    const value = Math.max(0, Number(gpuTimer.latestMs) || 0);
    this.smoothedGpuMs = this.smoothedGpuMs
      ? this.smoothedGpuMs + (value - this.smoothedGpuMs) * 0.12
      : value;
  }
}

function formatDensity(value = 1) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeHudText(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
