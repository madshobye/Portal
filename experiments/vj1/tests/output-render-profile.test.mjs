import test from "node:test";
import assert from "node:assert/strict";

import { OutputRenderProfile } from "../js/output/output-render-profile.js";

test("render profiling samples at its configured cadence", () => {
  const profile = new OutputRenderProfile({ sampleInterval: 2 });
  profile.beginFrame(1);
  assert.equal(profile.collectDetailed, false);
  assert.equal(profile.measure("sourceMs", { type: "source" }, () => 42), 42);
  assert.equal(profile.frameProfile.passSamples.length, 0);

  profile.beginFrame(2);
  assert.equal(profile.collectDetailed, true);
  profile.measure("sourceMs", { type: "source" }, () => 42);
  assert.equal(profile.frameProfile.passSamples.length, 1);
  assert.equal(profile.frameProfile.passSamples[0].type, "source");
});

test("nested component profiling preserves ownership and counts wall time once", () => {
  const profile = new OutputRenderProfile({ sampleInterval: 1 });
  profile.beginFrame(1);
  profile.measureComponent({ type: "component", componentId: "parent", componentName: "Parent" }, () => {
    assert.deepEqual(profile.activeComponentIdentity(), { componentId: "parent", componentName: "Parent" });
    profile.measureComponent({ type: "component", componentId: "child", componentName: "Child" }, () => {
      assert.deepEqual(profile.activeComponentIdentity(), { componentId: "child", componentName: "Child" });
    });
  });

  assert.equal(profile.frameProfile.componentRenders, 2);
  assert.ok(profile.frameProfile.componentMs >= profile.frameProfile.componentWallMs);
  const finished = profile.finishFrame(performance.now());
  assert.equal(finished.passSamples.length, 2);
  assert.deepEqual(profile.activeComponentIdentity(), {});
});
