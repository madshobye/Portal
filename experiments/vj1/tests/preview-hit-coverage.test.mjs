import test from "node:test";
import assert from "node:assert/strict";

import {
  PreviewHitCoverage,
  composeAffine,
  invertAffine,
  regionToParentAffine,
} from "../js/output/preview-hit-coverage.js";
import { createPlacedRenderResult } from "../js/graph/placed-render-result.js";
import { VISUAL_HIT_REGION_MODES } from "../js/libraries/render-engine/visual-node-contract.js";

test("preview alpha picking clicks through only completely transparent coverage", () => {
  const item = { id: "source", kind: "source", source: { type: "generator" } };
  const component = { id: "component", chain: [item] };
  const host = {
    mode: "component",
    state: { ui: { selectedComponentId: component.id } },
  };
  const coverage = new PreviewHitCoverage(host);
  const texture = alphaTexture(20, 20, [{ x: 10, y: 10, alpha: 1 }]);
  const request = {
    reason: "component-preview",
    width: 100,
    height: 100,
  };
  coverage.prepareRootRequest(component, request);
  coverage.recordRaster(component, { ...item }, { buffer: texture }, request);
  const frame = { x: 0, y: 0, width: 100, height: 100 };

  assert.equal(
    coverage.contains(component, item, frame, 50, 50, 0),
    true,
    "any nonzero alpha remains selectable",
  );
  assert.equal(
    coverage.contains(component, item, frame, 40, 50, 0),
    false,
    "a fully transparent sample clicks through",
  );
  assert.equal(
    coverage.contains(component, item, frame, 40, 50, 10),
    true,
    "the pointer neighborhood can reach a thin visible wire",
  );
  assert.equal(texture.reads, 3, "each hit candidate performs one block read");
});

test("preview coverage is invalidated with the compiled source structure", () => {
  const item = { id: "source", kind: "source", source: { type: "generator" } };
  const component = { id: "component", chain: [item] };
  const host = {
    mode: "component",
    state: { ui: { selectedComponentId: component.id } },
  };
  const coverage = new PreviewHitCoverage(host);
  const request = {
    reason: "component-preview",
    width: 100,
    height: 100,
  };
  coverage.prepareRootRequest(component, request);
  coverage.recordRaster(
    component,
    { ...item },
    { buffer: alphaTexture(10, 10, [{ x: 5, y: 5, alpha: 255 }]) },
    request,
  );
  coverage.invalidateStructure();

  assert.equal(
    coverage.contains(
      component,
      item,
      { x: 0, y: 0, width: 100, height: 100 },
      50,
      50,
      0,
    ),
    null,
    "stale pixels fall back to geometric picking until the new structure renders",
  );
});

test("preview coverage follows the selected visual graph in both Component and Scene workspaces", () => {
  for (const type of ["component", "scene"]) {
    const item = { id: `${type}-source`, kind: "source", source: { type: "generator" } };
    const component = { id: `${type}-graph`, type, chain: [item] };
    const host = {
      // Component and Scene workspaces intentionally share the same visual
      // graph preview renderer; graph type must not change hit semantics.
      mode: "component",
      state: { ui: { selectedComponentId: component.id } },
    };
    const coverage = new PreviewHitCoverage(host);
    const request = {
      reason: "component-preview",
      width: 100,
      height: 100,
    };
    coverage.prepareRootRequest(component, request);
    coverage.recordRaster(
      component,
      item,
      { buffer: alphaTexture(10, 10, [{ x: 5, y: 5, alpha: 255 }]) },
      request,
    );
    assert.equal(
      coverage.contains(
        component,
        item,
        { x: 0, y: 0, width: 100, height: 100 },
        50,
        50,
      ),
      true,
      `${type} graphs consume the same rendered hit region`,
    );
  }
});

