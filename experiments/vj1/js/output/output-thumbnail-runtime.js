import {
  createSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js?v=render-diagnostics-1";
import { canvasFrameSize } from "../domain/render-settings.js?v=canvas-global-resolution-1";
import { normalizedContentTransform } from "./preview-interaction-geometry.js?v=render-coordinate-scope-3";
import { renderTargetNeedsPresentationFlip } from "./render-target-contract.js?v=render-core-contract-1";
import {
  componentThumbnailSignature,
  fittedThumbnailSize,
  graphicsToThumbnailBlob,
} from "./thumbnail-utils.js?v=thumbnail-pipeline-1";

const CAPTURE_SETTLE_MS = 240;
const CAPTURE_RETRY_MS = 600;
const CAPTURE_SPACING_MS = 48;

export class OutputThumbnailRuntime {
  constructor({ getState, getComponentOutput, canCapture, shouldUseThumbnailPreview, isComponentReady, sendThumbnail } = {}) {
    this.getState = getState || (() => null);
    this.getComponentOutput = getComponentOutput || (() => null);
    this.canCapture = canCapture || (() => true);
    this.shouldUseThumbnailPreview = shouldUseThumbnailPreview || (() => false);
    this.isComponentReady = isComponentReady || (() => true);
    this.sendThumbnail = sendThumbnail;
    this.images = new Map();
    this.transformBaselines = new Map();
    this.signatures = new Map();
    this.pending = new Map();
    this.captureTarget = null;
    this.scheduleTimer = 0;
    this.idleHandle = 0;
    this.interactionActive = false;
    this.captureInFlight = false;
    this.generation = 0;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
    this.cancelSchedule();
    this.captureTarget?.remove?.();
    this.captureTarget = null;
    this.pending.clear();
    this.images.clear();
    this.transformBaselines.clear();
    this.signatures.clear();
  }

  getThumbnailImage(component) {
    if (!component?.thumbnail) return null;
    const existing = this.images.get(component.id);
    if (existing?.src === component.thumbnail) return existing;
    const item = { src: component.thumbnail, img: null, ready: false };
    this.images.set(component.id, item);
    loadImage(
      component.thumbnail,
      (img) => {
        item.img = img;
        item.ready = true;
      },
      () => {
        item.ready = false;
      }
    );
    return item;
  }

  captureEditTransformBaselines() {
    this.transformBaselines.clear();
    for (const component of this.getState()?.components || []) {
      for (const item of nestedChainItems(component.chain || [])) {
        if (item?.id) this.transformBaselines.set(`${component.id}:${item.id}`, normalizedContentTransform(item.transform));
      }
    }
  }

  setInteractionActive(active) {
    this.interactionActive = !!active;
    if (this.interactionActive) {
      this.cancelSchedule();
      return;
    }
    if (this.pending.size) this.scheduleCapture(CAPTURE_SETTLE_MS);
  }

  invalidateSelectedComponent() {
    if (!this.sendThumbnail || !this.canCapture() || this.shouldUseThumbnailPreview()) {
      this.cancelSchedule();
      this.pending.clear();
      return false;
    }
    const state = this.getState();
    const component = selectedComponent(state);
    if (!component) return false;
    const signature = componentThumbnailSignature(component, state.render);
    const needsComponentThumbnail = !component.thumbnail || this.signatures.get(component.id) !== signature;
    let changed = false;
    const liveKeys = new Set();
    if (needsComponentThumbnail) {
      liveKeys.add(component.id);
      changed = this.enqueue({ key: component.id, componentId: component.id, frameId: "", signature }) || changed;
    }
    if (component.type === "canvas") {
      for (const frame of state.recordingFrames || []) {
        const frameKey = `${component.id}:${frame.id}`;
        const frameSignature = `${signature}:${frame.x},${frame.y},${frame.width},${frame.height}`;
        if (component.canvas?.frameThumbnails?.[frame.id] && this.signatures.get(frameKey) === frameSignature) continue;
        liveKeys.add(frameKey);
        changed = this.enqueue({
          key: frameKey,
          componentId: component.id,
          frameId: frame.id,
          signature: frameSignature,
        }) || changed;
      }
    }
    for (const [key, job] of this.pending) {
      if (job.componentId !== component.id || !liveKeys.has(key)) this.pending.delete(key);
    }
    if (changed && !this.interactionActive) this.scheduleCapture(CAPTURE_SETTLE_MS, { restart: true });
    return changed;
  }

  captureSelectedComponentThumbnail() {
    return this.invalidateSelectedComponent();
  }

  enqueue(job) {
    const existing = this.pending.get(job.key);
    if (existing?.signature === job.signature) return false;
    this.pending.set(job.key, { ...job, generation: ++this.generation });
    return true;
  }

  scheduleCapture(delay = CAPTURE_SETTLE_MS, { restart = false } = {}) {
    if (this.disposed || this.interactionActive || this.captureInFlight || !this.pending.size) return;
    if (restart) this.cancelSchedule();
    if (this.scheduleTimer || this.idleHandle) return;
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = 0;
      if (this.disposed || this.interactionActive) return;
      if (typeof globalThis.requestIdleCallback === "function") {
        this.idleHandle = globalThis.requestIdleCallback(() => {
          this.idleHandle = 0;
          this.processNextCapture();
        }, { timeout: CAPTURE_RETRY_MS });
      } else {
        this.processNextCapture();
      }
    }, Math.max(0, delay));
  }

  cancelSchedule() {
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
    if (this.idleHandle && typeof globalThis.cancelIdleCallback === "function") {
      globalThis.cancelIdleCallback(this.idleHandle);
    }
    this.scheduleTimer = 0;
    this.idleHandle = 0;
  }

  async processNextCapture() {
    if (this.disposed || this.interactionActive || this.captureInFlight || !this.pending.size) return;
    const job = this.pending.values().next().value;
    this.pending.delete(job.key);
    this.captureInFlight = true;
    let retry = false;
    try {
      retry = !(await this.captureJob(job));
    } catch (error) {
      console.warn("[VJ1_THUMBNAIL_CAPTURE_FAILED]", {
        componentId: job.componentId,
        frameId: job.frameId,
        fallback: "retain the previous thumbnail and retry after the renderer settles",
        message: error?.message || String(error),
      });
      retry = true;
    } finally {
      this.captureInFlight = false;
    }
    if (retry && !this.disposed && !this.pending.has(job.key)) this.pending.set(job.key, job);
    if (this.pending.size) this.scheduleCapture(retry ? CAPTURE_RETRY_MS : CAPTURE_SPACING_MS);
  }

  async captureJob(job) {
    if (!this.canCapture() || this.shouldUseThumbnailPreview()) return true;
    if (this.interactionActive) return false;
    const state = this.getState();
    const component = selectedComponent(state);
    if (!component || component.id !== job.componentId) return true;
    const componentSignature = componentThumbnailSignature(component, state.render);
    const currentSignature = job.frameId
      ? frameThumbnailSignature(componentSignature, state.recordingFrames?.find((frame) => frame.id === job.frameId))
      : componentSignature;
    if (currentSignature !== job.signature) {
      this.invalidateSelectedComponent();
      return true;
    }
    // A rendered buffer is not necessarily content-ready: async media and AI
    // generators deliberately render a transparent/debug standby frame while
    // resolving. Keep the prior thumbnail visible until real content exists.
    if (!this.isComponentReady(component)) return false;
    const output = this.getComponentOutput(component.id);
    if (!output) return false;
    const crop = job.frameId ? canvasFrameCrop(output, state.render, state.recordingFrames, job.frameId) : null;
    if (job.frameId && !crop) return true;
    const readback = this.readSmallThumbnail(output, crop);
    if (!readback) return false;
    let blob = null;
    try {
      blob = await graphicsToThumbnailBlob(readback);
    } finally {
      readback?.remove?.();
    }
    if (!blob) return false;
    if (this.disposed || !this.canCapture() || this.shouldUseThumbnailPreview()) return true;
    const latest = this.pending.get(job.key);
    if (latest && latest.generation > job.generation) return true;
    const latestState = this.getState();
    const latestComponent = latestState?.components?.find((item) => item.id === job.componentId);
    const latestComponentSignature = latestComponent && componentThumbnailSignature(latestComponent, latestState.render);
    const latestSignature = job.frameId
      ? frameThumbnailSignature(latestComponentSignature, latestState.recordingFrames?.find((frame) => frame.id === job.frameId))
      : latestComponentSignature;
    if (latestSignature !== job.signature) {
      this.invalidateSelectedComponent();
      return true;
    }
    this.signatures.set(job.key, job.signature);
    const published = await this.sendThumbnail(job.componentId, blob, job.frameId ? { frameId: job.frameId } : {});
    if (published === false) this.signatures.delete(job.key);
    return true;
  }

  readSmallThumbnail(source, crop = null) {
    const sourceWidth = Math.max(1, Number(source?.width || source?.canvas?.width) || 1);
    const sourceHeight = Math.max(1, Number(source?.height || source?.canvas?.height) || 1);
    const sampleWidth = Math.max(1, Number(crop?.width) || sourceWidth);
    const sampleHeight = Math.max(1, Number(crop?.height) || sourceHeight);
    const size = fittedThumbnailSize(sampleWidth, sampleHeight);
    const target = this.ensureCaptureTarget(size.width, size.height);
    if (!target) return null;
    target.push();
    try {
      target.clear();
      target.imageMode(globalThis.CORNER ?? "corner");
      const flip = renderTargetNeedsPresentationFlip(source);
      const y = flip ? size.height : 0;
      const height = flip ? -size.height : size.height;
      if (crop) {
        target.image(
          unwrapRenderTarget(source),
          0, y, size.width, height,
          crop.x, crop.y, crop.width, crop.height
        );
      } else {
        target.image(unwrapRenderTarget(source), 0, y, size.width, height);
      }
    } finally {
      target.pop();
    }
    return target.get();
  }

  ensureCaptureTarget(width, height) {
    if (!this.captureTarget) {
      this.captureTarget = createSharedFramebufferTarget(width, height) || globalThis.createGraphics?.(width, height);
      this.captureTarget?.pixelDensity?.(1);
      return this.captureTarget;
    }
    if (this.captureTarget.width !== width || this.captureTarget.height !== height) {
      this.captureTarget.resizeCanvas(width, height);
    }
    return this.captureTarget;
  }
}

function* nestedChainItems(chain = []) {
  for (const item of chain || []) {
    if (!item) continue;
    yield item;
    if (item.kind === "group") yield* nestedChainItems(item.chain || []);
  }
}

function frameThumbnailSignature(componentSignature, frame) {
  if (!componentSignature || !frame) return "";
  return `${componentSignature}:${frame.x},${frame.y},${frame.width},${frame.height}`;
}

function selectedComponent(state) {
  return state?.components?.find((item) => item.id === state.ui?.selectedComponentId) || state?.components?.[0] || null;
}

function canvasFrameCrop(output, render, frames, frameId) {
  const frame = (frames || []).find((item) => item.id === frameId);
  if (!frame) return null;
  const sourceWidth = Math.max(1, Number(output?.width || output?.canvas?.width) || 1);
  const sourceHeight = Math.max(1, Number(output?.height || output?.canvas?.height) || 1);
  return {
    x: Number(frame.x) * sourceWidth,
    y: Number(frame.y) * sourceHeight,
    width: Math.max(1, Number(frame.width) * sourceWidth),
    height: Math.max(1, Number(frame.height) * sourceHeight),
  };
}
