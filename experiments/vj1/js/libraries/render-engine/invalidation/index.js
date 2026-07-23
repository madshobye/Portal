export const RENDER_INVALIDATION_MODES = Object.freeze({
  STABLE: "stable",
  REVISION: "revision",
  FRAME: "frame",
});

export function stableRenderInvalidation(reason = "stable") {
  return Object.freeze({
    mode: RENDER_INVALIDATION_MODES.STABLE,
    key: null,
    reason: String(reason || "stable"),
  });
}

export function revisionRenderInvalidation(key, reason = "revision") {
  return Object.freeze({
    mode: RENDER_INVALIDATION_MODES.REVISION,
    key: key ?? null,
    reason: String(reason || "revision"),
  });
}

export function frameRenderInvalidation(key, reason = "frame") {
  return Object.freeze({
    mode: RENDER_INVALIDATION_MODES.FRAME,
    key: key ?? null,
    reason: String(reason || "frame"),
  });
}

export function mergeRenderInvalidations(...values) {
  const invalidations = values.flat().filter(Boolean);
  let mode = RENDER_INVALIDATION_MODES.STABLE;
  const keys = [];
  const reasons = [];
  for (const invalidation of invalidations) {
    if (invalidation.mode === RENDER_INVALIDATION_MODES.FRAME) mode = RENDER_INVALIDATION_MODES.FRAME;
    else if (
      invalidation.mode === RENDER_INVALIDATION_MODES.REVISION &&
      mode === RENDER_INVALIDATION_MODES.STABLE
    ) {
      mode = RENDER_INVALIDATION_MODES.REVISION;
    }
    if (invalidation.key !== null && invalidation.key !== undefined) keys.push(invalidation.key);
    if (invalidation.reason) reasons.push(String(invalidation.reason));
  }
  return Object.freeze({
    mode,
    key: keys.length ? Object.freeze(keys) : null,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}

export function runtimePolicyRenderInvalidation(policy, params = {}, context = {}) {
  if (!policy) return stableRenderInvalidation("no-runtime-policy");
  if (policy.cacheable === false) {
    return frameRenderInvalidation(context.frame ?? context.time ?? null, "runtime-uncacheable");
  }
  let timeDependent = false;
  try {
    timeDependent = policy.timeDependent?.(params) === true;
  } catch {
    return frameRenderInvalidation(context.frame ?? context.time ?? null, "runtime-policy-error");
  }
  if (!timeDependent) return stableRenderInvalidation("runtime-stable");
  let key;
  try {
    key = policy.timeKey?.(params, context) ?? context.time ?? context.frame ?? null;
  } catch {
    key = context.frame ?? context.time ?? null;
  }
  return frameRenderInvalidation(key, "runtime-time");
}

export function mediaRenderInvalidation(item = null, metadata = null, context = {}) {
  const mediaType = String(metadata?.type || "");
  const video = mediaType === "video" || !!item?.video;
  if (!item) {
    return revisionRenderInvalidation("missing", video ? "video-missing" : "media-missing");
  }
  if (video) {
    const callbackTime = Number(item.videoFrameMediaTime);
    const hasDecodedCallback =
      Math.max(0, Number(item.videoFrameRevision) || 0) > 0 &&
      Number.isFinite(callbackTime);
    const key = Object.freeze({
      asset: Math.max(0, Number(item.revision) || 0),
      frame: Math.max(0, Number(item.videoFrameRevision) || 0),
      // A decoded-frame callback is the only evidence that the browser has a
      // drawable texture for the new media time. currentTime changes as soon
      // as a seek is requested and must never replace the retained last good
      // frame before decoding completes.
      timeMs: Math.max(0, Math.round((hasDecodedCallback ? callbackTime : 0) * 1000)),
    });
    return item.videoFrameDriven === true
      ? revisionRenderInvalidation(key, "video-frame")
      : frameRenderInvalidation(context.frame ?? key, "video-render-frame");
  }
  return revisionRenderInvalidation(
    Math.max(0, Number(item.revision) || 0),
    mediaType ? `media-${mediaType}` : "media-revision",
  );
}

export function renderInvalidationIsFrameDependent(invalidation = null) {
  return invalidation?.mode === RENDER_INVALIDATION_MODES.FRAME;
}
