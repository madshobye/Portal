import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  mediaFileFingerprint,
  OutputMediaRuntime,
  VIDEO_IDLE_GRACE_FRAMES,
} from "../js/output/output-media-runtime.js";
import { acceptVideoDecodedFrame, syncVideoPlayback } from "../js/output/media-utils.js";
import { OutputThumbnailRuntime } from "../js/output/output-thumbnail-runtime.js";
import { mediaSourceDemandSize, mediaSourceDemandWidth, OutputRenderer } from "../js/output/output-renderer.js";
import {
  createControlBridge,
  createOutputBridge,
  OUTPUT_BRIDGE_PROTOCOL_VERSION,
  recoveredOutputProjectState,
} from "../js/services/output-bridge-service.js";
import { applyLiveRenderPatches, createLiveRenderPatch, createRenderStatePatch } from "../js/domain/live-render-patch.js";
import { createMediaLibrary } from "../js/services/media-library-service.js";
import { mediaRenditionPath, mediaSourceRevision, parseMediaRenditionPath } from "../js/services/media-rendition-service.js";
import { compileComponentGroupTopology } from "../js/libraries/composition-engine/index.js";
import { produceStructuralShare } from "../js/libraries/data-store/data-store/structural-sharing.js";
import { LivePatchSynchronizer } from "../js/libraries/synchronization-engine/live-patch-synchronizer/index.js";

const protocol = (message) => ({
  ...message,
  protocolVersion: OUTPUT_BRIDGE_PROTOCOL_VERSION,
});

test("Output recovery remains visibly read-only until local folder access exists", () => {
  const recovered = { project: { folderName: "show", warnings: [] } };
  assert.match(recoveredOutputProjectState(recovered).project.warnings[0], /Read-only recovery/);
  assert.deepEqual(
    recoveredOutputProjectState(recovered, { warnings: ["Local folder permission required"] }).project.warnings,
    ["Local folder permission required"],
  );
});

test("media detail demand follows physical ROI backing and content scale", () => {
  const clippedBoundaryRequest = {
    width: 1000,
    height: 500,
    logicalWidth: 500,
    logicalHeight: 250,
    uvRect: [0.5, 0, 0.25, 1],
  };
  assert.equal(mediaSourceDemandWidth(clippedBoundaryRequest), 4000);
  assert.equal(mediaSourceDemandWidth(clippedBoundaryRequest, { contentTransform: { scale: 2 } }), 8000);
  assert.deepEqual(mediaSourceDemandSize(clippedBoundaryRequest), {
    width: 4000,
    height: 500,
    physicalWidth: 4000,
    physicalHeight: 500,
    contentScale: 1,
  });
  // Quality affects the physical backing request before detail is resolved;
  // it is not multiplied a second time from a metadata flag.
  assert.equal(mediaSourceDemandWidth({ ...clippedBoundaryRequest, width: 500, qualityScale: 0.5 }), 2000);
  assert.equal(mediaSourceDemandWidth({ ...clippedBoundaryRequest, empty: true }), 0);
});

test("media runtime deduplicates and throttles missing-file requests", () => {
  const previousMillis = globalThis.millis;
  let now = 1300;
  const requests = [];
  globalThis.millis = () => now;
  try {
    const runtime = new OutputMediaRuntime({ requestMediaFiles: (ids) => requests.push(ids) });
    runtime.requestMissingMediaBatch(["image-a", "image-a", "image-b"]);
    runtime.requestMissingMedia("image-c");
    now = 2500;
    runtime.requestMissingMedia("image-c");
    assert.deepEqual(requests, [["image-a", "image-b"], ["image-c"]]);
  } finally {
    if (previousMillis === undefined) delete globalThis.millis;
    else globalThis.millis = previousMillis;
  }
});

test("media library publishes cumulative resource snapshots independently from project-state updates", async () => {
  const library = createMediaLibrary();
  const snapshots = [];
  const unsubscribe = library.subscribe((entries, reason) => {
    snapshots.push({
      reason,
      ids: entries.map((entry) => entry.id),
    });
  });
  const one = new File(["one"], "one.png", {
    type: "image/png",
    lastModified: 1,
  });
  const two = new File(["two"], "two.png", {
    type: "image/png",
    lastModified: 2,
  });

  await library.importFiles([
    { id: "media/one.png", file: one },
  ]);
  await library.importFiles([
    { id: "media/two.png", file: two },
  ]);
  library.remove("media/one.png");
  library.clear();
  unsubscribe();

  assert.deepEqual(snapshots, [
    { reason: "import", ids: ["media/one.png"] },
    { reason: "import", ids: ["media/one.png", "media/two.png"] },
    { reason: "remove", ids: ["media/two.png"] },
    { reason: "clear", ids: [] },
  ]);
});

test("media library replaces an authoritative folder snapshot atomically", async () => {
  const library = createMediaLibrary();
  const snapshots = [];
  const one = new File(["one"], "one.png", {
    type: "image/png",
    lastModified: 1,
  });
  const two = new File(["two"], "two.png", {
    type: "image/png",
    lastModified: 2,
  });
  const three = new File(["three"], "three.png", {
    type: "image/png",
    lastModified: 3,
  });
  await library.importFiles([
    { id: "media/one.png", file: one },
    { id: "media/two.png", file: two },
  ]);
  const unsubscribe = library.subscribe((entries, reason) => {
    snapshots.push({
      reason,
      ids: entries.map((entry) => entry.id).sort(),
    });
  });

  await library.replaceFiles([
    { id: "media/two.png", file: two },
    { id: "media/three.png", file: three },
  ]);
  unsubscribe();

  assert.deepEqual(snapshots, [{
    reason: "replace",
    ids: ["media/three.png", "media/two.png"],
  }]);
  assert.equal(library.getFile("media/one.png"), null);
  assert.equal(library.getFile("media/two.png"), two);
  assert.equal(library.getFile("media/three.png"), three);
});

test("image and STL snapshots stay metadata-only until acquired", () => {
  const previousLoadImage = globalThis.loadImage;
  const previousCreateUrl = URL.createObjectURL;
  let imageLoads = 0;
  let modelReads = 0;
  globalThis.loadImage = () => { imageLoads++; };
  URL.createObjectURL = () => "blob:demand";
  try {
    const runtime = new OutputMediaRuntime();
    const imageFile = { name: "huge.png", size: 500, lastModified: 1, type: "image/png" };
    const modelFile = {
      name: "mesh.stl",
      size: 800,
      lastModified: 1,
      type: "model/stl",
      arrayBuffer() { modelReads++; return new Promise(() => {}); },
    };
    runtime.importFiles([
      { id: "media/huge.png", file: imageFile },
      { id: "media/mesh.stl", file: modelFile },
    ]);
    assert.equal(imageLoads, 0);
    assert.equal(modelReads, 0);
    runtime.acquireMedia(runtime.media.get("media/huge.png"));
    runtime.acquireMedia(runtime.media.get("media/mesh.stl"));
    assert.equal(imageLoads, 1);
    assert.equal(modelReads, 1);
  } finally {
    if (previousLoadImage === undefined) delete globalThis.loadImage;
    else globalThis.loadImage = previousLoadImage;
    URL.createObjectURL = previousCreateUrl;
  }
});

