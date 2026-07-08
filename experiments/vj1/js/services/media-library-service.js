import { uid } from "../domain/models.js";

const VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const SHADER_RE = /\.(frag|glsl|fs)$/i;

export function createMediaLibrary() {
  const files = new Map();

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
        if (isMediaFile(path)) {
          const meta = getMeta(file);
          files.set(meta.id, file);
          media.push(meta);
        } else if (SHADER_RE.test(path)) {
          shaders.push({ path, name: path.split("/").pop() || path, code: await file.text() });
        }
      }
      return { media, shaders, files: incoming.filter((file) => isMediaFile(file.name || file.relativePath || "")) };
    },
    getFile(id) {
      return files.get(id) || null;
    },
    getAllFiles() {
      return Array.from(files.entries()).map(([id, file]) => ({ id, file }));
    },
    clear() {
      files.clear();
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
        console.warn("[VJ1_FOLDER_SCAN_MISSING]", { path, name: error?.name, message: error?.message });
      }
    } else if (handle.kind === "directory") {
      try {
        files.push(...(await collectFilesFromDirectory(handle, path)));
      } catch (error) {
        console.warn("[VJ1_FOLDER_SCAN_DIRECTORY_SKIPPED]", { path, name: error?.name, message: error?.message });
      }
    }
  }
  return files;
}

export function isMediaFile(path) {
  return VIDEO_RE.test(path) || IMAGE_RE.test(path);
}

export function isShaderFile(path) {
  return SHADER_RE.test(path);
}

export function getMediaType(path) {
  if (VIDEO_RE.test(path)) return "video";
  if (IMAGE_RE.test(path)) return "image";
  return "unknown";
}
