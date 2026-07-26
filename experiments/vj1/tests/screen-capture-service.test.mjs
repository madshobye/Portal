import test from "node:test";
import assert from "node:assert/strict";

import { ScreenCaptureService } from "../js/output/screen-capture-service.js";

test("multiple screen captures remain session-owned and independently addressable", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const stopped = [];
  const tracks = ["Design window", "Reference window"].map((label, index) => ({
    label,
    addEventListener() {},
    getSettings: () => ({ width: 1280 + index * 640, height: 720 + index * 360 }),
    stop() { stopped.push(label); },
  }));
  const streams = tracks.map((track) => ({
    getVideoTracks: () => [track],
    getTracks: () => [track],
  }));
  const videos = tracks.map(() => ({
    autoplay: false,
    muted: false,
    playsInline: false,
    srcObject: null,
    async play() {},
  }));
  const requests = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { async getDisplayMedia(constraints) { requests.push(constraints); return streams[requests.length - 1]; } } },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => videos[requests.length - 1] },
  });
  try {
    const service = new ScreenCaptureService();
    await service.start({ frameRate: 24, cursor: "never", includeCurrentTab: false });
    await service.start({ frameRate: 30, cursor: "motion", includeCurrentTab: true });
    const active = service.snapshot();
    assert.equal(active.status, "active");
    assert.equal(active.active, true);
    assert.equal(active.inputs.length, 2);
    assert.deepEqual(active.inputs.map((input) => input.name), ["Design window", "Reference window"]);
    assert.deepEqual(active.inputs.map((input) => [input.width, input.height]), [[1280, 720], [1920, 1080]]);
    assert.notEqual(active.inputs[0].id, active.inputs[1].id);
    assert.equal(service.videoFor(active.inputs[0].id), videos[0]);
    assert.equal(service.videoFor(active.inputs[1].id), videos[1]);
    assert.deepEqual(requests[0].video, {
      frameRate: { ideal: 24 },
      cursor: "never",
    });
    assert.equal("width" in requests[0].video, false);
    assert.equal("height" in requests[0].video, false);
    assert.equal(requests[0].selfBrowserSurface, "exclude");

    assert.equal(service.rename(active.inputs[0].id, "Program feed"), true);
    assert.equal(service.snapshot().inputs[0].name, "Program feed");

    service.stop(active.inputs[0].id);
    assert.equal(service.snapshot().inputs.length, 1);
    assert.deepEqual(stopped, ["Design window"]);
    assert.equal(videos[0].srcObject, null);

    service.stopAll();
    assert.deepEqual(service.snapshot(), { status: "idle", error: "", active: false, inputs: [] });
    assert.deepEqual(stopped, ["Design window", "Reference window"]);
  } finally {
    restoreProperty("navigator", previousNavigator);
    restoreProperty("document", previousDocument);
  }
});

function restoreProperty(key, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else delete globalThis[key];
}