test("generic media LRU releases inactive decoded images", () => {
  const previousLoadImage = globalThis.loadImage;
  const previousCreateUrl = URL.createObjectURL;
  const previousRevokeUrl = URL.revokeObjectURL;
  const removed = [];
  const revoked = [];
  let index = 0;
  globalThis.loadImage = (_url, ready) => ready({
    width: 4000,
    height: 3000,
    remove() { removed.push(this); },
  });
  URL.createObjectURL = () => `blob:lru-${++index}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const runtime = new OutputMediaRuntime({ maxCachedMedia: 1, maxCachedMediaBytes: Number.MAX_SAFE_INTEGER });
    runtime.importFiles([
      { id: "media/a.png", file: { name: "a.png", size: 10, lastModified: 1, type: "image/png" } },
      { id: "media/b.png", file: { name: "b.png", size: 10, lastModified: 1, type: "image/png" } },
    ]);
    runtime.beginFrame();
    const first = runtime.acquireMedia(runtime.media.get("media/a.png"));
    runtime.endFrame();
    runtime.beginFrame();
    runtime.acquireMedia(runtime.media.get("media/b.png"));
    runtime.endFrame();
    assert.equal(first.image, null);
    assert.deepEqual(revoked, ["blob:lru-1"]);
    assert.equal(removed.length, 1);
  } finally {
    if (previousLoadImage === undefined) delete globalThis.loadImage;
    else globalThis.loadImage = previousLoadImage;
    URL.createObjectURL = previousCreateUrl;
    URL.revokeObjectURL = previousRevokeUrl;
  }
});

test("retained render results keep decoded image and STL resources resident", () => {
  const runtime = new OutputMediaRuntime({
    maxCachedMedia: 0,
    maxCachedMediaBytes: 0,
  });
  const removed = [];
  const imageItem = {
    id: "media/photo.png",
    file: { name: "photo.png", size: 10, type: "image/png" },
    image: {
      width: 64,
      height: 64,
      remove() { removed.push("image"); },
    },
    imageRenditions: new Map(),
    imageRenditionOrder: [],
    persistedRenditions: new Map(),
    renditionUrls: new Map(),
    loadToken: 0,
    revision: 0,
    ready: true,
    loading: false,
    lastMediaUse: 1,
  };
  const modelItem = {
    id: "media/mesh.stl",
    file: { name: "mesh.stl", size: 20_000_000, type: "model/stl" },
    modelData: {
      positions: new Float32Array(4_500_000),
      normals: new Float32Array(4_500_000),
    },
    imageRenditions: new Map(),
    imageRenditionOrder: [],
    persistedRenditions: new Map(),
    renditionUrls: new Map(),
    loadToken: 0,
    revision: 0,
    ready: true,
    loading: false,
    lastMediaUse: 2,
    inactiveFrameCount: 29,
  };
  runtime.media.set(imageItem.id, imageItem);
  runtime.media.set(modelItem.id, modelItem);

  runtime.beginFrame();
  runtime.retainMediaById(imageItem.id);
  runtime.retainMediaById(modelItem.id);
  runtime.endFrame();

  assert.ok(imageItem.image, "a retained image framebuffer renews its file-resource lease");
  assert.ok(modelItem.modelData, "a retained STL framebuffer renews its file-resource lease");

  runtime.beginFrame();
  runtime.endFrame();
  assert.equal(imageItem.image, null, "an unowned decoded image remains evictable");
  assert.equal(modelItem.modelData, null, "an unowned heavyweight STL remains evictable");
  assert.deepEqual(removed, ["image"]);
});

test("large raster acquisition decodes directly to a bounded render variant", async () => {
  const previousCreateBitmap = globalThis.createImageBitmap;
  const previousCreateImage = globalThis.createImage;
  const previousLoadImage = globalThis.loadImage;
  const previousCreateUrl = URL.createObjectURL;
  const bitmapRequests = [];
  let objectUrls = 0;
  let fallbackLoads = 0;
  globalThis.createImageBitmap = async (_file, options) => {
    bitmapRequests.push(options);
    return { width: options.resizeWidth, height: Math.round(options.resizeWidth * 1.5), close() {} };
  };
  globalThis.createImage = (width, height) => ({
    width,
    height,
    canvas: { getContext: () => ({ drawImage() {} }) },
    setModified() {},
  });
  globalThis.loadImage = () => { fallbackLoads++; };
  URL.createObjectURL = () => { objectUrls++; return "blob:original"; };
  try {
    const runtime = new OutputMediaRuntime();
    runtime.importFiles([{ id: "media/42mp.png", file: { name: "42mp.png", size: 25_000_000, lastModified: 1, type: "image/png" } }]);
    const item = runtime.acquireMedia(runtime.media.get("media/42mp.png"), { width: 1920 });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(bitmapRequests, [{ resizeWidth: 2048, resizeQuality: "high" }]);
    assert.equal(item.image.width, 2048);
    assert.equal(item.image.height, 3072);
    assert.equal(item.ready, true);
    assert.equal(objectUrls, 0, "the full-resolution source never receives a browser object URL");
    assert.equal(fallbackLoads, 0);
  } finally {
    if (previousCreateBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = previousCreateBitmap;
    if (previousCreateImage === undefined) delete globalThis.createImage;
    else globalThis.createImage = previousCreateImage;
    if (previousLoadImage === undefined) delete globalThis.loadImage;
    else globalThis.loadImage = previousLoadImage;
    URL.createObjectURL = previousCreateUrl;
  }
});

test("asynchronous media decode completion wakes on-change presentation", async () => {
  const previousCreateBitmap = globalThis.createImageBitmap;
  const previousCreateImage = globalThis.createImage;
  const invalidations = [];
  let resolveBitmap;
  globalThis.createImageBitmap = () => new Promise((resolve) => {
    resolveBitmap = resolve;
  });
  globalThis.createImage = (width, height) => ({
    width,
    height,
    canvas: { getContext: () => ({ drawImage() {} }) },
    setModified() {},
  });
  try {
    const runtime = new OutputMediaRuntime({
      onInvalidate: (reason, item) => invalidations.push([reason, item.id]),
    });
    runtime.importFiles([{
      id: "media/async.jpg",
      file: { name: "async.jpg", size: 100, lastModified: 1, type: "image/jpeg" },
    }]);
    const item = runtime.acquireMediaById("media/async.jpg", { width: 640 });
    assert.equal(item.image, null, "the first on-change frame may begin an asynchronous decode");
    assert.deepEqual(invalidations, []);

    resolveBitmap({ width: 768, height: 512, close() {} });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(item.ready, true);
    assert.deepEqual(invalidations, [["media-ready", "media/async.jpg"]]);
  } finally {
    if (previousCreateBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = previousCreateBitmap;
    if (previousCreateImage === undefined) delete globalThis.createImage;
    else globalThis.createImage = previousCreateImage;
  }
});

test("raster acquisition never upscales a source that is already below the render request", async () => {
  const previousCreateBitmap = globalThis.createImageBitmap;
  const previousLoadImage = globalThis.loadImage;
  const previousCreateUrl = URL.createObjectURL;
  let bitmapRequests = 0;
  let imageLoads = 0;
  const header = new Uint8Array(24);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(header.buffer).setUint32(16, 800);
  new DataView(header.buffer).setUint32(20, 600);
  globalThis.createImageBitmap = async () => {
    bitmapRequests++;
    return { width: 2048, height: 1536, close() {} };
  };
  globalThis.loadImage = (_url, ready) => {
    imageLoads++;
    ready({ width: 800, height: 600 });
  };
  URL.createObjectURL = () => "blob:small-original";
  try {
    const runtime = new OutputMediaRuntime();
    const file = {
      name: "small.png",
      size: 250_000,
      lastModified: 1,
      type: "image/png",
      slice() {
        return { arrayBuffer: async () => header.buffer };
      },
    };
    runtime.importFiles([{ id: "media/small.png", file }]);
    const item = runtime.acquireMedia(runtime.media.get("media/small.png"), { width: 1920 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(bitmapRequests, 0);
    assert.equal(imageLoads, 1);
    assert.equal(item.image.width, 800);
    assert.equal(item.image.height, 600);
    assert.equal(item.ready, true);
  } finally {
    if (previousCreateBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = previousCreateBitmap;
    if (previousLoadImage === undefined) delete globalThis.loadImage;
    else globalThis.loadImage = previousLoadImage;
    URL.createObjectURL = previousCreateUrl;
  }
});

test("raster demand escalation atomically replaces a smaller decoded variant", async () => {
  const previousCreateBitmap = globalThis.createImageBitmap;
  const previousCreateImage = globalThis.createImage;
  const bitmapRequests = [];
  const removed = [];
  const header = new Uint8Array(24);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(header.buffer).setUint32(16, 7952);
  new DataView(header.buffer).setUint32(20, 5304);
  globalThis.createImageBitmap = async (_file, options) => {
    bitmapRequests.push(options.resizeWidth);
    return { width: options.resizeWidth, height: Math.round(options.resizeWidth * 0.667), close() {} };
  };
  globalThis.createImage = (width, height) => ({
    width,
    height,
    canvas: { getContext: () => ({ drawImage() {} }) },
    setModified() {},
    remove() { removed.push(width); },
  });
  try {
    const runtime = new OutputMediaRuntime();
    const file = {
      name: "large.png",
      size: 25_000_000,
      lastModified: 1,
      type: "image/png",
      slice() {
        return { arrayBuffer: async () => header.buffer };
      },
    };
    runtime.importFiles([{ id: "media/large.png", file }]);
    const item = runtime.acquireMedia(runtime.media.get("media/large.png"), { width: 500 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const firstImage = item.image;
    assert.equal(firstImage.width, 512);

    runtime.acquireMedia(item, { width: 1920 });
    assert.equal(item.image, firstImage, "the smaller drawable remains available during the upgrade");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(bitmapRequests, [512, 2048]);
    assert.equal(item.image.width, 2048);
    assert.notEqual(item.image, firstImage);
    assert.deepEqual(removed, [512]);
    assert.equal(item.ready, true);
  } finally {
    if (previousCreateBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = previousCreateBitmap;
    if (previousCreateImage === undefined) delete globalThis.createImage;
    else globalThis.createImage = previousCreateImage;
  }
});

test("SVG media rasterizes at active demand and content scale upgrades the retained variant", () => {
  const PreviousImage = globalThis.Image;
  const previousCreateImage = globalThis.createImage;
  const previousCreateUrl = URL.createObjectURL;
  const rasterized = [];
  const removed = [];
  globalThis.Image = class {
    constructor() {
      this.naturalWidth = 100;
      this.naturalHeight = 50;
      this.width = 100;
      this.height = 50;
    }
    set src(value) {
      this._src = value;
      if (value) this.onload?.();
    }
    get src() { return this._src; }
  };
  globalThis.createImage = (width, height) => ({
    width,
    height,
    canvas: { getContext: () => ({ drawImage(_source, _x, _y, rw, rh) { rasterized.push([rw, rh]); } }) },
    setModified() {},
    remove() { removed.push(width); },
  });
  URL.createObjectURL = () => "blob:vector";
  try {
    const runtime = new OutputMediaRuntime();
    runtime.importFiles([{
      id: "media/logo.svg",
      file: { name: "logo.svg", size: 500, lastModified: 1, type: "image/svg+xml" },
    }]);
    const item = runtime.acquireMedia(runtime.media.get("media/logo.svg"), { width: 500 });
    assert.deepEqual(rasterized, [[512, 256]]);
    assert.equal(item.image.width, 512);
    const initialRevision = item.revision;

    runtime.acquireMedia(item, {
      width: mediaSourceDemandWidth(1920, { contentTransform: { scale: 2 } }),
    });
    assert.deepEqual(rasterized, [[512, 256], [3840, 1920]]);
    assert.equal(item.image.width, 3840);
    assert.deepEqual(removed, [512]);
    assert.ok(item.revision > initialRevision, "the higher-detail vector variant invalidates stable component output");
    assert.strictEqual(runtime.getImageRendition(item, 640, 360), item.image, "SVG bypasses stale raster rendition caches");

    runtime.acquireMedia(item, { width: 50_000 });
    assert.deepEqual(rasterized.at(-1), [8192, 4096], "extreme source detail remains bounded by the global SVG cap");
  } finally {
    if (PreviousImage === undefined) delete globalThis.Image;
    else globalThis.Image = PreviousImage;
    if (previousCreateImage === undefined) delete globalThis.createImage;
    else globalThis.createImage = previousCreateImage;
    URL.createObjectURL = previousCreateUrl;
  }
});

test("media-library preview URLs are leased once and released as a group", async () => {
  const previousCreateUrl = URL.createObjectURL;
  const previousRevokeUrl = URL.revokeObjectURL;
  let creates = 0;
  const revoked = [];
  URL.createObjectURL = () => `blob:preview-${++creates}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const library = createMediaLibrary();
    const file = { name: "large.png", size: 10, lastModified: 1, type: "image/png" };
    await library.importFiles([file]);
    assert.equal(library.acquirePreviewUrl("large.png"), "blob:preview-1");
    assert.equal(library.acquirePreviewUrl("large.png"), "blob:preview-1");
    assert.equal(creates, 1);
    library.releasePreviewUrl("large.png");
    assert.deepEqual(revoked, ["blob:preview-1"]);
    assert.equal(library.acquirePreviewUrl("large.png"), "blob:preview-2");
    library.releasePreviewUrls();
    assert.deepEqual(revoked, ["blob:preview-1", "blob:preview-2"]);
  } finally {
    URL.createObjectURL = previousCreateUrl;
    URL.revokeObjectURL = previousRevokeUrl;
  }
});

test("media library restores BroadcastChannel media entries without losing path identity", async () => {
  const library = createMediaLibrary();
  const file = { name: "photo.png", size: 10, lastModified: 1, type: "image/png" };
  const sourceRevision = "controller-authoritative-revision";
  const renditionFile = { name: "cached.png", size: 4, lastModified: 2, type: "image/png" };
  const rendition = {
    key: `media/photo.png:320x180:${sourceRevision}`,
    mediaId: "media/photo.png",
    sourceRevision,
    file: renditionFile,
  };

  const imported = await library.importFiles([{
    id: "media/photo.png",
    file,
    sourceRevision,
    renditions: [rendition],
  }]);

  assert.deepEqual(imported.media, [{
    id: "media/photo.png",
    name: "photo.png",
    path: "media/photo.png",
    type: "image",
    size: 10,
  }]);
  assert.strictEqual(library.getFile("media/photo.png"), file);
  assert.strictEqual(library.getAllFiles()[0].file, file);
  assert.equal(library.getAllFiles()[0].sourceRevision, sourceRevision, "source identity survives structured cloning explicitly");
  assert.strictEqual(library.getAllFiles()[0].renditions[0].file, renditionFile);
});

test("model media produces a bounded SVG preview only when demanded", async () => {
  const previousCreateUrl = URL.createObjectURL;
  const previousRevokeUrl = URL.revokeObjectURL;
  const created = [];
  const revoked = [];
  URL.createObjectURL = (value) => {
    created.push(value);
    return `blob:model-preview-${created.length}`;
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const library = createMediaLibrary();
    const text = `solid preview\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid preview`;
    const bytes = new TextEncoder().encode(text);
    const file = {
      name: "shape.stl",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    };
    await library.importFiles([file]);
    assert.equal(created.length, 0, "import remains metadata-only");
    assert.equal(await library.acquirePreviewUrl("shape.stl"), "blob:model-preview-1");
    assert.equal(created.length, 1);
    assert.equal(created[0].type, "image/svg+xml");
    library.releasePreviewUrl("shape.stl");
    assert.deepEqual(revoked, ["blob:model-preview-1"]);
  } finally {
    URL.createObjectURL = previousCreateUrl;
    URL.revokeObjectURL = previousRevokeUrl;
  }
});

