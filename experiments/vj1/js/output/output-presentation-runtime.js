import { clamp01 } from "../domain/models.js";
import { createPlacedRenderResult } from "../graph/placed-render-result.js";
import { fitRectGeometry } from "../libraries/render-engine/fit-geometry/index.js";
import { applyBlend } from "./blend-utils.js";
import {
  componentLogicalPreviewRect,
  componentPreviewRenderRequest,
  scenePreviewRenderRequest,
} from "./component-render-layout.js";
import { contentTransformCanvasPlacement } from "./content-coordinate-space.js";
import { GpuTimerTracker } from "./gpu-timer-tracker.js";
import { normalizedContentTransform } from "./preview-interaction-geometry.js";
import {
  outputFrames,
  outputFramesForIds,
} from "./render-geometry.js";
import { renderTargetImageGeometry } from "./render-draw-utils.js";
import { unwrapRenderTarget } from "./shared-framebuffer-target.js";

// Owns presentation of already-compiled render results. It may draw the final
// canvas, editor guides, and retained thumbnails, but it cannot compile a graph
// or allocate an intermediate render pass.
export class OutputPresentationRuntime {
  constructor(host) {
    this.host = host;
    this.gpuTimer = new GpuTimerTracker();
  }

  dispose() {
    this.gpuTimer.dispose?.();
  }

  draw() {
    const host = this.host;
    if (!host.state) return;
    host.mediaRuntime.beginFrame();
    host.controlSignalRuntime.beginFrame?.();
    host.livePatchRuntime.applyFrame();
    try {
      return this.drawFrame();
    } finally {
      host.livePatchRuntime.restoreFrame();
      host.controlSignalRuntime.endFrame?.();
      host.mediaRuntime.endFrame();
    }
  }

  drawFrame() {
    const host = this.host;
    host.recordSignal(
      host.mode === "output" ? "outputPresentations" : "previewPresentations",
      1,
      host.mode,
    );
    this.gpuTimer.poll(host.frameRuntime.frameIndex);
    host.frameRuntime.begin(performance.now());
    host.readinessRuntime.refresh();
    if (host.readinessRuntime.shouldHoldFrame()) {
      this.finishFrame();
      return;
    }
    host.componentRenderRuntime.beginFrame();
    host.presentationMetrics.beginFrame();
    host.frameRuntime.drainScheduledEvents();
    background(0);
    if (this.shouldUseThumbnailPreview()) this.renderThumbnailComponents();
    else this.renderComponents();
    if (host.mode === "component") {
      this.measureGpu(drawingContext, () =>
        host.presentationGeometry.withViewportTransform(() =>
          this.renderComponentPreview(),
        ),
      );
      this.finishFrame();
      return;
    }
    host.presentationGeometry.withViewportTransform(() => {
      host.surfaceRuntime.renderSurfaces();
      this.measureGpu(drawingContext, () => {
        const outputBlackout = host.readinessRuntime.isBlackout();
        const mapper = host.mappingRuntime.mapper;
        const restoreCalibrate =
          outputBlackout && mapper?.isCalibrating?.();
        if (restoreCalibrate) mapper.setCalibrate(false);
        const pointer = host.presentationGeometry.previewPointToWorld({
          x: globalThis.mouseX,
          y: globalThis.mouseY,
        });
        mapper.drawOverlays(pointer.x, pointer.y);
        this.renderMappingFrameOverlay();
        this.renderSelectedSurfaceOverlay();
        if (restoreCalibrate) mapper.setCalibrate(true);
      });
    });
    this.finishFrame();
  }

  finishFrame() {
    const host = this.host;
    this.gpuTimer.sealFrame(host.frameRuntime.frameIndex);
    host.frameRuntime.finish();
  }

  measureGpu(target, draw) {
    const token = this.gpuTimer.begin(
      target,
      this.host.frameRuntime.frameIndex,
    );
    try {
      return draw();
    } finally {
      this.gpuTimer.end(token);
    }
  }

