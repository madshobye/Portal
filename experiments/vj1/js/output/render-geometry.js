import { VJ1 } from "../constants.js";
import { componentFrameSize, normalizeOutputName } from "../domain/render-settings.js";
import { compositionLogicalSize, normalizeAspectRatio, projectedQuadAspect } from "../libraries/render-engine/relative-geometry.js";

export const SURFACE_DEMAND_OVERSCAN = 1;
export const RECORDING_FRAME_DEMAND_SCALE = 1;

export function outputDefinitions(render = {}) {
  if (Array.isArray(render.outputs) && render.outputs.length) {
    return render.outputs.map((output, index) => ({
      id: String(output.id || (index === 0 ? "output-main" : `output-${index + 1}`)),
      name: normalizeOutputName(output.name, index),
      aspectRatio: normalizeAspectRatio(output.aspectRatio, VJ1.renderWidth / VJ1.renderHeight),
    }));
  }
  return [{
    id: "output-main",
    name: "Output 1",
    aspectRatio: VJ1.renderWidth / VJ1.renderHeight,
  }];
}

export function frameSize(render = {}, outputId = "") {
  const outputs = outputDefinitions(render);
  const output = outputs.find((item) => item.id === outputId) || outputs[0];
  return containedAspectSize(hostViewportSize(render), output.aspectRatio);
}

export function worldSize(render = {}) {
  return hostViewportSize(render);
}

// Projection corners need one aspect-stable mathematical world. The browser
// host remains the raster authority, but it must never become the geometry
// authority: changing a popup from tall to wide may crop this world, not
// stretch its X and Y axes independently.
export function mappingWorldAspectRatio(render = {}) {
  // Mapping is the stable physical projection space. Adding or removing an
  // Output changes the Output frames arranged inside that space; it must not
  // resize the space itself and reinterpret every persisted relative Surface
  // coordinate. Scene already owns the project-wide relative proportion, so
  // use that as the single Mapping-world authority as well.
  return normalizeAspectRatio(
    render.sceneAspectRatio,
    outputDefinitions(render)[0]?.aspectRatio || VJ1.renderWidth / VJ1.renderHeight
  );
}

export function mappingWorldRender(render = {}) {
  const size = compositionLogicalSize(mappingWorldAspectRatio(render));
  return {
    ...render,
    hostViewport: {
      width: size.width,
      height: size.height,
      mode: "preview",
      outputId: "",
    },
  };
}

export function frameRenderRequest(render = {}, meta = {}) {
  return createRenderRequest("frame", frameSize(render), meta);
}

export function createRenderRequest(role = "texture", size = {}, meta = {}) {
  return {
    ...meta,
    role,
    width: positiveInt(size.width, VJ1.renderWidth, 1),
    height: positiveInt(size.height, VJ1.renderHeight, 1),
  };
}

export function renderRequestKey(request = {}) {
  const role = request.role || "texture";
  const width = positiveInt(request.width, VJ1.renderWidth, 1);
  const height = positiveInt(request.height, VJ1.renderHeight, 1);
  // Rendering identity is intentionally separate from presentation/timing
  // identity. Two surfaces can map the same component texture without
  // forcing the component chain to render twice.
  const requestInstance = request.renderIdentity ?? request.instanceId ?? "";
  const instance = requestInstance ? `:${requestInstance}` : "";
  return `${role}:${width}x${height}${instance}`;
}

// Resource identity deliberately stays size-based in renderRequestKey so a
// moving crop can reuse its target. Evaluation identity must additionally
// include the logical view: two equal-size ROIs can expose different parts of
// one boundary and therefore cannot share rendered pixels.
export function renderRequestStateKey(request = {}) {
  const logicalWidth = Math.max(1, Number(request.logicalWidth) || Number(request.width) || 1);
  const logicalHeight = Math.max(1, Number(request.logicalHeight) || Number(request.height) || 1);
  const uv = Array.isArray(request.uvRect) && request.uvRect.length >= 4
    ? request.uvRect.map((value) => Math.round((Number(value) || 0) * 1e6) / 1e6)
    : [0, 0, 1, 1];
  return `${renderRequestKey(request)}:${logicalWidth}x${logicalHeight}:${uv.join(",")}`;
}

// An immutable node produces the same pixels for every async placement. Strip
// only placement identity so those nodes can share a retained target while the
// first time/instance-dependent node and all of its descendants remain forked.
// Dimensions and logical ROI stay in the request, so differently sized or
// cropped instances never alias one another.
export function instanceInvariantRenderRequest(request = {}) {
  if (!(request.renderIdentity ?? request.instanceId ?? "")) return request;
  return {
    ...request,
    renderIdentity: "",
    instanceId: "",
  };
}

