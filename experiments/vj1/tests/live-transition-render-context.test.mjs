import test from "node:test";
import assert from "node:assert/strict";

import { alignLiveTransitionRenderContext } from "../js/output/live-transition-render-context.js";

test("Live transition sides receive the same presentation context", () => {
  const state = {
    render: {
      hostViewport: { width: 1400, height: 900 },
      previewQuality: "good",
      previewRasterScale: 2,
      previewViewportZoom: 1.5,
      previewViewportX: 0.1,
      previewViewportY: -0.2,
      aspect: 16 / 9,
      outputs: [{ id: "current-output" }],
    },
    liveTransition: {
      fromState: {
        render: {
          hostViewport: { width: 640, height: 360 },
          previewRasterScale: 1,
          aspect: 4 / 3,
          outputs: [{ id: "previous-output" }],
        },
      },
    },
  };

  const aligned = alignLiveTransitionRenderContext(state);
  assert.notStrictEqual(aligned, state);
  assert.deepEqual(aligned.liveTransition.fromState.render.hostViewport, state.render.hostViewport);
  assert.equal(aligned.liveTransition.fromState.render.previewQuality, "good");
  assert.equal(aligned.liveTransition.fromState.render.previewRasterScale, 2);
  assert.equal(aligned.liveTransition.fromState.render.previewViewportZoom, 1.5);
  assert.equal(aligned.liveTransition.fromState.render.previewViewportX, 0.1);
  assert.equal(aligned.liveTransition.fromState.render.previewViewportY, -0.2);
  assert.equal(aligned.liveTransition.fromState.render.aspect, 4 / 3);
  assert.deepEqual(aligned.liveTransition.fromState.render.outputs, [{ id: "current-output" }]);
  assert.equal(state.liveTransition.fromState.render.previewRasterScale, 1);
});

test("render context alignment leaves non-transition states untouched", () => {
  const state = { render: { hostViewport: { width: 800, height: 600 } } };
  assert.strictEqual(alignLiveTransitionRenderContext(state), state);
  assert.equal(alignLiveTransitionRenderContext(null), null);
});
