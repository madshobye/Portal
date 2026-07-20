import { RENDITION_DIR, RENDITION_ROOT, isMediaRenditionPath, mediaRenditionPath } from "./media-rendition-service.js?v=madstodo-4";
import {
  THUMBNAIL_DIR,
  THUMBNAIL_ROOT,
  componentThumbnailFilename,
  parseComponentThumbnailFilename,
  thumbnailDataUrlToBlob,
  thumbnailExtension,
} from "./component-thumbnail-store.js?v=thumbnail-url-lease-1";

export class ProjectDerivedAssetStore {
  constructor({ getProjectDirectory, isCurrentProject, mediaLibrary, onMediaFilesChanged, maxIndexedRenditions = 1000 }) {
    this.getProjectDirectory = getProjectDirectory;
    this.isCurrentProject = isCurrentProject || ((handle) => handle === this.getProjectDirectory?.());
    this.mediaLibrary = mediaLibrary;
    this.onMediaFilesChanged = onMediaFilesChanged;
    this.maxIndexedRenditions = maxIndexedRenditions;
    this.renditionIndexFilename = "index.json";
    this.writtenRenditions = new Set();
    this.renditionIndexPaths = [];
  }

  reset() {
    this.writtenRenditions.clear();
    this.renditionIndexPaths = [];
  }

  async writeMediaRendition(mediaId, width, height, blob, sourceRevision = "") {
    const projectHandle = this.getProjectDirectory?.();
    if (!projectHandle || !blob || !mediaId) return false;
    const path = mediaRenditionPath(mediaId, width, height, sourceRevision);
    if (this.writtenRenditions.has(path)) return false;
    const directory = await this.renditionDirectory(projectHandle);
    const filename = path.split("/").pop();
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    if (!this.isCurrentProject(projectHandle)) return false;
    this.writtenRenditions.add(path);
    await this.indexRendition(path, projectHandle);
    if (!this.isCurrentProject(projectHandle)) return false;
    const file = await handle.getFile();
    Object.defineProperty(file, "relativePath", { value: path, configurable: true });
    await this.mediaLibrary.importFiles([file]);
    this.onMediaFilesChanged?.();
    return true;
  }

  async loadIndexedRenditions() {
    const projectHandle = this.getProjectDirectory?.();
    this.renditionIndexPaths = [];
    if (!projectHandle) return [];
    let directory = null;
    try {
      const root = await projectHandle.getDirectoryHandle(RENDITION_ROOT);
      directory = await root.getDirectoryHandle(RENDITION_DIR);
      const indexHandle = await directory.getFileHandle(this.renditionIndexFilename);
      const parsed = JSON.parse(await (await indexHandle.getFile()).text());
      const indexedPaths = Array.isArray(parsed?.paths)
        ? parsed.paths.filter(isValidRenditionIndexPath).slice(-this.maxIndexedRenditions)
        : [];
      if (!this.isCurrentProject(projectHandle)) return [];
      this.renditionIndexPaths = indexedPaths;
    } catch (error) {
      if (!isNotFoundError(error) && !(error instanceof SyntaxError)) {
        console.warn("[VJ1_RENDITION_INDEX_READ_FAILED]", { fallback: "regenerate renditions on demand", message: error?.message || String(error) });
      } else if (error instanceof SyntaxError) {
        console.warn("[VJ1_RENDITION_INDEX_INVALID]", { fallback: "regenerate renditions on demand", message: error.message });
      }
      return [];
    }
    const files = [];
    let missing = 0;
    let count = 0;
    for (const path of this.renditionIndexPaths) {
      if (!this.isCurrentProject(projectHandle)) return [];
      try {
        const handle = await directory.getFileHandle(path.split("/").pop());
        const file = await handle.getFile();
        Object.defineProperty(file, "relativePath", { value: path, configurable: true });
        files.push(file);
        this.writtenRenditions.add(path);
      } catch (error) {
        if (isNotFoundError(error)) missing++;
        else console.warn("[VJ1_RENDITION_INDEX_ENTRY_FAILED]", { path, fallback: "regenerate rendition on demand", message: error?.message || String(error) });
      }
      if (++count % 64 === 0) await cooperativeYield();
    }
    if (missing) console.info("[VJ1_RENDITION_INDEX_STALE]", { missing, fallback: "regenerate missing renditions on demand" });
    return files;
  }

