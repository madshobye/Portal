import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { averageGpuQueryNanoseconds, cameraCaptureSettings, cameraSettingsSignature, canvasComponentPlacementRect, canvasFrameBorderHit, canvasMaxRasterSize, canvasPreviewRenderRequest, componentAdaptiveRasterLimit, componentPipelineSourceRequest, componentPreviewRenderRequest, componentReferencePlacement, componentReferenceRenderRequest, componentSourceView, directFitRects, eyeballFrameUniforms, fittedThumbnailSize, GpuTimerTracker, moveCanvasFrameRect, OutputRenderer, qualityScaledRenderRequest, resizeCanvasFrameRect, sharedComponentRenderRequests } from "../js/output/output-renderer.js";
import { createPlacedRenderResult, directPlacementKind, transformedPlacementDemandRect } from "../js/graph/placed-render-result.js";
import { renderRequestKey } from "../js/output/render-geometry.js";
import { mapperFragmentShaderSource, VjMapper } from "../js/output/vj-mapper.js";

function pickRequestSize(request) {
  return { width: request.width, height: request.height };
}

test("camera capture settings map project preferences to the Portal camera contract", () => {
  const render = {
    frameWidth: 960,
    frameHeight: 540,
    camera: {
      width: 1920,
      height: 1080,
      facingMode: "environment",
      mirrored: true,
      maxResolution: true,
    },
  };
  assert.deepEqual(cameraCaptureSettings(render), {
    width: 1920,
    height: 1080,
    front: false,
    mirrored: true,
    maxResolution: true,
  });
  assert.equal(cameraSettingsSignature(render), "1920x1080:rear:mirror:max");
});

test("projection corner drags emit live mapping updates before release", () => {
  const changes = [];
  const mapper = new VjMapper({
    onConfigChange: (mapping, meta) => changes.push({ mapping, reason: meta.reason }),
  });
  mapper.addSurface({
    id: "surface-main",
    name: "Main",
    width: 100,
    height: 100,
    corners: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  });
  mapper._dragSurf = 0;
  mapper._dragCorner = 0;
  mapper._dragMode = "corner";

  mapper.mouseDragged(12, 18);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].reason, "drag");
  assert.deepEqual(changes[0].mapping.surfaces[0].corners[0], { x: 12, y: 18 });

  mapper.mouseReleased();
  assert.equal(changes[1].reason, "autosave");
});

test("standalone output permanently rejects calibration markers", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  let mapperCalibrating = true;
  renderer.state = { global: { calibrating: true } };
  renderer.mapper = {
    setCalibrate(value) {
      mapperCalibrating = value;
    },
    isCalibrating() {
      return mapperCalibrating;
    },
  };

  renderer.setCalibrate(true);

  assert.equal(renderer.state.global.calibrating, false);
  assert.equal(mapperCalibrating, false);
  assert.equal(renderer.isCalibrating(), false);
});

test("mapping-world output-frame text follows the global label toggle", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const overlay = source.slice(
    source.indexOf("  renderOutputFrameOverlay()"),
    source.indexOf("\n  shouldRevealSurfaceOverlay", source.indexOf("  renderOutputFrameOverlay()"))
  );

  assert.ok(overlay.includes("const showLabels = this.state?.global?.showLabels !== false;"));
  assert.ok(overlay.includes("if (showLabels) {"));
  assert.ok(overlay.includes("text(`${frame.name} · ${frame.width}×${frame.height}`"));
});

test("surface calibration keeps direct projection without materialized labels", () => {
  const renderer = new OutputRenderer({ mode: "preview" });
  renderer.state = {
    ui: { debugPreview: true },
    global: { showLabels: true },
  };
  renderer.mapper = { isCalibrating: () => true };

  assert.equal(renderer.canDirectProjectSurfaceRoute({ surface: { finalShaderChain: [] } }), true);
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.equal(source.includes("drawSurfaceLabel"), false);
});

