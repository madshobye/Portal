import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { averageGpuQueryNanoseconds, canvasCompositionPlacementRect, canvasFrameBorderHit, canvasPreviewRenderRequest, compositionPipelineSourceRequest, compositionReferencePlacement, compositionReferenceRenderRequest, eyeballFrameUniforms, fittedThumbnailSize, GpuTimerTracker, moveCanvasFrameRect, OutputRenderer, qualityScaledRenderRequest, resizeCanvasFrameRect } from "../js/output/output-renderer.js";
import { createPlacedRenderResult, directPlacementKind, transformedPlacementDemandRect } from "../js/graph/placed-render-result.js";
import { renderRequestKey } from "../js/output/render-geometry.js";
import { mapperFragmentShaderSource, VjMapper } from "../js/output/vj-mapper.js";

function pickRequestSize(request) {
  return { width: request.width, height: request.height };
}

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

test("stable composition cache refreshes the exact GPU buffer usage key", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const lookup = source.slice(
    source.indexOf("    const stableGpuKey ="),
    source.indexOf("    if (composition.type === \"canvas\")")
  );

  assert.ok(lookup.includes("this.compositionGpuBuffer.get(stableGpuKey)"));
  assert.ok(lookup.includes("this.compositionBuffer.get(stableGpuKey)"));
  assert.ok(lookup.includes("this.touchRenderCache(this.compositionGpuBufferUse, stableGpuKey)"));
  assert.ok(lookup.includes("this.touchRenderCache(this.compositionBufferUse, stableGpuKey)"));
});

test("composition pipeline lowers physical render pixels but preserves logical output dimensions", () => {
  const request = {
    role: "surface",
    width: 1200,
    height: 800,
    logicalWidth: 1200,
    logicalHeight: 800,
    renderIdentity: "composition-a",
  };
  const scaled = compositionPipelineSourceRequest(request, {
    upscaling: { enabled: true, amount: 0.65 },
  });

  assert.equal(scaled.width, 780);
  assert.equal(scaled.height, 520);
  assert.equal(scaled.logicalWidth, 1200);
  assert.equal(scaled.logicalHeight, 800);
  assert.equal(scaled.renderIdentity, "composition-a");
  assert.equal(scaled.pipelineSource, true);
  assert.strictEqual(compositionPipelineSourceRequest(request, {
    upscaling: { enabled: false, amount: 0.5 },
  }), request);
});

test("composition post filters run after the upscale target", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const pipelineSource = source.slice(
    source.indexOf("  renderCompositionOutputPipeline("),
    source.indexOf("  cacheCompositionOutput(")
  );

  assert.ok(pipelineSource.indexOf('`${composition.id}:upscale`') < pipelineSource.indexOf('`${composition.id}:post`'));
  assert.ok(source.includes("COMPOSITION_UPSCALE_FRAGMENT_SHADER"));
  assert.ok(source.includes("COMPOSITION_POST_FRAGMENT_SHADER"));
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

test("terrain and STL WebGL targets use project pixel density", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const previousWebgl = globalThis.WEBGL;
  const created = [];
  globalThis.WEBGL = "webgl";
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
    assert.equal(terrainLow.appliedDensity, 0.5);
    assert.equal(modelLow.appliedDensity, 0.5);
    assert.equal(terrainLow.mode, "webgl");
    assert.equal(modelLow.mode, "webgl");

    renderer.state.render.pixelDensity = 1.5;
    const terrainHigh = renderer.getTerrainTarget(1000, 563);
    const modelHigh = renderer.getModelTarget(1000, 563);
    assert.equal(terrainHigh.appliedDensity, 1.5);
    assert.equal(modelHigh.appliedDensity, 1.5);
    assert.notStrictEqual(terrainHigh, terrainLow);
    assert.notStrictEqual(modelHigh, modelLow);

    const terrainResolved = renderer.getTerrainTarget(500, 282, 1);
    const modelResolved = renderer.getModelTarget(500, 282, 1);
    assert.equal(terrainResolved.appliedDensity, 1);
    assert.equal(modelResolved.appliedDensity, 1);
    assert.equal(created.length, 6);
  } finally {
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
    if (previousWebgl === undefined) delete globalThis.WEBGL;
    else globalThis.WEBGL = previousWebgl;
  }
});

