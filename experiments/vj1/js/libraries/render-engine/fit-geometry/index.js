export const FIT_MODE = Object.freeze({
  stretch: "stretch",
  cover: "cover",
  contain: "contain",
});

export function normalizeFitMode(value = FIT_MODE.cover) {
  if (value === FIT_MODE.stretch || value === FIT_MODE.contain) return value;
  return FIT_MODE.cover;
}

export function fitModeCode(value = FIT_MODE.cover) {
  const fit = normalizeFitMode(value);
  if (fit === FIT_MODE.stretch) return 0;
  if (fit === FIT_MODE.contain) return 2;
  return 1;
}

export function fitScale(source = {}, target = {}, fit = FIT_MODE.cover) {
  const sourceWidth = Math.max(1, Number(source.width) || 1);
  const sourceHeight = Math.max(1, Number(source.height) || 1);
  const targetWidth = Math.max(1, Number(target.width) || 1);
  const targetHeight = Math.max(1, Number(target.height) || 1);
  const xScale = targetWidth / sourceWidth;
  const yScale = targetHeight / sourceHeight;
  const mode = fit === "stretch" || fit === "contain" ? fit : "cover";
  if (mode === "stretch") return { x: xScale, y: yScale };
  const uniform = mode === "contain"
    ? Math.min(xScale, yScale)
    : Math.max(xScale, yScale);
  return { x: uniform, y: uniform };
}

// Canonical CPU presentation geometry. Cover is represented as a centered
// source crop, contain as a centered destination inset, and stretch as a
// complete source-to-destination mapping.
export function fitRectGeometry(source = {}, target = {}, fit = FIT_MODE.cover) {
  const sourceRect = normalizedRect(source);
  const destination = normalizedRect(target);
  const mode = normalizeFitMode(fit);
  if (mode === FIT_MODE.stretch) {
    return { source: sourceRect, destination };
  }
  const sourceAspect = sourceRect.width / sourceRect.height;
  const targetAspect = destination.width / destination.height;
  if (mode === FIT_MODE.cover) {
    if (sourceAspect > targetAspect) {
      const width = sourceRect.height * targetAspect;
      sourceRect.x += (sourceRect.width - width) * 0.5;
      sourceRect.width = width;
    } else if (sourceAspect < targetAspect) {
      const height = sourceRect.width / targetAspect;
      sourceRect.y += (sourceRect.height - height) * 0.5;
      sourceRect.height = height;
    }
    return { source: sourceRect, destination };
  }
  const scale = Math.min(
    destination.width / sourceRect.width,
    destination.height / sourceRect.height
  );
  const width = sourceRect.width * scale;
  const height = sourceRect.height * scale;
  destination.x += (destination.width - width) * 0.5;
  destination.y += (destination.height - height) * 0.5;
  destination.width = width;
  destination.height = height;
  return { source: sourceRect, destination };
}

// Some draw hosts accept a complete source plus an overflowing destination
// instead of an explicit source crop. This is the same fit contract expressed
// in that host representation.
export function fitOverflowDestination(source = {}, target = {}, fit = FIT_MODE.cover) {
  const sourceRect = normalizedRect(source);
  const targetRect = normalizedRect(target);
  const scale = fitScale(sourceRect, targetRect, fit);
  const width = sourceRect.width * scale.x;
  const height = sourceRect.height * scale.y;
  return {
    source: sourceRect,
    destination: {
      x: targetRect.x + (targetRect.width - width) * 0.5,
      y: targetRect.y + (targetRect.height - height) * 0.5,
      width,
      height,
    },
  };
}

export function fitSampleFractions(sourceAspect = 1, targetAspect = 1, fit = FIT_MODE.cover) {
  const source = positiveAspect(sourceAspect);
  const target = positiveAspect(targetAspect);
  if (normalizeFitMode(fit) !== FIT_MODE.cover) return { x: 1, y: 1 };
  if (source > target) return { x: target / source, y: 1 };
  if (source < target) return { x: 1, y: source / target };
  return { x: 1, y: 1 };
}