test("standalone outputs crop the shared mapping world to their configured viewport", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const renderer = new OutputRenderer({ mode: "output", outputId: "right" });
  renderer.state = {
    render: {
      outputs: [
        { id: "left", name: "Left", width: 1920, height: 1080 },
        { id: "right", name: "Right", width: 1280, height: 800 },
      ],
      outputGap: 0,
      worldWidth: 4160,
      worldHeight: 1620,
    },
  };
  globalThis.width = 1280;
  globalThis.height = 800;

  try {
    assert.deepEqual(renderer.outputFrameSize(), { width: 1280, height: 800 });
    assert.deepEqual(renderer.outputFrameOffset(), { x: 2400, y: 410 });
    const mapped = renderer.mappingForRenderMode({
      surfaces: [{ id: "surface", corners: [{ x: 2400, y: 410 }, { x: 3680, y: 410 }, { x: 3680, y: 1210 }, { x: 2400, y: 1210 }] }],
    });
    assert.deepEqual(mapped.surfaces[0].corners[0], { x: 0, y: 0 });
    assert.deepEqual(mapped.surfaces[0].corners[2], { x: 1280, y: 800 });
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("direct output presentation handles stretch contain and cover without homography", () => {
  const target = { x: 100, y: 50, width: 1000, height: 1000 };
  assert.deepEqual(directFitRects(2000, 1000, target, "stretch"), {
    source: { x: 0, y: 0, width: 2000, height: 1000 },
    destination: target,
  });
  assert.deepEqual(directFitRects(2000, 1000, target, "contain").destination, {
    x: 100, y: 300, width: 1000, height: 500,
  });
  assert.deepEqual(directFitRects(2000, 1000, target, "cover").source, {
    x: 500, y: 0, width: 1000, height: 1000,
  });
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(source.includes("if (mapped.direct) this.drawDirectSurfaceTexture(pg, route)"));
  assert.ok(source.includes("mapped.direct && Number(surface.feather) > 0"));
  assert.ok(source.includes("preserveFullFootprint: mapped.direct"));
});

test("GPU timing averages query samples instead of adding overlapping work", () => {
  assert.equal(averageGpuQueryNanoseconds([30_000_000, 10_000_000, 5_000_000]), 15_000_000);
  assert.equal(averageGpuQueryNanoseconds([]), 0);
});

test("GPU timing instrumentation bounds unresolved query backlog", () => {
  let nextQuery = 0;
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension(name) {
      return name === "EXT_disjoint_timer_query_webgl2" ? extension : null;
    },
    createQuery() { return { id: ++nextQuery }; },
    deleteQuery() {},
    beginQuery() {},
    endQuery() {},
    getQueryParameter(query, parameter) {
      return parameter === this.QUERY_RESULT_AVAILABLE ? false : 0;
    },
    getParameter() { return false; },
  };
  const timer = new GpuTimerTracker({ sampleInterval: 1, maxPending: 3, maxQueryAgeFrames: 4 });

  for (let frame = 1; frame <= 8; frame++) {
    const token = timer.begin(gl, frame);
    timer.end(token);
    timer.sealFrame(frame);
  }

  assert.equal(timer.pending.length, 3);
  assert.equal(nextQuery, 3);
  timer.poll(8);
  assert.equal(timer.pending.length, 0);
  assert.equal(timer.frames.size, 0);
});

test("GPU timing samples periodically instead of instrumenting every render frame", () => {
  const timer = new GpuTimerTracker();
  assert.equal(timer.begin({}, 1), null);
  assert.equal(timer.begin({}, 5), null);
});

test("stable component cache refreshes the exact GPU buffer usage key", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const lookup = source.slice(
    source.indexOf("    const stableGpuKey ="),
    source.indexOf("    if (component.type === \"canvas\")")
  );

  assert.ok(lookup.includes("this.componentGpuBuffer.get(stableGpuKey)"));
  assert.ok(lookup.includes("this.componentBuffer.get(stableGpuKey)"));
  assert.ok(lookup.includes("this.touchRenderCache(this.componentGpuBufferUse, stableGpuKey)"));
  assert.ok(lookup.includes("this.touchRenderCache(this.componentBufferUse, stableGpuKey)"));
});

test("component pipeline lowers physical render pixels but preserves logical output dimensions", () => {
  const request = {
    role: "surface",
    width: 1200,
    height: 800,
    logicalWidth: 1200,
    logicalHeight: 800,
    renderIdentity: "component-a",
  };
  const scaled = componentPipelineSourceRequest(request, {
    upscaling: { enabled: true, amount: 0.65 },
  });

  assert.equal(scaled.width, 780);
  assert.equal(scaled.height, 520);
  assert.equal(scaled.logicalWidth, 1200);
  assert.equal(scaled.logicalHeight, 800);
  assert.equal(scaled.renderIdentity, "component-a");
  assert.equal(scaled.pipelineSource, true);
  assert.strictEqual(componentPipelineSourceRequest(request, {
    upscaling: { enabled: false, amount: 0.5 },
  }), request);
});

test("component post filters run after the upscale target", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const pipelineSource = source.slice(
    source.indexOf("  renderComponentOutputPipeline("),
    source.indexOf("  cacheComponentOutput(")
  );

  assert.ok(pipelineSource.indexOf('`${component.id}:upscale`') < pipelineSource.indexOf('`${component.id}:post`'));
  assert.ok(source.includes("COMPONENT_UPSCALE_FRAGMENT_SHADER"));
  assert.ok(source.includes("COMPONENT_POST_FRAGMENT_SHADER"));
  assert.ok(source.includes('shaderProgram.setUniform("noiseAmount"'));
  assert.ok(source.includes('shaderProgram.setUniform("grayscaleAmount"'));
});