test("visual interaction contract can use boundary or disable hits without reading pixels", () => {
  const item = { id: "source", kind: "source", source: { type: "generator" } };
  const component = { id: "component", chain: [item] };
  const host = {
    mode: "component",
    state: { ui: { selectedComponentId: component.id } },
  };
  const coverage = new PreviewHitCoverage(host);
  const texture = alphaTexture(10, 10);
  const request = {
    reason: "component-preview",
    width: 100,
    height: 100,
  };
  const frame = { x: 0, y: 0, width: 100, height: 100 };
  coverage.prepareRootRequest(component, request);

  coverage.recordRaster(
    component,
    item,
    { buffer: texture },
    request,
    null,
    VISUAL_HIT_REGION_MODES.BOUNDARY,
  );
  assert.equal(coverage.contains(component, item, frame, 50, 50), true);
  assert.equal(texture.reads, 0);

  coverage.recordRaster(
    component,
    item,
    { buffer: texture },
    request,
    null,
    VISUAL_HIT_REGION_MODES.NONE,
  );
  assert.equal(coverage.contains(component, item, frame, 50, 50), false);
  assert.equal(texture.reads, 0);
});

test("direct contain placement excludes letterbox pixels and samples its source", () => {
  const item = { id: "media", kind: "source", source: { type: "generator" } };
  const component = { id: "component", chain: [item] };
  const host = {
    mode: "component",
    state: { ui: { selectedComponentId: component.id } },
  };
  const coverage = new PreviewHitCoverage(host);
  const texture = alphaTexture(20, 10, [{ x: 10, y: 5, alpha: 80 }]);
  const request = {
    reason: "component-preview",
    width: 100,
    height: 100,
  };
  coverage.prepareRootRequest(component, request);
  coverage.recordPlaced(
    component,
    { ...item },
    createPlacedRenderResult(texture, {
      destinationRect: { x: 0, y: 0, width: 100, height: 100 },
      fit: "contain",
    }),
    request,
  );
  const frame = { x: 0, y: 0, width: 100, height: 100 };

  assert.equal(coverage.contains(component, item, frame, 50, 10, 0), false);
  assert.equal(coverage.contains(component, item, frame, 50, 50, 0), true);
});

test("nested ROI placement composes and inverts without changing coordinate authority", () => {
  const outer = regionToParentAffine({
    centerX: 60,
    centerY: 40,
    boundaryWidth: 80,
    boundaryHeight: 60,
    sampleX: 10,
    sampleY: 5,
    width: 40,
    height: 30,
    rotation: Math.PI / 2,
  }, 40, 30);
  const nested = composeAffine(outer, {
    a: 0.5,
    b: 0,
    c: 0,
    d: 0.5,
    e: 4,
    f: 6,
  });
  const inverse = invertAffine(nested);
  const source = { x: 12, y: 18 };
  const root = apply(nested, source);

  assert.deepEqual(
    rounded(apply(inverse, root)),
    source,
    "coverage uses the same composed ROI transform in reverse",
  );
});

function alphaTexture(width, height, entries = []) {
  const alpha = new Uint8ClampedArray(width * height);
  for (const entry of entries) {
    alpha[entry.y * width + entry.x] = entry.alpha;
  }
  return {
    width,
    height,
    reads: 0,
    get(x, y, sampleWidth, sampleHeight) {
      this.reads++;
      const pixels = new Uint8ClampedArray(sampleWidth * sampleHeight * 4);
      for (let row = 0; row < sampleHeight; row++) {
        for (let column = 0; column < sampleWidth; column++) {
          const sourceIndex = (y + row) * width + x + column;
          const targetIndex = (row * sampleWidth + column) * 4;
          pixels[targetIndex + 3] = alpha[sourceIndex];
        }
      }
      return { pixels, loadPixels() {} };
    },
  };
}

function apply(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function rounded(point) {
  return {
    x: Math.round(point.x * 1e9) / 1e9,
    y: Math.round(point.y * 1e9) / 1e9,
  };
}