export function mappedSurfaceSize(corners = []) {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const [tl, tr, br, bl] = corners;
  if (![tl, tr, br, bl].every((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))) {
    return null;
  }
  const top = pointDistance(tl, tr);
  const bottom = pointDistance(bl, br);
  const left = pointDistance(tl, bl);
  const right = pointDistance(tr, br);
  return {
    // Projection can magnify one edge far more than its opposite. Demand must
    // follow the most demanding edge or trapezoids become visibly undersampled.
    width: Math.max(1, top, bottom),
    height: Math.max(1, left, right),
  };
}

export function mappedSurfaceBounds(corners = []) {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const points = corners.map((point) => ({ x: Number(point?.x), y: Number(point?.y) }));
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function visibleMappedSurfaceSize(corners = [], viewport = {}) {
  const mapped = mappedSurfaceSize(corners);
  const bounds = mappedSurfaceBounds(corners);
  if (!mapped || !bounds) return null;
  const viewportWidth = Math.max(1, Number(viewport.width) || 1);
  const viewportHeight = Math.max(1, Number(viewport.height) || 1);
  const visibleWidth = Math.min(bounds.right, viewportWidth) - Math.max(bounds.left, 0);
  const visibleHeight = Math.min(bounds.bottom, viewportHeight) - Math.max(bounds.top, 0);
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;
  return {
    width: Math.max(1, mapped.width * Math.min(1, visibleWidth / bounds.width)),
    height: Math.max(1, mapped.height * Math.min(1, visibleHeight / bounds.height)),
    bounds,
  };
}

export function sourceRenderDemand({
  logicalSize = {},
  sampleRect = {},
  maxRasterSize = {},
  maxSurfaceSize = {},
  corners = [],
  viewport = {},
  pixelScale = 1,
  overscan = SURFACE_DEMAND_OVERSCAN,
  samplingScale = 1,
  preserveFullFootprint = false,
  projectionFit = "cover",
  sourceFitActive = false,
  sourceFit = "cover",
  sourceAspect = 1,
} = {}) {
  const footprint = visibleMappedSurfaceSize(corners, viewport);
  if (!footprint) return null;
  const demandFootprint = preserveFullFootprint ? mappedSurfaceSize(corners) : footprint;
  const logicalWidth = Math.max(1, Number(logicalSize.width) || 1);
  const logicalHeight = Math.max(1, Number(logicalSize.height) || 1);
  const rect = clampLogicalRect(sampleRect, logicalWidth, logicalHeight);
  const sampledAspect = Math.max(0.0001, rect.width / rect.height);
  const intermediateAspect = sourceFitActive
    ? Math.max(0.0001, Number(sourceAspect) || sampledAspect)
    : sampledAspect;
  const projectedAspect = projectedQuadAspect(corners, demandFootprint.width / demandFootprint.height);
  const sourceFitFractions = sourceFitActive
    ? coverSampleFractions(sampledAspect, intermediateAspect, sourceFit)
    : { x: 1, y: 1 };
  const projectionFitFractions = coverSampleFractions(intermediateAspect, projectedAspect, projectionFit);
  const sampledFractions = {
    x: sourceFitFractions.x * projectionFitFractions.x,
    y: sourceFitFractions.y * projectionFitFractions.y,
  };
  const scaleToPixels = Math.max(0.05, Number(pixelScale) || 1) *
    Math.max(0.5, Number(overscan) || 1) *
    Math.max(0.05, Number(samplingScale) || 1);
  const desiredScale = Math.max(
    demandFootprint.width * scaleToPixels / (rect.width * sampledFractions.x),
    demandFootprint.height * scaleToPixels / (rect.height * sampledFractions.y)
  );
  const rasterLimit = Math.min(
    Math.max(1, Number(maxRasterSize.width) || logicalWidth) / logicalWidth,
    Math.max(1, Number(maxRasterSize.height) || logicalHeight) / logicalHeight
  );
  const rasterScale = Math.max(1 / Math.max(logicalWidth, logicalHeight), Math.min(rasterLimit, desiredScale));
  const rasterSize = {
    width: quantizedDemandInt(logicalWidth * rasterScale, Math.max(1, Number(maxRasterSize.width) || logicalWidth)),
    height: quantizedDemandInt(logicalHeight * rasterScale, Math.max(1, Number(maxRasterSize.height) || logicalHeight)),
  };
  const effectiveScale = Math.min(rasterSize.width / logicalWidth, rasterSize.height / logicalHeight);
  const maxSurfaceWidth = Math.max(1, Number(maxSurfaceSize.width) || rect.width);
  const maxSurfaceHeight = Math.max(1, Number(maxSurfaceSize.height) || rect.height);
  const intermediateSize = intermediateFitLogicalSize(
    rect,
    intermediateAspect,
    sourceFit,
    sourceFitActive
  );
  // A Scene Frame region can render directly at its mapped footprint.
  // Do not derive that target from the shared full-Scene request: a small
  // frame would otherwise retain only its tiny share of those pixels and be
  // enlarged into a visibly soft full-screen surface.
  const regionalScale = Math.max(
    1 / Math.max(intermediateSize.width, intermediateSize.height),
    Math.min(
      desiredScale,
      maxSurfaceWidth / intermediateSize.width,
      maxSurfaceHeight / intermediateSize.height
    )
  );
  const surfaceSize = {
    width: quantizedDemandInt(intermediateSize.width * regionalScale, maxSurfaceWidth),
    height: quantizedDemandInt(intermediateSize.height * regionalScale, maxSurfaceHeight),
  };
  return {
    footprint,
    demandFootprint,
    logicalSize: { width: logicalWidth, height: logicalHeight },
    sampleRect: rect,
    sampledFractions,
    rasterScale: effectiveScale,
    rasterSize,
    surfaceSize,
  };
}

// Cover samples only a fraction of one source axis. A single cover stage is
// naturally represented by max(widthScale, heightScale), but Live component
// routes can cover into a Scene-space Surface and then cover that result into
// the physical projection. Those crops may affect different axes, so demand
// must retain both fractions through the complete sampling chain.
function coverSampleFractions(sourceAspect = 1, targetAspect = 1, fit = "cover") {
  if (fit !== "cover") return { x: 1, y: 1 };
  const source = Math.max(0.0001, Number(sourceAspect) || 1);
  const target = Math.max(0.0001, Number(targetAspect) || 1);
  if (source > target) return { x: target / source, y: 1 };
  if (source < target) return { x: 1, y: source / target };
  return { x: 1, y: 1 };
}

// A routed Component is first fitted into Scene/Surface presentation space,
// then that intermediate texture is projected. Its render target must have
// the first stage's aspect. Retaining the original source aspect made the
// first cover operation a no-op in cached/transition paths even though the
// stable direct path applied it, producing a visible width jump at both ends
// of a transition.
function intermediateFitLogicalSize(rect, targetAspect, fit = "cover", active = false) {
  if (!active) return { width: rect.width, height: rect.height };
  const sourceAspect = Math.max(0.0001, rect.width / rect.height);
  const target = Math.max(0.0001, Number(targetAspect) || sourceAspect);
  if (fit === "cover") {
    const fractions = coverSampleFractions(sourceAspect, target, fit);
    return {
      width: rect.width * fractions.x,
      height: rect.height * fractions.y,
    };
  }
  // Contain/stretch preserve all source pixels but still produce a target
  // with the requested presentation aspect. The extra axis represents
  // letterbox space for contain and destination space for stretch.
  if (sourceAspect > target) {
    return { width: rect.width, height: rect.width / target };
  }
  return { width: rect.height * target, height: rect.height };
}

export function canvasSizeForMode(mode, render = {}) {
  if (mode === "preview") return worldSize(render);
  return frameSize(render);
}

export function outputFrameOffset(render = {}) {
  const frame = outputFrames(render)[0];
  return { x: frame?.x || 0, y: frame?.y || 0 };
}

export function outputFrames(render = {}) {
  const outputs = outputDefinitions(render);
  const world = worldSize(render);
  const marginX = world.width * VJ1.outputWorldMarginRatio;
  const marginY = world.height * VJ1.outputWorldMarginRatio;
  const availableWidth = Math.max(1, world.width - marginX * 2);
  const availableHeight = Math.max(1, world.height - marginY * 2);
  const aspectSum = outputs.reduce((sum, output) => sum + output.aspectRatio, 0);
  const commonHeight = Math.min(availableHeight, availableWidth / Math.max(0.05, aspectSum));
  const contentWidth = commonHeight * aspectSum;
  let x = (world.width - contentWidth) * 0.5;
  return outputs.map((output) => {
    const width = commonHeight * output.aspectRatio;
    const frame = {
      ...output,
      x,
      y: (world.height - commonHeight) * 0.5,
      width,
      height: commonHeight,
    };
    x += width;
    return frame;
  });
}

export function outputFrameForId(render = {}, outputId = "") {
  const frames = outputFrames(render);
  return frames.find((frame) => frame.id === outputId) || frames[0];
}

export function outputSpanRect(render = {}, outputIds = []) {
  const wanted = new Set((outputIds || []).map(String));
  const frames = outputFrames(render).filter((frame) => wanted.has(String(frame.id)));
  if (!frames.length) return null;
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function outputSpanFitScale(render = {}) {
  const frames = outputFrames(render);
  if (!frames.length) return 1;
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  const world = worldSize(render);
  return Math.max(0.1, Math.min(8,
    world.width / Math.max(1, right - left),
    world.height / Math.max(1, bottom - top)
  ));
}

export function defaultProjectSurfaceMapping(render = {}, surfaces = []) {
  // Default mappings live in the shared preview world, so both their extent
  // and origin must come from the same world-frame calculation. frameSize()
  // describes a standalone host and can be larger than this preview frame.
  const frame = outputFrames(render)[0] || { ...frameSize(render), x: 0, y: 0 };
  const offset = { x: frame.x || 0, y: frame.y || 0 };
  const texture = componentFrameSize(render);
  const surfaceList = Array.isArray(surfaces) ? surfaces : [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(surfaceList.length || 1)));
  const rows = Math.max(1, Math.ceil((surfaceList.length || 1) / cols));
  const gap = Math.max(24, Math.round(Math.min(frame.width, frame.height) * 0.035));
  const cellW = Math.max(1, (frame.width - gap * (cols + 1)) / cols);
  const idealCellH = cellW * (texture.height / texture.width);
  const maxCellH = Math.max(1, (frame.height - gap * (rows + 1)) / rows);
  const cellH = Math.min(idealCellH, maxCellH);

  return surfaceList.map((surface, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = offset.x + gap + col * (cellW + gap);
    const y = offset.y + gap + row * (cellH + gap);
    const id = surface.id || surface.name || `surface-${index + 1}`;
    return {
      id,
      name: id,
      w: texture.width,
      h: texture.height,
      corners: [
        { x, y },
        { x: x + cellW, y },
        { x: x + cellW, y: y + cellH },
        { x, y: y + cellH },
      ],
    };
  });
}

export function fittedCssRect(container, content, zoom = 1, pan = {}) {
  const cw = Math.max(1, Number(container?.width) || 1);
  const ch = Math.max(1, Number(container?.height) || 1);
  const iw = Math.max(1, Number(content?.width) || 1);
  const ih = Math.max(1, Number(content?.height) || 1);
  const scale = Math.min(cw / iw, ch / ih) * Math.max(0.01, Number(zoom) || 1);
  return {
    width: Math.max(1, iw * scale),
    height: Math.max(1, ih * scale),
    x: Number(pan?.x) || 0,
    y: Number(pan?.y) || 0,
    scale,
  };
}

function positiveInt(value, fallback, min = 1) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, number);
}