test("output resize keeps render buffers tied to configured frame size", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    frameWidth: 1280,
    frameHeight: 720,
  };
  const renderer = new OutputRenderer({ mode: "output" });

  try {
    globalThis.width = 1920;
    globalThis.height = 300;
    renderer.state = { render };

    assert.deepEqual(renderer.outputFrameSize(render), { width: 1280, height: 720 });
    assert.deepEqual(renderer.displayCanvasSize(render), { width: 1920, height: 300 });
    assert.deepEqual(renderer.renderResolutionSize(render), { width: 1280, height: 720, density: 1 });
    assert.equal(renderer.renderResolutionLabel(render), "1280x720");
    assert.deepEqual(renderer.outputFrameTransform(), {
      scale: 1.5,
      x: 0,
      y: -390,
    });
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("hud render resolution reports GPU render pixels, not window size", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    frameWidth: 1280,
    frameHeight: 720,
    pixelDensity: 1.5,
  };
  const renderer = new OutputRenderer({ mode: "output" });

  try {
    globalThis.width = 3840;
    globalThis.height = 2160;
    renderer.state = { render };

    assert.deepEqual(renderer.displayCanvasSize(render), { width: 3840, height: 2160 });
    assert.deepEqual(renderer.renderResolutionSize(render), { width: 1920, height: 1080, density: 1.5 });
    assert.equal(renderer.renderResolutionLabel(render), "1920x1080 @1.5x");
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("terrain stays in the shared WebGL context while STL reuses its p5 scratch target", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const previousCreateFramebuffer = globalThis.createFramebuffer;
  const previousNoStroke = globalThis.noStroke;
  const previousWebgl = globalThis.WEBGL;
  const created = [];
  const framebuffers = [];
  globalThis.WEBGL = "webgl";
  globalThis.noStroke = () => {};
  globalThis.createFramebuffer = ({ width, height, density, depth }) => {
    const framebuffer = {
      width,
      height,
      density,
      depth,
      renderer: { GL: {} },
      resize(nextWidth, nextHeight) {
        this.width = nextWidth;
        this.height = nextHeight;
        this.resizeCount = (this.resizeCount || 0) + 1;
      },
      remove() {},
    };
    framebuffers.push(framebuffer);
    return framebuffer;
  };
  globalThis.createGraphics = (width, height, mode) => {
    const target = {
      width,
      height,
      mode,
      appliedDensity: null,
      pixelDensity(value) {
        if (value !== undefined) this.appliedDensity = value;
        return this.appliedDensity;
      },
      resizeCanvas(nextWidth, nextHeight) {
        this.width = nextWidth;
        this.height = nextHeight;
        this.resizeCount = (this.resizeCount || 0) + 1;
      },
      noStroke() {},
    };
    created.push(target);
    return target;
  };

  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = { render: { pixelDensity: 0.5 } };

  try {
    const terrainLow = renderer.getTerrainTarget(1000, 563);
    const modelLow = renderer.getModelTarget(1000, 563);
    assert.equal(terrainLow.__vj1SharedFramebuffer, true);
    assert.equal(terrainLow.pixelDensity(), 1);
    assert.equal(terrainLow.framebuffer.depth, true);
    assert.equal(modelLow.appliedDensity, 0.5);
    assert.equal(modelLow.mode, "webgl");

    renderer.state.render.pixelDensity = 1.5;
    const terrainHigh = renderer.getTerrainTarget(1000, 563);
    const modelHigh = renderer.getModelTarget(1000, 563);
    assert.equal(terrainHigh.__vj1PixelDensity, 1.5);
    assert.equal(modelHigh.appliedDensity, 1.5);
    assert.strictEqual(terrainHigh, terrainLow);
    assert.strictEqual(modelHigh, modelLow);

    const terrainResolved = renderer.getTerrainTarget(500, 282, 1);
    const modelResolved = renderer.getModelTarget(500, 282, 1);
    assert.equal(terrainResolved.__vj1PixelDensity, 1);
    assert.equal(modelResolved.appliedDensity, 1);
    assert.strictEqual(terrainResolved, terrainLow);
    assert.strictEqual(modelResolved, modelLow);
    assert.equal(terrainResolved.framebuffer.resizeCount, 1);
    assert.equal(modelResolved.resizeCount, 1);
    assert.equal(renderer.specializedWebglTargets.size, 2);
    assert.equal(framebuffers.length, 1);
    assert.equal(created.length, 1);
  } finally {
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
    if (previousCreateFramebuffer === undefined) delete globalThis.createFramebuffer;
    else globalThis.createFramebuffer = previousCreateFramebuffer;
    if (previousNoStroke === undefined) delete globalThis.noStroke;
    else globalThis.noStroke = previousNoStroke;
    if (previousWebgl === undefined) delete globalThis.WEBGL;
    else globalThis.WEBGL = previousWebgl;
  }
});

test("component thumbnails retain their aspect within the thumbnail bounds", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("const COMPONENT_THUMBNAIL_WIDTH = 768;"));
  assert.ok(source.includes("const COMPONENT_THUMBNAIL_HEIGHT = 432;"));
  assert.ok(source.includes("const COMPONENT_THUMBNAIL_QUALITY = 0.92;"));
  assert.ok(source.includes('canvas.toDataURL("image/webp", COMPONENT_THUMBNAIL_QUALITY)'));
  assert.ok(source.includes('return canvas.toDataURL("image/png");'));
  assert.deepEqual(fittedThumbnailSize(1920, 1080), { width: 768, height: 432 });
  assert.deepEqual(fittedThumbnailSize(1080, 1920), { width: 243, height: 432 });
  assert.deepEqual(fittedThumbnailSize(1000, 1000), { width: 432, height: 432 });
  assert.ok(source.includes("context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, thumbnailSize.width, thumbnailSize.height);"));
});

test("Canvas recording-frame thumbnails crop the rendered Canvas by logical frame geometry", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(source.includes("component.canvas?.frameThumbnails?.[frame.id]"));
  assert.ok(source.includes("this.sendThumbnail(component.id, frameThumbnail, { frameId: frame.id })"));
  assert.ok(source.includes("if (cropRect) context.drawImage(source, sx, sy, sw, sh"));
});

test("current component thumbnails bypass full WebGL framebuffer readback", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const capture = source.slice(
    source.indexOf("  captureSelectedComponentThumbnail()"),
    source.indexOf("\n}\n\nfunction mappingStatusForReason")
  );
  const staleGuard = "if (!needsComponentThumbnail && !framesNeedingThumbnails.length) return;";
  assert.ok(capture.includes(staleGuard));
  assert.ok(capture.indexOf(staleGuard) < capture.indexOf("output.get()"));
  assert.ok(capture.includes("this.lastThumbnailAt = millis();"));
});

