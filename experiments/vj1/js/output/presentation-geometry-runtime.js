import { normalizePixelDensity } from "../domain/render-settings.js";
import { componentTextureSize } from "../domain/render-resolution.js";
import { fitOverflowDestination } from "../libraries/render-engine/fit-geometry/index.js";
import {
  frameSize,
  mappingWorldRender,
  outputFrameForId,
  outputFrameOffset,
  outputFrames,
  outputSpanRect,
  worldSize,
} from "./render-geometry.js";
import { rectToCorners } from "./component-render-layout.js";

export class PresentationGeometryRuntime {
  constructor(host) {
    this.host = host;
    this.viewport = { zoom: 1, x: 0, y: 0 };
  }

  renderSizeSignature(render = {}) {
    const frame = this.outputFrameSize(render);
    const world = worldSize(render);
    const texture = componentTextureSize(render);
    const density = this.pixelDensity(render);
    const outputs = outputFrames(render)
      .map((output) => `${output.id}:${output.width}x${output.height}@${output.x},${output.y}`)
      .join("|");
    return `${this.host.outputId}:${frame.width}x${frame.height}:${outputs}:${world.width}x${world.height}:ct${texture.width}x${texture.height}:ceiling${render.resolutionCeiling || "auto"}:pd${density}`;
  }

  outputFrameSize(render = this.host.state?.render || {}) {
    return frameSize(render, this.host.mode === "output" ? this.host.outputId : "");
  }

  displayCanvasSize(render = this.host.state?.render || {}) {
    const fallback = frameSize(render);
    return {
      width: Math.max(1, Math.floor(Number(typeof width === "number" ? width : fallback.width) || fallback.width)),
      height: Math.max(1, Math.floor(Number(typeof height === "number" ? height : fallback.height) || fallback.height)),
    };
  }

  pixelDensity(render = this.host.state?.render || {}) {
    const configured = normalizePixelDensity(render.pixelDensity);
    const demandScale = Math.max(0.125, Math.min(8, Number(render.previewRasterScale) || 1));
    return Math.max(0.125, Math.min(4, configured * demandScale));
  }

  viewportLabel() {
    return `${this.viewport.zoom.toFixed(2)}x view`;
  }

  viewportTransform(render = this.host.state?.render || {}) {
    if (this.host.mode === "output") return { zoom: 1, x: 0, y: 0 };
    const { zoom: userZoom, x: userX, y: userY } = this.viewport;
    if (this.host.mode === "component") return { zoom: userZoom, x: userX, y: userY };
    const display = this.displayCanvasSize(render);
    const project = worldSize(this.mappingProjectRender());
    const baseScale = Math.min(
      display.width / Math.max(1, project.width),
      display.height / Math.max(1, project.height),
    );
    const zoom = Math.max(0.01, baseScale * userZoom);
    return {
      zoom,
      // p5 WEBGL draws authored top-left coordinates relative to the current
      // display canvas centre (the mapper subtracts display / 2 from every
      // authored point). This is therefore a model-space translation, not a
      // top-left CSS offset. Compensate for the difference between the
      // display and project centres before applying the shared zoom.
      x: userX + (display.width - project.width) * 0.5 * zoom,
      y: userY + (display.height - project.height) * 0.5 * zoom,
    };
  }

  setViewport(viewport = {}) {
    if (this.host.mode === "output") return false;
    const changed = this.assignViewport({
      previewViewportZoom: viewport.zoom,
      previewViewportX: viewport.x,
      previewViewportY: viewport.y,
    });
    if (changed) this.host.invalidatePresentation("preview-viewport");
    return changed;
  }

  assignViewport(render = {}) {
    const next = {
      zoom: Math.max(0.1, Math.min(6, Number(render?.previewViewportZoom) || 1)),
      x: Number(render?.previewViewportX) || 0,
      y: Number(render?.previewViewportY) || 0,
    };
    const current = this.viewport;
    if (next.zoom === current.zoom && next.x === current.x && next.y === current.y) return false;
    this.viewport = next;
    return true;
  }

  withViewportTransform(draw) {
    if (typeof draw !== "function") return undefined;
    const viewport = this.viewportTransform();
    if (this.host.mode === "output" || (viewport.zoom === 1 && viewport.x === 0 && viewport.y === 0)) return draw();
    push();
    try {
      translate(viewport.x, viewport.y);
      scale(viewport.zoom);
      return draw();
    } finally {
      pop();
    }
  }

  previewPointToWorld(point = {}) {
    const viewport = this.viewportTransform();
    const display = this.displayCanvasSize();
    return {
      x: display.width * 0.5 +
        ((Number(point.x) || 0) - display.width * 0.5 - viewport.x) / viewport.zoom,
      y: display.height * 0.5 +
        ((Number(point.y) || 0) - display.height * 0.5 - viewport.y) / viewport.zoom,
    };
  }