test("video import stays metadata-only until an active render acquires it", () => {
  const previousCreateVideo = globalThis.createVideo;
  const previousCreateUrl = URL.createObjectURL;
  const previousRevokeUrl = URL.revokeObjectURL;
  let ready = null;
  let loopCalls = 0;
  let frameCallback = null;
  const cancelledFrameCallbacks = [];
  const attributes = new Map();
  const element = {
    tagName: "VIDEO",
    duration: 10,
    muted: false,
    defaultMuted: false,
    playsInline: false,
    preload: "",
    currentTime: 0,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    addEventListener() {},
    setAttribute(name, value) { attributes.set(name, value); },
    requestVideoFrameCallback(callback) {
      frameCallback = callback;
      return 41;
    },
    cancelVideoFrameCallback(id) { cancelledFrameCallbacks.push(id); },
  };
  const video = {
    elt: element,
    hide() {},
    volume() {},
    loop() { loopCalls++; },
    stop() {},
    remove() {},
  };
  globalThis.createVideo = (_url, callback) => {
    ready = callback;
    return video;
  };
  URL.createObjectURL = () => "blob:clip";
  URL.revokeObjectURL = () => {};
  try {
    const invalidations = [];
    const metadata = [];
    const runtime = new OutputMediaRuntime({
      onInvalidate: (reason, item) => invalidations.push([reason, item.id]),
      onMediaMetadata: (id, value) => metadata.push([id, value]),
    });
    runtime.importFiles([{ id: "media/clip.mp4", file: { name: "clip.mp4", size: 20, lastModified: 1, type: "video/mp4" } }]);
    assert.equal(ready, null, "the library snapshot does not instantiate a video decoder");
    runtime.beginFrame();
    const item = runtime.media.get("media/clip.mp4");
    runtime.acquireMedia(item);
    assert.equal(element.muted, true);
    assert.equal(element.defaultMuted, true);
    assert.equal(element.playsInline, true);
    assert.equal(element.preload, "auto");
    assert.equal(attributes.has("muted"), true);
    assert.equal(attributes.has("playsinline"), true);
    assert.equal(item.videoFrameDriven, true);
    assert.equal(item.videoFrameRevision, 0);
    frameCallback(100, { mediaTime: 1.25 });
    assert.equal(item.videoFrameRevision, 1, "a decoded frame advances the media dirty revision");
    assert.equal(item.videoFrameMediaTime, 1.25);
    assert.deepEqual(invalidations, [["video-frame", "media/clip.mp4"]], "decoded frames invalidate the matching retained media node");
    element.currentTime = 3.95;
    syncVideoPlayback(video, { start: 1, end: 4, speed: 1 });
    assert.equal(element.currentTime, 1);
    frameCallback(110, { mediaTime: 3.95 });
    assert.equal(item.videoFrameRevision, 1, "a callback queued before the loop seek cannot publish an old-segment frame");
    assert.deepEqual(invalidations, [["video-frame", "media/clip.mp4"]]);
    frameCallback(120, { mediaTime: 1 });
    assert.equal(item.videoFrameRevision, 2, "the decoded frame at the current seek target publishes the next revision");
    assert.equal(item.videoFrameMediaTime, 1);
    assert.deepEqual(invalidations, [
      ["video-frame", "media/clip.mp4"],
      ["video-frame", "media/clip.mp4"],
    ]);
    assert.equal(loopCalls, 0, "decode setup does not start playback");
    ready();
    assert.equal(runtime.media.get("media/clip.mp4").ready, true);
    assert.deepEqual(metadata, [["media/clip.mp4", { duration: 10 }]], "decoded duration is published to the control catalog");
    assert.equal(loopCalls, 0);
    runtime.dispose();
    assert.deepEqual(cancelledFrameCallbacks, [41], "disposing media cancels the pending decoded-frame callback");
  } finally {
    if (previousCreateVideo === undefined) delete globalThis.createVideo;
    else globalThis.createVideo = previousCreateVideo;
    URL.createObjectURL = previousCreateUrl;
    URL.revokeObjectURL = previousRevokeUrl;
  }
});

test("large video cache uses decoded memory and survives temporary thumbnail preview", () => {
  const previousCreateVideo = globalThis.createVideo;
  const previousCreateUrl = URL.createObjectURL;
  const previousRevokeUrl = URL.revokeObjectURL;
  const revoked = [];
  const retirement = [];
  let ready = null;
  const source = {
    removeAttribute(name) { retirement.push(`source:${name}`); },
  };
  const element = {
    tagName: "VIDEO",
    videoWidth: 1920,
    videoHeight: 1080,
    addEventListener() {},
    setAttribute() {},
    removeAttribute(name) { retirement.push(`video:${name}`); },
    querySelectorAll(selector) {
      assert.equal(selector, "source");
      return [source];
    },
    load() { retirement.push("load"); },
    requestVideoFrameCallback() { return 1; },
    cancelVideoFrameCallback() {},
  };
  const video = {
    elt: element,
    hide() {},
    volume() {},
    stop() { retirement.push("stop"); },
    remove() { retirement.push("remove"); },
  };
  globalThis.createVideo = (_url, callback) => {
    ready = callback;
    return video;
  };
  URL.createObjectURL = () => "blob:large-video";
  URL.revokeObjectURL = (url) => {
    retirement.push("revoke");
    revoked.push(url);
  };
  try {
    const runtime = new OutputMediaRuntime({
      maxCachedMedia: 12,
      maxCachedMediaBytes: 30 * 1024 * 1024,
    });
    runtime.importFiles([{
      id: "media/large.mov",
      file: {
        name: "large.mov",
        size: 1024 * 1024 * 1024,
        lastModified: 1,
        type: "video/quicktime",
      },
    }]);
    const item = runtime.media.get("media/large.mov");
    runtime.beginFrame();
    runtime.acquireMedia(item);
    ready();
    runtime.endFrame();

    for (let frame = 0; frame < VIDEO_IDLE_GRACE_FRAMES + 5; frame++) {
      runtime.beginFrame();
      runtime.endFrame();
    }
    assert.strictEqual(item.video, video, "compressed file bytes do not evict the retained decoder");
    assert.deepEqual(revoked, []);

    runtime.maxCachedMediaBytes = 1;
    runtime.beginFrame();
    runtime.endFrame();
    assert.equal(item.video, null, "genuine decoded-memory pressure still unloads an idle video");
    assert.deepEqual(revoked, ["blob:large-video"]);
    assert.deepEqual(retirement, [
      "stop",
      "video:src",
      "source:src",
      "load",
      "remove",
      "revoke",
    ], "decoder sources are detached before their object URL is revoked");
  } finally {
    if (previousCreateVideo === undefined) delete globalThis.createVideo;
    else globalThis.createVideo = previousCreateVideo;
    URL.createObjectURL = previousCreateUrl;
    URL.revokeObjectURL = previousRevokeUrl;
  }
});