test("thumbnail capture is blocked while live preview rendering is disabled", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const capture = rendererSource.slice(
    rendererSource.indexOf("  captureSelectedComponentThumbnail()"),
    rendererSource.indexOf("\n}\n\nfunction mappingStatusForReason")
  );
  assert.ok(capture.includes("if (this.shouldUseThumbnailPreview()) return;"));
  assert.ok(capture.indexOf("if (this.shouldUseThumbnailPreview()) return;") < capture.indexOf("output.get()"));
  assert.ok(previewSource.includes("if (store.getState()?.ui?.debugPreview === false) return;"));
});

test("paused previews contain thumbnails and canvas surface routes preserve sampling", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(source.includes("const rect = this.componentPreviewRect(component);"));
  assert.ok(source.includes('if (component?.type === "canvas")'));
  assert.ok(source.includes("drawSampleRect(pg, thumbnail.img"));
  assert.ok(source.includes("this.mapper.drawTexture(pg, mapped.mapperSurface, surface.projectionFit, surface.feather)"));
});

test("thumbnail preview remains an active transform editor without live component rendering", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("captureThumbnailEditTransformBaselines()"));
  assert.ok(source.includes("renderCanvasThumbnailEditPreview(component)"));
  assert.ok(source.includes("combineContentTransforms(parentTransform, item.transform)"));
  assert.ok(source.includes("this.renderSelectedChainTransformOverlay();"));
  assert.ok(source.includes("if (this.shouldUseThumbnailPreview()) this.renderThumbnailComponents();"));
  assert.ok(source.includes("const rect = this.componentPreviewRect(component);"));
  assert.ok(source.includes("withScreenScissor(rect"));
  assert.ok(source.includes("drawImageCoverCrop(thumbnail.img"));
});

test("canvas rendering evaluates ordinary sources, Groups, effects, and shared route frames", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const canvasRenderer = source.slice(
    source.indexOf("  renderCanvasComponent("),
    source.indexOf("  renderComponentPatch(")
  );
  assert.ok(source.includes("this.renderComponentChainState("));
  assert.ok(source.includes("this.renderEffectNodeState(nodeId, state, item, componentTime, renderRequest)"));
  assert.ok(source.includes("this.renderDirectSourceNodeState(nodeId, state, component, item, componentTime, renderRequest)"));
  assert.ok(source.includes("this.renderLayerNodeState(nodeId, state, sourceState, { ...item, transform: {} }, renderRequest)"));
  assert.ok(source.includes('source.type === "component"'));
  assert.ok(source.includes("this.recordingFrameById"));
  assert.ok(source.includes("this.state?.recordingFrames || []"));
  assert.ok(source.includes("renderCanvasRecordingFrames(component, source)"));
  assert.ok(source.includes("surface.outputFrameId"));
  assert.ok(source.includes("this.resolveRouteSourceNode(storedSurface)"));
  assert.ok(!source.includes('item.role === "canvas-layer"'));
  assert.ok(canvasRenderer.includes("this.renderComponentChainState("));
  assert.ok(!canvasRenderer.includes('item.kind === "source"'));
});

test("Canvas recording-frame routes declare extra sampling demand without changing whole-Canvas routes", () => {
  const canvas = { type: "canvas", canvas: { width: 3840, height: 2160 } };
  const frames = [{ id: "frame-a", x: 100, y: 200, width: 960, height: 540 }];
  const frameView = componentSourceView({}, canvas, { outputFrameId: "frame-a" }, frames);
  const wholeView = componentSourceView({}, canvas, {
    outputFrameId: "",
    sourceRect: { x: 0, y: 0, width: 960, height: 540 },
  }, frames);
  assert.equal(frameView.samplingScale, 1);
  assert.deepEqual(frameView.sampleRect, frames[0]);
  assert.equal(wholeView.samplingScale, 1);
  assert.deepEqual(wholeView.sampleRect, { x: 0, y: 0, width: 3840, height: 2160 });

  const reducedFrameView = componentSourceView(
    { sampling: { recordingFrameScale: 0.5 } },
    canvas,
    { outputFrameId: "frame-a" },
    frames
  );
  assert.equal(reducedFrameView.samplingScale, 0.5);
});

test("multiple recording frames share one parent Canvas texture request", () => {
  const component = { id: "canvas-a", type: "canvas" };
  const sourceView = {
    logicalSize: { width: 3840, height: 2160 },
    maxRasterSize: { width: 3840, height: 2160 },
  };
  const requests = sharedComponentRenderRequests([
    { component, sourceView, demand: { rasterScale: 0.25 } },
    { component, sourceView, demand: { rasterScale: 0.5 } },
  ], "to:");

  assert.equal(requests.size, 1);
  assert.deepEqual(pickRequestSize(requests.get("canvas-a")), { width: 1920, height: 1088 });
  assert.equal(requests.get("canvas-a").renderIdentity, "to:canvas-a");
  assert.equal(requests.get("canvas-a").demandScale, 0.5);
});

test("surface route lookup indexes components, frames, and source nodes once per state", () => {
  const renderer = new OutputRenderer({});
  renderer.state = {
    components: [{ id: "canvas-a", type: "canvas", name: "Canvas A", canvas: {} }],
    recordingFrames: [{ id: "frame-a", name: "Frame A" }],
  };
  renderer.rebuildRouteLookups();

  const node = renderer.resolveRouteSourceNode({
    sourceNodeId: "recording-frame:canvas-a:frame-a",
    componentId: "canvas-a",
    outputFrameId: "frame-a",
  });
  assert.equal(renderer.componentById.get("canvas-a").type, "canvas");
  assert.equal(renderer.recordingFrameById.get("frame-a").name, "Frame A");
  assert.equal(node.componentId, "canvas-a");
  assert.equal(node.outputFrameId, "frame-a");
});