  previewWorldPointToDisplay(point = {}, render = this.host.state?.render || {}) {
    if (this.host.mode === "output") return this.worldPointToDisplay(point);
    const viewport = this.viewportTransform(render);
    const display = this.displayCanvasSize(render);
    return {
      x: display.width * 0.5 + viewport.x +
        ((Number(point.x) || 0) - display.width * 0.5) * viewport.zoom,
      y: display.height * 0.5 + viewport.y +
        ((Number(point.y) || 0) - display.height * 0.5) * viewport.zoom,
    };
  }

  mappingProjectRender() {
    return mappingWorldRender(this.host.state?.render || {});
  }

  outputFrameOffset() {
    if (this.host.mode === "output") {
      const frame = outputFrameForId(this.mappingProjectRender(), this.host.outputId);
      return { x: frame?.x || 0, y: frame?.y || 0 };
    }
    return outputFrameOffset(this.host.state?.render || {});
  }

  outputFrameTransform() {
    const projectFrame = this.host.mode === "output"
      ? outputFrameForId(this.mappingProjectRender(), this.host.outputId)
      : this.outputFrameSize();
    const outputFrame = this.displayCanvasSize();
    const fitted = fitOverflowDestination(
      { x: 0, y: 0, width: projectFrame.width, height: projectFrame.height },
      { x: 0, y: 0, width: outputFrame.width, height: outputFrame.height },
      "cover",
    );
    return {
      scale: fitted.destination.width / Math.max(1, projectFrame.width),
      x: fitted.destination.x,
      y: fitted.destination.y,
    };
  }

  worldPointToDisplay(point = {}) {
    const x = Number(point.x) || 0;
    const y = Number(point.y) || 0;
    if (this.host.mode !== "output") return { x, y };
    const offset = this.outputFrameOffset();
    const transform = this.outputFrameTransform();
    return {
      x: (x - offset.x) * transform.scale + transform.x,
      y: (y - offset.y) * transform.scale + transform.y,
    };
  }

  displayPointToWorld(point = {}) {
    const x = Number(point.x) || 0;
    const y = Number(point.y) || 0;
    if (this.host.mode !== "output") return { x, y };
    const offset = this.outputFrameOffset();
    const transform = this.outputFrameTransform();
    return {
      x: (x - transform.x) / Math.max(0.0001, transform.scale) + offset.x,
      y: (y - transform.y) / Math.max(0.0001, transform.scale) + offset.y,
    };
  }

  directSurfaceCorners(surface = {}) {
    const rect = outputSpanRect(this.mappingProjectRender(), surface.destination?.outputIds || []);
    if (!rect) return null;
    const topLeft = this.worldPointToDisplay({ x: rect.x, y: rect.y });
    const bottomRight = this.worldPointToDisplay({ x: rect.x + rect.width, y: rect.y + rect.height });
    return rectToCorners({
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    });
  }

  projectSurfaceCorners(surfaceId = "") {
    const surface = this.host.state?.mappingCalibration?.surfaces?.find((item) =>
      String(item?.id || item?.name || "") === String(surfaceId)
    );
    const world = worldSize(this.mappingProjectRender());
    const relative = this.host.state?.mappingCalibration?.coordinateSpace === "relative";
    return Array.isArray(surface?.corners) && surface.corners.length === 4
      ? surface.corners.map((corner) => ({
          x: (Number(corner.x) || 0) * (relative ? world.width : 1),
          y: (Number(corner.y) || 0) * (relative ? world.height : 1),
        }))
      : null;
  }

  mappingForMode(mapping) {
    const world = worldSize(this.mappingProjectRender());
    const worldMapping = mapping?.coordinateSpace === "relative"
      ? mapMappingCorners(mapping, (corner) => ({
          x: (Number(corner.x) || 0) * world.width,
          y: (Number(corner.y) || 0) * world.height,
        }))
      : mapping;
    if (this.host.mode !== "output") return worldMapping;
    return mapMappingCorners(worldMapping, (corner) => this.worldPointToDisplay(corner));
  }

  mappingFromMode(mapping) {
    const worldMapping = this.host.mode === "output"
      ? mapMappingCorners(mapping, (corner) => this.displayPointToWorld(corner))
      : mapping;
    const world = worldSize(this.mappingProjectRender());
    const normalized = mapMappingCorners(worldMapping, (corner) => ({
      x: (Number(corner.x) || 0) / Math.max(1, world.width),
      y: (Number(corner.y) || 0) / Math.max(1, world.height),
    }));
    return {
      ...normalized,
      coordinateSpace: "relative",
      surfaces: (normalized?.surfaces || []).map((surface) => {
        const { w: _w, h: _h, ...persisted } = surface || {};
        return persisted;
      }),
    };
  }
}

function mapMappingCorners(mapping = {}, transformPoint = (point) => point) {
  return {
    ...mapping,
    surfaces: (mapping?.surfaces || []).map((surface) => ({
      ...surface,
      corners: (surface?.corners || []).map((corner) => transformPoint(corner)),
    })),
  };
}
