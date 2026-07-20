import test from "node:test";
import assert from "node:assert/strict";

import { ProjectDerivedAssetStore } from "../js/services/project-derived-asset-store.js";
import { RENDITION_DIR, RENDITION_ROOT } from "../js/services/media-rendition-service.js";

test("derived asset store owns rendition deduplication, manifest indexing, and publication", async () => {
  const project = new MemoryDirectory("project");
  const imported = [];
  let publications = 0;
  const store = new ProjectDerivedAssetStore({
    getProjectDirectory: () => project,
    mediaLibrary: {
      async importFiles(files) {
        imported.push(...files);
      },
    },
    onMediaFilesChanged() {
      publications++;
    },
  });

  const blob = new Blob(["pixels"], { type: "image/png" });
  assert.equal(await store.writeMediaRendition("media/photo.png", 320, 180, blob, "rev-1"), true);
  assert.equal(await store.writeMediaRendition("media/photo.png", 320, 180, blob, "rev-1"), false);
  assert.equal(imported.length, 1);
  assert.equal(publications, 1);

  const cacheRoot = await project.getDirectoryHandle(RENDITION_ROOT);
  const renditions = await cacheRoot.getDirectoryHandle(RENDITION_DIR);
  const index = JSON.parse(await (await (await renditions.getFileHandle("index.json")).getFile()).text());
  assert.equal(index.version, 1);
  assert.equal(index.paths.length, 1);
  assert.match(index.paths[0], /^vj1-cache\/renditions\//);

  store.reset();
  assert.equal(await store.writeMediaRendition("media/photo.png", 320, 180, blob, "rev-1"), true);
});

class MemoryDirectory {
  constructor(name) {
    this.kind = "directory";
    this.name = name;
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.directories.has(name)) {
      if (!create) throw notFound();
      this.directories.set(name, new MemoryDirectory(name));
    }
    return this.directories.get(name);
  }

  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw notFound();
      this.files.set(name, new MemoryFile(name));
    }
    return this.files.get(name);
  }

  async removeEntry(name) {
    if (!this.files.delete(name) && !this.directories.delete(name)) throw notFound();
  }

  async *values() {
    yield* this.files.values();
    yield* this.directories.values();
  }
}

class MemoryFile {
  constructor(name) {
    this.kind = "file";
    this.name = name;
    this.value = "";
  }

  async createWritable() {
    return {
      write: async (value) => {
        this.value = value;
      },
      close: async () => {},
    };
  }

  async getFile() {
    const value = this.value;
    return {
      name: this.name,
      size: typeof value === "string" ? value.length : value?.size || 0,
      lastModified: 1,
      async text() {
        return typeof value === "string" ? value : await value.text();
      },
    };
  }
}

function notFound() {
  return Object.assign(new Error("Not found"), { name: "NotFoundError" });
}
