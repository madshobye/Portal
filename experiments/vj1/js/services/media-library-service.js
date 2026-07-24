import { uid } from "../domain/models.js?v=surface-terminology-1";
import { isMediaRenditionPath, mediaSourceRevision, parseMediaRenditionPath } from "./media-rendition-service.js?v=madstodo-4";
import { createModelPreviewUrl } from "../libraries/mesh-engine/convert-3d-file-to-image/index.js";

const VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const MODEL_RE = /\.(stl|obj)$/i;
const SHADER_RE = /\.(frag|glsl|fs)$/i;

export function createMediaLibrary() {
  const files = new Map();
  const sourceRevisions = new Map();
  const renditions = new Map();
  const previewUrls = new Map();

  function releasePreviewUrl(id) {
    const entry = previewUrls.get(id);
    if (!entry) return;
    previewUrls.delete(id);
    entry.released = true;
    if (entry.url) URL.revokeObjectURL(entry.url);
    else entry.promise?.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }

  function releasePreviewUrls() {
    for (const id of previewUrls.keys()) releasePreviewUrl(id);
  }

  function getMeta(file, explicitPath = "") {
    const path = explicitPath || file.relativePath || file.webkitRelativePath || file.name || uid("media");
    return {
      id: path,
      name: path.split("/").pop() || path,
      path,
      type: getMediaType(path),
      size: file.size || 0,
    };
  }

  return {
    async importFiles(fileList) {
      const incoming = Array.from(fileList || []);
      const media = [];
      const shaders = [];
      const importedFiles = [];
      for (const entry of incoming) {
        const file = entry?.file || entry;
        if (!file) continue;
        // BroadcastChannel recovery carries stable media entries rather than
        // raw Files because custom File properties such as relativePath do not
        // survive structured cloning. Keep the explicit id as path authority.
        const path = entry?.id || file.relativePath || file.webkitRelativePath || file.name || "";
        if (isMediaRenditionPath(path)) {
          const parsed = parseMediaRenditionPath(path);
          if (parsed) renditions.set(parsed.key, { ...parsed, file });
        } else if (isMediaFile(path)) {
          const meta = getMeta(file, path);
          if (files.get(meta.id) !== file) releasePreviewUrl(meta.id);
          files.set(meta.id, file);
          sourceRevisions.set(meta.id, entry?.sourceRevision || mediaSourceRevision(file));
          media.push(meta);
          importedFiles.push(file);
          const sourceRevision = sourceRevisions.get(meta.id);
          for (const rendition of entry?.renditions || []) {
            if (!rendition?.key || !rendition?.file) continue;
            renditions.set(rendition.key, {
              ...rendition,
              mediaId: rendition.mediaId || meta.id,
              sourceRevision: rendition.sourceRevision || sourceRevision,
            });
          }
        } else if (SHADER_RE.test(path)) {
          shaders.push({ path, name: path.split("/").pop() || path, code: await file.text() });
        }
      }
      return { media, shaders, files: importedFiles };
    },
    getFile(id) {
      return files.get(id) || null;
    },
    remove(id) {
      if (!id) return false;
      releasePreviewUrl(id);
      const removed = files.delete(id);
      sourceRevisions.delete(id);
      for (const [key, entry] of renditions) {
        if (entry.mediaId === id) renditions.delete(key);
      }
      return removed;
    },
    acquirePreviewUrl(id) {
      const existing = previewUrls.get(id);
      if (existing) return existing.url || existing.promise;
      const file = files.get(id);
      if (!file) return "";
      if (!MODEL_RE.test(id)) {
        const url = URL.createObjectURL(file);
        previewUrls.set(id, { url, promise: null, released: false });
        return url;
      }
      const entry = { url: "", promise: null, released: false };
      entry.promise = createModelPreviewUrl(file).then((url) => {
        entry.url = url;
        return url;
      }).catch((error) => {
        previewUrls.delete(id);
        console.warn("[VJ1_MODEL_PREVIEW_FAILED]", {
          mediaId: id,
          fallback: "show model placeholder icon",
          message: error?.message || String(error),
        });
        return "";
      });
      previewUrls.set(id, entry);
      return entry.promise;
    },
    releasePreviewUrl,
    releasePreviewUrls,
    getAllFiles() {
      return Array.from(files.entries()).map(([id, file]) => ({
        id,
        file,
        sourceRevision: sourceRevisions.get(id) || mediaSourceRevision(file),
        renditions: Array.from(renditions.values())
          .filter((entry) => entry.mediaId === id && entry.sourceRevision === (sourceRevisions.get(id) || mediaSourceRevision(file)))
          .map((entry) => ({ ...entry })),
      }));
    },
    getRendition(key) {
      return renditions.get(key)?.file || null;
    },
    getAllRenditions() {
      return Array.from(renditions.values()).map((entry) => ({ ...entry }));
    },
    getRenditionsForMedia(mediaId) {
      const file = files.get(mediaId);
      const sourceRevision = file ? (sourceRevisions.get(mediaId) || mediaSourceRevision(file)) : "";
      return Array.from(renditions.values())
        .filter((entry) => entry.mediaId === mediaId && entry.sourceRevision === sourceRevision)
        .map((entry) => ({ ...entry }));
    },
    clear() {
      releasePreviewUrls();
      files.clear();
      sourceRevisions.clear();
      renditions.clear();
    },
  };
}