test("transition overlap keeps two video decoders isolated and reuses the inactive endpoint within its grace period", async () => {
  const previousCreateVideo = globalThis.createVideo;
  const previousCreateUrl = URL.createObjectURL;
  const previousRevokeUrl = URL.revokeObjectURL;
  const callbacks = new Map();
  const readyCallbacks = new Map();
  const wrappers = new Map();
  const invalidations = [];
  const revoked = [];
  let nextCallbackId = 1;

  URL.createObjectURL = (file) => `blob:${file.name}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.createVideo = (url, ready) => {
    const id = url.replace("blob:", "");
    const element = {
      tagName: "VIDEO",
      duration: 10,
      currentTime: 0,
      playbackRate: 1,
      paused: true,
      seeking: false,
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
      addEventListener() {},
      setAttribute() {},
      play() {
        this.paused = false;
        return Promise.resolve();
      },
      requestVideoFrameCallback(callback) {
        callbacks.set(id, callback);
        return nextCallbackId++;
      },
      cancelVideoFrameCallback() {},
    };
    const wrapper = {
      elt: element,
      hide() {},
      volume() {},
      pause() { element.paused = true; },
      stop() { element.paused = true; },
      remove() {},
    };
    readyCallbacks.set(id, ready);
    wrappers.set(id, wrapper);
    return wrapper;
  };

  try {
    const runtime = new OutputMediaRuntime({
      onInvalidate: (reason, item) =>
        invalidations.push([reason, item.id]),
    });
    runtime.importFiles([
      {
        id: "media/a.mp4",
        file: {
          name: "a.mp4",
          size: 20,
          lastModified: 1,
          type: "video/mp4",
        },
      },
      {
        id: "media/b.mp4",
        file: {
          name: "b.mp4",
          size: 20,
          lastModified: 1,
          type: "video/mp4",
        },
      },
    ]);

    runtime.beginFrame();
    const itemA = runtime.acquireMediaById("media/a.mp4", {
      playback: { start: 1, end: 4, speed: 1 },
    });
    const itemB = runtime.acquireMediaById("media/b.mp4", {
      playback: { start: 2, end: 6, speed: 1 },
    });
    readyCallbacks.get("a.mp4")();
    readyCallbacks.get("b.mp4")();
    runtime.endFrame();
    await Promise.resolve();

    assert.notStrictEqual(itemA.video, itemB.video);
    assert.equal(itemA.video.elt.paused, false);
    assert.equal(itemB.video.elt.paused, false);
    callbacks.get("a.mp4")(100, { mediaTime: 1 });
    callbacks.get("b.mp4")(100, { mediaTime: 2 });
    assert.deepEqual(invalidations, [
      ["media-ready", "media/a.mp4"],
      ["media-ready", "media/b.mp4"],
      ["video-frame", "media/a.mp4"],
      ["video-frame", "media/b.mp4"],
    ]);
    assert.equal(itemA.videoFrameRevision, 1);
    assert.equal(itemB.videoFrameRevision, 1);

    runtime.beginFrame();
    runtime.acquireMediaById("media/b.mp4", {
      playback: { start: 2, end: 6, speed: 1 },
    });
    runtime.endFrame();
    await Promise.resolve();
    assert.equal(itemA.video.elt.paused, true);
    assert.equal(itemB.video.elt.paused, false);
    assert.strictEqual(
      itemA.video,
      wrappers.get("a.mp4"),
      "leaving a transition endpoint pauses but does not destroy its decoder",
    );

    runtime.beginFrame();
    const reacquiredA = runtime.acquireMediaById("media/a.mp4", {
      playback: { start: 1, end: 4, speed: 1 },
    });
    runtime.endFrame();
    assert.strictEqual(
      reacquiredA.video,
      wrappers.get("a.mp4"),
      "returning within the media grace period reuses the original decoder",
    );
    assert.equal(reacquiredA.video.elt.paused, false);
    assert.deepEqual(revoked, []);
    assert.equal(wrappers.size, 2, "one decoder is created per distinct media file");
    runtime.dispose();
  } finally {
    if (previousCreateVideo === undefined) delete globalThis.createVideo;
    else globalThis.createVideo = previousCreateVideo;
    URL.createObjectURL = previousCreateUrl;
    URL.revokeObjectURL = previousRevokeUrl;
  }
});

test("video playback owns loop state and reports promise rejection once", async () => {
  const previousError = console.error;
  const errors = [];
  const element = {
    tagName: "VIDEO",
    paused: true,
    duration: 10,
    currentTime: 0,
    playbackRate: 1,
    loop: false,
  };
  const video = {
    elt: element,
    play: () => Promise.reject(new Error("autoplay denied")),
  };
  console.error = (...args) => errors.push(args);
  try {
    syncVideoPlayback(video, { speed: 1 });
    await Promise.resolve();
    await Promise.resolve();
    syncVideoPlayback(video, { speed: 1 });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(element.loop, false, "full-length playback uses the same retained seek boundary as trimmed playback");
    assert.deepEqual(errors[0], ["[VJ1_VIDEO_PLAYBACK_FAILED]", {
      source: "VIDEO",
      operation: "play",
      message: "autoplay denied",
    }]);
    assert.equal(errors.length, 1);
  } finally {
    console.error = previousError;
  }
});

test("video playback enforces the authored end on the media clock", () => {
  const listeners = new Map();
  const element = {
    tagName: "VIDEO",
    paused: false,
    duration: 10,
    currentTime: 2,
    playbackRate: 1,
    loop: true,
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  syncVideoPlayback({ elt: element }, { start: 2, end: 4, speed: 1 });
  assert.equal(element.loop, false);
  element.currentTime = 4;
  listeners.get("timeupdate")();
  assert.equal(element.currentTime, 2, "the authored end loops directly to the authored start");
});

test("loop restart does not publish a decoded revision until the video is drawable", () => {
  const element = {
    tagName: "VIDEO",
    paused: false,
    duration: 10,
    currentTime: 3.95,
    playbackRate: 1,
    loop: false,
    seeking: false,
    readyState: 1,
    videoWidth: 1920,
    videoHeight: 1080,
    addEventListener() {},
  };
  syncVideoPlayback({ elt: element }, { start: 1, end: 4, speed: 1 });
  assert.equal(element.currentTime, 1);
  assert.equal(
    acceptVideoDecodedFrame(element, 1),
    false,
    "the retained pre-seek texture remains authoritative during a readyState dip",
  );
  element.readyState = 2;
  assert.equal(
    acceptVideoDecodedFrame(element, 1),
    true,
    "the loop-start frame publishes once the renderer can draw it",
  );
});

test("full-length video loops before the decoder exposes its exhausted surface", () => {
  const listeners = new Map();
  const element = {
    tagName: "VIDEO",
    paused: false,
    duration: 10,
    currentTime: 9.94,
    playbackRate: 1,
    loop: true,
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  syncVideoPlayback({ elt: element }, { speed: 1 });
  assert.equal(element.loop, false);
  assert.equal(element.currentTime, 0, "the common loop boundary seeks while the retained final frame is still valid");
  assert.equal(typeof listeners.get("timeupdate"), "function");
});

test("video buffering never rewrites commanded playback intent", async () => {
  let attempts = 0;
  const element = {
    tagName: "VIDEO",
    paused: true,
    duration: Number.NaN,
    readyState: 0,
    currentTime: 0,
    playbackRate: 1,
    loop: false,
  };
  const video = { elt: element, play: () => { attempts += 1; return Promise.resolve(); } };
  syncVideoPlayback(video, { speed: 1 });
  syncVideoPlayback(video, { speed: 1 });
  await Promise.resolve();
  assert.equal(attempts, 1, "one pending browser play request is shared across repeated frame claims");
  assert.equal(element.paused, true, "a browser-reported pause is not treated as a new user command");
});

test("an expected lifecycle AbortError from video play is silent", async () => {
  const previousError = console.error;
  const errors = [];
  const abort = new Error("play interrupted by pause");
  abort.name = "AbortError";
  const element = {
    tagName: "VIDEO",
    paused: true,
    duration: 10,
    currentTime: 0,
    playbackRate: 1,
    loop: false,
    play: () => Promise.reject(abort),
  };
  console.error = (...args) => errors.push(args);
  try {
    syncVideoPlayback({ elt: element }, { speed: 1 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(errors, []);
  } finally {
    console.error = previousError;
  }
});

test("media runtime pauses videos that are no longer claimed by the rendered frame", () => {
  const element = {
    tagName: "VIDEO",
    paused: true,
    duration: 10,
    currentTime: 0,
    playbackRate: 1,
    loop: false,
  };
  const video = {
    elt: element,
    play() { element.paused = false; },
    pause() { element.paused = true; },
  };
  const runtime = new OutputMediaRuntime();
  runtime.media.set("clip", { video });

  runtime.beginFrame();
  runtime.claimVideoPlayback(video, { speed: 1 });
  runtime.endFrame();
  assert.equal(element.paused, false, "a visible video remains active");

  runtime.beginFrame();
  runtime.endFrame();
  assert.equal(element.paused, true, "a video hidden by routing or selection is paused");
});

test("thumbnail runtime owns nested chain transform baselines", () => {
  const source = { id: "source-a", kind: "source", transform: { x: 0.25, scale: 2 } };
  const group = { id: "group-a", kind: "group", transform: { y: -0.5 }, chain: [source] };
  const runtime = new OutputThumbnailRuntime({
    getState: () => ({ components: [{ id: "component-a", chain: [group] }] }),
    getComponentProgram: () => ({
      forEachOperation(visitor) {
        visitor({ configuration: group });
        visitor({ configuration: source });
      },
    }),
  });

  runtime.captureEditTransformBaselines();

  assert.deepEqual(runtime.transformBaselines.get("component-a:group-a"), { x: 0, y: -0.5, scale: 1, rotation: 0 });
  assert.deepEqual(runtime.transformBaselines.get("component-a:source-a"), { x: 0.25, y: 0, scale: 2, rotation: 0 });
});

test("media runtime replaces changed files and revisions completed loads", () => {
  const previousLoadImage = globalThis.loadImage;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  const loads = [];
  const revoked = [];
  let urlIndex = 0;
  globalThis.loadImage = (url, ready, error) => loads.push({ url, ready, error });
  URL.createObjectURL = () => `blob:test-${++urlIndex}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const runtime = new OutputMediaRuntime();
    const first = { name: "photo.png", size: 10, lastModified: 1, type: "image/png" };
    const replacement = { name: "photo.png", size: 20, lastModified: 2, type: "image/png" };
    runtime.importFiles([{ id: "media/photo.png", file: first }]);
    runtime.importFiles([{ id: "media/photo.png", file: first }]);
    assert.equal(loads.length, 0, "library snapshots remain metadata-only");
    runtime.acquireMedia(runtime.media.get("media/photo.png"));
    assert.equal(loads.length, 1, "an unchanged File keeps its current runtime load");
    runtime.importFiles([{ id: "media/photo.png", file: replacement }]);
    assert.equal(loads.length, 1, "replacement metadata is not decoded until acquired");
    runtime.acquireMedia(runtime.media.get("media/photo.png"));
    assert.equal(loads.length, 2);
    assert.deepEqual(revoked, ["blob:test-1"]);
    const item = runtime.media.get("media/photo.png");
    assert.equal(item.fileKey, mediaFileFingerprint(replacement));
    loads[1].ready({ width: 20, height: 20 });
    assert.equal(item.ready, true);
    assert.equal(item.revision, 1);
    runtime.dispose();
  } finally {
    if (previousLoadImage === undefined) delete globalThis.loadImage;
    else globalThis.loadImage = previousLoadImage;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});