  renderSelectedSurfaceOverlay() {
    const host = this.host;
    if (host.mode === "output") return;
    const workspace = host.state?.ui?.workspace;
    const mappingSelection = workspace === "mapping";
    const liveSelection = workspace === "live";
    if (!mappingSelection && !liveSelection) return;
    const surfaceId = host.state?.ui?.selectedSurfaceId;
    if (!surfaceId) return;
    const calibrating = !!host.mappingRuntime.mapper?.isCalibrating?.();
    const revealHandles =
      mappingSelection &&
      calibrating &&
      (host.state?.global?.mappingHandleMode !== "near" ||
        this.shouldRevealSurfaceOverlay(surfaceId));
    const mapped = host.mappingRuntime.surfaces.get(surfaceId);
    if (mapped?.direct) {
      if (liveSelection) this.renderSelectedDirectOutputFrameOverlay(surfaceId);
      return;
    }
    const corners = mapped?.mapperSurface?.corners;
    if (!Array.isArray(corners) || corners.length !== 4) return;

    const gl = drawingContext;
    if (gl?.disable) gl.disable(gl.DEPTH_TEST);
    push();
    const w2 = width * 0.5;
    const h2 = height * 0.5;
    noFill();
    stroke(255, 232, 92);
    strokeWeight(revealHandles ? 5 : 3);
    beginShape();
    for (const corner of corners) vertex(corner.x - w2, corner.y - h2, 1);
    endShape(CLOSE);
    if (!revealHandles) {
      pop();
      if (gl?.enable) gl.enable(gl.DEPTH_TEST);
      return;
    }
    noStroke();
    for (const corner of corners) {
      fill(255, 232, 92, 170);
      circle(corner.x - w2, corner.y - h2, 34);
      fill(255);
      circle(corner.x - w2, corner.y - h2, 14);
    }
    pop();
    if (gl?.enable) gl.enable(gl.DEPTH_TEST);
  }

  renderMappingFrameOverlay() {
    const host = this.host;
    if (!isMappingProjectionPresentation(host)) return;
    const frames = outputFrames(
      host.presentationGeometry.mappingProjectRender(),
    );
    this.drawOutputFrameBoundaries(frames, {
      color: [101, 224, 211, 190],
      weight: 2,
    });
  }

  renderSelectedDirectOutputFrameOverlay(surfaceId) {
    const host = this.host;
    const surface = host.state?.surfaces?.find(
      (item) => String(item.id) === String(surfaceId),
    );
    if (surface?.destination?.type !== "direct") return;
    const frames = outputFramesForIds(
      host.presentationGeometry.mappingProjectRender(),
      surface.destination.outputIds || [],
    );
    this.drawOutputFrameBoundaries(frames, {
      color: [255, 232, 92],
      weight: 3,
    });
  }

  drawOutputFrameBoundaries(
    frames = [],
    { color = [255], weight = 2 } = {},
  ) {
    if (!frames.length) return;
    const gl = drawingContext;
    if (gl?.disable) gl.disable(gl.DEPTH_TEST);
    resetShader();
    push();
    noFill();
    rectMode(CORNER);
    stroke(...color);
    strokeWeight(weight);
    for (const frame of frames) {
      rect(
        Number(frame.x || 0) - width * 0.5,
        Number(frame.y || 0) - height * 0.5,
        Math.max(1, Number(frame.width) || 1),
        Math.max(1, Number(frame.height) || 1),
      );
    }
    pop();
    if (gl?.enable) gl.enable(gl.DEPTH_TEST);
  }

  shouldRevealSurfaceOverlay(surfaceId) {
    const host = this.host;
    const mapped = host.mappingRuntime.surfaces.get(surfaceId);
    const corners = mapped?.mapperSurface?.corners;
    if (!Array.isArray(corners)) return false;
    if (mapped?.mapperSurface?.dragging !== -1) return true;
    const pointer = host.presentationGeometry.previewPointToWorld({
      x: typeof mouseX === "number" ? mouseX : -99999,
      y: typeof mouseY === "number" ? mouseY : -99999,
    });
    const radius = host.mappingRuntime.mapper?.pickRadius || 60;
    return corners.some((corner) => {
      const dx = pointer.x - corner.x;
      const dy = pointer.y - corner.y;
      return dx * dx + dy * dy <= radius * radius;
    });
  }

  renderComponents() {
    const host = this.host;
    const resources = host.resourceRuntime;
    resources.componentOutput.clear();
    resources.mainMix.push();
    resources.mainMix.clear();
    resources.mainMix.pop();
    if (host.readinessRuntime.isBlackout() || host.mode !== "component") {
      return;
    }

    const neededComponentIds = this.neededComponentIds();
    for (const component of host.state.components || []) {
      if (
        neededComponentIds.size &&
        !neededComponentIds.has(component.id)
      ) {
        continue;
      }
      const componentTime =
        host.frameRuntime.componentTimes.get(component.id) || 0;
      const request =
        component.type === "scene"
          ? scenePreviewRenderRequest(
              host.state?.render || {},
              component,
              width,
              height,
              {
                reason: "component-preview",
                renderIdentity: component.id,
              },
            )
          : componentPreviewRenderRequest(
              host.state.render,
              component,
              width,
              height,
              host.presentationGeometry.pixelDensity(host.state.render),
              {
                reason: "component-preview",
                renderIdentity: component.id,
              },
            );
      const output = host.componentRenderRuntime.render(
        component,
        componentTime,
        request,
      );
      host.presentationMetrics.recordPresentedRequest(request);
      resources.componentOutput.set(component.id, output);
      const rect = containedRect(
        resources.mainMix.width,
        resources.mainMix.height,
        output.width,
        output.height,
      );
      resources.mainMix.push();
      applyBlend(resources.mainMix, component.blend);
      resources.mainMix.tint(255, 255 * clamp01(component.opacity));
      host.sourceRuntime.drawPlacedResultGeometry(
        resources.mainMix,
        createPlacedRenderResult(output, {
          destinationRect: rect,
          transform: component.transform,
          sourceIsWebGL: host.renderTargetRuntime.isShaderBuffer(output),
        }),
      );
      resources.mainMix.noTint();
      resources.mainMix.blendMode(BLEND);
      resources.mainMix.pop();
    }
  }

