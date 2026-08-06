import { surfaceTextureCeiling } from "../domain/render-resolution.js";
import {
  componentRenderInstanceKey,
  componentRootTransformRegion,
  componentSourceView,
  sharedComponentRenderRequests,
} from "./component-render-layout.js";
import {
  createRenderRequest,
  frameSize,
  sourceRenderDemand,
  SURFACE_DEMAND_OVERSCAN,
} from "./render-geometry.js";
import { visibleSurfaceUvRect } from "../libraries/mapping-engine/mapping-engine/index.js";
import { createSurfaceCompositionEngine } from "../libraries/composition-engine/surface-composition/index.js";
import { directSurfaceHierarchy } from "../domain/direct-surface-hierarchy.js";

// Direct render-host bridge: the node owns the route algorithm while the
// renderer supplies its established geometry policies directly. This closure
// is compiled once and adds no node-runtime work to the frame loop.
export const planSurfaceRoutes = createSurfaceCompositionEngine({
  surfaceTextureCeiling,
  componentRenderInstanceKey,
  componentSourceView,
  componentRootTransformRegion,
  sharedComponentRenderRequests,
  createRenderRequest,
  sourceRenderDemand,
  visibleSurfaceUvRect,
  surfaceDemandOverscan: SURFACE_DEMAND_OVERSCAN,
  componentRegionSafe: (component) => component?.regionSafe === true,
  componentFrameFanoutSafe: (component) => component?.frameFanoutSafe !== false,
});

// Direct output routes are backplanes, not projection overlays. Draw declared
// parents before their overrides, then authored mapped Surfaces. The stable
// source index preserves user ordering between peers and requires no extra
// render target or pass.
export function orderedSurfaceProgram(surfaces = []) {
  const hierarchy = directSurfaceHierarchy(surfaces);
  return (surfaces || []).map((surface, index) => ({ surface, index })).sort((a, b) => {
    const aDirect = a.surface?.destination?.type === "direct";
    const bDirect = b.surface?.destination?.type === "direct";
    if (aDirect !== bDirect) return aDirect ? -1 : 1;
    if (aDirect) {
      const depthDifference = (hierarchy.depthById.get(String(a.surface?.id || "")) || 0)
        - (hierarchy.depthById.get(String(b.surface?.id || "")) || 0);
      if (depthDifference) return depthDifference;
    }
    return a.index - b.index;
  }).map(({ surface }) => surface);
}

// A transition orders only routes that actually draw, while direct-output
// hierarchy also contains structural backplanes that may be transparent on one
// endpoint. Add just the missing ancestor closure for validation and ordering;
// callers still draw only surfaces with a from/to route.
export function surfaceProgramWithDirectAncestors(routeSurfaces = [], availableSurfaces = []) {
  const program = [];
  const included = new Set();
  const availableById = new Map();
  for (const surface of availableSurfaces || []) {
    const id = String(surface?.id || "");
    if (id) availableById.set(id, surface);
  }
  const include = (surface) => {
    const id = String(surface?.id || "");
    if (!id || included.has(id)) return;
    included.add(id);
    program.push(surface);
  };
  for (const surface of routeSurfaces || []) include(surface);
  for (let index = 0; index < program.length; index++) {
    const surface = program[index];
    if (surface?.destination?.type !== "direct") continue;
    const parentId = String(surface.destination?.parentSurfaceId || "");
    if (!parentId || included.has(parentId)) continue;
    const parent = availableById.get(parentId);
    if (parent) include(parent);
  }
  return program;
}

export function stableSurfaceRenderRequest(render = {}, meta = {}) {
  const frame = frameSize(render);
  return createRenderRequest("surface", {
    width: Math.max(1, Math.round(frame.width)),
    height: Math.max(1, Math.round(frame.height)),
  }, {
    ...meta,
    timingId: meta.timingId || meta.surfaceId || "",
    renderIdentity: meta.renderIdentity ?? meta.instanceId ?? "",
  });
}
