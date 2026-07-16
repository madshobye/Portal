import { uid } from "../domain/models.js?v=adaptive-component-demand-26";
import { isMediaRenditionPath, parseMediaRenditionPath } from "./media-rendition-service.js";

const VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const MODEL_RE = /\.(stl|obj)$/i;
const SHADER_RE = /\.(frag|glsl|fs)$/i;

export function createMediaLibrary() {
  const files = new Map();
  const renditions = new Map();

  function getMeta(file) {
    const path = file.relativePath || file.webkitRelativePath || file.name || uid("media");
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
      for (const file of incoming) {
        const path = file.relativePath || file.webkitRelativePath || file.name || "";
        if (isMediaRenditionPath(path)) {
          const parsed = parseMediaRenditionPath(path);
          if (parsed) renditions.set(parsed.key, { ...parsed, file });
        } else if (isMediaFile(path)) {
          const meta = getMeta(file);
          files.set(meta.id, file);
          media.push(meta);
        } else if (SHADER_RE.test(path)) {
          shaders.push({ path, name: path.split("/").pop() || path, code: await file.text() });
        }
      }
      return { media, shaders, files: incoming.filter((file) => isMediaFile(file.relativePath || file.webkitRelativePath || file.name || "")) };
    },
    getFile(id) {
      return files.get(id) || null;
    },
    getAllFiles() {
      return Array.from(files.entries()).map(([id, file]) => ({
        id,
        file,
        renditions: Array.from(renditions.values())
          .filter((entry) => entry.mediaId === id)
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
      return Array.from(renditions.values())
        .filter((entry) => entry.mediaId === mediaId)
        .map((entry) => ({ ...entry }));
    },
    clear() {
      files.clear();
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
      } catch {}
    } else if (handle.kind === "directory") {
      try {
        files.push(...(await collectFilesFromDirectory(handle, path)));
      } catch {}
    }
  }
  return files;
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