test("media runtime reconciles removed files from authoritative snapshots", () => {
  const previousLoadImage = globalThis.loadImage;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  const revoked = [];
  let urlIndex = 0;
  globalThis.loadImage = () => {};
  URL.createObjectURL = () => `blob:snapshot-${++urlIndex}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const runtime = new OutputMediaRuntime();
    const first = { name: "first.png", size: 10, lastModified: 1, type: "image/png" };
    const second = { name: "second.png", size: 20, lastModified: 1, type: "image/png" };
    runtime.importFiles([
      { id: "media/first.png", file: first },
      { id: "media/second.png", file: second },
    ]);
    runtime.acquireMedia(runtime.media.get("media/first.png"));
    runtime.acquireMedia(runtime.media.get("media/second.png"));
    const deletedBuffers = [];
    const deletedPrograms = [];
    const gl = {
      deleteBuffer: (buffer) => deletedBuffers.push(buffer),
      deleteProgram: (program) => deletedPrograms.push(program),
    };
    const removedItem = runtime.media.get("media/first.png");
    removedItem.modelRawRenderers = new Map([[gl, {
      buffers: new Map([["surface", { buffer: "surface-buffer" }]]),
      program: { program: "point-program" },
      surfaceProgram: { program: "surface-program" },
      wireProgram: { program: "wire-program" },
    }]]);
    runtime.importFiles([{ id: "media/second.png", file: second }]);
    assert.equal(runtime.media.has("media/first.png"), false);
    assert.equal(runtime.media.has("media/second.png"), true);
    assert.deepEqual(revoked, ["blob:snapshot-1"]);
    assert.deepEqual(deletedBuffers, ["surface-buffer"]);
    assert.deepEqual(deletedPrograms, ["point-program", "surface-program", "wire-program"]);
    assert.equal(removedItem.modelRawRenderers.size, 0);

    runtime.importFiles([]);
    assert.equal(runtime.media.size, 0);
    assert.deepEqual(revoked, ["blob:snapshot-1", "blob:snapshot-2"]);
  } finally {
    if (previousLoadImage === undefined) delete globalThis.loadImage;
    else globalThis.loadImage = previousLoadImage;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});

test("output bridge transmits an empty authoritative media snapshot", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const store = {
      getState: () => ({ metrics: { clients: 0, outputs: {} } }),
      getMetrics: () => ({ clients: 0, outputs: {} }),
      updateRuntime() {},
    };
    const bridge = createControlBridge({ store, mediaLibrary: { getAllFiles: () => [] } });
    const sessionId = messages.find((message) => message.type === "control-hello")?.sessionId;
    bridge.sendMediaFiles([]);
    bridge.close();
    assert.deepEqual(messages.at(-1), protocol({ type: "media-files", files: [], sessionId }));
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("output diagnostics cross the bridge with origin and bounded occurrence counts", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const channels = [];
  const recorded = [];
  globalThis.BroadcastChannel = class {
    constructor() { channels.push(this); }
    postMessage(message) {
      for (const channel of channels) {
        if (channel !== this) channel.onmessage?.({ data: message });
      }
    }
    close() {}
  };
  try {
    const state = { metrics: { clients: 0, outputs: {} } };
    const control = createControlBridge({
      store: {
        subscribe() { return () => {}; },
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
      },
      mediaLibrary: { getAllFiles: () => [] },
      diagnostics: {
        record(level, values, source, count) { recorded.push({ level, message: values[0], source, count }); },
      },
    });
    const output = createOutputBridge({ mode: "output", outputId: "projector-a" });
    output.diagnostic({ level: "error", message: "shader failed", source: "console", count: 4 });
    await Promise.resolve();

    assert.deepEqual(recorded, [{
      level: "error",
      message: "shader failed",
      source: "output projector-a · console",
      count: 4,
    }]);
    output.close();
    control.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("control bridge rejects stale clients before state, media, or recovery can cross", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  let channel = null;
  let state = { project: { folderName: "" }, metrics: { clients: 0, outputs: {} } };
  let imports = 0;
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage(message) { messages.push(message); }
    close() {}
  };
  let bridge = null;
  try {
    bridge = createControlBridge({
      store: {
        getState: () => state,
        getMetrics: () => state.metrics,
        getLiveRenderState: () => state,
        updateRuntime() {},
        replace(next) { state = next; },
      },
      mediaLibrary: {
        getAllFiles: () => [],
        async importFiles() { imports++; },
      },
    });
    const sessionId = messages.find((message) => message.type === "control-hello").sessionId;
    channel.onmessage({ data: { type: "hello", clientId: "stale-output" } });
    assert.equal(messages.some((message) => (
      message.type === "protocol-mismatch"
      && message.targetClientId === "stale-output"
    )), true);
    assert.equal(messages.some((message) => message.type === "state"), false);

    channel.onmessage({ data: protocol({
      type: "hello",
      clientId: "current-output",
      sessionId,
    }) });
    channel.onmessage({ data: {
      type: "recovery-state",
      clientId: "current-output",
      sessionId,
      recoveryId: "stale-recovery",
      state: { project: { folderName: "must-not-load" }, metrics: { clients: 0, outputs: {} } },
    } });
    assert.equal(state.project.folderName, "");
    assert.equal(imports, 0);
  } finally {
    bridge?.close();
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("output bridge reports protocol mismatch and ignores unversioned controller traffic", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  let channel = null;
  const mismatches = [];
  const states = [];
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage() {}
    close() {}
  };
  let bridge = null;
  try {
    bridge = createOutputBridge({
      mode: "output",
      onState: (state) => states.push(state),
      onProtocolMismatch: (mismatch) => mismatches.push(mismatch),
    });
    channel.onmessage({ data: { type: "control-hello", sessionId: "stale-control" } });
    channel.onmessage({ data: {
      type: "state",
      sessionId: "stale-control",
      state: { id: "must-not-render" },
    } });
    assert.equal(mismatches.length, 1);
    assert.equal(mismatches[0].received, null);
    assert.deepEqual(states, []);
  } finally {
    bridge?.close();
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("controller startup never publishes a false empty media snapshot before recovery", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  let channel = null;
  let state = { project: { folderName: "" }, media: [], metrics: { clients: 0, outputs: {} } };
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const store = {
      getState: () => state,
      getLiveRenderState: () => state,
      getMetrics: () => state.metrics,
      updateRuntime() {},
    };
    const bridge = createControlBridge({ store, mediaLibrary: { getAllFiles: () => [] } });

    await channel.onmessage({ data: protocol({ type: "hello", clientId: "output-before-recovery" }) });
    assert.equal(
      messages.some((message) => message.type === "media-files"),
      false,
      "an uninitialized controller must leave the Output's current media ownership intact"
    );

    state = { ...state, project: { folderName: "empty-show" } };
    await channel.onmessage({ data: protocol({ type: "hello", clientId: "output-after-project-load" }) });
    assert.deepEqual(messages.find((message) => message.type === "media-files")?.files, []);
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("stored project restore can become authoritative before Output recovery is announced", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  let channel = null;
  let state = { project: { folderName: "" }, components: [], metrics: { clients: 0, outputs: {} } };
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage(message) { messages.push(message); }
    close() {}
  };
  let bridge = null;
  try {
    const store = {
      getState: () => state,
      getMetrics: () => state.metrics,
      updateRuntime() {},
      replace(next) { state = next; },
    };
    bridge = createControlBridge({
      store,
      mediaLibrary: { importFiles: async () => {}, getAllFiles: () => [] },
      deferAnnouncement: true,
    });
    assert.equal(messages.some((message) => message.type === "control-hello"), false);

    state = {
      ...state,
      project: { folderName: "show" },
      components: [{ id: "component-a", thumbnail: "blob:folder-thumbnail" }],
    };
    assert.equal(bridge.announceControl(), true);
    assert.equal(messages.some((message) => message.type === "control-hello"), true);
    const sessionId = messages.find((message) => message.type === "control-hello").sessionId;
    channel.onmessage({ data: protocol({ type: "hello", clientId: "output-a", sessionId }) });

    channel.onmessage({ data: protocol({
      type: "recovery-state",
      clientId: "output-a",
      sessionId,
      recoveryId: "recovery-a",
      state: {
        project: { folderName: "show" },
        components: [{ id: "component-a", thumbnail: "" }],
        metrics: { clients: 0, outputs: {} },
      },
    }) });
    assert.equal(state.components[0].thumbnail, "blob:folder-thumbnail");
    assert.equal(bridge.announceControl(), false);
  } finally {
    bridge?.close();
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("local project restore queues competing Output state and media until its outcome is known", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  let channel = null;
  let state = { project: { folderName: "" }, components: [], metrics: { clients: 0, outputs: {} } };
  let imports = 0;
  let sessionId = "";
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage(message) {
      if (message.type === "control-hello") sessionId = message.sessionId;
    }
    close() {}
  };
  let bridge = null;
  try {
    const store = {
      getState: () => state,
      getMetrics: () => state.metrics,
      updateRuntime() {},
      replace(next) { state = next; },
    };
    bridge = createControlBridge({
      store,
      mediaLibrary: {
        async importFiles() { imports++; },
        getAllFiles: () => [],
      },
      deferAnnouncement: true,
    });
    bridge.beginProjectRestore();
    bridge.announceControl();
    channel.onmessage({ data: protocol({ type: "hello", clientId: "output-a", sessionId }) });
    channel.onmessage({ data: protocol({
      type: "recovery-state",
      clientId: "output-a",
      sessionId,
      recoveryId: "recovery-a",
      state: { project: { folderName: "show" }, components: [], metrics: { clients: 0, outputs: {} } },
    }) });
    channel.onmessage({ data: protocol({
      type: "recovery-media-files",
      clientId: "output-a",
      sessionId,
      recoveryId: "recovery-a",
      folderName: "show",
      files: [{ id: "media/a.png", file: { name: "a.png" } }],
    }) });
    assert.equal(state.project.folderName, "", "transport recovery must not replace an active local restore");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(imports, 0, "Output media must not compete with the local directory import");

    state = { ...state, components: [{ id: "component-a", thumbnail: "blob:folder-thumbnail" }] };
    state.project = { folderName: "show" };
    bridge.finishProjectRestore(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(imports, 0);
    assert.equal(state.components[0].thumbnail, "blob:folder-thumbnail");
  } finally {
    bridge?.close();
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("queued Output state becomes the fallback when local project restore fails", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  let channel = null;
  let state = { project: { folderName: "" }, components: [], metrics: { clients: 0, outputs: {} } };
  let imports = 0;
  let sessionId = "";
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage(message) {
      if (message.type === "control-hello") sessionId = message.sessionId;
    }
    close() {}
  };
  let bridge = null;
  try {
    bridge = createControlBridge({
      store: {
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
        replace(next) { state = next; },
      },
      mediaLibrary: {
        async importFiles() { imports++; },
        getAllFiles: () => [],
      },
      deferAnnouncement: true,
    });
    bridge.beginProjectRestore();
    bridge.announceControl();
    channel.onmessage({ data: protocol({ type: "hello", clientId: "output-a", sessionId }) });
    channel.onmessage({ data: protocol({
      type: "recovery-state",
      clientId: "output-a",
      sessionId,
      recoveryId: "recovery-a",
      state: {
        project: { folderName: "fallback-show" },
        components: [],
        metrics: { clients: 0, outputs: {} },
        ui: { live: { sceneMappingInLive: false, sceneMappingVisible: true } },
      },
    }) });
    channel.onmessage({ data: protocol({
      type: "recovery-media-files",
      clientId: "output-a",
      sessionId,
      recoveryId: "recovery-a",
      folderName: "fallback-show",
      files: [{ id: "media/a.png", file: { name: "a.png" } }],
    }) });
    state = {
      ...state,
      project: {
        ...state.project,
        warnings: ["Click the folder button to restore access to fallback-show."],
      },
    };
    bridge.finishProjectRestore(false);
    assert.equal(state.project.folderName, "fallback-show");
    assert.deepEqual(state.project.warnings, [
      "Click the folder button to restore access to fallback-show.",
    ], "transport recovery must not disguise a read-only project as writable");
    assert.equal(
      Object.hasOwn(state.ui.live, "sceneMappingVisible"),
      false,
      "Output recovery clears the old session override before app-state normalization",
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(imports, 1);
  } finally {
    bridge?.close();
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("output recovery publishes project state before importing media and never overwrites a later folder restore", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  let channel = null;
  let state = { project: { folderName: "" }, components: [], metrics: { clients: 0, outputs: {} } };
  let replaceCount = 0;
  let importStarted = false;
  let finishImport = null;
  let bridge = null;
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const mediaLibrary = {
      importFiles() {
        importStarted = true;
        return new Promise((resolve) => { finishImport = resolve; });
      },
      getAllFiles: () => [{ id: "media/a.png", file: { name: "a.png" } }],
    };
    const store = {
      getState: () => state,
      getMetrics: () => state.metrics,
      updateRuntime() {},
      replace(next) {
        replaceCount++;
        state = next;
      },
    };
    bridge = createControlBridge({ store, mediaLibrary });
    const sessionId = messages.find((message) => message.type === "control-hello").sessionId;
    channel.onmessage({ data: protocol({ type: "hello", clientId: "output-a", sessionId }) });
    channel.onmessage({ data: protocol({
      type: "recovery-state",
      clientId: "output-a",
      sessionId,
      recoveryId: "recovery-a",
      state: {
        project: { folderName: "show" },
        components: [{ id: "component-a", thumbnail: "blob:output" }],
        metrics: { clients: 0, outputs: {} },
      },
    }) });
    channel.onmessage({ data: protocol({
      type: "recovery-media-files",
      clientId: "output-a",
      sessionId,
      recoveryId: "recovery-a",
      folderName: "show",
      files: [{ id: "media/a.png", file: { name: "a.png" } }],
    }) });

    assert.equal(state.project.folderName, "show");
    assert.match(
      state.project.warnings[0],
      /Read-only recovery/,
      "a late Output recovery cannot masquerade as a writable local project",
    );
    assert.equal(state.components[0].thumbnail, "");
    assert.equal(importStarted, false, "media recovery must not hold the state publication task open");

    // Simulate the stored-folder path hydrating the authoritative thumbnail
    // while the deferred recovery media import is pending.
    state = {
      ...state,
      components: [{ id: "component-a", thumbnail: "blob:folder-thumbnail" }],
    };
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(importStarted, true);
    finishImport({ media: [], shaders: [] });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(replaceCount, 1, "media completion must not perform a second recovery replace");
    assert.equal(state.components[0].thumbnail, "blob:folder-thumbnail");
    assert.equal(messages.some((message) => message.type === "media-files"), true);
  } finally {
    bridge?.close();
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("output recovery sends lightweight state before its media snapshot", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  let bridge = null;
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    bridge = createOutputBridge({ mode: "output", outputId: "main" });
    const files = [{ id: "media/a.png", file: { name: "a.png" } }];
    bridge.recoveryState({ project: { folderName: "show" }, components: [] }, files);

    const stateMessage = messages.find((message) => message.type === "recovery-state");
    assert.ok(stateMessage);
    assert.equal("files" in stateMessage, false);
    assert.equal(stateMessage.state.project.folderName, "show");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const mediaMessage = messages.find((message) => message.type === "recovery-media-files");
    assert.deepEqual(mediaMessage.files, files);
    assert.equal(mediaMessage.folderName, "show");
    assert.equal(mediaMessage.recoveryId, stateMessage.recoveryId);
  } finally {
    bridge?.close();
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("output bridge owns realtime Live-state delivery independently of animation frames", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  let listener = null;
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    let revision = 1;
    const store = {
      subscribe(next) { listener = next; return () => { listener = null; }; },
      getLiveRenderState: () => ({ revision }),
      getState: () => ({ metrics: { clients: 0, outputs: {} } }),
      getMetrics: () => ({ clients: 0, outputs: {} }),
      updateRuntime() {},
    };
    const bridge = createControlBridge({ store, mediaLibrary: { getAllFiles: () => [] } });
    const sessionId = messages.find((message) => message.type === "control-hello")?.sessionId;

    listener({}, "scrub:live", {
      scope: "live",
      phase: "scrub",
      livePatches: [createLiveRenderPatch("component-a", "chain.0.params.amount", 0.25)],
    });
    listener({}, "scrub:live", {
      scope: "live",
      phase: "scrub",
      livePatches: [createLiveRenderPatch("component-a", "chain.0.params.amount", 0.3)],
    });
    assert.equal(messages.filter((message) => message.type === "state").length, 0);
    revision = 2;
    await Promise.resolve();
    const firstPatchMessage = messages.filter((message) => message.type === "live-patch").at(-1);
    assert.equal(Number.isFinite(firstPatchMessage.transport?.sentAtMs), true);
    assert.deepEqual({ ...firstPatchMessage, transport: undefined }, {
      type: "live-patch",
      baseRevision: 0,
      revision: 1,
      sessionId,
      patches: [createLiveRenderPatch("component-a", "chain.0.params.amount", 0.3)],
      transport: undefined,
      protocolVersion: OUTPUT_BRIDGE_PROTOCOL_VERSION,
    });

    revision = 3;
    listener({}, "live:update", {
      scope: "live",
      phase: "commit",
      livePatches: [createLiveRenderPatch("component-a", "chain.0.params.amount", 0.5)],
    });
    const secondPatchMessage = messages.filter((message) => message.type === "live-patch").at(-1);
    assert.equal(Number.isFinite(secondPatchMessage.transport?.sentAtMs), true);
    assert.deepEqual({ ...secondPatchMessage, transport: undefined }, {
      type: "live-patch",
      baseRevision: 1,
      revision: 2,
      sessionId,
      patches: [createLiveRenderPatch("component-a", "chain.0.params.amount", 0.5)],
      transport: undefined,
      protocolVersion: OUTPUT_BRIDGE_PROTOCOL_VERSION,
    });

    listener({}, "live:scene", { scope: "live", phase: "commit" });
    const stateMessage = messages.filter((message) => message.type === "state").at(-1);
    assert.equal(Number.isFinite(stateMessage.transport?.sentAtMs), true);
    assert.deepEqual({ ...stateMessage, transport: undefined }, {
      type: "state",
      state: { revision: 3 },
      targetClientId: "",
      activation: "full",
      revision: 3,
      sessionId,
      transport: undefined,
      protocolVersion: OUTPUT_BRIDGE_PROTOCOL_VERSION,
    });
    bridge.close();
    assert.equal(listener, null);
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("Application graph can own bridge state delivery without a hidden store subscription", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  let subscribed = false;
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const state = { metrics: { clients: 0, outputs: {} } };
    const bridge = createControlBridge({
      subscribeStore: false,
      store: {
        subscribe() { subscribed = true; return () => {}; },
        getLiveRenderState: () => state,
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
      },
      mediaLibrary: { getAllFiles: () => [] },
    });

    assert.equal(subscribed, false);
    bridge.acceptStateChange(state, "scrub:live", {
      scope: "live",
      phase: "scrub",
      livePatches: [createLiveRenderPatch("component-a", "chain.0.params.amount", 0.75)],
    });
    await Promise.resolve();
    assert.equal(messages.filter((message) => message.type === "live-patch").at(-1).patches[0].value, 0.75);
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("asset catalog state transport declares scoped activation", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const state = {
      project: { folderName: "project" },
      metrics: { clients: 0, outputs: {} },
    };
    const bridge = createControlBridge({
      subscribeStore: false,
      store: {
        getLiveRenderState: () => state,
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
      },
      mediaLibrary: { getAllFiles: () => [] },
    });

    bridge.sendState(null, { activation: "assets" });
    const packet = messages.find((message) => message.type === "state");
    assert.equal(packet.activation, "assets");
    assert.deepEqual(packet.state.project, { folderName: "project" });
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("Live Surface visibility sends only the derived route projection", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const state = {
      project: { folderName: "project" },
      metrics: { clients: 0, outputs: {} },
      surfaces: [{ id: "surface-a", enabled: false }],
    };
    const bridge = createControlBridge({
      subscribeStore: false,
      store: {
        getLiveRenderState: () => state,
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
      },
      mediaLibrary: { getAllFiles: () => [] },
    });

    bridge.acceptStateChange(state, "live:surface-visibility", {
      scope: "live",
    });
    const packet = messages.find((message) => message.type === "live-patch");
    assert.equal(messages.some((message) => message.type === "state"), false);
    assert.deepEqual(packet.patches, [
      createRenderStatePatch("surfaces", state.surfaces),
    ]);
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("persistent Component scrubs use the same small revisioned patch transport", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const state = { metrics: { clients: 0, outputs: {} } };
    const bridge = createControlBridge({
      store: {
        subscribe() { return () => {}; },
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
      },
      mediaLibrary: { getAllFiles: () => [] },
    });
    bridge.sendRenderPatches([
      createLiveRenderPatch("component-a", "chain.0.params.amount", 0.4),
    ], { coalesce: true });
    bridge.sendRenderPatches([
      createLiveRenderPatch("component-a", "chain.0.params.amount", 0.6),
    ], { coalesce: true });
    await Promise.resolve();
    const patch = messages.filter((message) => message.type === "live-patch").at(-1);
    assert.equal(patch.patches.length, 1);
    assert.equal(patch.patches[0].value, 0.6);
    assert.equal(messages.some((message) => message.type === "state"), false);
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("committed Component placement sends one patch and never a project snapshot", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const state = { metrics: { clients: 0, outputs: {} } };
    const bridge = createControlBridge({
      subscribeStore: false,
      store: {
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
      },
      mediaLibrary: { getAllFiles: () => [] },
    });
    bridge.sendRenderPatches([
      createLiveRenderPatch("component-a", "chain.0.boundary", {
        x: 0.25,
        y: -0.1,
        width: 0.5,
        height: 0.5,
      }),
    ], { coalesce: false });

    const packets = messages.filter((message) =>
      message.type === "live-patch" || message.type === "state"
    );
    assert.equal(packets.length, 1);
    assert.equal(packets[0].type, "live-patch");
    assert.equal(packets[0].patches.length, 1);
    assert.deepEqual(packets[0].patches[0].value, {
      x: 0.25,
      y: -0.1,
      width: 0.5,
      height: 0.5,
    });
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("structurally shared object parameters cross the live patch transport as plain data", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  globalThis.BroadcastChannel = class {
    postMessage(message) {
      // Match the browser boundary: BroadcastChannel performs a structured
      // clone and rejects any transaction Proxy retained in the packet.
      messages.push(structuredClone(message));
    }
    close() {}
  };
  try {
    const base = {
      metrics: { clients: 0, outputs: {} },
      components: [{
        id: "component-a",
        chain: [{
          params: {
            material: Object.freeze({ version: "1.0.0", color: [1, 0, 0] }),
          },
        }],
      }],
    };
    const state = produceStructuralShare(base, (draft) => {
      draft.components[0].chain[0].params = {
        ...draft.components[0].chain[0].params,
        material: {
          ...draft.components[0].chain[0].params.material,
          color: draft.components[0].chain[0].params.material.color.map((value) => value),
        },
      };
    });
    const bridge = createControlBridge({
      store: {
        subscribe() { return () => {}; },
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
      },
      mediaLibrary: { getAllFiles: () => [] },
    });

    bridge.sendRenderPatches([
      createLiveRenderPatch(
        "component-a",
        "chain.0.params",
        state.components[0].chain[0].params,
      ),
    ], { coalesce: false });

    const packet = messages.find((message) => message.type === "live-patch");
    assert.deepEqual(packet.patches[0].value.material, {
      version: "1.0.0",
      color: [1, 0, 0],
    });
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("draft-backed render patch values detach at the BroadcastChannel boundary", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(structuredClone(message)); }
    close() {}
  };
  try {
    let transactionValue = null;
    const state = produceStructuralShare({
      metrics: { clients: 0, outputs: {} },
      components: [{
        id: "component-a",
        chain: [{ transform: { x: 0, y: 0, scale: 1, rotation: 0 } }],
      }],
    }, (draft) => {
      const item = draft.components[0].chain[0];
      item.transform = { ...item.transform, x: 0.5 };
      transactionValue = item.transform;
    });
    assert.throws(() => structuredClone(transactionValue), { name: "DataCloneError" });

    const bridge = createControlBridge({
      store: {
        subscribe() { return () => {}; },
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
      },
      mediaLibrary: { getAllFiles: () => [] },
    });
    bridge.sendRenderPatches([{
      componentId: "component-a",
      path: "chain.0.transform",
      value: transactionValue,
    }]);

    const packet = messages.find((message) => message.type === "live-patch");
    assert.deepEqual(packet.patches[0].value, {
      x: 0.5,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("a failed patch delivery is consumed once and does not advance transport revision", () => {
  let attempts = 0;
  const packets = [];
  const synchronizer = new LivePatchSynchronizer({
    onPatch(packet) {
      attempts++;
      if (attempts === 1) throw new DOMException("not cloneable", "DataCloneError");
      packets.push(packet);
    },
  });
  synchronizer.queue([createLiveRenderPatch("component-a", "chain.0.params.amount", 0.25)]);
  assert.throws(() => synchronizer.flush(), { name: "DataCloneError" });
  assert.equal(synchronizer.revision, 0);
  assert.equal(synchronizer.pendingCount, 0);
  assert.equal(synchronizer.flush(), null);

  synchronizer.queue([createLiveRenderPatch("component-a", "chain.0.params.amount", 0.5)]);
  const recovered = synchronizer.flush();
  assert.equal(recovered.baseRevision, 0);
  assert.equal(recovered.revision, 1);
  assert.equal(synchronizer.revision, 1);
  assert.equal(packets.length, 1);
});

test("mapping scrubs share the patch transport and retain only the latest calibration", async () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const state = { metrics: { clients: 0, outputs: {} } };
    const bridge = createControlBridge({
      store: {
        subscribe() { return () => {}; },
        getState: () => state,
        getMetrics: () => state.metrics,
        updateRuntime() {},
      },
      mediaLibrary: { getAllFiles: () => [] },
    });
    bridge.sendRenderPatches([
      createRenderStatePatch("mappingCalibration", { surfaces: [{ id: "surface-a", x: 0.1 }] }),
    ], { coalesce: true });
    bridge.sendRenderPatches([
      createRenderStatePatch("mappingCalibration", { surfaces: [{ id: "surface-a", x: 0.9 }] }),
    ], { coalesce: true });
    await Promise.resolve();
    const packets = messages.filter((message) => message.type === "live-patch");
    assert.equal(packets.length, 1);
    assert.equal(packets[0].patches.length, 1);
    assert.equal(packets[0].patches[0].target, "state");
    assert.equal(packets[0].patches[0].value.surfaces[0].x, 0.9);
    assert.equal(messages.some((message) => message.command === "sync-mapping"), false);
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("output bridge switches controller sessions and ignores stale controller traffic", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const messages = [];
  let channel = null;
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage(message) { messages.push(message); }
    close() {}
  };
  try {
    const states = [];
    const hellos = [];
    const bridge = createOutputBridge({
      mode: "output",
      onState: (state, meta) => states.push({ state, meta }),
      onControlHello: (meta) => hellos.push(meta),
    });
    const initialHelloCount = messages.filter((message) => message.type === "hello").length;
    channel.onmessage({ data: protocol({ type: "control-hello", sessionId: "control-new" }) });
    assert.equal(messages.filter((message) => message.type === "hello").length, initialHelloCount + 1);
    assert.deepEqual(hellos.at(-1), { sessionId: "control-new", changed: true });

    channel.onmessage({ data: protocol({
      type: "state",
      sessionId: "control-new",
      revision: 0,
      activation: "projection",
      state: { id: "new" },
    }) });
    channel.onmessage({ data: protocol({ type: "state", sessionId: "control-old", revision: 99, state: { id: "stale" } }) });
    assert.deepEqual(states.map((entry) => entry.state.id), ["new"]);
    assert.equal(states[0].meta.sessionId, "control-new");
    assert.equal(states[0].meta.activation, "projection");
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});

test("output receiver drops superseded pointer samples before renderer application", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  let channel = null;
  let scheduledFrame = null;
  const received = [];
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage() {}
    close() {}
  };
  globalThis.requestAnimationFrame = (callback) => {
    scheduledFrame = callback;
    return 1;
  };
  try {
    const bridge = createOutputBridge({
      mode: "output",
      onLivePatch: (patches, meta) => received.push({ patches, meta }),
    });
    channel.onmessage({ data: protocol({ type: "control-hello", sessionId: "control-a" }) });
    channel.onmessage({ data: protocol({
      type: "live-patch",
      sessionId: "control-a",
      baseRevision: 0,
      revision: 1,
      patches: [createRenderStatePatch("mappingCalibration", { x: 0.1 })],
    }) });
    channel.onmessage({ data: protocol({
      type: "live-patch",
      sessionId: "control-a",
      baseRevision: 1,
      revision: 2,
      patches: [createRenderStatePatch("mappingCalibration", { x: 0.9 })],
    }) });
    assert.equal(received.length, 0);
    scheduledFrame();
    assert.equal(received.length, 1);
    assert.equal(received[0].meta.baseRevision, 0);
    assert.equal(received[0].meta.revision, 2);
    assert.equal(received[0].patches.length, 1);
    assert.equal(received[0].patches[0].value.x, 0.9);
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test("a complete startup state subsumes buffered patches without a revision resync", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  let channel = null;
  let scheduledFrame = null;
  const received = [];
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage() {}
    close() {}
  };
  globalThis.requestAnimationFrame = (callback) => {
    scheduledFrame = callback;
    return 1;
  };
  try {
    const bridge = createOutputBridge({
      mode: "output",
      onState: (state, meta) => received.push(["state", state, meta]),
      onLivePatch: (patches, meta) => received.push(["patch", patches, meta]),
    });
    channel.onmessage({ data: protocol({ type: "control-hello", sessionId: "control-a" }) });
    channel.onmessage({ data: protocol({
      type: "live-patch",
      sessionId: "control-a",
      baseRevision: 150,
      revision: 151,
      patches: [createLiveRenderPatch("component-a", "opacity", 0.5)],
    }) });
    channel.onmessage({ data: protocol({
      type: "state",
      sessionId: "control-a",
      revision: 151,
      state: { id: "authoritative-151" },
    }) });

    assert.deepEqual(received.map((entry) => entry[0]), ["state"]);
    assert.equal(received[0][1].id, "authoritative-151");
    scheduledFrame();
    assert.deepEqual(received.map((entry) => entry[0]), ["state"]);
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test("a buffered patch newer than startup state continues from the installed revision", () => {
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  let channel = null;
  const received = [];
  globalThis.BroadcastChannel = class {
    constructor() { channel = this; }
    postMessage() {}
    close() {}
  };
  globalThis.requestAnimationFrame = () => 1;
  try {
    const bridge = createOutputBridge({
      mode: "output",
      onState: (state) => received.push(["state", state]),
      onLivePatch: (patches, meta) => received.push(["patch", patches, meta]),
    });
    channel.onmessage({ data: protocol({ type: "control-hello", sessionId: "control-a" }) });
    channel.onmessage({ data: protocol({
      type: "live-patch",
      sessionId: "control-a",
      baseRevision: 150,
      revision: 152,
      patches: [createLiveRenderPatch("component-a", "opacity", 0.75)],
    }) });
    channel.onmessage({ data: protocol({
      type: "state",
      sessionId: "control-a",
      revision: 151,
      state: { id: "authoritative-151" },
    }) });

    assert.deepEqual(received.map((entry) => entry[0]), ["state", "patch"]);
    assert.equal(received[1][2].baseRevision, 151);
    assert.equal(received[1][2].revision, 152);
    assert.equal(received[1][1][0].value, 0.75);
    bridge.close();
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test("Live render patches mutate only the addressed Component path", () => {
  const state = {
    components: [
      { id: "component-a", opacity: 1, chain: [{ params: { amount: 0.1 } }] },
      { id: "component-b", opacity: 0.75, chain: [{ params: { amount: 0.2 } }] },
    ],
  };
  const untouched = state.components[1];
  const result = applyLiveRenderPatches(state, [
    createLiveRenderPatch("component-a", "chain.0.params.amount", 0.8),
  ]);

  assert.equal(result.applied, true);
  assert.deepEqual(result.componentIds, ["component-a"]);
  assert.equal(state.components[0].chain[0].params.amount, 0.8);
  assert.equal(state.components[1], untouched);
  const beforeAtomicFailure = state.components[0].chain[0].params.amount;
  const failed = applyLiveRenderPatches(state, [
    createLiveRenderPatch("component-a", "chain.0.params.amount", 0.3),
    createLiveRenderPatch("component-a", "chain.9.params.amount", 1),
  ]);
  assert.equal(failed.applied, false);
  assert.equal(state.components[0].chain[0].params.amount, beforeAtomicFailure);
});

test("render-state patches update only allow-listed continuous renderer roots", () => {
  const originalCalibration = { coordinateSpace: "relative", surfaces: [] };
  const originalSurfaces = [{ id: "surface-a", enabled: true }];
  const state = {
    components: [],
    mappingCalibration: originalCalibration,
    surfaces: originalSurfaces,
    global: { blackout: false },
  };
  const nextCalibration = {
    coordinateSpace: "relative",
    surfaces: [{ id: "surface-a", corners: [{ x: 0.2, y: 0.1 }] }],
  };
  const applied = applyLiveRenderPatches(state, [
    createRenderStatePatch("mappingCalibration", nextCalibration),
  ]);
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.statePaths, ["mappingCalibration"]);
  assert.equal(state.mappingCalibration, nextCalibration);
  assert.deepEqual(state.global, { blackout: false });

  const nextSurfaces = [{ id: "surface-a", enabled: false }];
  const projected = applyLiveRenderPatches(state, [
    createRenderStatePatch("surfaces", nextSurfaces),
  ]);
  assert.equal(projected.applied, true);
  assert.deepEqual(projected.statePaths, ["surfaces"]);
  assert.equal(state.surfaces, nextSurfaces);

  const rejected = applyLiveRenderPatches(state, [
    createRenderStatePatch("global", { blackout: true }),
  ]);
  assert.equal(rejected.applied, false);
  assert.deepEqual(state.global, { blackout: false });
});

test("a route projection patch retains visual programs and rebuilds only Mapping lookups", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  const previousState = {
    components: [],
    nodes: { groups: [] },
    frames: [],
    surfaces: [{ id: "surface-a", enabled: true }],
    ui: { live: { paramFadeDuration: 0 } },
  };
  const nextSurfaces = [{ id: "surface-a", enabled: false }];
  renderer.state = previousState;
  const calls = [];
  renderer.mappingRuntime.captureState = () => {
    calls.push("capture");
    return { retained: true };
  };
  renderer.componentProgramRuntime.ensureStateRoots = (state) => calls.push(["ensure", state]);
  renderer.mappingProgramRuntime.rebuild = (state) => calls.push(["mapping", state]);
  renderer.componentProgramRuntime.rebuildLookups = (state) => calls.push(["lookups", state]);
  renderer.mappingRuntime.reconcileState = (state) => calls.push(["reconcile", state]);

  const result = renderer.livePatchRuntime.applyLive([
    createRenderStatePatch("surfaces", nextSurfaces),
  ]);

  assert.equal(result.applied, true);
  assert.notStrictEqual(renderer.state, previousState);
  assert.strictEqual(renderer.state.components, previousState.components);
  assert.strictEqual(renderer.state.surfaces, nextSurfaces);
  assert.deepEqual(calls, [
    "capture",
    ["ensure", renderer.state],
    ["mapping", renderer.state],
    ["lookups", renderer.state],
    ["reconcile", { retained: true }],
  ]);
});

test("Live render patches may author omitted parameter defaults but not structure", () => {
  const state = {
    components: [{
      id: "component-a",
      chain: [
        { kind: "effect", params: { amount: 1 } },
        { kind: "source", source: { type: "media", params: {} } },
      ],
    }],
  };
  const result = applyLiveRenderPatches(state, [
    createLiveRenderPatch("component-a", "chain.0.params.hueMin", 170),
    createLiveRenderPatch("component-a", "chain.1.source.params.alphaCut", 4),
  ]);

  assert.equal(result.applied, true);
  assert.equal(state.components[0].chain[0].params.hueMin, 170);
  assert.equal(state.components[0].chain[1].source.params.alphaCut, 4);
  assert.equal(applyLiveRenderPatches(state, [
    createLiveRenderPatch("component-a", "chain.0.typo", 1),
  ]).applied, false);
});

test("revisioned slider patches update the compiled visual plan without rebuilding it", () => {
  const component = {
    id: "component-a",
    type: "chain",
    chain: [{
      id: "source-a",
      kind: "source",
      enabled: true,
      opacity: 1,
      blend: "normal",
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      source: { type: "generator", generatorId: "noise", params: { scale: 1 } },
    }],
  };
  const persistedGroup = compileComponentGroupTopology(component);
  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = {
    components: [component],
    nodes: { groups: [persistedGroup] },
    frames: [],
    surfaces: [],
    ui: { live: { paramFadeDuration: 0 } },
  };
  renderer.componentProgramRuntime.rebuild();
  renderer.componentProgramRuntime.rebuildLookups();
  const program = renderer.componentProgramRuntime.programs.get(component.id);
  const originalPlan = program.plan;
  assert.strictEqual(program.plan.operations[0].configuration, component.chain[0]);
  assert.notStrictEqual(program.plan.operations[0].configuration, persistedGroup.nodes[0].configuration);

  const result = renderer.livePatchRuntime.applyLive([
    createLiveRenderPatch(component.id, "chain.0.source.params.scale", 3),
  ]);

  assert.equal(result.applied, true);
  assert.strictEqual(program.plan, originalPlan, "a parameter scrub does not recompile the plan");
  assert.equal(program.plan.operations[0].configuration.source.params.scale, 3);
});

test("Live numeric patches preserve target truth while the renderer interpolates display values", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = {
    components: [{ id: "component-a", chain: [{ params: { amount: 0 } }] }],
    frames: [],
    surfaces: [],
    ui: { live: { paramFadeDuration: 1 } },
  };
  renderer.componentProgramRuntime.rebuildLookups();

  const result = renderer.livePatchRuntime.applyLive([
    createLiveRenderPatch("component-a", "chain.0.params.amount", 1),
  ], 100);
  const params = renderer.state.components[0].chain[0].params;
  assert.equal(result.applied, true);
  assert.equal(params.amount, 1, "the commanded target remains canonical between frames");

  renderer.livePatchRuntime.applyFrame(600);
  assert.equal(params.amount, 0.5);
  renderer.livePatchRuntime.restoreFrame();
  assert.equal(params.amount, 1, "render-only interpolation must restore user truth");

  renderer.livePatchRuntime.applyLive([
    createLiveRenderPatch("component-a", "chain.0.params.amount", 0),
  ], 600);
  renderer.livePatchRuntime.applyFrame(1100);
  assert.equal(params.amount, 0.25, "retargeting continues from the currently displayed value");
  renderer.livePatchRuntime.restoreFrame();
  assert.equal(params.amount, 0);
});

test("Structural resolution patches bypass param fading in both directions", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = {
    components: [{ id: "component-a", resolutionScale: 1, chain: [] }],
    frames: [],
    surfaces: [],
    ui: { live: { paramFadeDuration: 2 } },
  };
  renderer.componentProgramRuntime.rebuildLookups();

  renderer.livePatchRuntime.applyLive([
    createLiveRenderPatch("component-a", "resolutionScale", 0.5),
  ], 100);
  renderer.livePatchRuntime.applyFrame(600);
  assert.equal(renderer.state.components[0].resolutionScale, 0.5);
  assert.equal(renderer.livePatchRuntime.fades.size, 0);

  renderer.livePatchRuntime.applyLive([
    createLiveRenderPatch("component-a", "resolutionScale", 2),
  ], 700);
  renderer.livePatchRuntime.applyFrame(800);
  assert.equal(renderer.state.components[0].resolutionScale, 2);
  assert.equal(renderer.livePatchRuntime.fades.size, 0);
});

test("persisted renditions are bound to the exact source file revision", async () => {
  const first = { name: "photo.png", relativePath: "media/photo.png", size: 10, lastModified: 1, type: "image/png" };
  const replacement = { ...first, size: 20, lastModified: 2 };
  const firstRevision = mediaSourceRevision(first);
  const replacementRevision = mediaSourceRevision(replacement);
  assert.notEqual(firstRevision, replacementRevision);

  const path = mediaRenditionPath("media/photo.png", 320, 180, firstRevision);
  assert.deepEqual(parseMediaRenditionPath(path), {
    mediaId: "media/photo.png",
    width: 320,
    height: 180,
    sourceRevision: firstRevision,
    key: `media/photo.png:320x180:${firstRevision}`,
    path,
  });

  const rendition = { name: path.split("/").at(-1), relativePath: path, size: 5, lastModified: 3, type: "image/png" };
  const library = createMediaLibrary();
  await library.importFiles([first, rendition]);
  assert.equal(library.getAllFiles()[0].renditions.length, 1);
  library.clear();
  await library.importFiles([replacement, rendition]);
  assert.equal(library.getAllFiles()[0].renditions.length, 0, "a same-path replacement cannot reuse the previous file's pixels");
});

test("rendition snapshot removal disposes loaded and in-flight rendition resources", () => {
  const previousLoadImage = globalThis.loadImage;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  const loads = [];
  const revoked = [];
  let urlIndex = 0;
  globalThis.loadImage = (url, ready, error) => loads.push({ url, ready, error });
  URL.createObjectURL = () => `blob:rendition-${++urlIndex}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const file = { name: "photo.png", size: 10, lastModified: 1, type: "image/png" };
    const revision = mediaSourceRevision(file);
    const key = `media/photo.png:320x180:${revision}`;
    const renditionFile = { name: "cached.png", size: 5, lastModified: 2, type: "image/png" };
    const runtime = new OutputMediaRuntime();
    runtime.importFiles([{ id: "media/photo.png", file, renditions: [{ key, file: renditionFile }] }]);
    const item = runtime.acquireMedia(runtime.media.get("media/photo.png"));
    loads[0].ready({ width: 640, height: 360 });
    runtime.getImageRendition(item, 320, 180);
    const revisionBeforeRendition = item.revision;
    const renditionImage = { removeCount: 0, remove() { this.removeCount++; } };
    loads[1].ready(renditionImage);
    assert.equal(runtime.media.get("media/photo.png").imageRenditions.get(key), renditionImage);
    assert.equal(item.revision, revisionBeforeRendition + 1, "a completed persisted rendition invalidates stable render nodes");

    runtime.importFiles([{ id: "media/photo.png", file, renditions: [] }]);
    assert.equal(runtime.media.get("media/photo.png").imageRenditions.has(key), false);
    assert.equal(renditionImage.removeCount, 1);
    assert.ok(revoked.includes("blob:rendition-2"), "the rendition object URL is released after decode");
    runtime.dispose();
  } finally {
    if (previousLoadImage === undefined) delete globalThis.loadImage;
    else globalThis.loadImage = previousLoadImage;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});