test("Canvas demand is capped to logical size by default and can opt into supersampling", () => {
  assert.deepEqual(canvasMaxRasterSize({ pixelDensity: 1 }, { width: 4000, height: 2000 }), {
    width: 4000,
    height: 2000,
  });
  assert.deepEqual(canvasMaxRasterSize({ pixelDensity: 2 }, { width: 4000, height: 2000 }), {
    width: 4000,
    height: 2000,
  });
  assert.deepEqual(canvasMaxRasterSize({
    pixelDensity: 2,
    sampling: { limitCanvasToLogicalSize: false },
  }, { width: 4000, height: 2000 }), {
    width: 8000,
    height: 4000,
  });
  assert.deepEqual(canvasMaxRasterSize({
    pixelDensity: 2,
    sampling: { limitCanvasToLogicalSize: false },
  }, { width: 5000, height: 5000 }), {
    width: 8192,
    height: 8192,
  });
});

test("Component initial dimensions define geometry without capping adaptive render demand", () => {
  const render = { componentTexture: { width: 1000, height: 500 }, pixelDensity: 1 };
  const component = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const view = componentSourceView(render, component);
  assert.deepEqual(view.logicalSize, { width: 1000, height: 500 });
  assert.deepEqual(view.maxRasterSize, { width: 8192, height: 4096 });
  assert.deepEqual(componentAdaptiveRasterLimit(view.logicalSize), view.maxRasterSize);
  assert.deepEqual(
    pickRequestSize(componentReferenceRenderRequest(render, component, { width: 3000, height: 1500 })),
    { width: 3008, height: 1504 }
  );
});

test("Component preview raster follows visible demand instead of its initial dimensions", () => {
  const render = { componentTexture: { width: 2000, height: 1000 }, pixelDensity: 1 };
  const component = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  assert.deepEqual(
    pickRequestSize(componentPreviewRenderRequest(render, component, 800, 600, 1)),
    { width: 800, height: 400 }
  );
});

test("Canvas recording frames move within bounds and corner resize changes both dimensions independently", () => {
  const moved = moveCanvasFrameRect({ x: 100, y: 100, width: 400, height: 200 }, 900, 900, 1200, 800);
  assert.deepEqual(moved, { x: 800, y: 600, width: 400, height: 200 });

  const resized = resizeCanvasFrameRect(
    { x: 100, y: 100, width: 400, height: 200 },
    "se",
    200,
    20,
    1200,
    800
  );
  assert.deepEqual(resized, { x: 100, y: 100, width: 600, height: 220 });

  const northwest = resizeCanvasFrameRect(
    { x: 100, y: 100, width: 400, height: 200 },
    "nw",
    -200,
    -300,
    1200,
    800
  );
  assert.deepEqual(northwest, { x: 0, y: 0, width: 500, height: 300 });
});

test("Canvas recording frames drag only from their border so the interior passes through", () => {
  const frame = { x: 100, y: 100, width: 400, height: 200 };
  assert.equal(canvasFrameBorderHit(frame, 102, 180), true);
  assert.equal(canvasFrameBorderHit(frame, 300, 296), true);
  assert.equal(canvasFrameBorderHit(frame, 300, 200), false);
  assert.equal(canvasFrameBorderHit(frame, 50, 200), false);
});

test("Canvas component placements use a stable normalized footprint", () => {
  assert.deepEqual(
    canvasComponentPlacementRect(
      { width: 3840, height: 2160 },
      { baseWidth: 1080, baseHeight: 1920, width: 540, height: 960 },
      {},
      { scale: 1080 / 3840 }
    ),
    { x: 1380, y: 120, width: 1080, height: 1920 }
  );
  assert.deepEqual(
    canvasComponentPlacementRect(
      { width: 3840, height: 2160 },
      { baseWidth: 1920, baseHeight: 1080 },
      { width: 960, height: 540 },
      { scale: 1920 / 3840 }
    ),
    { x: 240, y: 135, width: 480, height: 270 }
  );
});

test("Canvas Component placement is independent from later texture-resolution changes", () => {
  const canvas = { type: "canvas", canvas: { width: 4000, height: 2000 } };
  const child = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const placement = { scale: 0.325 };
  const target = { width: 1000, height: 500 };
  const low = componentReferencePlacement(
    canvas,
    child,
    { componentTexture: { width: 650, height: 500 }, pixelDensity: 1 },
    target,
    placement
  );
  const high = componentReferencePlacement(
    canvas,
    child,
    { componentTexture: { width: 2600, height: 2000 }, pixelDensity: 1 },
    target,
    placement
  );
  assert.deepEqual(high, low);
  assert.deepEqual(low, { x: 338, y: 125, width: 325, height: 250 });
});

test("Canvas placement follows changed Component aspect without stretching its old dimensions", () => {
  const canvas = { type: "canvas", canvas: { width: 4000, height: 2000 } };
  const child = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const target = { width: 1000, height: 500 };
  const placement = { scale: 0.325 };
  const original = componentReferencePlacement(
    canvas,
    child,
    { componentTexture: { width: 1300, height: 1000 }, pixelDensity: 1 },
    target,
    placement
  );
  const wider = componentReferencePlacement(
    canvas,
    child,
    { componentTexture: { width: 1300, height: 650 }, pixelDensity: 1 },
    target,
    placement
  );
  assert.equal(wider.width, original.width);
  assert.equal(wider.height, Math.round(wider.width * 650 / 1300));
  assert.ok(wider.height < original.height);
});