  renderThumbnailComponents() {
    const host = this.host;
    const resources = host.resourceRuntime;
    resources.componentOutput.clear();
    resources.mainMix.push();
    resources.mainMix.clear();
    resources.mainMix.pop();
  }

  neededComponentIds() {
    const host = this.host;
    const ids = new Set();
    if (host.mode === "component") {
      const selected =
        host.state.ui.selectedComponentId ||
        host.state.components[0]?.id ||
        "";
      if (selected) ids.add(selected);
      return ids;
    }
    for (const surface of host.state.surfaces || []) {
      if (surface.enabled && surface.componentId) {
        ids.add(surface.componentId);
      }
    }
    return ids;
  }

  renderComponentPreview() {
    const host = this.host;
    const componentId =
      host.state.ui.selectedComponentId ||
      host.state.components[0]?.id ||
      "";
    const component = host.state.components.find(
      (item) => item.id === componentId,
    );
    const source = host.resourceRuntime.componentOutput.get(componentId);
    resetShader();
    push();
    imageMode(CORNER);
    if (this.shouldUseThumbnailPreview()) {
      const drewSceneSnapshot =
        component?.type === "scene" &&
        this.renderSceneThumbnailSnapshotPreview(component);
      if (!drewSceneSnapshot && component?.type !== "scene") {
        this.renderFlattenedThumbnailEditPreview(component);
      }
    } else if (source) {
      const rect = this.componentPreviewRect(component, source);
      const geometry = renderTargetImageGeometry(source, {
        x: rect.x - width / 2,
        y: rect.y - height / 2,
        width: rect.width,
        height: rect.height,
      });
      image(
        unwrapRenderTarget(source),
        geometry.destination.x,
        geometry.destination.y,
        geometry.destination.width,
        geometry.destination.height,
      );
    } else {
      image(
        unwrapRenderTarget(host.resourceRuntime.mainMix),
        -width / 2,
        -height / 2,
        width,
        height,
      );
    }
    pop();
    host.previewInteraction.renderComponentFrameOverlay(component, source);
    host.previewInteraction.renderSceneSurfaces(component, source);
    host.previewInteraction.renderSelectedChainTransformOverlay();
  }

  renderFlattenedThumbnailEditPreview(component) {
    const host = this.host;
    const thumbnail = host.thumbnailRuntime.getThumbnailImage(component);
    if (!thumbnail?.ready || !thumbnail.img) return false;
    const rect = this.componentPreviewRect(component);
    const item = host.previewInteraction.selectedTransformableChainItem();
    const current = normalizedContentTransform(item?.transform);
    const baseline = item
      ? host.thumbnailRuntime.transformBaselines.get(
          `${component.id}:${item.id}`,
        ) || current
      : current;
    const editScale = current.scale / Math.max(0.01, baseline.scale);
    const editPlacement = contentTransformCanvasPlacement(
      {
        x: current.x - baseline.x,
        y: current.y - baseline.y,
      },
      rect.width,
      rect.height,
    );
    withScreenScissor(
      rect,
      () => {
        push();
        translate(
          rect.x - width * 0.5 + editPlacement.centerX,
          rect.y - height * 0.5 + editPlacement.centerY,
        );
        rotate(current.rotation - baseline.rotation);
        scale(editScale);
        drawImageCoverCrop(
          thumbnail.img,
          -rect.width * 0.5,
          -rect.height * 0.5,
          rect.width,
          rect.height,
        );
        pop();
      },
      host.presentationGeometry.viewportTransform(),
    );
    return true;
  }

  renderSceneThumbnailSnapshotPreview(component) {
    const host = this.host;
    const thumbnail = host.thumbnailRuntime.getThumbnailImage(component);
    if (!thumbnail?.ready || !thumbnail.img) return false;
    const rect = this.componentPreviewRect(component);
    withScreenScissor(
      rect,
      () => {
        drawImageCoverCrop(
          thumbnail.img,
          rect.x - width * 0.5,
          rect.y - height * 0.5,
          rect.width,
          rect.height,
        );
      },
      host.presentationGeometry.viewportTransform(),
    );
    return true;
  }

