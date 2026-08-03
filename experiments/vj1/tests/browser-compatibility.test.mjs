import test from "node:test";
import assert from "node:assert/strict";

import {
  assertP5RenderCapabilities,
  chromeBrowserIdentity,
  recordBrowserCapabilityDiagnostics,
  reportBrowserCompatibility,
  VJ1_MINIMUM_CHROME_MAJOR,
} from "../js/libraries/diagnostics-engine/browser-compatibility.js";

function capableHost({ userAgent = `Mozilla/5.0 Chrome/${VJ1_MINIMUM_CHROME_MAJOR}.0.0.0 Safari/537.36` } = {}) {
  const warnings = [];
  class HTMLVideoElement {}
  HTMLVideoElement.prototype.requestVideoFrameCallback = () => 1;
  HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
  const functions = {
    BroadcastChannel() {}, Worker() {}, OffscreenCanvas() {}, createImageBitmap() {},
    requestAnimationFrame() {}, requestIdleCallback() {}, ResizeObserver() {},
    IntersectionObserver() {}, PerformanceObserver() {}, structuredClone() {},
    showDirectoryPicker() {}, FileSystemObserver() {},
  };
  const gl = {
    MAX_TEXTURE_SIZE: 1,
    MAX_RENDERBUFFER_SIZE: 2,
    getParameter(parameter) { return parameter === 1 ? 16384 : 16384; },
    getExtension() { return { loseContext() {} }; },
  };
  return {
    ...functions,
    HTMLVideoElement,
    WebGL2RenderingContext: function WebGL2RenderingContext() {},
    navigator: {
      userAgent,
      mediaDevices: { getDisplayMedia() {} },
    },
    document: { createElement: () => ({ getContext: () => gl }) },
    console: { warn: (...args) => warnings.push(args) },
    warnings,
  };
}

test("current Google Chrome with required APIs produces no compatibility warning", () => {
  const host = capableHost();
  const status = reportBrowserCompatibility({ host, mode: "control" });
  assert.equal(status.browser.isGoogleChrome, true);
  assert.deepEqual(status.missing, []);
  assert.equal(status.supported, true);
  assert.deepEqual(host.warnings, []);
});

test("p5 render capabilities fail closed before render target allocation", () => {
  assert.throws(
    () => assertP5RenderCapabilities({ createGraphics() {} }),
    /VJ1_RENDER_CAPABILITY_REQUIRED:p5\.createFramebuffer/,
  );
  assert.equal(assertP5RenderCapabilities({
    createFramebuffer() {},
    createGraphics() {},
    createImage() {},
    loadFont() {},
    textFont() {},
  }).supported, true);
});

test("wrong or old browsers produce one explicit startup warning", () => {
  const host = capableHost({ userAgent: "Mozilla/5.0 Firefox/140.0" });
  delete host.OffscreenCanvas;
  const status = reportBrowserCompatibility({ host, mode: "control" });
  assert.equal(status.wrongBrowser, true);
  assert.ok(status.degraded.some((entry) => entry.name === "OffscreenCanvas"));
  assert.equal(host.warnings.length, 1);
  assert.equal(host.warnings[0][0], "[VJ1_BROWSER_UNSUPPORTED]");
});

test("optional subsystem capabilities degrade without blocking core startup", () => {
  const host = capableHost();
  delete host.FileSystemObserver;
  delete host.navigator.mediaDevices.getDisplayMedia;
  const status = reportBrowserCompatibility({ host, mode: "control" });
  assert.equal(status.supported, true);
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.degraded.map((entry) => entry.subsystem), [
    "screen capture",
    "automatic project-folder refresh",
  ]);
  assert.equal(host.warnings[0][0], "[VJ1_BROWSER_CAPABILITY_DEGRADED]");
});

test("optional capability degradation is copied into production diagnostics", () => {
  const host = capableHost();
  delete host.FileSystemObserver;
  const status = reportBrowserCompatibility({ host, mode: "control" });
  const recorded = [];
  recordBrowserCapabilityDiagnostics({
    record: (...args) => recorded.push(args),
  }, status);
  assert.deepEqual(recorded, [[
    "warning",
    [{
      code: "VJ1_BROWSER_CAPABILITY_DEGRADED",
      capability: "FileSystemObserver",
      subsystem: "automatic project-folder refresh",
      fallback: "The explicit Refresh command remains available.",
    }],
    "browser-capabilities",
  ]]);
});

test("an otherwise capable old Chrome build is rejected explicitly", () => {
  const host = capableHost({ userAgent: `Mozilla/5.0 Chrome/${VJ1_MINIMUM_CHROME_MAJOR - 1}.0.0.0 Safari/537.36` });
  const status = reportBrowserCompatibility({ host, mode: "control" });
  assert.equal(status.wrongBrowser, false);
  assert.equal(status.oldBrowser, true);
  assert.equal(host.warnings[0][0], "[VJ1_BROWSER_UNSUPPORTED]");
});

test("browser identity rejects Chromium shells that are not Google Chrome", () => {
  assert.equal(chromeBrowserIdentity({ userAgent: "Mozilla/5.0 Chrome/150.0.0.0 Edg/150.0" }).isGoogleChrome, false);
  assert.equal(chromeBrowserIdentity({ userAgent: "Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36" }).major, 149);
});