  async indexRendition(path, projectHandle) {
    const nextPaths = this.renditionIndexPaths.filter((entry) => entry !== path);
    nextPaths.push(path);
    const evicted = nextPaths.splice(0, Math.max(0, nextPaths.length - this.maxIndexedRenditions));
    const directory = await this.renditionDirectory(projectHandle);
    const handle = await directory.getFileHandle(this.renditionIndexFilename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ version: 1, paths: nextPaths }, null, 2));
    await writable.close();
    for (const oldPath of evicted) {
      try {
        await directory.removeEntry(oldPath.split("/").pop());
      } catch (error) {
        if (!isNotFoundError(error)) console.warn("[VJ1_RENDITION_CACHE_EVICT_FAILED]", { path: oldPath, message: error?.message || String(error) });
      }
      if (this.isCurrentProject(projectHandle)) this.writtenRenditions.delete(oldPath);
    }
    if (this.isCurrentProject(projectHandle)) this.renditionIndexPaths = nextPaths;
  }

  async renditionDirectory(projectHandle) {
    const root = await projectHandle.getDirectoryHandle(RENDITION_ROOT, { create: true });
    return await root.getDirectoryHandle(RENDITION_DIR, { create: true });
  }

  async writeComponentThumbnail(componentId, frameId, dataUrl) {
    const projectHandle = this.getProjectDirectory?.();
    if (!projectHandle || !componentId || !dataUrl) return false;
    const blob = thumbnailDataUrlToBlob(dataUrl);
    const extension = thumbnailExtension(blob);
    const directory = await this.thumbnailDirectory({ create: true, projectHandle });
    const filename = componentThumbnailFilename(componentId, frameId, extension);
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    const alternate = componentThumbnailFilename(componentId, frameId, extension === "png" ? "webp" : "png");
    try {
      await directory.removeEntry(alternate);
    } catch (error) {
      if (!isNotFoundError(error)) console.warn("[VJ1_STALE_THUMBNAIL_REMOVE_FAILED]", { filename: alternate, message: error?.message || String(error) });
    }
    return true;
  }

  async migrateEmbeddedThumbnails(entries) {
    for (const entry of entries || []) {
      try {
        await this.writeComponentThumbnail(entry.componentId, entry.frameId, entry.url);
      } catch (error) {
        console.warn("[VJ1_EMBEDDED_THUMBNAIL_MIGRATION_FAILED]", {
          componentId: entry.componentId,
          frameId: entry.frameId,
          fallback: "regenerate this thumbnail on demand",
          message: error?.message || String(error),
        });
      }
      await cooperativeYield();
    }
  }

  async loadComponentThumbnails(components = []) {
    const componentIds = new Set((components || []).map((component) => String(component.id)));
    const directory = await this.thumbnailDirectory();
    if (!directory) return { entries: [], urls: new Set() };
    const entries = [];
    const urls = new Set();
    let count = 0;
    for await (const handle of directory.values()) {
      const parsed = handle.kind === "file" ? parseComponentThumbnailFilename(handle.name) : null;
      if (parsed && componentIds.has(String(parsed.componentId))) {
        try {
          const url = URL.createObjectURL(await handle.getFile());
          urls.add(url);
          entries.push({ ...parsed, url });
        } catch (error) {
          console.warn("[VJ1_THUMBNAIL_READ_FAILED]", { filename: handle.name, fallback: "regenerate thumbnail on demand", message: error?.message || String(error) });
        }
      }
      if (++count % 64 === 0) await cooperativeYield();
    }
    return { entries, urls };
  }

  async thumbnailDirectory({ create = false, projectHandle = this.getProjectDirectory?.() } = {}) {
    if (!projectHandle) return null;
    try {
      const root = await projectHandle.getDirectoryHandle(THUMBNAIL_ROOT, { create });
      return await root.getDirectoryHandle(THUMBNAIL_DIR, { create });
    } catch (error) {
      if (!isNotFoundError(error)) console.warn("[VJ1_THUMBNAIL_DIRECTORY_UNAVAILABLE]", { fallback: "regenerate thumbnails in memory", message: error?.message || String(error) });
      return null;
    }
  }
}

function isValidRenditionIndexPath(path = "") {
  return isMediaRenditionPath(path) && !String(path).slice(`${RENDITION_ROOT}/${RENDITION_DIR}/`.length).includes("/");
}

function isNotFoundError(error) {
  return error?.name === "NotFoundError" || error?.code === 8;
}

function cooperativeYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