test("nested components inherit physical demand from their placement for every parent type", () => {
  const render = { frameWidth: 1000, frameHeight: 700, pixelDensity: 1 };
  const child = { id: "child", type: "chain", frameShape: "landscape", resolutionScale: 2 };
  const canvasParent = { type: "canvas", canvas: { width: 4000, height: 2800 } };
  const canvasPlacement = componentReferencePlacement(canvasParent, child, render, { width: 1000, height: 700 }, { scale: 0.25 });
  const regularPlacement = componentReferencePlacement({ type: "chain" }, child, render, { width: 640, height: 360 });
  const request = componentReferenceRenderRequest(render, child, canvasPlacement);

  assert.equal(canvasPlacement.x, Math.round((1000 - canvasPlacement.width) * 0.5));
  assert.equal(canvasPlacement.y, Math.round((700 - canvasPlacement.height) * 0.5));
  assert.ok(canvasPlacement.width < regularPlacement.width);
  assert.ok(canvasPlacement.height < regularPlacement.height);
  assert.deepEqual(regularPlacement, { x: 0, y: 0, width: 640, height: 360 });
  assert.ok(request.width <= canvasPlacement.width * 2 + 16);
  assert.ok(request.height <= canvasPlacement.height * 2 + 16);
  assert.ok(request.width >= canvasPlacement.width * 2 - 16);
  assert.ok(request.height >= canvasPlacement.height * 2 - 16);
  assert.equal(request.logicalWidth / request.logicalHeight, 10 / 7);
});

test("placed render results separate texture pixels from parent-frame placement", () => {
  const texture = { width: 320, height: 180 };
  const placed = createPlacedRenderResult(texture, {
    destinationRect: { x: 40, y: 30, width: 640, height: 360 },
    transform: { x: 0.2, y: -0.1, scale: 1.5, rotation: 0.25 },
    fit: "contain",
  });

  assert.equal(placed.texture, texture);
  assert.deepEqual(placed.destinationRect, { x: 40, y: 30, width: 640, height: 360 });
  assert.deepEqual(transformedPlacementDemandRect(placed.destinationRect, placed.transform), {
    x: 40,
    y: 30,
    width: 960,
    height: 540,
  });
});

test("direct placement eligibility is shared by Canvas and ordinary component parents", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const dependency = { id: "child", type: "chain" };
  renderer.state = { components: [dependency] };
  renderer.media.set("image", { image: { width: 640, height: 360 } });
  renderer.media.set("model", { model: {}, image: { width: 640, height: 360 } });

  const reference = { kind: "source", source: { type: "component", componentId: dependency.id } };
  assert.equal(renderer.canDirectCompositeSource(reference), true);
  assert.equal(renderer.canDirectCompositeSource({ ...reference, blend: "overlay" }), false);
  assert.equal(renderer.canDirectCompositeSource({ kind: "source", source: { type: "media", mediaId: "image" } }), true);
  assert.equal(renderer.canDirectCompositeSource({ kind: "source", source: { type: "media", mediaId: "model" } }), false);
  assert.equal(directPlacementKind({ source: { type: "camera" }, cameraDrawable: true }), "camera-texture");
  assert.equal(directPlacementKind({ source: { type: "generator" } }), "");
});

test("direct placement composites texture geometry without a parent-sized source buffer", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const calls = [];
  const output = {
    width: 1000,
    height: 700,
    push: () => calls.push(["push"]),
    pop: () => calls.push(["pop"]),
    blendMode: (value) => calls.push(["blendMode", value]),
    tint: (...values) => calls.push(["tint", ...values]),
    noTint: () => calls.push(["noTint"]),
    translate: (...values) => calls.push(["translate", ...values]),
    rotate: (value) => calls.push(["rotate", value]),
    scale: (value) => calls.push(["scale", value]),
    image: (...values) => calls.push(["image", ...values]),
  };
  const texture = { width: 320, height: 180 };
  const previousBlend = globalThis.BLEND;
  globalThis.BLEND = "blend";
  try {
    renderer.drawPlacedSourceResult(output, createPlacedRenderResult(texture, {
      destinationRect: { x: 400, y: 300, width: 200, height: 100 },
      transform: { x: 0.2, y: -0.1, scale: 1.5, rotation: 0.25 },
    }), { opacity: 0.5, blend: "normal" });
  } finally {
    globalThis.BLEND = previousBlend;
  }

  assert.ok(calls.some((call) => call[0] === "translate" && call[1] === 600 && call[2] === 315));
  assert.ok(calls.some((call) => call[0] === "scale" && call[1] === 1.5));
  assert.ok(calls.some((call) => call[0] === "tint" && call[2] === 127.5));
  assert.ok(calls.some((call) => call[0] === "image" && call[1] === texture && call[2] === -100 && call[3] === -50 && call[4] === 200 && call[5] === 100));
});

test("direct surfaces map normal compositing to BLEND rather than the deprecated NORMAL constant", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const helper = source.slice(
    source.indexOf("function applyBlendGlobal("),
    source.indexOf("\n}\n\nfunction drawWebGLBuffer", source.indexOf("function applyBlendGlobal("))
  );
  assert.ok(helper.includes('if (!blend || blend === "normal") blendMode(BLEND);'));
  assert.ok(helper.indexOf('blend === "normal"') < helper.indexOf("globalThis"));
});