test("generic media LRU accounts for decoded rendition memory", () => {
  const runtime = new OutputMediaRuntime({
    maxCachedMedia: 12,
    maxCachedMediaBytes: 1_000_000,
  });
  const removed = [];
  const item = {
    id: "media/photo.png",
    file: { name: "photo.png", size: 10, type: "image/png" },
    image: { width: 100, height: 100, remove() { removed.push("base"); } },
    imageRenditions: new Map([["large", {
      width: 1000,
      height: 1000,
      remove() { removed.push("rendition"); },
    }]]),
    imageRenditionOrder: ["large"],
    persistedRenditions: new Map(),
    renditionUrls: new Map(),
    loadToken: 0,
    revision: 0,
    ready: true,
    loading: false,
    lastMediaUse: 1,
  };
  runtime.media.set(item.id, item);
  runtime.beginFrame();
  runtime.endFrame();
  assert.equal(item.image, null);
  assert.deepEqual(removed.sort(), ["base", "rendition"]);
});

test("media prepared for an incoming Scene is reserved until activation or cancellation", () => {
  const runtime = new OutputMediaRuntime({ maxCachedMedia: 0, maxCachedMediaBytes: 0 });
  const removed = [];
  const item = {
    id: "incoming.png",
    file: { name: "incoming.png", size: 10, type: "image/png" },
    image: { width: 64, height: 64, remove() { removed.push("image"); } },
    imageRenditions: new Map(),
    imageRenditionOrder: [],
    persistedRenditions: new Map(),
    renditionUrls: new Map(),
    loadToken: 0,
    revision: 0,
    ready: true,
    loading: false,
    lastMediaUse: 1,
  };
  runtime.media.set(item.id, item);
  runtime.reserveMedia([item.id]);
  runtime.beginFrame();
  runtime.endFrame();
  assert.equal(item.image.width, 64);
  assert.deepEqual(removed, []);

  runtime.reserveMedia();
  runtime.beginFrame();
  runtime.endFrame();
  assert.equal(item.image, null);
  assert.deepEqual(removed, ["image"]);
});

