import { isSharedFramebufferTarget } from "./shared-framebuffer-target.js?v=render-diagnostics-1";
import { canvasFrameSize } from "../domain/render-settings.js?v=canvas-global-resolution-1";
import { normalizedContentTransform } from "./preview-interaction-geometry.js?v=render-coordinate-scope-3";
import {
  COMPONENT_THUMBNAIL_HEIGHT,
  COMPONENT_THUMBNAIL_WIDTH,
  componentThumbnailSignature,
  graphicsToThumbnail,
} from "./thumbnail-utils.js?v=canvas-global-resolution-1";

export class OutputThumbnailRuntime {
  constructor({ getState, getComponentOutput, shouldUseThumbnailPreview, isComponentReady, sendThumbnail } = {}) {
    this.getState = getState || (() => null);
    this.getComponentOutput = getComponentOutput || (() => null);
    this.shouldUseThumbnailPreview = shouldUseThumbnailPreview || (() => false);
    this.isComponentReady = isComponentReady || (() => true);
    this.sendThumbnail = sendThumbnail;
    this.images = new Map();
    this.transformBaselines = new Map();
    this.signatures = new Map();
    this.lastCaptureAt = 0;
  }

  dispose() {
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

  captureSelectedComponentThumbnail() {
    if (this.shouldUseThumbnailPreview()) return;
    const now = runtimeMillis();
    if (!this.sendThumbnail || now - this.lastCaptureAt < 1200) return;
    const state = this.getState();
    const component = state?.components?.find((item) => item.id === state.ui?.selectedComponentId) || state?.components?.[0];
    if (!component) return;
    // A rendered buffer is not necessarily content-ready: async media and AI
    // generators deliberately render a transparent/debug standby frame while
    // resolving. Never persist that transient frame as the component preview.
    if (!this.isComponentReady(component)) return;
    const output = this.getComponentOutput(component.id);
    if (!output) return;
    const signature = componentThumbnailSignature(component, state.render);
    const needsComponentThumbnail = !component.thumbnail || this.signatures.get(component.id) !== signature;
    const framesNeedingThumbnails = component.type === "canvas"
      ? (state.recordingFrames || []).filter((frame) => {
          const frameKey = `${component.id}:${frame.id}`;
          const frameSignature = `${signature}:${frame.x},${frame.y},${frame.width},${frame.height}`;
          return !component.canvas?.frameThumbnails?.[frame.id] || this.signatures.get(frameKey) !== frameSignature;
        })
      : [];
    // Prove staleness before a potentially expensive WebGL readback.
    this.lastCaptureAt = now;
    if (!needsComponentThumbnail && !framesNeedingThumbnails.length) return;
    const readback = isSharedFramebufferTarget(output);
    const thumbnailSource = readback ? output.get() : output;
    if (needsComponentThumbnail) {
      const thumbnail = graphicsToThumbnail(thumbnailSource);
      if (thumbnail) {
        this.signatures.set(component.id, signature);
        this.sendThumbnail(component.id, thumbnail);
      }
    }
    if (component.type === "canvas") {
      const sourceWidth = Math.max(1, Number(thumbnailSource?.width || thumbnailSource?.canvas?.width) || 1);
      const sourceHeight = Math.max(1, Number(thumbnailSource?.height || thumbnailSource?.canvas?.height) || 1);
      const { width: logicalWidth, height: logicalHeight } = canvasFrameSize(state.render);
      for (const frame of framesNeedingThumbnails) {
        const frameKey = `${component.id}:${frame.id}`;
        const frameSignature = `${signature}:${frame.x},${frame.y},${frame.width},${frame.height}`;
        const frameThumbnail = graphicsToThumbnail(thumbnailSource, COMPONENT_THUMBNAIL_WIDTH, COMPONENT_THUMBNAIL_HEIGHT, {
          x: Number(frame.x) * sourceWidth / logicalWidth,
          y: Number(frame.y) * sourceHeight / logicalHeight,
          width: Number(frame.width) * sourceWidth / logicalWidth,
          height: Number(frame.height) * sourceHeight / logicalHeight,
        });
        if (!frameThumbnail) continue;
        this.signatures.set(frameKey, frameSignature);
        this.sendThumbnail(component.id, frameThumbnail, { frameId: frame.id });
      }
    }
    if (readback) thumbnailSource?.remove?.();
  }
}

function* nestedChainItems(chain = []) {
  for (const item of chain || []) {
    if (!item) continue;
    yield item;
    if (item.kind === "group") yield* nestedChainItems(item.chain || []);
  }
}

function runtimeMillis() {
  return typeof globalThis.millis === "function" ? globalThis.millis() : Date.now();
}