test("composition thumbnails retain their aspect within the thumbnail bounds", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("const COMPOSITION_THUMBNAIL_WIDTH = 768;"));
  assert.ok(source.includes("const COMPOSITION_THUMBNAIL_HEIGHT = 432;"));
  assert.ok(source.includes("const COMPOSITION_THUMBNAIL_QUALITY = 0.92;"));
  assert.ok(source.includes('canvas.toDataURL("image/webp", COMPOSITION_THUMBNAIL_QUALITY)'));
  assert.ok(source.includes('return canvas.toDataURL("image/png");'));
  assert.deepEqual(fittedThumbnailSize(1920, 1080), { width: 768, height: 432 });
  assert.deepEqual(fittedThumbnailSize(1080, 1920), { width: 243, height: 432 });
  assert.deepEqual(fittedThumbnailSize(1000, 1000), { width: 432, height: 432 });
  assert.ok(source.includes("context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, thumbnailSize.width, thumbnailSize.height);"));
});

test("Canvas recording-frame thumbnails crop the rendered Canvas by logical frame geometry", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(source.includes("composition.canvas?.frameThumbnails?.[frame.id]"));
  assert.ok(source.includes("this.sendThumbnail(composition.id, frameThumbnail, { frameId: frame.id })"));
  assert.ok(source.includes("if (sourceRect) context.drawImage(source, sx, sy, sw, sh"));
});

test("current composition thumbnails bypass full WebGL framebuffer readback", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const capture = source.slice(
    source.indexOf("  captureSelectedCompositionThumbnail()"),
    source.indexOf("\n}\n\nfunction mappingStatusForReason")
  );
  const staleGuard = "if (!needsCompositionThumbnail && !framesNeedingThumbnails.length) return;";
  assert.ok(capture.includes(staleGuard));
  assert.ok(capture.indexOf(staleGuard) < capture.indexOf("output.get()"));
  assert.ok(capture.includes("this.lastThumbnailAt = millis();"));
});

test("paused previews contain thumbnails and canvas surface routes preserve sampling", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(source.includes("const rect = this.compositionPreviewRect(composition, thumbnail.img);"));
  assert.ok(source.includes('if (composition?.type === "canvas")'));
  assert.ok(source.includes("drawSampleRect(pg, thumbnail.img"));
  assert.ok(source.includes("this.mapper.drawTexture(pg, mapped.mapperSurface, surface.projectionFit, surface.feather)"));
});