test("camera failures are reported once and retried on a bounded clock", async () => {
  const previousSetup = globalThis.setupWebcamera;
  const previousMillis = globalThis.millis;
  const previousError = console.error;
  let now = 100;
  let attempts = 0;
  const errors = [];
  globalThis.millis = () => now;
  globalThis.setupWebcamera = () => {
    attempts++;
    return Promise.reject(new Error("permission denied"));
  };
  console.error = (...args) => errors.push(args);
  try {
    const runtime = new OutputMediaRuntime({
      getRenderSettings: () => ({ frameWidth: 640, frameHeight: 480 }),
    });
    runtime.acquireCameraInput();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(runtime.cameraError, "permission denied");
    assert.equal(attempts, 1);
    runtime.acquireCameraInput();
    assert.equal(attempts, 1, "the render loop does not restart a failed camera every frame");
    now = 3200;
    runtime.acquireCameraInput();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(attempts, 2, "the same camera configuration remains recoverable");
    assert.equal(errors.filter(([label]) => label === "[VJ1_CAMERA_CAPTURE_FAILED]").length, 1);
  } finally {
    if (previousSetup === undefined) delete globalThis.setupWebcamera;
    else globalThis.setupWebcamera = previousSetup;
    if (previousMillis === undefined) delete globalThis.millis;
    else globalThis.millis = previousMillis;
    console.error = previousError;
  }
});