function hostViewportSize(render = {}) {
  const host = render.hostViewport || {};
  return {
    width: positiveInt(host.width, VJ1.renderWidth, 1),
    height: positiveInt(host.height, VJ1.renderHeight, 1),
  };
}

function containedAspectSize(container = {}, aspectRatio = VJ1.renderWidth / VJ1.renderHeight) {
  const width = Math.max(1, Number(container.width) || VJ1.renderWidth);
  const height = Math.max(1, Number(container.height) || VJ1.renderHeight);
  const aspect = normalizeAspectRatio(aspectRatio);
  return width / height > aspect
    ? { width: Math.max(1, Math.round(height * aspect)), height: Math.round(height) }
    : { width: Math.round(width), height: Math.max(1, Math.round(width / aspect)) };
}

function quantizedDemandInt(value, max) {
  const upper = Math.max(1, Math.round(Number(max) || 1));
  const clamped = Math.min(upper, Math.max(1, Math.round(Number(value) || 1)));
  if (clamped < 16) return clamped;
  return Math.min(upper, Math.max(16, Math.round(clamped / 16) * 16));
}

function clampLogicalRect(rect = {}, logicalWidth = 1, logicalHeight = 1) {
  const x = Math.max(0, Math.min(logicalWidth - 1, Number(rect.x) || 0));
  const y = Math.max(0, Math.min(logicalHeight - 1, Number(rect.y) || 0));
  const width = Math.max(1, Math.min(logicalWidth - x, Number(rect.width) || logicalWidth));
  const height = Math.max(1, Math.min(logicalHeight - y, Number(rect.height) || logicalHeight));
  return { x, y, width, height };
}

function pointDistance(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  return Math.sqrt(dx * dx + dy * dy);
}
