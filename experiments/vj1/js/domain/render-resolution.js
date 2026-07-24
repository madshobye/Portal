import { componentFrameSize, resolutionCeilingLongEdge } from "./render-settings.js?v=surface-terminology-1";

// Component design resolution is independent from the adaptive surface
// raster policy. It defines frame geometry and available native detail.
export function componentTextureSize(render = {}) {
  const logical = componentFrameSize(render);
  const host = render.hostViewport || {};
  const hostLongEdge = Math.max(Number(host.width) || 0, Number(host.height) || 0) || Math.max(logical.width, logical.height);
  const ceiling = resolutionCeilingLongEdge(render.resolutionCeiling);
  const longEdge = Math.min(hostLongEdge, ceiling);
  const scale = longEdge / Math.max(logical.width, logical.height);
  return {
    width: Math.max(1, Math.round(logical.width * scale)),
    height: Math.max(1, Math.round(logical.height * scale)),
  };
}

export function surfaceTextureCeiling(render = {}) {
  const ceiling = resolutionCeilingLongEdge(render.resolutionCeiling);
  if (!Number.isFinite(ceiling)) return null;
  const logical = componentFrameSize(render);
  // The ceiling is a physical-buffer ceiling. Pixel density contributes to
  // demand before this limit and must not multiply the ceiling itself.
  const scale = ceiling / Math.max(logical.width, logical.height);
  return { width: Math.round(logical.width * scale), height: Math.round(logical.height * scale) };
}
