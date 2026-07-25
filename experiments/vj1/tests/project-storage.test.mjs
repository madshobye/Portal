import test from "node:test";
import assert from "node:assert/strict";

import { collectProjectAssetFiles } from "../js/services/media-library-service.js";
import {
  applyThumbnailUrls,
  clearThumbnailUrls,
  componentThumbnailFilename,
  createThumbnailUrlLease,
  parseComponentThumbnailFilename,
  thumbnailDataUrlToBlob,
  stateWithoutThumbnailUrls,
} from "../js/services/component-thumbnail-store.js";

class FakeFileHandle {
  constructor(name, calls) { this.kind = "file"; this.name = name; this.calls = calls; }
  async getFile() {
    this.calls.push(this.name);
    return new File([this.name], this.name, { lastModified: 1 });
  }
}

class FakeDirectoryHandle {
  constructor(name, entries = {}) { this.kind = "directory"; this.name = name; this.items = new Map(Object.entries(entries)); }
  async *entries() { yield* this.items.entries(); }
  async *values() { yield* this.items.values(); }
  async getDirectoryHandle(name) {
    const handle = this.items.get(name);
    if (handle?.kind === "directory") return handle;
    const error = new Error("missing"); error.name = "NotFoundError"; throw error;
  }
}

test("asset discovery never opens revisions or unrelated cache files", async () => {
  const calls = [];
  const root = new FakeDirectoryHandle("project", {
    "root.png": new FakeFileHandle("root.png", calls),
    "notes.txt": new FakeFileHandle("notes.txt", calls),
    media: new FakeDirectoryHandle("media", {
      "clip.mov": new FakeFileHandle("clip.mov", calls),
      "ignore.txt": new FakeFileHandle("ignore.txt", calls),
    }),
    shaders: new FakeDirectoryHandle("shaders", { "custom.frag": new FakeFileHandle("custom.frag", calls) }),
    revisions: new FakeDirectoryHandle("revisions", { "project-before.json": new FakeFileHandle("project-before.json", calls) }),
    "vj1-cache": new FakeDirectoryHandle("vj1-cache", {
      thumbnails: new FakeDirectoryHandle("thumbnails", { "thumb.webp": new FakeFileHandle("thumb.webp", calls) }),
      renditions: new FakeDirectoryHandle("renditions", { "rendition.png": new FakeFileHandle("rendition.png", calls) }),
    }),
  });
  const files = await collectProjectAssetFiles(root, { yieldEvery: 1000 });
  assert.deepEqual(calls.sort(), ["clip.mov", "custom.frag", "root.png"]);
  assert.deepEqual(files.map((file) => file.relativePath).sort(), [
    "media/clip.mov",
    "root.png",
    "shaders/custom.frag",
  ]);
});

test("asset discovery publishes ordered batches before the authoritative traversal completes", async () => {
  const calls = [];
  const batches = [];
  const root = new FakeDirectoryHandle("project", {
    media: new FakeDirectoryHandle("media", {
      "one.png": new FakeFileHandle("one.png", calls),
      "two.png": new FakeFileHandle("two.png", calls),
      "three.png": new FakeFileHandle("three.png", calls),
    }),
  });

  const files = await collectProjectAssetFiles(root, {
    yieldEvery: 1000,
    batchSize: 2,
    onBatch(batch, progress) {
      batches.push({
        paths: batch.map((file) => file.relativePath),
        ...progress,
      });
    },
  });

  assert.deepEqual(batches, [
    {
      paths: ["media/one.png", "media/two.png"],
      discovered: 2,
      complete: false,
    },
    {
      paths: ["media/three.png"],
      discovered: 3,
      complete: false,
    },
    {
      paths: [],
      discovered: 3,
      complete: true,
    },
  ]);
  assert.deepEqual(
    files.map((file) => file.relativePath),
    ["media/one.png", "media/two.png", "media/three.png"],
  );
});

test("thumbnail cache names round-trip ids and cache URLs apply to components", () => {
  const filename = componentThumbnailFilename("component / a", "surface:1", "png");
  assert.deepEqual(parseComponentThumbnailFilename(filename), {
    componentId: "component / a",
    surfaceId: "surface:1",
    extension: "png",
  });
  const components = [{ id: "component / a", type: "scene", canvas: {} }];
  applyThumbnailUrls(components, [
    { componentId: "component / a", url: "blob:component", surfaceId: "" },
    { componentId: "component / a", url: "blob:surface", surfaceId: "surface:1" },
  ]);
  assert.equal(components[0].thumbnail, "blob:component");
  assert.equal(components[0].scene.surfaceThumbnails["surface:1"], "blob:surface");
  clearThumbnailUrls(components);
  assert.equal(components[0].thumbnail, "");
  assert.deepEqual(components[0].scene.surfaceThumbnails, {});
});

test("thumbnail data URLs become typed cache blobs", () => {
  const blob = thumbnailDataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
  assert.equal(blob.type, "image/png");
  assert.ok(blob.size > 0);
});

test("thumbnail URL leases retire old blobs only after replacement rendering", () => {
  const deferred = [];
  const revoked = [];
  const lease = createThumbnailUrlLease({
    defer: (callback) => deferred.push(callback),
    revoke: (url) => revoked.push(url),
  });

  lease.activate(["blob:old"]);
  lease.activate(["blob:new"]);
  assert.deepEqual(revoked, [], "the old DOM can finish rendering before revocation");
  deferred.shift()();
  assert.deepEqual(revoked, ["blob:old"]);

  lease.release();
  assert.deepEqual(revoked, ["blob:old", "blob:new"]);
});

test("thumbnail URL leases retain blobs while a lazy image still references them", () => {
  const deferred = [];
  const revoked = [];
  let referenced = true;
  let notifyUnused = null;
  const lease = createThumbnailUrlLease({
    defer: (callback) => deferred.push(callback),
    revoke: (url) => revoked.push(url),
    isReferenced: () => referenced,
    watchUntilUnused: (_url, callback) => {
      notifyUnused = callback;
      return () => {};
    },
  });

  lease.activate(["blob:old"]);
  lease.activate(["blob:new"]);
  deferred.shift()();
  assert.deepEqual(revoked, []);

  referenced = false;
  notifyUnused();
  assert.deepEqual(revoked, ["blob:old"]);
  lease.release();
});

test("render transport strips local thumbnail URLs without mutating editor state", () => {
  const state = {
    components: [
      { id: "component-a", type: "chain", thumbnail: "blob:component" },
      { id: "scene-a", type: "scene", thumbnail: "blob:scene", scene: { surfaceThumbnails: { surface: "blob:surface" } } },
    ],
  };
  const transport = stateWithoutThumbnailUrls(state);
  assert.equal(transport.components[0].thumbnail, "");
  assert.equal(transport.components[1].thumbnail, "");
  assert.deepEqual(transport.components[1].scene.surfaceThumbnails, {});
  assert.equal(state.components[0].thumbnail, "blob:component");
  assert.equal(state.components[1].scene.surfaceThumbnails.surface, "blob:surface");
});
