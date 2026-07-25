import test from "node:test";
import assert from "node:assert/strict";
import { RenderRequestRuntime } from "../js/output/render-request-runtime.js";

test("render requests normalize demand, density, and control signals through one capability", () => {
  const controls = { audio: { level: 0.5 } };
  const runtime = new RenderRequestRuntime({
    getRenderSettings: () => ({ width: 1280, height: 720 }),
    getFrameSize: (render) => ({
      width: render.width,
      height: render.height,
    }),
    getPixelDensity: () => 2,
    controlSignals: controls,
  });

  assert.deepEqual(runtime.normalize(null, "source"), {
    role: "source",
    width: 1280,
    height: 720,
    controlSignals: controls,
  });
  assert.deepEqual(runtime.normalize({
    width: 320,
    height: 180,
    renderIdentity: "eye:a",
  }, "effect"), {
    role: "effect",
    width: 320,
    height: 180,
    renderIdentity: "eye:a",
    controlSignals: controls,
  });
  assert.equal(runtime.pixelDensity({}), 2);
  assert.equal(runtime.pixelDensity({ pixelDensityApplied: true }), 1);

  const replacement = { midi: { note: 64 } };
  runtime.setControlSignals(replacement);
  assert.strictEqual(
    runtime.normalize({ width: 1, height: 1 }).controlSignals,
    replacement,
  );
});
