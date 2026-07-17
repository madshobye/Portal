export const RENDITION_ROOT = "vj1-cache";
export const RENDITION_DIR = "renditions";
export const RENDITION_PREFIX = `${RENDITION_ROOT}/${RENDITION_DIR}/`;

export function mediaRenditionKey(mediaId, width, height, sourceRevision = "") {
  const revision = String(sourceRevision || "");
  return `${String(mediaId || "")}:${positiveInt(width)}x${positiveInt(height)}${revision ? `:${revision}` : ""}`;
}

export function mediaRenditionPath(mediaId, width, height, sourceRevision = "") {
  const revision = String(sourceRevision || "");
  return `${RENDITION_PREFIX}${encodeURIComponent(String(mediaId || "media"))}__${positiveInt(width)}x${positiveInt(height)}${revision ? `__${encodeURIComponent(revision)}` : ""}.png`;
}

export function isMediaRenditionPath(path = "") {
  return String(path).startsWith(RENDITION_PREFIX) && /\.(png|jpe?g)$/i.test(String(path));
}

export function parseMediaRenditionPath(path = "") {
  const name = String(path).slice(RENDITION_PREFIX.length);
  const match = /^(.+)__(\d+)x(\d+)(?:__([^./]+))?\.(?:png|jpe?g)$/i.exec(name);
  if (!match) return null;
  try {
    const sourceRevision = match[4] ? decodeURIComponent(match[4]) : "";
    return {
      mediaId: decodeURIComponent(match[1]),
      width: positiveInt(match[2]),
      height: positiveInt(match[3]),
      sourceRevision,
      key: mediaRenditionKey(decodeURIComponent(match[1]), match[2], match[3], sourceRevision),
      path,
    };
  } catch {
    return null;
  }
}

export function mediaSourceRevision(file = {}) {
  const fingerprint = typeof file === "string"
    ? file
    : [
        file.relativePath || file.webkitRelativePath || file.name || "",
        Number(file.size) || 0,
        Number(file.lastModified) || 0,
        file.type || "",
      ].join(":");
  let hash = 0x811c9dc5;
  for (let index = 0; index < fingerprint.length; index++) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function positiveInt(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(1, number) : 1;
}
