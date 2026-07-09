export const RENDITION_ROOT = "vj1-cache";
export const RENDITION_DIR = "renditions";
export const RENDITION_PREFIX = `${RENDITION_ROOT}/${RENDITION_DIR}/`;

export function mediaRenditionKey(mediaId, width, height) {
  return `${String(mediaId || "")}:${positiveInt(width)}x${positiveInt(height)}`;
}

export function mediaRenditionPath(mediaId, width, height) {
  return `${RENDITION_PREFIX}${encodeURIComponent(String(mediaId || "media"))}__${positiveInt(width)}x${positiveInt(height)}.jpg`;
}

export function isMediaRenditionPath(path = "") {
  return String(path).startsWith(RENDITION_PREFIX) && /\.jpe?g$/i.test(String(path));
}

export function parseMediaRenditionPath(path = "") {
  const name = String(path).slice(RENDITION_PREFIX.length);
  const match = /^(.+)__(\d+)x(\d+)\.jpe?g$/i.exec(name);
  if (!match) return null;
  try {
    return {
      mediaId: decodeURIComponent(match[1]),
      width: positiveInt(match[2]),
      height: positiveInt(match[3]),
      key: mediaRenditionKey(decodeURIComponent(match[1]), match[2], match[3]),
      path,
    };
  } catch {
    return null;
  }
}

function positiveInt(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(1, number) : 1;
}