// Target UV -> sampled source UV. `inside` is false only in contain's
// letterbox region.
export function fitTargetUvToSourceUv(point = {}, sourceAspect = 1, targetAspect = 1, fit = FIT_MODE.cover) {
  const source = positiveAspect(sourceAspect);
  const target = positiveAspect(targetAspect);
  const mode = normalizeFitMode(fit);
  let x = Number(point.x) || 0;
  let y = Number(point.y) || 0;
  if (mode === FIT_MODE.cover) {
    if (source > target) x = 0.5 + (x - 0.5) * (target / source);
    else if (source < target) y = 0.5 + (y - 0.5) * (source / target);
  } else if (mode === FIT_MODE.contain) {
    if (source > target) y = 0.5 + (y - 0.5) * (source / target);
    else if (source < target) x = 0.5 + (x - 0.5) * (target / source);
  }
  return {
    x,
    y,
    inside: mode !== FIT_MODE.contain || (x >= 0 && x <= 1 && y >= 0 && y <= 1),
  };
}

// Source UV -> presented target UV. This is the inverse used by guides and
// hit geometry.
export function fitSourceUvToTargetUv(point = {}, sourceAspect = 1, targetAspect = 1, fit = FIT_MODE.cover) {
  const source = Math.max(0.0001, Number(sourceAspect) || 1);
  const target = Math.max(0.0001, Number(targetAspect) || 1);
  const mode = fit === "stretch" || fit === "contain" ? fit : "cover";
  let x = Number(point.x) || 0;
  let y = Number(point.y) || 0;
  if (mode === FIT_MODE.cover) {
    if (source > target) x = 0.5 + (x - 0.5) * (source / target);
    else if (source < target) y = 0.5 + (y - 0.5) * (target / source);
  } else if (mode === FIT_MODE.contain) {
    if (source > target) y = 0.5 + (y - 0.5) * (target / source);
    else if (source < target) x = 0.5 + (x - 0.5) * (source / target);
  }
  return { x, y };
}

// The mapper executes on the GPU, so it cannot call the CPU functions above.
// Generate its fit operation from this module so stable and transition
// shaders consume one authored fit formula rather than maintaining copies.
export function fitTargetUvToSourceUvShaderSource(functionName = "vj1FitTargetUvToSourceUv") {
  return `
    vec3 ${functionName}(vec2 targetUv, float sourceAspect, float targetAspect, float fitMode) {
      vec2 sourceUv = targetUv;
      float inside = 1.0;
      if (fitMode > 0.5 && fitMode < 1.5) {
        if (sourceAspect > targetAspect) {
          sourceUv.x = 0.5 + (targetUv.x - 0.5) * (targetAspect / sourceAspect);
        } else if (sourceAspect < targetAspect) {
          sourceUv.y = 0.5 + (targetUv.y - 0.5) * (sourceAspect / targetAspect);
        }
      } else if (fitMode >= 1.5) {
        if (sourceAspect > targetAspect) {
          sourceUv.y = 0.5 + (targetUv.y - 0.5) * (sourceAspect / targetAspect);
        } else if (sourceAspect < targetAspect) {
          sourceUv.x = 0.5 + (targetUv.x - 0.5) * (targetAspect / sourceAspect);
        }
        inside = step(0.0, sourceUv.x) * step(sourceUv.x, 1.0) *
          step(0.0, sourceUv.y) * step(sourceUv.y, 1.0);
      }
      return vec3(sourceUv, inside);
    }
  `;
}

function normalizedRect(value = {}) {
  return {
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    width: positiveSize(value.width),
    height: positiveSize(value.height),
  };
}

function positiveSize(value) {
  return Math.max(1, Number(value) || 1);
}

function positiveAspect(value) {
  return Math.max(0.0001, Number(value) || 1);
}
