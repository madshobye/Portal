import test from "node:test";
import assert from "node:assert/strict";

import { mediaFileFingerprint, OutputMediaRuntime } from "../js/output/output-media-runtime.js";
import { syncVideoPlayback } from "../js/output/media-utils.js";
import { OutputThumbnailRuntime } from "../js/output/output-thumbnail-runtime.js";
import { createControlBridge } from "../js/services/output-bridge-service.js";
import { createMediaLibrary } from "../js/services/media-library-service.js";
import { mediaRenditionPath, mediaSourceRevision, parseMediaRenditionPath } from "../js/services/media-rendition-service.js";

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

test("video import stays metadata-only until an active render acquires it", () => {
  const previousCreateVideo = globalThis.createVideo;
  const previousCreateUrl = URL.createObjectURL;
  const previousRevokeUrl = URL.revokeObjectURL;
  let ready = null;
  let loopCalls = 0;
  const attributes = new Map();
  const element = {
    tagName: "VIDEO",
    muted: false,
    defaultMuted: false,
    playsInline: false,
    preload: "",
    addEventListener() {},
    setAttribute(name, value) { attributes.set(name, value); },
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
    const runtime = new OutputMediaRuntime();
    runtime.importFiles([{ id: "media/clip.mp4", file: { name: "clip.mp4", size: 20, lastModified: 1, type: "video/mp4" } }]);
    assert.equal(ready, null, "the library snapshot does not instantiate a video decoder");
    runtime.beginFrame();
    runtime.acquireMedia(runtime.media.get("media/clip.mp4"));
    assert.equal(element.muted, true);
    assert.equal(element.defaultMuted, true);
    assert.equal(element.playsInline, true);
    assert.equal(element.preload, "auto");
    assert.equal(attributes.has("muted"), true);
    assert.equal(attributes.has("playsinline"), true);
    assert.equal(loopCalls, 0, "decode setup does not start playback");
    ready();
    assert.equal(runtime.media.get("media/clip.mp4").ready, true);
    assert.equal(loopCalls, 0);
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
    assert.equal(element.loop, true);
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
  assert.equal(attempts, 2, "the runtime keeps converging toward Play while readiness is only observed state");
  assert.equal(element.paused, true, "a browser-reported pause is not treated as a new user command");
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
    bridge.sendMediaFiles([]);
    bridge.close();
    assert.deepEqual(messages.at(-1), { type: "media-files", files: [] });
  } finally {
    if (previousBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = previousBroadcastChannel;
  }
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
    runtime.ensureCameraCapture();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(runtime.cameraError, "permission denied");
    assert.equal(attempts, 1);
    runtime.ensureCameraCapture();
    assert.equal(attempts, 1, "the render loop does not restart a failed camera every frame");
    now = 3200;
    runtime.ensureCameraCapture();
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
