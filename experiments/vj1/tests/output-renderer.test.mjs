import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { averageGpuQueryNanoseconds, compositionPipelineSourceRequest, eyeballFrameUniforms, fittedThumbnailSize, OutputRenderer, qualityScaledRenderRequest } from "../js/output/output-renderer.js";
import { renderRequestKey } from "../js/output/render-geometry.js";
import { VjMapper } from "../js/output/vj-mapper.js";

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

test("GPU timing averages query samples instead of adding overlapping work", () => {
  assert.equal(averageGpuQueryNanoseconds([30_000_000, 10_000_000, 5_000_000]), 15_000_000);
  assert.equal(averageGpuQueryNanoseconds([]), 0);
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

test("paused previews contain thumbnails and canvas surface routes preserve sampling", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(source.includes("const rect = this.compositionPreviewRect(composition, thumbnail.img);"));
  assert.ok(source.includes('if (composition?.type === "canvas")'));
  assert.ok(source.includes("drawSampleRect(pg, thumbnail.img"));
  assert.ok(source.includes("this.mapper.drawTexture(pg, mapped.mapperSurface, surface.projectionFit)"));
});

test("canvas rendering evaluates shared layer groups, effects, and canvas-owned route frames", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(source.includes('item.role === "canvas-layer"'));
  assert.ok(source.includes("this.renderCompositionChainState("));
  assert.ok(source.includes("this.renderEffectNodeState(nodeId, state, item, compositionTime, renderRequest)"));
  assert.ok(source.includes("renderCanvasLayerNodeState("));
  assert.ok(source.includes('source.type === "composition"'));
  assert.ok(source.includes("canvasRouteFrameRect(composition, surface)"));
  assert.ok(source.includes("surface.outputFrameId"));
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
    source.indexOf("  drawSurfaceRoute(pg, surface)"),
    source.indexOf("  drawSurfaceThumbnailRoute(pg, surface)")
  );
  const surfaceRouteRenderRequest = source.slice(
    source.indexOf("  surfaceRouteRenderRequest(surface, composition = null)"),
    source.indexOf("  getSurfaceTexture(request")
  );

  assert.ok(surfaceRouteRenderRequest.includes("compositionRenderRequest(this.state.render, composition"));
  assert.ok(!drawSurfaceRoute.includes("stableFrameRenderRequest(this.state.render"));
  assert.ok(source.includes("getSurfaceTexture(request)"));
  assert.ok(source.includes("createGraphics(widthPx, heightPx)"));

  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = {
    render: { surfaceWidth: 1000, surfaceHeight: 700, pixelDensity: 0.5 },
  };
  const composition = { id: "portrait", type: "chain", frameShape: "portrait", resolutionScale: 2 };
  const first = renderer.surfaceRouteRenderRequest({ id: "surface-a", compositionId: composition.id }, composition);
  const second = renderer.surfaceRouteRenderRequest({ id: "surface-b", compositionId: composition.id }, composition);
  assert.equal(first.width, 700);
  assert.equal(first.height, 1000);
  assert.equal(first.logicalWidth, 700);
  assert.equal(first.logicalHeight, 1000);
  assert.equal(first.pixelDensityApplied, true);
  assert.equal(renderRequestKey(first), renderRequestKey(second));
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
  assert.ok(rendererSource.includes("this.mapper.drawTexture(pg, mapped.mapperSurface, surface.projectionFit)"));
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
  const source = readFileSync(new URL("../js/output/vj-mapper.js", import.meta.url), "utf8");
  const shaderSource = source.slice(source.indexOf("  _ensureShader()"));

  assert.ok(shaderSource.includes("precision highp float;"));
  assert.ok(!shaderSource.includes("precision mediump float;"));
});