  componentPreviewRect(component, source = null) {
    const host = this.host;
    return componentLogicalPreviewRect(
      host.state?.render || {},
      component || {},
      width,
      height,
      {
        sceneEditorWorld:
          host.mode === "component" &&
          host.state?.ui?.workspace === "scene",
      },
    );
  }

  shouldUseThumbnailPreview() {
    const host = this.host;
    return (
      (host.mode === "preview" ||
        host.mode === "component" ||
        host.mode === "live") &&
      host.state?.ui?.debugPreview === false
    );
  }
}

// Mapping and Live share one projected output-matrix presentation. Live's
// Scene Mapping row deliberately does not opt in: it is the flat source
// monitor whose guides describe Scene-space crops instead.
export function isMappingProjectionPresentation(host = {}) {
  const workspace = host.state?.ui?.workspace;
  return (
    (host.mode === "preview" && workspace === "mapping") ||
    (host.mode === "live" &&
      workspace === "live" &&
      host.state?.livePreviewPresentation === "mapping")
  );
}

function containedRect(
  containerWidth,
  containerHeight,
  contentWidth,
  contentHeight,
) {
  return fitRectGeometry(
    { x: 0, y: 0, width: contentWidth, height: contentHeight },
    { x: 0, y: 0, width: containerWidth, height: containerHeight },
    "contain",
  ).destination;
}

function drawImageCoverCrop(source, x, y, targetWidth, targetHeight) {
  const sourceWidth = Math.max(
    1,
    Number(
      source?.width ||
        source?.naturalWidth ||
        source?.elt?.naturalWidth,
    ) || targetWidth,
  );
  const sourceHeight = Math.max(
    1,
    Number(
      source?.height ||
        source?.naturalHeight ||
        source?.elt?.naturalHeight,
    ) || targetHeight,
  );
  const fitted = fitRectGeometry(
    { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
    { x, y, width: targetWidth, height: targetHeight },
    "cover",
  );
  image(
    source,
    fitted.destination.x,
    fitted.destination.y,
    fitted.destination.width,
    fitted.destination.height,
    fitted.source.x,
    fitted.source.y,
    fitted.source.width,
    fitted.source.height,
  );
}

// Editor-only clip for transformed stale thumbnails. This changes GL scissor
// state around an existing draw; it does not create a render target or pass.
function withScreenScissor(rect = {}, draw, viewport = {}) {
  const gl =
    typeof drawingContext !== "undefined" ? drawingContext : null;
  if (!gl?.scissor || !gl?.enable || typeof draw !== "function") {
    return draw?.();
  }
  const canvasWidth = Math.max(
    1,
    Number(
      typeof width === "number" ? width : gl.drawingBufferWidth,
    ) || 1,
  );
  const canvasHeight = Math.max(
    1,
    Number(
      typeof height === "number" ? height : gl.drawingBufferHeight,
    ) || 1,
  );
  const scaleX =
    Math.max(0.0001, Number(gl.drawingBufferWidth) || canvasWidth) /
    canvasWidth;
  const scaleY =
    Math.max(0.0001, Number(gl.drawingBufferHeight) || canvasHeight) /
    canvasHeight;
  const zoom = Math.max(
    0.1,
    Math.min(6, Number(viewport.zoom) || 1),
  );
  const panX = Number(viewport.x) || 0;
  const panY = Number(viewport.y) || 0;
  const transformedLeft =
    canvasWidth * 0.5 +
    ((Number(rect.x) || 0) - canvasWidth * 0.5) * zoom +
    panX;
  const transformedTop =
    canvasHeight * 0.5 +
    ((Number(rect.y) || 0) - canvasHeight * 0.5) * zoom +
    panY;
  const left = Math.max(0, Math.min(canvasWidth, transformedLeft));
  const top = Math.max(0, Math.min(canvasHeight, transformedTop));
  const right = Math.max(
    left,
    Math.min(
      canvasWidth,
      transformedLeft +
        Math.max(0, Number(rect.width) || 0) * zoom,
    ),
  );
  const bottom = Math.max(
    top,
    Math.min(
      canvasHeight,
      transformedTop +
        Math.max(0, Number(rect.height) || 0) * zoom,
    ),
  );
  const wasEnabled = gl.isEnabled?.(gl.SCISSOR_TEST) === true;
  const previousBox = gl.getParameter?.(gl.SCISSOR_BOX);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(
    Math.floor(left * scaleX),
    Math.floor((canvasHeight - bottom) * scaleY),
    Math.max(1, Math.ceil((right - left) * scaleX)),
    Math.max(1, Math.ceil((bottom - top) * scaleY)),
  );
  try {
    return draw();
  } finally {
    if (previousBox?.length === 4) {
      gl.scissor(
        previousBox[0],
        previousBox[1],
        previousBox[2],
        previousBox[3],
      );
    }
    if (!wasEnabled) gl.disable(gl.SCISSOR_TEST);
  }
}