test("camera capture is shared by active consumers and released after demand ends", async () => {
  const previousSetup = globalThis.setupWebcamera;
  let setupCount = 0;
  let removeCount = 0;
  globalThis.setupWebcamera = async () => {
    setupCount++;
    return { width: 640, height: 480, remove() { removeCount++; } };
  };
  const runtime = new OutputMediaRuntime({
    getRenderSettings: () => ({ frameWidth: 640, frameHeight: 480 }),
    cameraIdleGraceMs: 5,
  });
  try {
    runtime.beginFrame();
    runtime.acquireCameraInput();
    runtime.acquireCameraInput();
    runtime.endFrame();
    await Promise.resolve();
    assert.equal(setupCount, 1, "identical active consumers share one capture");
    assert.ok(runtime.cameraCapture);

    runtime.beginFrame();
    runtime.acquireCameraInput();
    runtime.endFrame();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(runtime.cameraCapture, "an active frame does not schedule capture disposal");

    runtime.beginFrame();
    runtime.endFrame();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(runtime.cameraCapture, null);
    assert.equal(removeCount, 1, "the last consumer disappearing closes capture after the grace period");
  } finally {
    runtime.dispose();
    if (previousSetup === undefined) delete globalThis.setupWebcamera;
    else globalThis.setupWebcamera = previousSetup;
  }
});

test("media load failures update readiness and emit structured diagnostics", () => {
  const previousLoadImage = globalThis.loadImage;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  const previousError = console.error;
  const errors = [];
  let rejectLoad = null;
  globalThis.loadImage = (_url, _ready, error) => { rejectLoad = error; };
  URL.createObjectURL = () => "blob:failed-image";
  URL.revokeObjectURL = () => {};
  console.error = (...args) => errors.push(args);
  try {
    const runtime = new OutputMediaRuntime();
    runtime.importFiles([{ id: "media/broken.png", file: { name: "broken.png", size: 5, lastModified: 1, type: "image/png" } }]);
    runtime.acquireMedia(runtime.media.get("media/broken.png"));
    rejectLoad(new Error("decode failed"));
    const item = runtime.media.get("media/broken.png");
    assert.equal(item.ready, false);
    assert.equal(item.loadError, "decode failed");
    assert.equal(item.revision, 1);
    assert.deepEqual(errors[0], ["[VJ1_MEDIA_LOAD_FAILED]", {
      id: "media/broken.png",
      fileKey: mediaFileFingerprint(item.file),
      loadToken: 1,
      message: "decode failed",
    }]);
    runtime.dispose();
  } finally {
    if (previousLoadImage === undefined) delete globalThis.loadImage;
    else globalThis.loadImage = previousLoadImage;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
    console.error = previousError;
  }
});

test("model imports expose processing state and exact preview diagnostics", () => {
  const runtimeSource = readFileSync(new URL("../js/output/output-media-runtime.js", import.meta.url), "utf8");
  const meshSource = readFileSync(new URL("../js/libraries/mesh-engine/media-mesh/index.js", import.meta.url), "utf8");
  const sceneRenderSource = readFileSync(new URL("../js/libraries/mesh-engine/scene-render/index.js", import.meta.url), "utf8");
  assert.match(runtimeSource, /item\.loadStatus = "reading 3D model"/);
  assert.match(runtimeSource, /item\.loadStatus = "processing 3D model"/);
  assert.match(meshSource, /externalStatus\?\.loadStatus/);
  assert.match(meshSource, /externalStatus\?\.modelError/);
  assert.match(sceneRenderSource, /`3D model error: \$\{resourceStatus\.error\}`/);
  assert.match(sceneRenderSource, /\{ forceVisible: true \}/);
});