export async function collectFilesFromDirectory(dirHandle, prefix = "") {
  const files = [];
  for await (const [name, handle] of dirHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      try {
        const file = await handle.getFile();
        Object.defineProperty(file, "relativePath", { value: path, configurable: true });
        files.push(file);
      } catch (error) {
        console.warn("[VJ1_MEDIA_FILE_SKIPPED]", { path, fallback: "omit unreadable file from library", message: error?.message || String(error) });
      }
    } else if (handle.kind === "directory") {
      try {
        files.push(...(await collectFilesFromDirectory(handle, path)));
      } catch (error) {
        console.warn("[VJ1_MEDIA_DIRECTORY_SKIPPED]", { path, fallback: "omit unreadable directory from library", message: error?.message || String(error) });
      }
    }
  }
  return files;
}

// Project discovery deliberately traverses only user asset roots. Revisions
// and cache data are owned by their services and must never be part of a media
// inventory. Root-level supported files remain valid for small projects.
export async function collectProjectAssetFiles(dirHandle, { yieldEvery = 64 } = {}) {
  const files = [];
  const counter = { value: 0 };
  await collectAllowedDirectory(dirHandle, "", files, counter, yieldEvery, true);
  return files;
}

async function collectAllowedDirectory(dirHandle, prefix, files, counter, yieldEvery, root = false) {
  for await (const [name, handle] of dirHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      if ((root || prefix === "media" || prefix.startsWith("media/") || prefix === "shaders" || prefix.startsWith("shaders/"))
          && (isMediaFile(path) || isShaderFile(path))) {
        await appendReadableFile(handle, path, files);
      }
    } else if (handle.kind === "directory") {
      if (root && !["media", "shaders"].includes(name)) continue;
      await collectAllowedDirectory(handle, path, files, counter, yieldEvery, false);
    }
    if (++counter.value % yieldEvery === 0) await cooperativeYield();
  }
}

async function appendReadableFile(handle, path, files) {
  try {
    const file = await handle.getFile();
    Object.defineProperty(file, "relativePath", { value: path, configurable: true });
    files.push(file);
  } catch (error) {
    console.warn("[VJ1_MEDIA_FILE_SKIPPED]", { path, fallback: "omit unreadable file from library", message: error?.message || String(error) });
  }
}

function cooperativeYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function isMediaFile(path) {
  if (isMediaRenditionPath(path)) return false;
  return VIDEO_RE.test(path) || IMAGE_RE.test(path) || MODEL_RE.test(path);
}

export function isShaderFile(path) {
  return SHADER_RE.test(path);
}

export function getMediaType(path) {
  if (VIDEO_RE.test(path)) return "video";
  if (IMAGE_RE.test(path)) return "image";
  if (MODEL_RE.test(path)) return "model";
  return "unknown";
}
