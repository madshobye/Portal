import test from "node:test";
import assert from "node:assert/strict";

import { ScreenCaptureService } from "../js/output/screen-capture-service.js?v=test";

test("screen capture remains session-owned until explicitly stopped", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const stopped = [];
  const track = {
    addEventListener() {},
    stop() { stopped.push("track"); },
  };
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  const video = {
    autoplay: false,
    muted: false,
    playsInline: false,
    srcObject: null,
    async play() {},
  };
  const requests = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { async getDisplayMedia(constraints) { requests.push(constraints); return stream; } } },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => video },
  });
  try {
    const service = new ScreenCaptureService();
    await service.start({ frameRate: 24, cursor: "never", includeCurrentTab: false });
    assert.deepEqual(service.snapshot(), { status: "active", error: "", active: true });
    assert.equal(service.video, video);
    assert.deepEqual(requests[0].video, {
      frameRate: { ideal: 24 },
      cursor: "never",
    });
    assert.equal("width" in requests[0].video, false);
    assert.equal("height" in requests[0].video, false);
    assert.equal(requests[0].selfBrowserSurface, "exclude");

    service.stop();
    assert.deepEqual(service.snapshot(), { status: "idle", error: "", active: false });
    assert.equal(stopped.length, 1);
  } finally {
    restoreProperty("navigator", previousNavigator);
    restoreProperty("document", previousDocument);
  }
});

function restoreProperty(key, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else delete globalThis[key];
}
