import {
  nodeBoundaryUniformScale,
  nodeBoundaryWithUniformScale,
  normalizeNodeBoundary,
} from "../../render-engine/roi/index.js";

const GENERAL_PREFIX = "$general.";

export const CHAIN_GENERAL_CONTROL_PATHS = Object.freeze({
  OPACITY: "opacity",
  CONTENT_X: "transform.x",
  CONTENT_Y: "transform.y",
  CONTENT_SCALE: "transform.scale",
  BOUNDARY_X: "boundary.x",
  BOUNDARY_Y: "boundary.y",
  BOUNDARY_ROTATION: "boundary.rotation",
  BOUNDARY_SCALE: "boundary.scale",
});

export function chainGeneralControlParameterId(path = "") {
  return `${GENERAL_PREFIX}${String(path || "")}`;
}

export function isChainGeneralControlParameter(parameterId = "") {
  return String(parameterId || "").startsWith(GENERAL_PREFIX);
}

export function chainGeneralControlValue(configuration = {}, parameterId = "") {
  const path = chainGeneralControlPath(parameterId);
  if (!path) return undefined;
  const transform = configuration.transform || {};
  const boundary = normalizeNodeBoundary(configuration.boundary);
  switch (path) {
    case CHAIN_GENERAL_CONTROL_PATHS.OPACITY:
      return finite(configuration.opacity, 1);
    case CHAIN_GENERAL_CONTROL_PATHS.CONTENT_X:
      return finite(transform.x, 0);
    case CHAIN_GENERAL_CONTROL_PATHS.CONTENT_Y:
      return finite(transform.y, 0);
    case CHAIN_GENERAL_CONTROL_PATHS.CONTENT_SCALE:
      return Math.max(0.000001, finite(transform.scale, 1));
    case CHAIN_GENERAL_CONTROL_PATHS.BOUNDARY_X:
      return boundary.x;
    case CHAIN_GENERAL_CONTROL_PATHS.BOUNDARY_Y:
      return boundary.y;
    case CHAIN_GENERAL_CONTROL_PATHS.BOUNDARY_ROTATION:
      return boundary.rotation;
    case CHAIN_GENERAL_CONTROL_PATHS.BOUNDARY_SCALE:
      return nodeBoundaryUniformScale(boundary);
    default:
      return undefined;
  }
}

// Returns the exact retained configuration properties owned by a synthetic
// General parameter. The caller performs the temporary write/restoration so
// animated values never enter project state.
export function chainGeneralControlWrites(configuration = {}, parameterId = "", value) {
  const path = chainGeneralControlPath(parameterId);
  if (!path) return [];
  if (path === CHAIN_GENERAL_CONTROL_PATHS.OPACITY) {
    return [{ target: configuration, key: "opacity", value }];
  }
  if (path.startsWith("transform.")) {
    const transform = configuration.transform || (configuration.transform = {});
    return [{ target: transform, key: path.slice("transform.".length), value }];
  }
  const boundary = configuration.boundary || (configuration.boundary = {});
  if (path === CHAIN_GENERAL_CONTROL_PATHS.BOUNDARY_SCALE) {
    const scaled = nodeBoundaryWithUniformScale(boundary, value);
    return [
      { target: boundary, key: "width", value: scaled.width },
      { target: boundary, key: "height", value: scaled.height },
    ];
  }
  if (path.startsWith("boundary.")) {
    return [{ target: boundary, key: path.slice("boundary.".length), value }];
  }
  return [];
}

export function withChainGeneralControlValue(configuration = {}, parameterId = "", value) {
  const path = chainGeneralControlPath(parameterId);
  if (!path) return configuration;
  const next = {
    ...configuration,
    ...(configuration.transform ? { transform: { ...configuration.transform } } : {}),
    ...(configuration.boundary ? { boundary: { ...configuration.boundary } } : {}),
  };
  for (const write of chainGeneralControlWrites(next, parameterId, value)) {
    write.target[write.key] = write.value;
  }
  return next;
}

function chainGeneralControlPath(parameterId = "") {
  if (!isChainGeneralControlParameter(parameterId)) return "";
  const path = String(parameterId).slice(GENERAL_PREFIX.length);
  return Object.values(CHAIN_GENERAL_CONTROL_PATHS).includes(path) ? path : "";
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
