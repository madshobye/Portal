import {
  createSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js?v=premultiplied-alpha-5";
import { normalizedContentTransform } from "./preview-interaction-geometry.js?v=render-coordinate-scope-3";
import { renderTargetNeedsPresentationFlip } from "./render-target-contract.js?v=source-target-ownership-1";
import { boundedSampleRect } from "./render-draw-utils.js?v=runtime-diagnostics-1";
import {
  componentThumbnailSignature,
  fittedThumbnailSize,
  graphicsToThumbnailBlob,
} from "./thumbnail-utils.js?v=compiled-program-projection-1";

const CAPTURE_SETTLE_MS = 240;
const CAPTURE_RETRY_MS = 600;
const CAPTURE_SPACING_MS = 48;

export class OutputThumbnailRuntime {
  constructor({
    getState,
    getComponentOutput,
    getComponentProgram,
    canCapture,
    shouldUseThumbnailPreview,
    isComponentReady,
    sendThumbnail,
  } = {}) {
    this.getState = getState || (() => null);
    this.getComponentOutput = getComponentOutput || (() => null);
    this.getComponentProgram = getComponentProgram || (() => null);
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
      if (component.systemRole) continue;
      const program = this.getComponentProgram(component.id);
      program?.forEachOperation?.((operation) => {
        const item = operation.configuration;
        if (item?.id) this.transformBaselines.set(`${component.id}:${item.id}`, normalizedContentTransform(item.transform));
      });
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
    const signature = this.componentSignature(component, state.render);
    const needsComponentThumbnail = !component.thumbnail || this.signatures.get(component.id) !== signature;
    let changed = false;
    const liveKeys = new Set();
    if (needsComponentThumbnail) {
      liveKeys.add(component.id);
      changed = this.enqueue({ key: component.id, componentId: component.id, signature }) || changed;
    }
    if (component.type === "scene") {
      for (const surface of state.surfaces || []) {
        const surfaceKey = `${component.id}:${surface.id}`;
        const surfaceSignature = surfaceThumbnailSignature(signature, surface);
        if (component.scene?.surfaceThumbnails?.[surface.id] && this.signatures.get(surfaceKey) === surfaceSignature) continue;
        liveKeys.add(surfaceKey);
        changed = this.enqueue({
          key: surfaceKey,
          componentId: component.id,
          surfaceId: surface.id,
          signature: surfaceSignature,
        }) || changed;
      }
    }
    for (const [key, job] of this.pending) {
      if (job.componentId !== component.id || !liveKeys.has(key)) this.pending.delete(key);
    }
    if (changed && !this.interactionActive) this.scheduleCapture(CAPTURE_SETTLE_MS, { restart: true });
    return changed;
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
        if (!this.idleCallbackUnavailableReported) {
          this.idleCallbackUnavailableReported = true;
          console.warn("[VJ1_IDLE_CALLBACK_UNAVAILABLE]", {
            fallback: "run thumbnail capture directly after the settle timer",
            message: "requestIdleCallback is unavailable",
          });
        }
        this.processNextCapture();
      }
    }, Math.max(0, delay));
    // Thumbnail capture is opportunistic background work. In non-browser
    // hosts such as the Node test runner, its retry timer must not become the
    // owner that keeps the process alive after every renderer client is gone.
    this.scheduleTimer?.unref?.();
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
        surfaceId: job.surfaceId,
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
    const componentSignature = this.componentSignature(component, state.render);
    const currentSignature = job.surfaceId
      ? surfaceThumbnailSignature(componentSignature, state.surfaces?.find((surface) => surface.id === job.surfaceId))
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
    const crop = job.surfaceId ? sceneSurfaceCrop(output, state.surfaces, job.surfaceId) : null;
    if (job.surfaceId && !crop) return true;
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
    const latestComponentSignature = latestComponent && this.componentSignature(latestComponent, latestState.render);
    const latestSignature = job.surfaceId
      ? surfaceThumbnailSignature(latestComponentSignature, latestState.surfaces?.find((surface) => surface.id === job.surfaceId))
      : latestComponentSignature;
    if (latestSignature !== job.signature) {
      this.invalidateSelectedComponent();
      return true;
    }
    this.signatures.set(job.key, job.signature);
    const published = await this.sendThumbnail(job.componentId, blob, job.surfaceId ? { surfaceId: job.surfaceId } : {});
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
        const sample = boundedSampleRect(source, crop, sourceWidth, sourceHeight);
        target.image(
          unwrapRenderTarget(source),
          0, y, size.width, height,
          sample.x, sample.y, sample.width, sample.height
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
      this.captureTarget = createSharedFramebufferTarget(width, height);
      this.captureTarget?.pixelDensity?.(1);
      return this.captureTarget;
    }
    if (this.captureTarget.width !== width || this.captureTarget.height !== height) {
      this.captureTarget.resizeCanvas(width, height);
    }
    return this.captureTarget;
  }

  componentSignature(component, render) {
    const configuration = this.getComponentProgram(component?.id)?.configurationState?.() || [];
    return componentThumbnailSignature(component, render, configuration);
  }
}

function surfaceThumbnailSignature(componentSignature, surface) {
  if (!componentSignature || !surface) return "";
  return `${componentSignature}:${surface.x},${surface.y},${surface.width},${surface.height}`;
}

function selectedComponent(state) {
  return state?.components?.find((item) => item.id === state.ui?.selectedComponentId) || state?.components?.[0] || null;
}

function sceneSurfaceCrop(output, surfaces, surfaceId) {
  const surface = (surfaces || []).find((item) => item.id === surfaceId);
  if (!surface) return null;
  const sourceWidth = Math.max(1, Number(output?.width || output?.canvas?.width) || 1);
  const sourceHeight = Math.max(1, Number(output?.height || output?.canvas?.height) || 1);
  return {
    x: Number(surface.x) * sourceWidth,
    y: Number(surface.y) * sourceHeight,
    width: Math.max(1, Number(surface.width) * sourceWidth),
    height: Math.max(1, Number(surface.height) * sourceHeight),
  };
}
