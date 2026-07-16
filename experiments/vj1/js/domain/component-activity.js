const EMPTY_ACTIVITY = Object.freeze({ createdAt: "", updatedAt: "", lastUsedAt: "" });

export function createProjectActivity(now = new Date().toISOString()) {
  const timestamp = normalizeTimestamp(now);
  return { createdAt: timestamp, updatedAt: timestamp, lastUsedAt: "" };
}

export function normalizeProjectActivity(activity = {}, fallback = "") {
  const createdAt = normalizeTimestamp(activity?.createdAt) || normalizeTimestamp(fallback);
  return {
    createdAt,
    updatedAt: normalizeTimestamp(activity?.updatedAt) || createdAt,
    lastUsedAt: normalizeTimestamp(activity?.lastUsedAt),
  };
}

export function latestProjectActivity(activity = EMPTY_ACTIVITY) {
  return Math.max(
    timestampValue(activity?.createdAt),
    timestampValue(activity?.updatedAt),
    timestampValue(activity?.lastUsedAt)
  );
}

export function stampChangedProjectItems(previous = {}, next = {}, now = new Date().toISOString()) {
  const timestamp = normalizeTimestamp(now) || new Date().toISOString();
  stampCollection(previous.components, next.components, timestamp, componentActivitySignature);
  stampCollection(previous.recordingFrames, next.recordingFrames, timestamp, frameActivitySignature);
  return next;
}

export function touchComponentUsed(state, componentId, now = new Date().toISOString()) {
  const component = state?.components?.find((item) => item.id === componentId);
  if (!component) return false;
  component.activity = normalizeProjectActivity(component.activity, now);
  component.activity.lastUsedAt = normalizeTimestamp(now);
  return true;
}

export function touchRecordingFrameUsed(state, frameId, now = new Date().toISOString()) {
  const frame = state?.recordingFrames?.find((item) => item.id === frameId);
  if (!frame) return false;
  frame.activity = normalizeProjectActivity(frame.activity, now);
  frame.activity.lastUsedAt = normalizeTimestamp(now);
  return true;
}

function stampCollection(previousItems = [], nextItems = [], timestamp, signatureFor) {
  const previousById = new Map((previousItems || []).map((item) => [item.id, item]));
  for (const item of nextItems || []) {
    const previous = previousById.get(item.id);
    item.activity = normalizeProjectActivity(item.activity, timestamp);
    if (!previous || signatureFor(previous) !== signatureFor(item)) item.activity.updatedAt = timestamp;
  }
}

function componentActivitySignature(component = {}) {
  const { activity: _activity, thumbnail: _thumbnail, canvas, ...ownData } = component;
  if (!canvas || typeof canvas !== "object") return stableStringify(ownData);
  const { frameThumbnails: _frameThumbnails, ...canvasData } = canvas;
  return stableStringify({ ...ownData, canvas: canvasData });
}

function frameActivitySignature(frame = {}) {
  const { activity: _activity, ...ownData } = frame;
  return stableStringify(ownData);
}

function normalizeTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function timestampValue(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