test("Canvas preview requests follow the viewport with auto low and full quality modes", () => {
  assert.deepEqual(
    pickRequestSize(canvasPreviewRenderRequest({ canvas: { width: 3840, height: 2160, previewQuality: "auto" } }, 1200, 800)),
    { width: 1200, height: 675 }
  );
  assert.deepEqual(
    pickRequestSize(canvasPreviewRenderRequest({ canvas: { width: 3840, height: 2160, previewQuality: "low" } }, 1200, 800)),
    { width: 600, height: 338 }
  );
  assert.deepEqual(
    pickRequestSize(canvasPreviewRenderRequest({ canvas: { width: 3840, height: 2160, previewQuality: "full" } }, 1200, 800)),
    { width: 3840, height: 2160 }
  );
});

test("component groups render isolated from earlier parent layers", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const groupRenderSource = source.slice(
    source.indexOf("  renderComponentChainState("),
    source.indexOf("  renderThumbnailComponents()")
  );

  assert.ok(groupRenderSource.includes("let state = this.transparentChainState(component, renderRequest);"));
  assert.ok(groupRenderSource.includes("const groupState = this.renderComponentChainState("));
  assert.ok(groupRenderSource.includes("item.chain || []"));
  assert.ok(groupRenderSource.includes("state = this.renderLayerNodeState(nodeId, state, groupState, item, renderRequest);"));
  assert.ok(!groupRenderSource.includes("drawBuffer(groupState.buffer, state.buffer"));
});

test("source transforms change source coordinates while groups resample inside a fixed component frame", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const chainRenderSource = source.slice(
    source.indexOf("  renderComponentChainState("),
    source.indexOf("  transparentChainState(")
  );
  const layerRenderSource = source.slice(
    source.indexOf("  renderLayerNodeState("),
    source.indexOf("  renderOverlayLayerToTarget(")
  );
  const drawLayerSource = source.slice(
    source.indexOf("  drawChainLayer("),
    source.indexOf("  drawTransformedLayerFallback(")
  );

  assert.ok(source.includes("contentTransform: item.transform || {}"));
  assert.ok(chainRenderSource.includes("{ ...item, transform: {} }"));
  assert.ok(layerRenderSource.includes("renderLayerContentTransformState("));
  assert.ok(layerRenderSource.includes('renderBufferKey(nodeId, "content-transform")'));
  assert.ok(source.includes("uniform mat3 sourceUvMatrix;"));
  assert.ok(source.includes("gl_FragColor = color * inside;"));
  assert.ok(drawLayerSource.includes("drawBuffer(output, source, 0, 0, output.width, output.height"));
  assert.ok(!drawLayerSource.includes("output.translate("));
  assert.ok(!drawLayerSource.includes("output.scale("));
  assert.ok(source.includes('setShaderUniformIfPresent(shader, "contentUvMatrix", contentMatrix)'));
  assert.ok(source.includes("applyModelContentTransform(target, source.contentTransform, viewport)"));
});

test("component preview always draws its overarching frame independently of selection", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const previewSource = source.slice(
    source.indexOf("  renderComponentPreview()"),
    source.indexOf("  setCalibrate(on)")
  );

  assert.ok(previewSource.includes("this.renderComponentFrameOverlay(component, source)"));
  assert.ok(previewSource.includes('if (this.mode !== "component" || !component) return'));
  assert.ok(previewSource.includes("this.componentPreviewRect(component, source)"));
  assert.ok(previewSource.includes("stroke(101, 224, 211, 235)"));
});

test("scene surfaces render components at their configured shape and relative resolution", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const drawSurfaceRoute = source.slice(
    source.indexOf("  drawSurfaceRoute(pg, route = {})"),
    source.indexOf("  drawSurfaceThumbnailRoute(pg, surface)")
  );
  const surfaceRenderPlan = source.slice(
    source.indexOf("  buildSurfaceRenderPlan()"),
    source.indexOf("  getSurfaceTexture(request")
  );

  assert.ok(surfaceRenderPlan.includes("sourceRenderDemand({"));
  assert.ok(surfaceRenderPlan.includes("componentSourceView("));
  assert.ok(surfaceRenderPlan.includes("this.componentById.get(surface.componentId)"));
  assert.ok(surfaceRenderPlan.includes("this.resolveRouteSourceNode(storedSurface)"));
  assert.ok(surfaceRenderPlan.includes("this.state.render?.sampling?.surfaceOverscan"));
  assert.ok(surfaceRenderPlan.includes("sharedComponentRenderRequests(routes"));
  assert.ok(surfaceRenderPlan.includes("route.componentRequest = componentRequests.get(route.component.id)"));
  assert.ok(!drawSurfaceRoute.includes("stableFrameRenderRequest(this.state.render"));
  assert.ok(drawSurfaceRoute.includes("scaledComponentSampleRect("));
  assert.ok(source.includes("getSurfaceTexture(request)"));
  assert.ok(source.includes("createGraphics(widthPx, heightPx)"));
});

test("element render quality scales physical component pixels without changing logical proportions", () => {
  const request = {
    role: "source",
    width: 2000,
    height: 1400,
    logicalWidth: 1000,
    logicalHeight: 700,
  };
  const scaled = qualityScaledRenderRequest(request, { renderQuality: 0 }, 0.5);

  assert.equal(scaled.width, 1000);
  assert.equal(scaled.height, 700);
  assert.equal(scaled.logicalWidth, 1000);
  assert.equal(scaled.logicalHeight, 700);
});

