import test from "node:test";
import assert from "node:assert/strict";

import { createBrowserCameraCapture } from "../js/output/browser-camera-capture.js";

test("native camera capture owns constraints and stops its stream on removal", async () => {
  const constraints = [];
  let stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const video = {
    tagName: "VIDEO",
    dataset: {},
    readyState: 2,
    videoWidth: 1280,
    videoHeight: 720,
    async play() {},
  };
  const capture = await createBrowserCameraCapture({
    front: false,
    width: 1280,
    height: 720,
    mirrored: true,
  }, {
    mediaDevices: {
      async getUserMedia(value) {
        constraints.push(value);
        return stream;
      },
    },
    documentRef: { createElement: () => video },
  });

  assert.deepEqual(constraints, [{
    audio: false,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: { ideal: "environment" },
    },
  }]);
  assert.equal(capture.dataset.vj1Mirrored, "true");
  capture.remove();
  assert.equal(stopped, 1);
  assert.equal(capture.srcObject, null);
});
