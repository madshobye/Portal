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

test("imported video loading configures an inert muted inline element", () => {
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
      message: "autoplay denied",
    }]);
    assert.equal(errors.length, 1);
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
    assert.equal(loads.length, 1, "an unchanged File keeps its current runtime load");
    runtime.importFiles([{ id: "media/photo.png", file: replacement }]);
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
    const renditionImage = { removeCount: 0, remove() { this.removeCount++; } };
    loads[1].ready(renditionImage);
    assert.equal(runtime.media.get("media/photo.png").imageRenditions.get(key), renditionImage);

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