test("shader generators preserve the component render contract", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  const request = {
    role: "surface",
    width: 1600,
    height: 2400,
    logicalWidth: 800,
    logicalHeight: 1200,
    pixelDensityApplied: true,
    frameShape: "portrait",
    resolutionScale: 2,
    renderIdentity: "component-eye",
  };
  const pg = {
    width: request.width,
    height: request.height,
    push() {},
    pop() {},
    clear() {},
    image() {},
    translate() {},
    scale() {},
  };
  const target = { width: request.width, height: request.height };
  let receivedRequest = null;
  renderer.renderShaderGeneratorSource = (_id, _time, nextRequest) => {
    receivedRequest = nextRequest;
    return target;
  };

  assert.equal(renderer.drawShaderGenerator(pg, "eyeball", 1.25, request), true);
  assert.deepEqual(receivedRequest, request);
});

test("shader generators draw directly into a shared source framebuffer", () => {
  const renderer = Object.create(OutputRenderer.prototype);
  const request = { width: 640, height: 360, logicalWidth: 640, logicalHeight: 360 };
  const pg = {
    __vj1SharedFramebuffer: true,
    width: request.width,
    height: request.height,
    push() { throw new Error("direct generator output must not be copied"); },
  };
  let receivedTarget = null;
  renderer.normalizeRenderRequest = (nextRequest) => nextRequest;
  renderer.renderShaderGeneratorSource = (_id, _time, _request, _params, _instanceId, _transform, outputTarget) => {
    receivedTarget = outputTarget;
    return outputTarget;
  };

  assert.equal(renderer.drawShaderGenerator(pg, "eyeball", 1.25, request), true);
  assert.equal(receivedTarget, pg);
});

test("eyeball computes frame-constant animation outside its fragment shader", () => {
  const frame = eyeballFrameUniforms(3.25, {
    gazeRange: 1,
    motionSpeed: 1,
    pauseAmount: 0.82,
    jitter: 0.35,
    blinkRate: 1,
  });
  for (const vector of [frame.gazeDir, frame.irisRight, frame.irisUp]) {
    assert.ok(Math.abs(Math.hypot(...vector) - 1) < 0.000001);
  }
  assert.ok(frame.blink >= 0 && frame.blink <= 1);
  assert.equal(eyeballFrameUniforms(3.25, { blinkRate: 0 }).blink, 0);
});

test("every generator path is tied to the component source target", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const drawSource = source.slice(
    source.indexOf("  drawSourceToGraphics("),
    source.indexOf("  drawAnatomyGenerator(")
  );
  const drawShader = source.slice(
    source.indexOf("  drawShaderGenerator("),
    source.indexOf("  renderShaderGeneratorSource(")
  );

  assert.ok(drawSource.includes("this.drawAnatomyGenerator(pg, source, generatorTime, renderRequest)"));
  assert.ok(drawSource.includes("this.drawTerrainGenerator(pg, source, generatorTime, renderRequest)"));
  assert.ok(drawSource.includes("this.drawShaderGenerator(pg, source, generatorTime, renderRequest)"));
  assert.ok(drawSource.includes("drawGenerator(pg, source.generatorId, generatorTime, source.params || {})"));
  assert.ok(drawShader.includes("width: pg.width"));
  assert.ok(drawShader.includes("height: pg.height"));
});

test("projection mapper uses actual texture size for surface sampling math", () => {
  const source = readFileSync(new URL("../js/output/vj-mapper.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("const sourceWidth = sourceRect[2] * Math.max(1, Number(texture.width) || 1);"));
  assert.ok(source.includes("const sourceHeight = sourceRect[3] * Math.max(1, Number(texture.height) || 1);"));
  assert.ok(source.includes('projectionFit = "cover"'));
  assert.ok(rendererSource.includes("this.mapper.drawTexture(pg, mapped.mapperSurface, surface.projectionFit, surface.feather)"));
  assert.ok(rendererSource.includes("sourceRect: view.sourceRect"));
  assert.ok(rendererSource.includes("directSurfaceSamples"));
  assert.ok(source.includes("drawTextureBatch(items = [])"));
  assert.ok(source.includes("this._drawSurfaceQuad(cache.vertices)"));
  assert.ok(rendererSource.includes("drawSurfaceRouteViewBatch(batch, blend)"));
});

test("zero-duration Live output retains the original single-scene surface path", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(source.includes("if (transition) {"));
  assert.ok(source.includes("this.renderSingleSceneSurfaces();"));
  assert.ok(source.includes("this.releaseTransitionSurfaceTextures();"));
  assert.ok(source.includes("this.mapper.drawTransitionTextures("));
});

test("media renditions are saved without lossy jpeg compression", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const renditionSource = readFileSync(new URL("../js/services/media-rendition-service.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('canvas.toBlob(resolve, "image/png")'));
  assert.ok(!rendererSource.includes('"image/jpeg"'));
  assert.ok(renditionSource.includes(".png"));
  assert.ok(renditionSource.includes("png|jpe?g"));
});

test("projection mapper uses high precision for homography sampling", () => {
  const shaderSource = mapperFragmentShaderSource();

  assert.ok(shaderSource.includes("precision highp float;"));
  assert.ok(!shaderSource.includes("precision mediump float;"));
});