test("canvas rendering evaluates ordinary sources, Groups, effects, and shared route frames", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const canvasRenderer = source.slice(
    source.indexOf("  renderCanvasComposition("),
    source.indexOf("  renderCompositionPatch(")
  );
  assert.ok(source.includes("this.renderCompositionChainState("));
  assert.ok(source.includes("this.renderEffectNodeState(nodeId, state, item, compositionTime, renderRequest)"));
  assert.ok(source.includes("this.renderDirectSourceNodeState(nodeId, state, composition, item, compositionTime, renderRequest)"));
  assert.ok(source.includes("this.renderLayerNodeState(nodeId, state, sourceState, { ...item, transform: {} }, renderRequest)"));
  assert.ok(source.includes('source.type === "composition"'));
  assert.ok(source.includes("compositionSourceView(this.state.render, composition, surface, this.state.recordingFrames)"));
  assert.ok(source.includes("this.state?.recordingFrames || []"));
  assert.ok(source.includes("renderCanvasRecordingFrames(composition, source)"));
  assert.ok(source.includes("surface.outputFrameId"));
  assert.ok(source.includes("resolveSceneSourceNode(this.state, storedSurface.sourceNodeId, storedSurface)"));
  assert.ok(!source.includes('item.role === "canvas-layer"'));
  assert.ok(canvasRenderer.includes("this.renderCompositionChainState("));
  assert.ok(!canvasRenderer.includes('item.kind === "source"'));
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

test("Canvas composition placements retain the referenced composition's logical dimensions", () => {
  assert.deepEqual(
    canvasCompositionPlacementRect(
      { width: 3840, height: 2160 },
      { baseWidth: 1080, baseHeight: 1920, width: 540, height: 960 }
    ),
    { x: 1380, y: 120, width: 1080, height: 1920 }
  );
  assert.deepEqual(
    canvasCompositionPlacementRect(
      { width: 3840, height: 2160 },
      { baseWidth: 1920, baseHeight: 1080 },
      { width: 960, height: 540 }
    ),
    { x: 240, y: 135, width: 480, height: 270 }
  );
});

test("nested compositions inherit physical demand from their placement for every parent type", () => {
  const render = { frameWidth: 1000, frameHeight: 700, pixelDensity: 1 };
  const child = { id: "child", type: "chain", frameShape: "landscape", resolutionScale: 2 };
  const canvasParent = { type: "canvas", canvas: { width: 4000, height: 2800 } };
  const canvasPlacement = compositionReferencePlacement(canvasParent, child, render, { width: 1000, height: 700 });
  const regularPlacement = compositionReferencePlacement({ type: "chain" }, child, render, { width: 640, height: 360 });
  const request = compositionReferenceRenderRequest(render, child, canvasPlacement);

  assert.equal(canvasPlacement.x, Math.round((1000 - canvasPlacement.width) * 0.5));
  assert.equal(canvasPlacement.y, Math.round((700 - canvasPlacement.height) * 0.5));
  assert.ok(canvasPlacement.width < regularPlacement.width);
  assert.ok(canvasPlacement.height < regularPlacement.height);
  assert.deepEqual(regularPlacement, { x: 0, y: 0, width: 640, height: 360 });
  assert.ok(request.width <= canvasPlacement.width + 16);
  assert.ok(request.height <= canvasPlacement.height + 16);
  assert.equal(request.logicalWidth / request.logicalHeight, 16 / 9);
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

test("direct placement eligibility is shared by Canvas and ordinary composition parents", () => {
  const renderer = new OutputRenderer({ mode: "composition" });
  const dependency = { id: "child", type: "chain" };
  renderer.state = { compositions: [dependency] };
  renderer.media.set("image", { image: { width: 640, height: 360 } });
  renderer.media.set("model", { model: {}, image: { width: 640, height: 360 } });

  const reference = { kind: "source", source: { type: "composition", compositionId: dependency.id } };
  assert.equal(renderer.canDirectCompositeSource(reference), true);
  assert.equal(renderer.canDirectCompositeSource({ ...reference, blend: "overlay" }), false);
  assert.equal(renderer.canDirectCompositeSource({ kind: "source", source: { type: "media", mediaId: "image" } }), true);
  assert.equal(renderer.canDirectCompositeSource({ kind: "source", source: { type: "media", mediaId: "model" } }), false);
  assert.equal(directPlacementKind({ source: { type: "camera" }, cameraDrawable: true }), "camera-texture");
  assert.equal(directPlacementKind({ source: { type: "generator" } }), "");
});

test("direct placement composites texture geometry without a parent-sized source buffer", () => {
  const renderer = new OutputRenderer({ mode: "composition" });
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

test("composition groups render isolated from earlier parent layers", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const groupRenderSource = source.slice(
    source.indexOf("  renderCompositionChainState("),
    source.indexOf("  renderThumbnailCompositions()")
  );

  assert.ok(groupRenderSource.includes("let state = this.transparentChainState(composition, renderRequest);"));
  assert.ok(groupRenderSource.includes("const groupState = this.renderCompositionChainState("));
  assert.ok(groupRenderSource.includes("item.chain || []"));
  assert.ok(groupRenderSource.includes("state = this.renderLayerNodeState(nodeId, state, groupState, item, renderRequest);"));
  assert.ok(!groupRenderSource.includes("drawBuffer(groupState.buffer, state.buffer"));
});

test("source transforms change source coordinates while groups resample inside a fixed composition frame", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const chainRenderSource = source.slice(
    source.indexOf("  renderCompositionChainState("),
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

test("composition preview always draws its overarching frame independently of selection", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const previewSource = source.slice(
    source.indexOf("  renderCompositionPreview()"),
    source.indexOf("  setCalibrate(on)")
  );

  assert.ok(previewSource.includes("this.renderCompositionFrameOverlay(composition, source)"));
  assert.ok(previewSource.includes('if (this.mode !== "composition" || !composition) return'));
  assert.ok(previewSource.includes("this.compositionPreviewRect(composition, source)"));
  assert.ok(previewSource.includes("stroke(101, 224, 211, 235)"));
});

test("scene surfaces render compositions at their configured shape and relative resolution", () => {
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
  assert.ok(surfaceRenderPlan.includes("compositionSourceView(this.state.render, composition"));
  assert.ok(surfaceRenderPlan.includes("compositionScales"));
  assert.ok(!drawSurfaceRoute.includes("stableFrameRenderRequest(this.state.render"));
  assert.ok(drawSurfaceRoute.includes("scaledCompositionSampleRect("));
  assert.ok(source.includes("getSurfaceTexture(request)"));
  assert.ok(source.includes("createGraphics(widthPx, heightPx)"));
});

test("element render quality scales physical composition pixels without changing logical proportions", () => {
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

test("shader generators preserve the composition render contract", () => {
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
    renderIdentity: "composition-eye",
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

test("every generator path is tied to the composition source target", () => {
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

  assert.ok(source.includes("texture.width || surface.w"));
  assert.ok(source.includes("texture.height || surface.h"));
  assert.ok(source.includes('projectionFit = "cover"'));
  assert.ok(rendererSource.includes("this.mapper.drawTexture(pg, mapped.mapperSurface, surface.projectionFit, surface.feather)"));
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
