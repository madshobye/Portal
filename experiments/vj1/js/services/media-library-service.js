import { uid } from "../domain/models.js";
import { isMediaRenditionPath, mediaSourceRevision, parseMediaRenditionPath } from "./media-rendition-service.js";
import { createMediaThumbnailHandler } from "./media-thumbnail-service.js";

const VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const MODEL_RE = /\.(stl|obj)$/i;
const SHADER_RE = /\.(frag|glsl|fs|vs)$/i;

export function createMediaLibrary({ thumbnailHandler = createMediaThumbnailHandler() } = {}) {
  const files = new Map();
  const sourceRevisions = new Map();
  const renditions = new Map();
  const listeners = new Set();
  let publishSuspended = 0;

  function publish(reason = "media-library") {
    if (publishSuspended > 0) return;
    const snapshot = getAllFiles();
    for (const listener of listeners) listener(snapshot, reason);
  }

  function getAllFiles() {
    return Array.from(files.entries()).map(([id, file]) => ({
      id,
      file,
      sourceRevision: sourceRevisions.get(id) || mediaSourceRevision(file),
      renditions: Array.from(renditions.values())
        .filter((entry) => entry.mediaId === id && entry.sourceRevision === (sourceRevisions.get(id) || mediaSourceRevision(file)))
        .map((entry) => ({ ...entry })),
    }));
  }

  function releasePreviewUrl(id) {
    thumbnailHandler.release(id);
  }

  function releasePreviewUrls() {
    thumbnailHandler.clear();
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

  const api = {
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
          const nextRevision =
            entry?.sourceRevision || mediaSourceRevision(file);
          const previousRevision = sourceRevisions.get(meta.id) || "";
          if (
            files.get(meta.id) !== file &&
            previousRevision &&
            previousRevision !== nextRevision
          ) {
            thumbnailHandler.invalidate(meta.id);
          }
          files.set(meta.id, file);
          sourceRevisions.set(meta.id, nextRevision);
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
      if (incoming.length) publish("import");
      return { media, shaders, files: importedFiles };
    },
    async replaceFiles(fileList) {
      const incoming = Array.from(fileList || []);
      const sourceIds = new Set();
      const renditionKeys = new Set();
      for (const entry of incoming) {
        const file = entry?.file || entry;
        if (!file) continue;
        const path = entry?.id || file.relativePath || file.webkitRelativePath || file.name || "";
        if (isMediaRenditionPath(path)) {
          const parsed = parseMediaRenditionPath(path);
          if (parsed?.key) renditionKeys.add(parsed.key);
        } else if (isMediaFile(path)) {
          sourceIds.add(path);
        }
      }

      publishSuspended++;
      let imported;
      try {
        imported = await api.importFiles(incoming);
        for (const id of Array.from(files.keys())) {
          if (sourceIds.has(id)) continue;
          thumbnailHandler.invalidate(id);
          files.delete(id);
          sourceRevisions.delete(id);
          for (const [key, rendition] of renditions) {
            if (rendition.mediaId === id) renditions.delete(key);
          }
        }
        for (const key of Array.from(renditions.keys())) {
          if (!renditionKeys.has(key)) renditions.delete(key);
        }
      } finally {
        publishSuspended--;
      }
      publish("replace");
      return imported;
    },
    getFile(id) {
      return files.get(id) || null;
    },
    remove(id) {
      if (!id) return false;
      thumbnailHandler.invalidate(id);
      const removed = files.delete(id);
      sourceRevisions.delete(id);
      for (const [key, entry] of renditions) {
        if (entry.mediaId === id) renditions.delete(key);
      }
      if (removed) publish("remove");
      return removed;
    },
    acquirePreviewUrl(id) {
      const file = files.get(id);
      return thumbnailHandler.acquire(id, file);
    },
    releasePreviewUrl,
    releasePreviewUrls,
    setThumbnailStorage(storage) {
      thumbnailHandler.setStorage(storage);
    },
    getAllFiles() {
      return getAllFiles();
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
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
      const changed = files.size > 0 || sourceRevisions.size > 0 || renditions.size > 0;
      thumbnailHandler.clear();
      files.clear();
      sourceRevisions.clear();
      renditions.clear();
      if (changed) publish("clear");
    },
  };
  return api;
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
export async function collectProjectAssetFiles(
  dirHandle,
  {
    yieldEvery = 64,
    batchSize = 32,
    onBatch = null,
  } = {},
) {
  const files = [];
  const pending = [];
  const counter = { value: 0 };
  const publishBatch = async () => {
    if (!pending.length || typeof onBatch !== "function") return;
    const batch = pending.splice(0, pending.length);
    await onBatch(batch, {
      discovered: files.length,
      complete: false,
    });
  };
  await collectAllowedDirectory(
    dirHandle,
    "",
    files,
    counter,
    yieldEvery,
    true,
    async (file) => {
      pending.push(file);
      if (pending.length >= Math.max(1, Number(batchSize) || 1)) {
        await publishBatch();
      }
    },
  );
  await publishBatch();
  if (typeof onBatch === "function") {
    await onBatch([], {
      discovered: files.length,
      complete: true,
    });
  }
  return files;
}

async function collectAllowedDirectory(
  dirHandle,
  prefix,
  files,
  counter,
  yieldEvery,
  root = false,
  onFile = null,
) {
  for await (const [name, handle] of dirHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      if ((root || prefix === "media" || prefix.startsWith("media/") || prefix === "shaders" || prefix.startsWith("shaders/"))
          && (isMediaFile(path) || isShaderFile(path))) {
        const file = await appendReadableFile(handle, path, files);
        if (file) await onFile?.(file);
      }
    } else if (handle.kind === "directory") {
      if (root && !["media", "shaders"].includes(name)) continue;
      await collectAllowedDirectory(
        handle,
        path,
        files,
        counter,
        yieldEvery,
        false,
        onFile,
      );
    }
    if (++counter.value % yieldEvery === 0) await cooperativeYield();
  }
}

async function appendReadableFile(handle, path, files) {
  try {
    const file = await handle.getFile();
    Object.defineProperty(file, "relativePath", { value: path, configurable: true });
    files.push(file);
    return file;
  } catch (error) {
    console.warn("[VJ1_MEDIA_FILE_SKIPPED]", { path, fallback: "omit unreadable file from library", message: error?.message || String(error) });
    return null;
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
