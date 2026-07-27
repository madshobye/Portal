import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { averageGpuQueryNanoseconds, cameraCaptureSettings, cameraSettingsSignature, sceneComponentPlacementRect, surfaceBorderHit, sceneMaxRasterSize, scenePreviewRenderRequest, chainTransformDragScale, compiledNativeSourceRenderer, compiledSourceRenderRequest, compiledVisualSourceRenderer, componentAdaptiveRasterLimit, componentInstanceTime, componentLogicalPreviewRect, componentPipelineSourceRequest, componentPreviewRenderRequest, componentReferenceCount, componentReferencePlacement, componentReferencePrefersSharedTexture, componentReferenceRegionRequest, componentReferenceRenderRequest, componentReferenceVisibleRenderRequest, componentRenderInstanceKey, componentSourceView, directFitRects, effectNeedsComposite, eyeballFrameUniforms, fittedThumbnailSize, GpuTimerTracker, moveSurfaceRect, namedTextureStateKey, OutputRenderer, pointInTransformedRect, primaryTextureInputPort, qualityScaledRenderRequest, renderStateComponentProgramRoots, resizeSurfaceRect, sharedComponentRenderRequests, visualOperationRenderItem } from "../js/output/output-renderer.js";
import { createPlacedRenderResult, directPlacementKind, transformedPlacementDemandRect } from "../js/graph/placed-render-result.js";
import { defaultProjectSurfaceMapping, outputFrameForId, outputFrames, renderRequestKey, worldSize } from "../js/output/render-geometry.js";
import { disposeP5Shader, mapperFragmentShaderSource, mapperTransitionFragmentShaderSource, VjMapper } from "../js/libraries/mapping-engine/mapping-engine/index.js";
import { ComponentPreviewInteraction, stateWithSurfaceRect, stateWithChainItemBoundary, stateWithChainItemTransform } from "../js/output/component-preview-interaction.js";
import { compileOutputGroupTopology, compileMappingGroupTopology } from "../js/libraries/composition-engine/index.js";
import { IsfRenderRuntime } from "../js/output/isf-render-runtime.js";
import { IsfAudioTextureRuntime } from "../js/output/isf-audio-texture-runtime.js";
import { IsfImportedImageRuntime } from "../js/output/isf-imported-image-runtime.js";
import { TextureOperatorRuntime } from "../js/output/texture-operator-runtime.js";
import { ShaderEffectRuntime } from "../js/output/shader-effect-runtime.js";
import { ShaderGeneratorRuntime } from "../js/output/shader-generator-runtime.js";
import { CompositeRenderRuntime } from "../js/output/composite-render-runtime.js";
import { TransitionRuntime } from "../js/output/transition-runtime.js";
import { ComponentRenderRuntime } from "../js/output/component-render-runtime.js";
import { OutputRenderProfile } from "../js/output/output-render-profile.js";
import { OutputSurfaceRuntime } from "../js/output/output-surface-runtime.js";
import { VisualPlanRuntime } from "../js/output/visual-plan-runtime.js";
import { compiledSourceRenderTargetOptions, mediaSourceDemandSize, operationMediaResourceIds, runtimeValueMediaResourceIds, SourceRenderRuntime } from "../js/output/source-render-runtime.js";
import { SpecializedSourceRuntime } from "../js/output/specialized/specialized-source-runtime.js";
import { MAPPING_TEST_PATTERN_COMPONENT_ID } from "../js/domain/runtime-visual-sources.js";
import { createIsfNodeDefinition } from "../js/libraries/isf-engine/index.js";
import { NativeRendererRegistry } from "../js/libraries/render-engine/native-renderer-registry.js";
import { nodeRoiRequest } from "../js/libraries/render-engine/roi/index.js";
import {
  BuiltInVisualLibrary,
  DefaultBuiltInTransition,
} from "../js/libraries/visual-nodes/catalog.js";
import { VisualComponent as PhotoGradeVisualComponent } from "../js/libraries/visual-nodes/effects/photo-grade/index.js";

test("effect opacity and blend request a separate generic composite", () => {
  assert.equal(effectNeedsComposite({}), false);
  assert.equal(effectNeedsComposite({ opacity: 1, blend: "normal" }), false);
  assert.equal(effectNeedsComposite({ opacity: 0.5, blend: "normal" }), true);
  assert.equal(effectNeedsComposite({ opacity: 1, blend: "screen" }), true);
});

test("compiled projective renderers preserve Component viewport ROI without legacy generator registration", () => {
  const component = { id: "component-projective", type: "component" };
  const operation = {
    opcode: "source",
    configuration: {
      enabled: true,
      source: {
        type: "generator",
        generatorId: "core.scene3d.render",
      },
    },
    contract: {
      roi: {
        mode: "projective",
        inputMapping: "sub-frustum",
        pixelEquivalentToFullFrame: true,
      },
    },
  };
  const host = {
    state: { components: [component] },
    componentProgramRuntime: {
      programs: new Map([[
        component.id,
        { forEachOperation(visitor) { visitor(operation); } },
      ]]),
    },
    visualNodeRuntime: {
      generator() {
        return null;
      },
    },
  };
  const runtime = new SourceRenderRuntime(host);

  assert.equal(runtime.componentRegionSafe(component), true);

  operation.contract.roi.pixelEquivalentToFullFrame = false;
  runtime.invalidateStructure();
  assert.equal(
    runtime.componentRegionSafe(component),
    false,
    "a projective renderer cannot use viewport ROI without an explicit pixel-equivalence guarantee",
  );
});

test("parameter-dependent effect ROI follows live values without structural recompilation", () => {
  const component = { id: "component-photo-grade", type: "scene" };
  const params = { distort: 0, contrast: 0.4 };
  const operation = {
    opcode: "effect",
    configuration: { enabled: true, params },
    runtimePolicy: PhotoGradeVisualComponent.runtime,
    contract: { roi: PhotoGradeVisualComponent.runtime.roi },
  };
  const host = {
    state: { components: [component] },
    componentProgramRuntime: {
      programs: new Map([[
        component.id,
        { forEachOperation(visitor) { visitor(operation); } },
      ]]),
    },
    visualNodeRuntime: { generator() { return null; } },
  };
  const runtime = new SourceRenderRuntime(host);

  assert.equal(
    runtime.componentRegionSafe(component),
    true,
    "ordinary grading is pixel-local in full logical coordinates",
  );

  params.distort = 0.5;
  assert.equal(
    runtime.componentRegionSafe(component),
    false,
    "source distortion expands the dependency to the full input immediately",
  );

  params.distort = 0;
  assert.equal(
    runtime.componentRegionSafe(component),
    true,
    "returning to local grading restores regional execution without recompiling the graph",
  );
});

test("named ISF image ports bind retained textures and participate in dirty identity", () => {
  const calls = new Map();
  const shader = {
    uniforms: Object.fromEntries([
      "foreground",
      "foreground_imgSize",
      "foreground_flipY",
      "background",
      "background_imgSize",
      "background_flipY",
      "TIME",
      "TIMEDELTA",
      "FRAMEINDEX",
      "PASSINDEX",
      "DATE",
      "RENDERSIZE",
      "vj1IsfFinalPass",
    ].map((name) => [name, {}])),
    setUniform(name, value) {
      calls.set(name, value);
    },
  };
  const foreground = {
    buffer: { width: 320, height: 180 },
    nodeKey: "foreground",
    outputVersion: 4,
  };
  const background = {
    buffer: { width: 1280, height: 720 },
    nodeKey: "background",
    outputVersion: 9,
  };
  const inputs = new Map([
    ["foreground", foreground],
    ["background", background],
  ]);
  const renderer = {
    frameRuntime: {
      visualDeltaSeconds: 1 / 60,
      frameIndex: 12,
      visualTime: 1.5,
    },
  };

  new IsfRenderRuntime(renderer).setFrameUniforms(shader, {}, {
    inputs,
    renderRequest: { width: 640, height: 360 },
    timeSeconds: 1.5,
    sourceDetail: {
      width: 1920,
      height: 1080,
      physicalWidth: 640,
      physicalHeight: 360,
      contentScale: 3,
    },
  });

  assert.equal(calls.get("foreground"), foreground.buffer);
  assert.deepEqual(calls.get("foreground_imgSize"), [320, 180]);
  assert.equal(calls.get("foreground_flipY"), true);
  assert.equal(calls.get("background"), background.buffer);
  assert.deepEqual(calls.get("background_imgSize"), [1280, 720]);
  assert.equal(calls.get("background_flipY"), true);
  assert.deepEqual(
    calls.get("RENDERSIZE"),
    [640, 360],
    "Content scale changes ISF coordinates once instead of also scaling RENDERSIZE",
  );
  assert.deepEqual(namedTextureStateKey(inputs), [
    ["background", "background@9"],
    ["foreground", "foreground@4"],
  ]);
  assert.equal(primaryTextureInputPort({
    textureInputPorts: ["overlayImage", "inputImage"],
  }), "inputImage", "an ISF effect always preserves its semantic base image");
});

test("ISF audio textures upload each analyser frame once and reuse retained images", () => {
  const frame = {
    sequence: 1,
    lifecycleRevision: 1,
    timeData: new Uint8Array([0, 128, 255]),
    frequencyData: new Uint8Array([10, 20]),
  };
  const created = [];
  const runtime = new IsfAudioTextureRuntime({
    controlSignalRuntime: {
      analysisFrame: () => frame,
    },
  }, {
    createImage(width, height) {
      const image = {
        width,
        height,
        pixels: new Uint8ClampedArray(width * height * 4),
        uploads: 0,
        loadPixels() {},
        updatePixels() {
          this.uploads++;
        },
        remove() {
          this.removed = true;
        },
      };
      created.push(image);
      return image;
    },
  });

  const waveform = runtime.texture("audio");
  assert.strictEqual(runtime.texture("audio"), waveform);
  assert.equal(waveform.uploads, 1);
  assert.deepEqual([...waveform.pixels.slice(0, 12)], [
    0, 0, 0, 255,
    128, 128, 128, 255,
    255, 255, 255, 255,
  ]);
  assert.deepEqual(
    [...waveform.pixels.slice(0, 12)],
    [...waveform.pixels.slice(12, 24)],
    "mono analyser data is duplicated into the ISF stereo rows",
  );

  const fft = runtime.texture("audioFFT");
  assert.equal(fft.uploads, 1);
  assert.equal(created.length, 2);
  frame.sequence++;
  runtime.texture("audio");
  runtime.texture("audio");
  assert.equal(waveform.uploads, 2);
  runtime.dispose();
  assert.equal(waveform.removed, true);
  assert.equal(fft.removed, true);
});

test("ISF imported images load once, share by resource identity, and invalidate on readiness", () => {
  const callbacks = [];
  const invalidations = [];
  const image = { width: 64, height: 105, remove() { this.removed = true; } };
  const runtime = new IsfImportedImageRuntime({
    frameRuntime: { frameIndex: 4 },
    invalidatePresentation(reason) {
      invalidations.push(reason);
    },
  }, {
    loadImage(url, onLoad, onError) {
      callbacks.push({ url, onLoad, onError });
      return image;
    },
  });
  const descriptor = Object.freeze({
    id: "vidvox/cursor.png",
    url: "data:image/png;base64,cursor",
  });
  const generator = {
    isfImportedResources: { cursorImage: descriptor },
  };
  const effect = {
    isfImportedResources: { cursorImage: descriptor },
  };
  const imported = { name: "cursorImage", path: "cursor.png" };

  assert.equal(runtime.texture(generator, imported), null);
  assert.equal(runtime.texture(effect, imported), null);
  assert.equal(callbacks.length, 1);
  assert.match(runtime.externalKey(generator), /loading/);
  callbacks[0].onLoad(image);
  assert.strictEqual(runtime.texture(effect, imported), image);
  assert.equal(callbacks.length, 1);
  assert.match(runtime.externalKey(effect), /ready/);
  assert.deepEqual(invalidations, ["isf-imported-image-ready"]);
  runtime.dispose();
  assert.equal(image.removed, true);
});

test("a failed imported image load retries on a later render frame", () => {
  const host = {
    frameRuntime: { frameIndex: 7 },
    invalidatePresentation() {},
  };
  const attempts = [];
  const image = { width: 2, height: 2 };
  const runtime = new IsfImportedImageRuntime(host, {
    loadImage(_url, onLoad, onError) {
      attempts.push({ onLoad, onError });
      return image;
    },
  });
  const component = {
    isfImportedResources: {
      noiseTex: { id: "noise", url: "data:image/png;base64,noise" },
    },
  };
  const imported = { name: "noiseTex", path: "noise.png" };

  runtime.texture(component, imported);
  attempts[0].onError(new Error("decode failed"));
  assert.equal(runtime.texture(component, imported), null);
  assert.equal(attempts.length, 1, "multipass calls do not retry in the failed frame");
  host.frameRuntime.frameIndex++;
  assert.equal(runtime.texture(component, imported), null);
  assert.equal(attempts.length, 2);
  attempts[1].onLoad(image);
  assert.strictEqual(runtime.texture(component, imported), image);
});

test("typed media resource inputs carry runtime readiness into retained source identity", () => {
  const resource = {
    kind: "project-media-resource",
    mediaId: "media/example.jpg",
    resourceIdentity: "project-media:media/example.jpg",
  };
  const runtimeValues = new Map([["resource", resource]]);
  assert.deepEqual(runtimeValueMediaResourceIds(runtimeValues), [
    "media/example.jpg",
  ]);

  const signatures = [];
  const mediaItem = {
    id: "media/example.jpg",
    ready: false,
    revision: 0,
    fileKey: "example:1",
  };
  const host = {
    frameRuntime: {
      frameIndex: 1,
      isPlaybackActive: () => true,
    },
    visualNodeRuntime: {
      generator: () => ({
        params: [],
        runtime: {
          cacheable: true,
          timeDependent: () => false,
        },
      }),
    },
    componentRenderRuntime: {
      isFrameDynamic: () => false,
    },
    specializedSources: {
      featureMorph: {
        analysisService: () => null,
      },
    },
    state: {
      media: [{ id: "media/example.jpg", type: "image", size: 1 }],
    },
    media: new Map([[mediaItem.id, mediaItem]]),
    renderEvaluationRuntime: {
      evaluate(_nodeId, signature) {
        signatures.push(signature);
        return { buffer: {}, outputVersion: signatures.length };
      },
    },
  };
  const runtime = new SourceRenderRuntime(host);
  const operation = {
    runtimeValueInputs: runtimeValues,
    runtimeValueIdentityInputs: new Map([
      ["resource", "project-media:media/example.jpg"],
    ]),
    directPlacement: { kind: "drawable-resource", input: "resource" },
  };
  const inputState = {
    buffer: {},
    nodeKey: "input",
    outputVersion: 1,
    instanceInvariant: true,
  };
  const component = { id: "component", speed: 1 };
  const item = {
    id: "render",
    source: {
      type: "generator",
      generatorId: "core.visual.media-resource-to-image",
      params: {},
    },
  };
  runtime.renderDirectNodeState(
    "media-node",
    inputState,
    component,
    item,
    0,
    { width: 640, height: 360 },
    operation,
  );
  mediaItem.ready = true;
  mediaItem.revision = 1;
  mediaItem.image = { width: 693, height: 443 };
  runtime.renderDirectNodeState(
    "media-node",
    inputState,
    component,
    item,
    0,
    { width: 640, height: 360 },
    operation,
  );

  assert.equal(signatures.length, 2);
  assert.notEqual(
    signatures[0],
    signatures[1],
    "a decoded resource invalidates the child renderer even when its graph value identity is stable",
  );
  assert.match(signatures[0], /"ready":false/);
  assert.match(signatures[1], /"revision":1/);
});

test("compiled media dependency projection keeps retained Scene and Mesh values opaque", () => {
  const mesh = new Proxy({
    kind: "mesh",
    contractVersion: 1,
  }, {
    ownKeys() {
      throw new Error("retained mesh geometry must not be traversed");
    },
  });
  const scene = {
    kind: "scene3d",
    contractVersion: 1,
    objects: [{ mesh }],
  };
  const operation = {
    mediaDependencies: ["media/skull.obj"],
    runtimeValueInputs: new Map([["scene", scene]]),
  };

  assert.deepEqual(
    [...operationMediaResourceIds(operation)],
    ["media/skull.obj"],
  );
  assert.deepEqual(runtimeValueMediaResourceIds(
    new Map([["scene", scene]]),
  ), []);
});

test("the dedicated ISF backend owns and prunes retained pass targets", () => {
  const removed = [];
  const runtime = new IsfRenderRuntime({ frameRuntime: { frameIndex: 20 } });
  runtime.passTargets.set("stale", {
    lastUsed: 1,
    targets: [{ remove: () => removed.push("stale-a") }, { remove: () => removed.push("stale-b") }],
  });
  runtime.passTargets.set("active", {
    lastUsed: 19,
    targets: [{ remove: () => removed.push("active") }],
  });
  runtime.programStates.set("stale-program", {
    frameIndex: 4,
    lastUsed: 1,
  });
  runtime.programStates.set("active-program", {
    frameIndex: 2,
    lastUsed: 19,
  });

  runtime.prune(5);
  assert.deepEqual(removed, ["stale-a", "stale-b"]);
  assert.deepEqual([...runtime.passTargets.keys()], ["active"]);
  assert.deepEqual([...runtime.programStates.keys()], ["active-program"]);

  runtime.dispose();
  assert.deepEqual(removed, ["stale-a", "stale-b", "active"]);
  assert.equal(runtime.passTargets.size, 0);
  assert.equal(runtime.programStates.size, 0);

  const rendererSource = readFileSync(
    new URL("../js/output/output-renderer.js", import.meta.url),
    "utf8",
  );
  const backendSource = readFileSync(
    new URL("../js/output/isf-render-runtime.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(rendererSource, /this\.isfPassTargets/);
  assert.match(rendererSource, /new IsfRenderRuntime\(this, \{/);
  assert.match(backendSource, /class IsfRenderRuntime/);
  assert.match(backendSource, /evaluateIsfDimension/);
  assert.match(backendSource, /programState = \{ frameIndex: 0, lastUsed: 0 \}/);
  assert.match(backendSource, /frameIndex: programState\.frameIndex/);
});

test("ISF automation tokens become one-frame pulses shared by every pass", () => {
  const frameRuntime = { frameIndex: 10, scheduledEvents: [] };
  const runtime = new IsfRenderRuntime({ frameRuntime });

  assert.equal(
    runtime.eventPulse("shockwave", "pulse", 4),
    false,
    "a renderer joining an existing event stream establishes a baseline",
  );
  assert.equal(
    runtime.eventPulse("shockwave", "pulse", 4),
    false,
    "the baseline is not converted into a pulse by another pass",
  );
  frameRuntime.frameIndex = 11;
  assert.equal(runtime.eventPulse("shockwave", "pulse", 4), false);
  frameRuntime.frameIndex = 12;
  assert.equal(runtime.eventPulse("shockwave", "pulse", 5), true);
  assert.equal(
    runtime.eventPulse("shockwave", "pulse", 5),
    true,
    "multipass reads in the triggering frame retain the pulse",
  );
  assert.equal(
    runtime.eventPulse("manual", "pulse", null),
    false,
    "an idle manual event establishes a null baseline",
  );
  frameRuntime.frameIndex = 13;
  assert.equal(runtime.eventPulse("manual", "pulse", 1), true);
  frameRuntime.scheduledEvents = [{
    type: "isf-event",
    target: "shockwave",
    payload: { parameterId: "pulse" },
  }];
  frameRuntime.frameIndex = 14;
  assert.equal(runtime.eventPulse("shockwave", "pulse", 5), true);

  runtime.dispose();
  assert.equal(runtime.eventSignals.size, 0);
});

test("Live presentation clears Component sharing once per frame", () => {
  const componentOutput = new Map([["stale", { frame: 1 }]]);
  const renderer = {
    state: {},
    resourceRuntime: { componentOutput },
  };
  const runtime = new OutputSurfaceRuntime(renderer);
  let renderedFrames = 0;
  runtime.releaseTransitionSurfaceTextures = () => {};
  runtime.renderMappingSurfaces = () => {
    assert.equal(componentOutput.size, 0);
    componentOutput.set("shared-in-frame", { frame: ++renderedFrames });
  };

  runtime.renderSurfaces();
  assert.equal(componentOutput.get("shared-in-frame").frame, 1);
  runtime.renderSurfaces();
  assert.equal(componentOutput.get("shared-in-frame").frame, 2);
});

test("the texture-operator backend owns retained delay state and shader disposal", () => {
  const targets = new Map();
  const createTarget = (key) => ({
    key,
    width: 320,
    height: 180,
    draws: [],
    push() {},
    clear() {},
    pop() {},
    image(source, x, y, width, height) {
      this.draws.push({ source, x, y, width, height });
    },
  });
  const runtime = new TextureOperatorRuntime({
    renderTargetRuntime: {
      isShaderBuffer: () => false,
      gpu(key) {
        if (!targets.has(key)) targets.set(key, createTarget(key));
        return targets.get(key);
      },
    },
  });
  const plan = { retainedOperators: new Map() };
  const operation = { id: "delay-1", opcode: "delay", configuration: {} };
  const firstSource = { id: "first" };
  const secondSource = { id: "second" };
  const first = runtime.renderRetained(
    plan,
    operation,
    { buffer: firstSource },
    { width: 320, height: 180 },
    "component-1",
  );
  const firstBuffer = first.buffer;
  const second = runtime.renderRetained(
    plan,
    operation,
    { buffer: secondSource },
    { width: 320, height: 180 },
    "component-1",
  );
  assert.notEqual(second.buffer, firstBuffer, "Delay exposes the previous retained target before swapping");
  assert.deepEqual(
    [...targets.values()].flatMap((target) => target.draws.map((draw) => draw.source)),
    [secondSource, firstSource],
    "each input frame is copied into the target that becomes readable on the following evaluation",
  );
  assert.equal(second.outputVersion, 2);

  const deleted = [];
  const gl = {
    isProgram: () => true,
    deleteProgram: (value) => deleted.push(["program", value]),
    isShader: () => true,
    deleteShader: (value) => deleted.push(["shader", value]),
  };
  const shader = (name) => ({
    _renderer: { GL: gl },
    _glProgram: `${name}-program`,
    _vertShader: `${name}-vertex`,
    _fragShader: `${name}-fragment`,
  });
  const operatorShader = shader("operator");
  const transitionShader = shader("transition");
  runtime.operatorShaders.set("context", operatorShader);
  runtime.transitionShaders.set("context", new Map([["kernel", transitionShader]]));
  runtime.dispose();
  assert.equal(runtime.operatorShaders.size, 0);
  assert.equal(runtime.transitionShaders.size, 0);
  assert.equal(deleted.length, 6);
  assert.equal(operatorShader._glProgram, 0);
  assert.equal(transitionShader._glProgram, 0);

  const rendererSource = readFileSync(
    new URL("../js/output/output-renderer.js", import.meta.url),
    "utf8",
  );
  const backendSource = readFileSync(
    new URL("../js/output/texture-operator-runtime.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(rendererSource, /this\.textureOperatorShaders|this\.textureTransitionShaders/);
  assert.match(rendererSource, /new TextureOperatorRuntime\(this\)/);
  assert.match(backendSource, /class TextureOperatorRuntime/);
  assert.match(backendSource, /renderRetained\(/);
  assert.match(backendSource, /disposeP5Shader/);
});

test("the shader-effect backend owns program caching uniforms and GL disposal", () => {
  const deleted = [];
  const gl = {
    isProgram: () => true,
    deleteProgram: (value) => deleted.push(["program", value]),
    isShader: () => true,
    deleteShader: (value) => deleted.push(["shader", value]),
  };
  let compileCount = 0;
  const shader = {
    _renderer: { GL: gl },
    _glProgram: "effect-program",
    _vertShader: "effect-vertex",
    _fragShader: "effect-fragment",
    uniforms: {},
  };
  const target = {
    createShader() {
      compileCount++;
      return shader;
    },
  };
  const component = {
    id: "test-effect",
    type: "effect",
    code: "vec4 effect(vec4 color, vec2 uv) { return color; }",
    params: [],
  };
  const runtime = new ShaderEffectRuntime({
    isfRuntime: {
      eventPulse: (instanceId, parameterId) =>
        instanceId === "effect-instance" && parameterId === "clear",
    },
  }, {
    getCustomCode: () => "",
    getComponent: () => component,
  });
  assert.equal(runtime.getShader({ id: component.id }, target), shader);
  assert.equal(runtime.getShader({ id: component.id }, target), shader);
  assert.equal(compileCount, 1, "one context and shader identity compile once");

  const uniforms = new Map();
  runtime.setParamUniforms({
    setUniform: (name, value) => uniforms.set(name, value),
  }, {
    params: [
      { id: "enabled", type: "boolean", defaultValue: true },
      { id: "tint", type: "color", defaultValue: "#ff0000" },
      { id: "mode", type: "enum", values: ["a", "b"], defaultValue: "a" },
      { id: "clear", type: "event", defaultValue: false, isfUniformType: "event" },
      { id: "x", type: "number", defaultValue: 0, isfUniform: "point", isfVectorIndex: 0 },
      { id: "y", type: "number", defaultValue: 0, isfUniform: "point", isfVectorIndex: 1 },
    ],
  }, {
    enabled: false,
    tint: "#00ff00",
    mode: "b",
    x: 0.25,
    y: 0.75,
  }, { instanceId: "effect-instance" });
  assert.equal(uniforms.get("enabled"), false);
  assert.deepEqual(uniforms.get("tint"), [0, 1, 0, 1]);
  assert.equal(uniforms.get("mode"), 1);
  assert.equal(uniforms.get("clear"), true);
  assert.deepEqual(uniforms.get("point"), [0.25, 0.75]);
  assert.equal(uniforms.get("amount"), 0);

  runtime.clear();
  assert.equal(deleted.length, 3);
  assert.equal(shader._glProgram, 0);

  const rendererSource = readFileSync(
    new URL("../js/output/output-renderer.js", import.meta.url),
    "utf8",
  );
  const backendSource = readFileSync(
    new URL("../js/output/shader-effect-runtime.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(rendererSource, /this\.shaderBuilder/);
  assert.match(rendererSource, /new ShaderEffectRuntime\(this/);
  assert.match(backendSource, /fuseLocalShaderSchedule/);
  assert.match(backendSource, /disposeShader: disposeP5Shader/);
});

test("the shader-effect backend owns paired scratch targets pruning and disposal", () => {
  const created = [];
  const disposed = [];
  let compileCount = 0;
  const component = {
    id: "retained-program-effect",
    type: "effect",
    code: "vec4 effect(vec4 color, vec2 uv) { return color; }",
    params: [],
  };
  const runtime = new ShaderEffectRuntime({
    frameRuntime: { frameIndex: 1 },
    renderRequestRuntime: {
      normalize(request) {
        return request;
      },
    },
  }, {
    createTarget(width, height) {
      const target = {
        width,
        height,
        __vj1ShaderContextId: "shared-test-context",
        createShader() {
          compileCount++;
          return { id: `shader-${compileCount}` };
        },
        resizeCanvas(nextWidth, nextHeight) {
          this.width = nextWidth;
          this.height = nextHeight;
        },
      };
      created.push(target);
      return target;
    },
    disposeTarget(target) {
      disposed.push(target);
    },
    getComponent: () => component,
  });

  const first = runtime.getTarget({ width: 320, height: 180 }, 0);
  const second = runtime.getTarget({ width: 320, height: 180 }, 1);
  const retainedProgram = runtime.getShader({ id: component.id }, first);
  assert.notEqual(first, second);
  assert.equal(runtime.ownsTarget(first), true);
  assert.deepEqual(runtime.targets, [first, second]);
  assert.equal(compileCount, 1);

  runtime.host.frameRuntime.frameIndex = 2;
  runtime.getTarget({ width: 640, height: 360 }, 0);
  runtime.host.frameRuntime.frameIndex = 3;
  runtime.getTarget({ width: 800, height: 450 }, 0);
  runtime.host.frameRuntime.frameIndex = 4;
  runtime.getTarget({ width: 960, height: 540 }, 0);
  assert.equal(runtime.targetGroups.size, 3, "the oldest target pair is pruned before a fourth size is retained");
  assert.deepEqual(disposed, [first, second]);
  assert.equal(
    runtime.getShader({ id: component.id }, runtime.targets[0]),
    retainedProgram,
    "evicting a size-keyed scratch target retains programs from the shared WebGL context",
  );
  assert.equal(
    compileCount,
    1,
    "scratch-target churn cannot trigger per-frame shader recompilation",
  );

  runtime.dispose();
  assert.equal(runtime.targetGroups.size, 0);
  assert.deepEqual(runtime.targets, [null, null]);
  assert.equal(disposed.length, created.length);

  const rendererSource = readFileSync(
    new URL("../js/output/output-renderer.js", import.meta.url),
    "utf8",
  );
  const backendSource = readFileSync(
    new URL("../js/output/shader-effect-runtime.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(rendererSource, /this\.fxTargetGroups|this\.fxTargets|this\.fxTargetKey/);
  assert.doesNotMatch(
    rendererSource,
    /^  (?:getComponentPipelineShader|drawComponentPipelinePass|drawTextureOperatorTarget|drawTextureTransitionTarget|renderOverlayLayerToTarget|renderShaderChain|renderShaderPassToTarget|setShaderParamUniforms|setIsfFrameUniforms)\(/m,
    "compiled operations call their capability runtime without renderer forwarding methods",
  );
  assert.match(backendSource, /this\.targetGroups = new Map\(\)/);
  assert.match(backendSource, /getTarget\(request, slot = 0\)/);
  assert.match(backendSource, /disposeTargets\(\)/);
  assert.match(backendSource, /getIsfRuntime = \(\) => host\.isfRuntime/);
  assert.match(rendererSource, /getIsfRuntime: \(\) => this\.isfRuntime/);
});

test("the shader-effect capability owns retained effect evaluation and quality demand", () => {
  const resolutions = [];
  const evaluations = [];
  const component = {
    id: "quality-effect",
    params: [
      {
        id: "renderQuality",
        type: "number",
        min: 0,
        max: 1,
        defaultValue: 0.5,
      },
      {
        id: "amount",
        type: "number",
        min: 0,
        max: 1,
        defaultValue: 1,
      },
    ],
    runtime: { timeDependent: () => false },
  };
  const output = {
    width: 200,
    height: 100,
    push() {},
    clear() {},
    image() {},
    pop() {},
  };
  const host = {
    frameRuntime: {
      frameIndex: 7,
      isPlaybackActive: () => false,
    },
    state: { shaders: { customCode: "" } },
    renderTargetRuntime: {
      isShaderBuffer: () => false,
    },
    componentRenderRuntime: {
      recordResolution: (...args) => resolutions.push(args),
    },
    renderEvaluationRuntime: {
      evaluate(nodeId, signature, request, render, reason, options) {
        render(output);
        evaluations.push({ nodeId, signature, request, reason, options });
        return {
          buffer: output,
          outputVersion: 1,
          nodeKey: nodeId,
          instanceInvariant: options.instanceInvariant,
        };
      },
    },
    compositeRuntime: {
      renderLayerNodeState() {
        throw new Error("neutral effects must not add a composite pass");
      },
    },
  };
  const runtime = new ShaderEffectRuntime(host, {
    getComponent: () => component,
    getCustomCode: () => "",
  });
  const effected = { id: "effected" };
  const renderCalls = [];
  runtime.renderChain = (...args) => {
    renderCalls.push(args);
    return effected;
  };

  const result = runtime.renderNodeState(
    "effect-node",
    {
      buffer: { id: "input" },
      outputVersion: 3,
      nodeKey: "input",
      instanceInvariant: true,
    },
    {
      id: "effect-item",
      componentId: component.id,
      opacity: 1,
      blend: "normal",
      params: { renderQuality: 0, amount: 1 },
    },
    2,
    { width: 200, height: 100, logicalWidth: 200, logicalHeight: 100 },
  );

  assert.equal(result.buffer, output);
  assert.deepEqual(
    resolutions[0].slice(0, 4),
    [
      null,
      {
        id: "effect-item",
        componentId: component.id,
        opacity: 1,
        blend: "normal",
        params: { renderQuality: 0, amount: 1 },
      },
      "effect",
      {
        width: 70,
        height: 35,
        logicalWidth: 200,
        logicalHeight: 100,
        qualityScale: 0.35,
      },
    ],
  );
  assert.equal(renderCalls.length, 1);
  assert.equal(renderCalls[0][2].width, 70);
  assert.equal(renderCalls[0][2].height, 35);
  assert.equal(evaluations[0].reason, "effect");
  assert.equal(evaluations[0].options.instanceInvariant, true);
});

test("retained ISF final targets are committed into the evaluation-owned output", () => {
  const component = {
    id: "persistent-isf-effect",
    type: "isf",
    params: [
      { id: "amount", type: "number", min: 0, max: 1, defaultValue: 1 },
    ],
    runtime: { timeDependent: () => true },
  };
  const drawn = [];
  const output = {
    __vj1SharedFramebuffer: true,
    framebuffer: { id: "evaluation-framebuffer" },
    width: 200,
    height: 100,
    push() {},
    pop() {},
    clear() { drawn.push(["clear"]); },
    imageMode() {},
    translate() {},
    scale() {},
    image(...args) { drawn.push(["image", ...args]); },
  };
  const retained = {
    __vj1SharedFramebuffer: true,
    framebuffer: { id: "persistent-framebuffer" },
    width: 200,
    height: 100,
  };
  const host = {
    frameRuntime: {
      frameIndex: 7,
      isPlaybackActive: () => true,
    },
    state: { shaders: { customCode: "" } },
    renderTargetRuntime: {
      isShaderBuffer: (value) => value?.__vj1SharedFramebuffer === true,
    },
    componentRenderRuntime: {
      recordResolution() {},
    },
    renderEvaluationRuntime: {
      evaluate(nodeId, signature, request, render, reason, options) {
        render(output);
        return {
          buffer: output,
          outputVersion: 1,
          nodeKey: nodeId,
          instanceInvariant: options.instanceInvariant,
        };
      },
    },
    compositeRuntime: {
      renderLayerNodeState() {
        throw new Error("normal opacity must not composite");
      },
    },
  };
  const runtime = new ShaderEffectRuntime(host, {
    getComponent: () => component,
    getCustomCode: () => "",
  });
  runtime.renderPass = () => retained;

  const result = runtime.renderNodeState(
    "persistent-node",
    {
      buffer: { id: "input" },
      outputVersion: 3,
      nodeKey: "input",
      instanceInvariant: false,
    },
    {
      id: "persistent-instance",
      componentId: component.id,
      opacity: 1,
      blend: "normal",
      params: { amount: 1 },
    },
    2,
    { width: 200, height: 100, logicalWidth: 200, logicalHeight: 100 },
  );

  assert.equal(result.buffer, output);
  assert.deepEqual(drawn[0], ["clear"]);
  assert.equal(drawn[1][0], "image");
  assert.equal(drawn[1][1], retained.framebuffer);
});

test("declared neutral shader effects bypass evaluation, targets, and draw calls", () => {
  const component = {
    id: "neutral-effect",
    params: [
      { id: "amount", type: "number", min: 0, max: 1, defaultValue: 1 },
      { id: "cut", type: "number", min: 0, max: 32, defaultValue: 1 },
      { id: "feather", type: "number", min: 0, max: 32, defaultValue: 3 },
    ],
    runtime: {
      isNeutral: (params) => params.cut <= 0.001 && params.feather <= 0.001,
    },
  };
  const runtime = new ShaderEffectRuntime({}, {
    getComponent: () => component,
    getCustomCode: () => "",
    createTarget: () => {
      throw new Error("a neutral effect must not allocate a render target");
    },
  });
  const inputState = {
    buffer: { id: "input" },
    outputVersion: 3,
    nodeKey: "input",
    instanceInvariant: true,
  };

  const result = runtime.renderNodeState(
    "effect-node",
    inputState,
    {
      id: "effect-item",
      componentId: component.id,
      opacity: 1,
      blend: "normal",
      params: { amount: 1, cut: 0, feather: 0 },
    },
    2,
    { width: 200, height: 100 },
  );

  assert.strictEqual(result, inputState);
  assert.equal(runtime.targetGroups.size, 0);
});

test("the compositing backend owns fixed passes per context and disposes every program", () => {
  const deleted = [];
  const gl = {
    isProgram: () => true,
    deleteProgram: (value) => deleted.push(["program", value]),
    isShader: () => true,
    deleteShader: (value) => deleted.push(["shader", value]),
  };
  const created = [];
  const target = {
    width: 320,
    height: 180,
    _renderer: { GL: gl },
    push() {},
    pop() {},
    blendMode() {},
    clear() {},
    shader() {},
    resetShader() {},
    rect() {},
    createShader() {
      const id = `fixed-${created.length}`;
      const uniforms = new Map();
      const shader = {
        _renderer: { GL: gl },
        _glProgram: `${id}-program`,
        _vertShader: `${id}-vertex`,
        _fragShader: `${id}-fragment`,
        setUniform: (name, value) => uniforms.set(name, value),
        uniforms,
      };
      created.push(shader);
      return shader;
    },
  };
  const profileRuntime = new OutputRenderProfile();
  const host = {
    profileRuntime,
    renderTargetRuntime: {
      isShaderBuffer: (source) => source?.webgl === true,
    },
    presentationRuntime: {
      measureGpu: (_target, draw) => draw(),
    },
  };
  const runtime = new CompositeRenderRuntime(host);
  const upscale = runtime.getPipelineShader("upscale", target);
  assert.equal(runtime.getPipelineShader("upscale", target), upscale);
  const post = runtime.getPipelineShader("post", target);
  assert.equal(created.length, 2, "fixed pipeline programs compile once per kind and context");

  const source = { webgl: true };
  runtime.drawPipelinePass({
    target,
    shaderProgram: post,
    source,
    request: { width: 320, height: 180 },
    passName: "Component post",
    uniforms: () => post.setUniform("noiseAmount", 0.2),
  });
  assert.equal(post.uniforms.get("sourceTex"), source);
  assert.equal(post.uniforms.get("sourceFlipY"), false);
  assert.equal(post.uniforms.get("noiseAmount"), 0.2);
  assert.equal(profileRuntime.frameProfile.shaderPasses, 1);
  assert.equal(profileRuntime.frameProfile.shaderChains, 1);

  const matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.equal(runtime.drawLayerTransform(target, source, matrix), true);
  assert.equal(runtime.drawLayer(target, source, { webgl: false }, {
    opacity: 0.4,
    blend: "normal",
  }), true);
  assert.equal(runtime.drawOverlay(target, source, { webgl: false }, {
    layerUvMatrix: matrix,
    opacity: 0.4,
  }), true);
  assert.equal(created.length, 5);
  assert.deepEqual(created[2].uniforms.get("sourceUvMatrix"), matrix);
  assert.equal(created[3].uniforms.get("layerOpacity"), 0.4);
  assert.equal(created[3].uniforms.get("layerBlendMode"), 0);
  assert.equal(created[4].uniforms.get("layerOpacity"), 0.4);

  const retainedLayer = { buffer: { id: "opaque-layer" } };
  assert.strictEqual(
    runtime.renderLayerNodeState(
      "identity-layer",
      { buffer: { id: "transparent" }, transparent: true },
      retainedLayer,
      { opacity: 1, blend: "normal", transform: {} },
      { width: 320, height: 180 },
    ),
    retainedLayer,
    "an opaque identity layer remains the chain result without a composite target",
  );

  runtime.dispose();
  assert.equal(runtime.pipelineShaders.size, 0);
  assert.equal(runtime.layerTransformShaders.size, 0);
  assert.equal(runtime.layerBlendShaders.size, 0);
  assert.equal(runtime.overlayBlendShaders.size, 0);
  assert.equal(deleted.length, 15);

  const rendererSource = readFileSync(
    new URL("../js/output/output-renderer.js", import.meta.url),
    "utf8",
  );
  const backendSource = readFileSync(
    new URL("../js/output/composite-render-runtime.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    rendererSource,
    /this\.overlayBlendShader|this\.layerTransformShader|this\.componentPipelineShaders/,
  );
  assert.match(rendererSource, /new CompositeRenderRuntime\(this\)/);
  assert.match(backendSource, /drawPipelinePass/);
  assert.match(backendSource, /renderComponentPipeline/);
  assert.match(backendSource, /getPipelineTarget/);
  assert.match(backendSource, /drawLayer/);
  assert.match(backendSource, /drawLayerTransform/);
  assert.match(backendSource, /drawOverlay/);
  assert.match(backendSource, /transparentChainState/);
  assert.match(backendSource, /renderBoundedEffectRunNodeState/);
  assert.match(backendSource, /extractNodeRegionState/);
  assert.match(backendSource, /compositeNodeRegionState/);
  assert.match(backendSource, /disposeP5Shader/);
  assert.doesNotMatch(
    rendererSource,
    /output\.translate\(-roi\.sampleX,\s*-roi\.sampleY\)/,
    "ROI extraction belongs to the compositing capability",
  );
  assert.doesNotMatch(
    rendererSource,
    /^  (?:renderComponentOutputPipeline|getComponentPipelineTarget)\(/m,
    "Component pipeline scheduling and target policy belong to the compositing capability",
  );
});

test("native source dispatch follows the compiled node hook instead of generator-name branching", () => {
  const operation = {
    backend: "native-specialized",
    renderer: "output/specialized:terrainSurface",
  };
  const source = { type: "generator", generatorId: "renamed-terrain-node" };
  assert.equal(compiledNativeSourceRenderer(operation, source), "output/specialized:terrainSurface");
  assert.equal(compiledNativeSourceRenderer({ backend: "native-specialized" }, source, {
    nodeDefinition: { metadata: { nativeRenderer: "output/specialized:text" } },
  }), "output/specialized:text");

  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const backendSource = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const specializedSource = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  assert.doesNotMatch(backendSource, /source\.generatorId === "terrainFlyover"/);
  assert.doesNotMatch(backendSource, /source\.generatorId === "text"/);
  assert.doesNotMatch(backendSource, /NATIVE_SOURCE_HOST_METHODS/);
  assert.match(backendSource, /this\.nativeRendererRegistry\.execute\(/);
  assert.match(specializedSource, /registerNativeRenderer\(\s*"output\/specialized:terrainSurface"/);
  assert.match(specializedSource, /registerNativeRenderer\(\s*"output\/specialized:terrainWire"/);
  assert.match(rendererSource, /new SourceRenderRuntime\(this,\s*\{\s*mediaRuntime: this\.mediaRuntime,/);
});

test("source backend imports every shared render-view contract it executes", () => {
  const source = readFileSync(
    new URL("../js/output/source-render-runtime.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /import \{\s*renderSourceDetail,\s*renderView,\s*withRenderView,\s*\} from "\.\.\/libraries\/render-engine\/render-view\/index\.js/,
  );
  assert.match(source, /return renderSourceDetail\(descriptor, descriptor,/);
});

test("native source renderer capabilities are retained, collision checked, and backend owned", () => {
  const calls = [];
  const registry = new NativeRendererRegistry();
  const runtime = new SourceRenderRuntime({
    state: { render: {}, ui: {} },
    mode: "output",
    frameRuntime: { frameIndex: 0 },
  }, { nativeRendererRegistry: registry });
  runtime.registerNativeRenderer(
    "test/native:custom",
    (...args) => calls.push(args),
  );
  assert.equal(runtime.hasNativeRenderer("test/native:custom"), true);
  assert.equal(runtime.drawCompiledNativeSource(
    "test/native:custom",
    { id: "target" },
    { type: "generator", generatorId: "custom" },
    2.5,
    { width: 640, height: 360 },
    { id: "compiled-operation" },
  ), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 2.5);
  assert.throws(
    () => runtime.registerNativeRenderer("test/native:custom", () => {}),
    /VJ1_NATIVE_SOURCE_RENDERER_DUPLICATE:test\/native:custom/,
  );

  const specialized = new SpecializedSourceRuntime({
    nativeRendererRegistry: registry,
  });
  assert.equal(
    specialized.hasNativeRenderer("test/native:custom"),
    true,
    "generic and specialized capability owners resolve through one registry",
  );
  assert.equal(
    specialized.hasNativeRenderer("output/specialized:anatomy"),
    false,
    "Anatomy uses the ordinary Scene3D image operation rather than a parallel renderer",
  );
  assert.equal(
    specialized.hasNativeRenderer("output/specialized:tileTexture"),
    false,
    "Tile Texture compiles Media Image and Tile Repeat through the ordinary texture graph",
  );
  for (const rendererId of [
    "output/specialized:terrainSurface",
    "output/specialized:terrainWire",
    "output/specialized:featureMorph",
    "output/specialized:featureMorphV2",
    "output/specialized:text",
  ]) {
    assert.equal(specialized.hasNativeRenderer(rendererId), true, `${rendererId} capability`);
  }
  assert.equal(
    specialized.hasNativeRenderer("output/specialized:meshPatterns"),
    false,
    "Mesh Patterns compiles reusable topology, material, and render nodes rather than a parent renderer",
  );
  assert.throws(
    () => specialized.registerNativeRenderer("output/specialized:text", () => {}),
    /VJ1_NATIVE_SOURCE_RENDERER_DUPLICATE:output\/specialized:text/,
  );
  specialized.dispose();
});

test("shader disposal ignores non-native p5 wrapper handles during context teardown", () => {
  const deleted = [];
  const nativeProgram = { kind: "program" };
  const nativeFragment = { kind: "shader" };
  const gl = {
    isProgram(value) {
      if (value !== nativeProgram) throw new TypeError("not a WebGLProgram");
      return true;
    },
    deleteProgram(value) {
      deleted.push(["program", value]);
    },
    isShader(value) {
      if (value !== nativeFragment) throw new TypeError("not a WebGLShader");
      return true;
    },
    deleteShader(value) {
      deleted.push(["shader", value]);
    },
  };
  const shader = {
    _renderer: { GL: gl },
    _glProgram: nativeProgram,
    _vertShader: { p5Wrapper: true },
    _fragShader: nativeFragment,
  };

  assert.doesNotThrow(() => disposeP5Shader(shader));
  assert.deepEqual(deleted, [
    ["program", nativeProgram],
    ["shader", nativeFragment],
  ]);
  assert.equal(shader._glProgram, 0);
  assert.equal(shader._vertShader, 0);
  assert.equal(shader._fragShader, 0);
});

test("ordinary source dispatch accepts only semantic generators and Component references", () => {
  assert.equal(compiledVisualSourceRenderer({
    backend: "source-runtime",
    renderer: "output/source:generator",
  }, { type: "generator", generatorId: "gradient" }), "output/source:generator");
  assert.equal(
    compiledVisualSourceRenderer({}, { type: "component", componentId: "child" }),
    "output/source:component",
  );
  assert.throws(
    () => compiledVisualSourceRenderer({}, { type: "camera" }),
    /VJ1_AUTHORED_VISUAL_SOURCE_REQUIRED:camera/,
  );

  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const backendSource = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  assert.match(backendSource, /SOURCE_RUNTIME_METHODS\[rendererId\]/);
  assert.match(backendSource, /resolvePlacedSourceResult\(/);
  assert.doesNotMatch(rendererSource, /^  drawSourceToGraphics\(/m);
  assert.doesNotMatch(rendererSource, /^  resolvePlacedSourceResult\(/m);
  assert.doesNotMatch(rendererSource, /SOURCE_RUNTIME_METHODS\[rendererId\]/);
  assert.equal(typeof new SourceRenderRuntime({}).drawSourceToGraphics, "function");
});

test("extracted source backend owns source detail and suppresses only repeated identical crashes", () => {
  assert.deepEqual(mediaSourceDemandSize({
    width: 160,
    height: 90,
    uvRect: [0, 0, 0.5, 0.5],
  }, {
    contentTransform: { scale: 2 },
  }), {
    width: 640,
    height: 360,
    physicalWidth: 320,
    physicalHeight: 180,
    contentScale: 2,
  });

  const runtime = new SourceRenderRuntime({ state: { render: {} } });
  const target = {
    width: 160,
    height: 90,
    push() {},
    pop() {},
    background() {},
  };
  const component = { id: "owner", name: "Owner" };
  const source = { type: "media", mediaId: "media/clip.mov" };
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    runtime.drawSourceToGraphics = () => {
      throw new ReferenceError("missing source dependency");
    };
    runtime.safeDrawSourceToGraphics(target, source, component, 0, { width: 160, height: 90 });
    runtime.safeDrawSourceToGraphics(target, source, component, 0, { width: 160, height: 90 });
    assert.equal(errors.length, 1, "the same persistent source failure is reported once");

    runtime.drawSourceToGraphics = () => {};
    runtime.safeDrawSourceToGraphics(target, source, component, 0, { width: 160, height: 90 });
    runtime.drawSourceToGraphics = () => {
      throw new ReferenceError("missing source dependency");
    };
    runtime.safeDrawSourceToGraphics(target, source, component, 0, { width: 160, height: 90 });
    assert.equal(errors.length, 2, "a failure is reportable again after the source recovers");
  } finally {
    console.error = originalError;
  }
});

test("source backend executes the compiled renderer capability without source-kind branching", () => {
  const runtime = new SourceRenderRuntime({
    state: { render: {}, ui: {} },
    mode: "output",
    frameRuntime: { frameIndex: 0 },
  });
  const calls = [];
  runtime.drawGeneratorSource = (...args) => calls.push(["generator", ...args]);
  const target = {};
  const component = { id: "owner" };
  const source = { type: "generator", generatorId: "gradient" };
  const operation = {
    backend: "source-runtime",
    renderer: "output/source:generator",
  };

  runtime.drawSourceToGraphics(
    target,
    source,
    component,
    2.5,
    { width: 640, height: 360 },
    operation,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "generator");
  assert.equal(calls[0][1], target);
  assert.equal(calls[0][2], source);
  assert.equal(calls[0][3], component);
  assert.equal(calls[0][4], 2.5);
});

test("source backends prepare dependencies unbound and own only their final target draw", () => {
  let depth = 0;
  const target = {
    width: 640,
    height: 360,
    push() {
      depth++;
    },
    pop() {
      depth--;
    },
    translate() {},
    rotate() {},
    scale() {},
  };
  const child = {
    id: "child",
    type: "chain",
    frameShape: "landscape",
    resolutionScale: 1,
    transform: {},
  };
  const parent = { id: "parent", type: "chain" };
  const events = [];
  const host = {
    state: {
      render: { componentAspectRatio: 16 / 9, pixelDensity: 1 },
    },
    frameRuntime: { componentTimes: new Map() },
    componentProgramRuntime: {
      programs: new Map([[
        parent.id,
        {
          inspect: () => ({
            references: [{ kind: "component", id: child.id, path: "source.componentId" }],
          }),
        },
      ]]),
      componentForId: (id) => id === child.id ? child : null,
    },
    componentRenderRuntime: {
      render: () => {
        events.push(`dependency:${depth}`);
        return { width: 640, height: 360 };
      },
    },
    renderTargetRuntime: {
      isShaderBuffer: () => false,
    },
    visualNodeRuntime: { generator: () => null },
  };
  const runtime = new SourceRenderRuntime(host, {
    mediaRuntime: {
      acquireMediaById: () => null,
      requestMissingMedia() {},
      acquireScreenInput: () => null,
      screenError: () => "",
    },
  });
  runtime.componentRegionSafe = () => false;
  runtime.drawPlacedResultGeometry = () => events.push(`present:${depth}`);

  runtime.drawComponentReferenceSource(
    target,
    {
      type: "component",
      componentId: child.id,
      instanceId: "child-instance",
      placement: { scale: 1 },
      contentTransform: {},
    },
    parent,
    0,
    { width: 640, height: 360 },
  );

  runtime.drawGeneratorSource(
    target,
    { type: "generator", generatorId: "immediate", params: {}, contentTransform: {} },
    parent,
    0,
    { width: 640, height: 360 },
    {
      nodeProcess: (_inputs, context) => events.push(`immediate:${depth}:${context.target === target}`),
    },
  );

  runtime.registerNativeRenderer(
    "test/native:intermediate",
    () => events.push(`native:${depth}`),
  );
  runtime.drawGeneratorSource(
    target,
    { type: "generator", generatorId: "native", params: {}, contentTransform: {} },
    parent,
    0,
    { width: 640, height: 360 },
    {
      backend: "native-specialized",
      renderer: "test/native:intermediate",
    },
  );

  assert.deepEqual(events, [
    "dependency:0",
    "present:1",
    "immediate:1:true",
    "native:0",
  ]);
  assert.equal(depth, 0);
});

test("render-plan roots include visible current and transition endpoint Components only", () => {
  const state = {
    ui: { selectedComponentId: "editor-component" },
    components: [
      { id: "editor-component" },
      { id: "current-component" },
      { id: "previous-component" },
      { id: "disabled-component" },
    ],
    surfaces: [
      { id: "current", enabled: true, componentId: "current-component" },
      { id: "disabled", enabled: false, componentId: "disabled-component" },
    ],
    liveTransition: {
      fromState: {
        surfaces: [{ id: "previous", enabled: false, componentId: "previous-component" }],
      },
    },
  };

  assert.deepEqual(
    [...renderStateComponentProgramRoots(state, "live")].sort(),
    ["current-component", "previous-component"],
    "historical transition bindings remain reachable even when their stored endpoint is disabled",
  );
  assert.deepEqual(
    [...renderStateComponentProgramRoots(state, "component")],
    ["editor-component"],
  );
});

test("Component program reachability remains structural across visibility patches", () => {
  const child = {
    id: "child",
    type: "chain",
    chain: [{ id: "child-source", kind: "source", enabled: true, source: { type: "generator", generatorId: "waves" } }],
  };
  const replacement = {
    id: "replacement",
    type: "chain",
    chain: [{ id: "replacement-source", kind: "source", enabled: true, source: { type: "generator", generatorId: "waves" } }],
  };
  const reference = {
    id: "child-reference",
    kind: "source",
    enabled: false,
    source: { type: "component", componentId: child.id },
  };
  const root = { id: "root", type: "scene", chain: [reference] };
  const renderer = new OutputRenderer({ mode: "component" });
  renderer.state = {
    components: [root, child, replacement],
    nodes: { groups: [] },
    render: {},
    surfaces: [],
    ui: { selectedComponentId: root.id },
  };
  renderer.visualNodeRuntime.rebuild();
  renderer.componentProgramRuntime.rebuild();
  assert.deepEqual(
    [...renderer.componentProgramRuntime.programs.keys()].sort(),
    [child.id, root.id],
    "a hidden reference retains its executable child program",
  );
  assert.deepEqual(
    renderer.componentProgramRuntime.programs.get(root.id).inspect().dependencies.components,
    [],
    "active render dependencies still exclude hidden references",
  );

  const result = renderer.livePatchRuntime.apply([{
    componentId: root.id,
    path: "chain.0.enabled",
    value: true,
  }]);

  assert.equal(result.applied, true);
  assert.equal(renderer.state.components[0].chain[0].enabled, true);
  assert.deepEqual([...renderer.componentProgramRuntime.programs.keys()].sort(), [child.id, root.id]);
  let patchedReference = null;
  renderer.componentProgramRuntime.programs.get(root.id).forEachOperation((operation) => {
    if (operation.id === reference.id) patchedReference = operation.configuration;
  });
  assert.equal(
    patchedReference?.enabled,
    true,
    "visibility patches update retained operation configuration without recompiling topology",
  );

  renderer.livePatchRuntime.apply([{
    componentId: root.id,
    path: "chain.0.source.componentId",
    value: replacement.id,
  }]);
  assert.deepEqual(
    [...renderer.componentProgramRuntime.programs.keys()].sort(),
    [replacement.id, root.id],
    "retargeting a reference derives a fresh closure from current topology rather than stale inspection",
  );
});

test("persisted compact Component graphs compile their referenced Component closure", () => {
  const child = { id: "child", type: "chain", chain: [] };
  const root = { id: "root", type: "scene", chain: [] };
  const sourceNode = (id, configuration) => ({
    id,
    nodeId: "core.visual.source",
    nodeVersion: "0.1.0",
    role: "source",
    configuration,
    generatedBy: "vj1-component-compiler",
  });
  const group = (componentId, nodes) => ({
    id: `vj1.component.${componentId}`,
    nodeId: "core.composition.component-program",
    nodeVersion: "0.1.0",
    componentId,
    nodes,
    connections: [],
    publicInlets: {},
    publicOutlets: { texture: nodes.length ? `${nodes.at(-1).id}.texture` : "$in.texture" },
    compiler: {
      id: "vj1.visual.component-program",
      target: "visual",
      strategy: "allocation-stable-direct-render-program",
    },
    generatedBy: "vj1-component-compiler",
    compactTopology: true,
  });
  const renderer = new OutputRenderer({ mode: "component" });
  renderer.state = {
    components: [root, child],
    nodes: {
      groups: [
        group(root.id, [sourceNode("child-reference", {
          id: "child-reference",
          kind: "source",
          enabled: true,
          source: { type: "component", componentId: child.id },
        })]),
        group(child.id, [sourceNode("child-source", {
          id: "child-source",
          kind: "source",
          enabled: true,
          source: { type: "generator", generatorId: "waves" },
        })]),
      ],
    },
    render: {},
    surfaces: [],
    ui: { selectedComponentId: root.id },
  };
  renderer.visualNodeRuntime.rebuild();
  renderer.componentProgramRuntime.rebuild();
  assert.deepEqual([...renderer.componentProgramRuntime.programs.keys()].sort(), [child.id, root.id]);
});
import { createInitialState } from "../js/domain/models.js";

function pickRequestSize(request) {
  return { width: request.width, height: request.height };
}

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

test("local transform overlays path-copy store-owned component and Surface state", () => {
  const child = { id: "child", kind: "source", transform: { x: 0, y: 0, scale: 1, rotation: 0 } };
  const group = { id: "group", kind: "group", chain: [child] };
  const component = { id: "component", chain: [group] };
  const surface = { id: "surface", x: 0, y: 0, width: 100, height: 100 };
  const state = {
    components: [component],
    mappings: [{ id: "mapping", surfaces: [surface] }],
    surfaces: [surface],
    ui: { selectedMappingId: "mapping" },
  };

  const transformed = stateWithChainItemTransform(state, component.id, child.id, { x: 0.5 });
  const bounded = stateWithChainItemBoundary(transformed, component.id, child.id, { width: 0.5, height: 0.5, rotation: 0.3 });
  const surfaced = stateWithSurfaceRect(bounded, surface.id, { y: 24 });

  assert.equal(child.transform.x, 0, "the store-owned nested item is not mutated");
  assert.equal(surface.y, 0, "the store-owned Surface is not mutated");
  assert.equal(surfaced.components[0].chain[0].chain[0].transform.x, 0.5);
  assert.equal(surfaced.components[0].chain[0].chain[0].boundary.rotation, 0.3);
  assert.equal(surfaced.components[0].chain[0].chain[0].boundary.width, 0.5);
  assert.equal(surfaced.mappings[0].surfaces[0].y, 24);
  assert.equal(surfaced.surfaces[0].y, 24);
  assert.equal(surfaced.components[0].chain[0].id, group.id);
});

test("a hidden selected element cannot expose transform handles or begin a drag", () => {
  const hidden = {
    id: "hidden-item",
    kind: "source",
    enabled: false,
    opacity: 1,
    source: { type: "media", mediaId: "image" },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  };
  const renderer = {
    state: {
      components: [{ id: "component", chain: [hidden] }],
      ui: { selectedComponentId: "component", selectedChainItemId: hidden.id },
    },
  };
  const interaction = new ComponentPreviewInteraction(renderer);
  assert.equal(interaction.selectedTransformableChainItem(), null);
  assert.equal(interaction.startChainTransformDrag(50, 50), false);
});

test("local drag overlays refresh only Component lookup entries while Surface geometry stays in Mapping state", () => {
  const component = { id: "component", chain: [{ id: "item", kind: "source", transform: {} }] };
  const surface = { id: "surface", x: 0, y: 0, width: 100, height: 100 };
  const renderer = new OutputRenderer({ mode: "component" });
  renderer.state = {
    components: [component],
    mappings: [{ id: "mapping", surfaces: [surface] }],
    surfaces: [surface],
    render: {},
    ui: { selectedMappingId: "mapping" },
  };
  renderer.componentProgramRuntime.rebuildLookups();
  let patchedProgramItem = null;
  renderer.componentProgramRuntime.programs.set(component.id, {
    replaceChainItem(itemId, item) {
      assert.equal(itemId, "item");
      patchedProgramItem = item;
      return true;
    },
  });
  let fullRebuilds = 0;
  renderer.rebuildRouteLookups = () => { fullRebuilds++; };
  const interaction = new ComponentPreviewInteraction(renderer);

  interaction.applyLocalChainTransform(component.id, "item", { x: 0.25 });
  interaction.applyLocalSurface(surface.id, { y: 20 });

  assert.equal(fullRebuilds, 0);
  assert.equal(renderer.componentProgramRuntime.componentById.get(component.id).chain[0].transform.x, 0.25);
  assert.equal(patchedProgramItem.transform.x, 0.25, "the rendered program follows the local preview overlay immediately");
  assert.equal(renderer.state.mappings[0].surfaces[0].y, 20);
  assert.equal(renderer.state.surfaces[0].y, 20);
});

test("compiled Output topology gates the existing Mapping route program", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const mappingRuntimeSource = readFileSync(new URL("../js/output/mapping-program-runtime.js", import.meta.url), "utf8");
  const surfaceRuntimeSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const state = createInitialState();
  state.surfaces[0].enabled = true;
  state.surfaces[0].componentId = state.components[0].id;
  const sceneGroup = compileMappingGroupTopology({ id: "", name: "Working Mapping" }, state.surfaces);
  const outputGroup = compileOutputGroupTopology();
  state.nodes = { groups: [sceneGroup, outputGroup] };
  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = state;
  renderer.mappingProgramRuntime.rebuild();

  assert.equal(renderer.mappingProgramRuntime.output.enabled, true);
  assert.equal(renderer.mappingProgramRuntime.programs instanceof Map, true);
  assert.deepEqual(
    renderer.mappingProgramRuntime.surfaces().map((surface) => surface.id),
    state.surfaces.map((surface) => surface.id)
  );

  outputGroup.connections = outputGroup.connections.filter((edge) => edge.to !== "$out.output");
  renderer.mappingProgramRuntime.rebuild();
  assert.equal(renderer.mappingProgramRuntime.output.enabled, false);
  assert.deepEqual(renderer.mappingProgramRuntime.surfaces(), []);
  assert.doesNotMatch(rendererSource, /\bcompileMappingRenderPrograms\b/);
  assert.match(mappingRuntimeSource, /\bcompileMappingRenderPrograms\b/);
  assert.match(surfaceRuntimeSource, /mappingProgramRuntime\.surfaces\(/);
});

test("preview transform ownership survives stale state until an exact acknowledgement", () => {
  const transform = { x: 0.4, y: -0.2, scale: 1.5, rotation: 0.3 };
  const rect = { x: 30, y: 40, width: 120, height: 80 };
  const surface = { id: "surface", x: 0, y: 0, width: 100, height: 100 };
  const stale = {
    components: [{ id: "component", chain: [{ id: "item", kind: "source", transform: { x: 0, y: 0, scale: 1, rotation: 0 } }] }],
    mappings: [{ id: "mapping", surfaces: [surface] }],
    surfaces: [surface],
    ui: { selectedChainItemId: "", selectedMappingId: "mapping" },
  };
  const interaction = new ComponentPreviewInteraction({});
  interaction.pendingChainTransform = { componentId: "component", itemId: "item", transform };
  interaction.pendingSurface = { surfaceId: "surface", rect };

  const reconciled = interaction.reconcileIncomingState(stale);
  assert.deepEqual(stale.components[0].chain[0].transform, { x: 0, y: 0, scale: 1, rotation: 0 });
  assert.equal(stale.mappings[0].surfaces[0].x, 0);
  assert.deepEqual(reconciled.components[0].chain[0].transform, transform);
  assert.deepEqual(reconciled.mappings[0].surfaces[0], { id: "surface", ...rect });
  assert.deepEqual(reconciled.surfaces[0], { id: "surface", ...rect });
  assert.equal(reconciled.ui.selectedChainItemId, "item");
  assert.ok(interaction.pendingChainTransform);
  assert.ok(interaction.pendingSurface);

  const acknowledged = stateWithSurfaceRect(
    stateWithChainItemTransform(stale, "component", "item", transform),
    "surface",
    rect
  );
  assert.equal(interaction.reconcileIncomingState(acknowledged), acknowledged);
  assert.equal(interaction.pendingChainTransform, null);
  assert.equal(interaction.pendingSurface, null);
});

test("authoritative retained controls supersede completed preview handle ownership", () => {
  const interaction = new ComponentPreviewInteraction({});
  interaction.pendingChainBoundary = {
    componentId: "component",
    itemId: "item",
    boundary: { width: 0.4, height: 0.4 },
  };
  interaction.pendingChainTransform = {
    componentId: "component",
    itemId: "item",
    transform: { scale: 0.4 },
  };

  interaction.acceptAuthoritativeConfigurationPatches([
    {
      targetType: "component",
      componentId: "component",
      itemId: "item",
      path: "chain.0.boundary.width",
      value: 1,
    },
  ]);

  assert.equal(interaction.pendingChainBoundary, null);
  assert.ok(interaction.pendingChainTransform, "an independent Content transform remains owned");

  interaction.acceptAuthoritativeConfigurationPatches([
    {
      targetType: "component",
      componentId: "component",
      itemId: "item",
      path: "chain.0.transform.scale",
      value: 1,
    },
  ]);

  assert.equal(interaction.pendingChainTransform, null);
});

test("retained scrub echoes do not take ownership from an active preview drag", () => {
  const interaction = new ComponentPreviewInteraction({});
  interaction.chainTransformDrag = {
    componentId: "component",
    itemId: "item",
    lastBoundary: { width: 0.4, height: 0.4 },
  };
  interaction.pendingChainBoundary = {
    componentId: "component",
    itemId: "item",
    boundary: { width: 0.4, height: 0.4 },
  };

  interaction.acceptAuthoritativeConfigurationPatches([
    {
      targetType: "component",
      componentId: "component",
      itemId: "item",
      path: "chain.0.boundary",
      value: { width: 0.4, height: 0.4 },
    },
  ]);

  assert.ok(interaction.pendingChainBoundary);
});

test("selected element handles take priority over overlapping Scene Surfaces", () => {
  const calls = [];
  const interaction = new ComponentPreviewInteraction({ mode: "component" });
  interaction.startChainTransformDrag = (_x, _y, options) => {
    calls.push(["chain", options]);
    return true;
  };
  interaction.startSurfaceDrag = () => {
    calls.push(["surface"]);
    return true;
  };

  interaction.mousePressed(40, 50);

  assert.deepEqual(calls, [["chain", { handlesOnly: true }]]);
});

test("Scene Surfaces receive the pointer when no selected handle is hit", () => {
  const calls = [];
  const interaction = new ComponentPreviewInteraction({ mode: "component" });
  interaction.startChainTransformDrag = () => {
    calls.push(["chain"]);
    return false;
  };
  interaction.startSurfaceDrag = () => {
    calls.push(["surface"]);
    return true;
  };

  interaction.mousePressed(40, 50);

  assert.deepEqual(calls, [["chain"], ["surface"]]);
});

test("direct output Surfaces remain editable as 2D Scene rectangles", () => {
  const surface = {
    id: "direct-output-main",
    enabled: true,
    calibrationLocked: true,
    keepProportions: true,
    destination: { type: "direct", outputIds: ["output-main"] },
    x: 0.1,
    y: 0.1,
    width: 0.4,
    height: 0.3,
  };
  const scene = { id: "scene", type: "scene", chain: [] };
  const selected = [];
  const renderer = {
    state: {
      components: [scene],
      mappings: [{ id: "mapping", surfaces: [surface] }],
      ui: {
        workspace: "scene",
        sceneInspectorTarget: "surface",
        selectedComponentId: scene.id,
        selectedMappingId: "mapping",
        selectedSurfaceId: surface.id,
      },
    },
    resourceRuntime: {
      componentOutput: new Map(),
    },
    presentationRuntime: {
      componentPreviewRect: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    },
    onSceneSurfaceSelect: (id) => selected.push(id),
  };
  const interaction = new ComponentPreviewInteraction(renderer);

  assert.equal(interaction.startSurfaceDrag(20, 10), true);
  assert.deepEqual(selected, [surface.id]);
  assert.equal(interaction.surfaceDrag?.surfaceId, surface.id);
  assert.equal(interaction.surfaceDrag?.keepProportions, true);
});

test("Scene Surface frames become inert while an element owns inspector focus", () => {
  const surface = {
    id: "surface-a",
    enabled: true,
    x: 0.1,
    y: 0.1,
    width: 0.4,
    height: 0.3,
  };
  const scene = { id: "scene", type: "scene", chain: [] };
  const renderer = {
    state: {
      components: [scene],
      mappings: [{ id: "mapping", surfaces: [surface] }],
      ui: {
        workspace: "scene",
        sceneInspectorTarget: "element",
        selectedComponentId: scene.id,
        selectedMappingId: "mapping",
        selectedSurfaceId: surface.id,
      },
    },
    resourceRuntime: { componentOutput: new Map() },
    presentationRuntime: {
      componentPreviewRect: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    },
  };
  const interaction = new ComponentPreviewInteraction(renderer);

  assert.equal(interaction.activeSceneSurfaceId(), "");
  assert.equal(interaction.startSurfaceDrag(20, 10), false);

  renderer.state.ui.sceneInspectorTarget = "surface";
  assert.equal(interaction.activeSceneSurfaceId(), surface.id);
  assert.equal(interaction.startSurfaceDrag(20, 10), true);
});

test("Preview element picking applies the shared exclusive Scene selection", () => {
  const selected = [];
  const renderer = {
    state: {
      ui: {
        workspace: "scene",
        sceneInspectorTarget: "surface",
        selectedSurfaceId: "surface-a",
        selectedChainItemId: "",
      },
    },
    onChainItemSelect: (id) => selected.push(id),
  };
  const interaction = new ComponentPreviewInteraction(renderer);

  interaction.selectChainItemAtPoint(0, 0, { id: "element-a" });

  assert.equal(renderer.state.ui.sceneInspectorTarget, "element");
  assert.equal(renderer.state.ui.selectedChainItemId, "element-a");
  assert.equal(renderer.state.ui.selectedSurfaceId, "");
  assert.deepEqual(selected, ["element-a"]);
});

test("element scale dragging uses a softened bounded response", () => {
  assert.equal(chainTransformDragScale(1, 40, 160), 2);
  assert.equal(chainTransformDragScale(1, 40, 10), 0.5);
  assert.equal(chainTransformDragScale(6, 40, 160), 8);
});

test("transformed physical bounds support translated scaled and rotated picking", () => {
  const frame = { x: 0, y: 0, width: 200, height: 100 };
  const rect = { x: 50, y: 25, width: 100, height: 50 };
  assert.equal(pointInTransformedRect(100, 50, frame, rect, {}), true);
  assert.equal(pointInTransformedRect(25, 50, frame, rect, {}), false);
  assert.equal(pointInTransformedRect(150, 50, frame, rect, { x: 0.5, scale: 0.5, rotation: Math.PI / 2 }), true);
  assert.equal(pointInTransformedRect(100, 50, frame, rect, { x: 0.5, scale: 0.5, rotation: Math.PI / 2 }), false);
});

test("preview picking selects physical sources, spatial effects, and containing groups", () => {
  const selected = [];
  const renderer = new OutputRenderer({ mode: "component", onChainItemSelect: (id) => selected.push(id) });
  const source = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const groupedSource = { id: "source-b", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "media", mediaId: "image-a" } };
  const group = { id: "group-a", kind: "group", enabled: true, opacity: 1, transform: {}, chain: [groupedSource] };
  const ordinaryEffect = { id: "effect-a", kind: "effect", componentId: "labelChromatic", enabled: true, opacity: 1, transform: {} };
  const component = { id: "component-a", type: "chain", chain: [source, group, ordinaryEffect] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: "" } };
  renderer.presentationRuntime.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  assert.equal(renderer.previewInteraction.selectChainItemAtPoint(100, 50)?.id, group.id);
  assert.equal(renderer.state.ui.selectedChainItemId, group.id);
  assert.deepEqual(selected, [group.id]);

  component.chain.push({ id: "effect-spatial", kind: "effect", componentId: "ripple", enabled: true, opacity: 1, transform: {} });
  renderer.state.ui.selectedChainItemId = "";
  assert.equal(renderer.previewInteraction.selectChainItemAtPoint(100, 50)?.id, "effect-spatial");
});

test("preview body picking follows compositor z-order even when a covered item was selected", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const left = {
    id: "left",
    kind: "source",
    enabled: true,
    opacity: 1,
    boundary: { x: -0.5, y: 0, width: 0.5, height: 1, rotation: 0 },
    source: { type: "generator", generatorId: "noise" },
  };
  const right = {
    id: "right",
    kind: "source",
    enabled: true,
    opacity: 1,
    boundary: { x: 0.5, y: 0, width: 0.5, height: 1, rotation: 0 },
    source: { type: "generator", generatorId: "plasma" },
  };
  const component = { id: "component-a", type: "chain", chain: [left, right] };
  renderer.state = {
    components: [component],
    render: {},
    ui: { selectedComponentId: component.id, selectedChainItemId: left.id },
  };
  renderer.presentationRuntime.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  assert.equal(renderer.previewInteraction.chainItemAtPoint(50, 50), left);
  assert.equal(renderer.previewInteraction.chainItemAtPoint(150, 50), right);

  right.boundary = { x: 0, y: 0, width: 1, height: 1, rotation: 0 };
  assert.equal(
    renderer.previewInteraction.chainItemAtPoint(50, 50),
    right,
    "the frontmost body wins even when the covered item owns selection",
  );
});

test("clicking empty preview space clears element selection", () => {
  const selected = [];
  const renderer = new OutputRenderer({
    mode: "component",
    onChainItemSelect: (id) => selected.push(id),
  });
  const source = {
    id: "source-a",
    kind: "source",
    enabled: true,
    opacity: 1,
    boundary: { x: 0, y: 0, width: 0.25, height: 0.25, rotation: 0 },
    source: { type: "generator", generatorId: "noise" },
  };
  const component = { id: "component-a", type: "chain", chain: [source] };
  renderer.state = {
    components: [component],
    render: {},
    ui: { selectedComponentId: component.id, selectedChainItemId: source.id },
  };
  renderer.presentationRuntime.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  renderer.mousePressed(10, 10);

  assert.equal(renderer.state.ui.selectedChainItemId, "");
  assert.deepEqual(selected, [""]);
});

test("one preview press selects a physical element and begins moving it", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const source = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const component = { id: "component-a", type: "chain", chain: [source] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: "" } };
  renderer.presentationRuntime.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  renderer.mousePressed(80, 40);

  assert.equal(renderer.state.ui.selectedChainItemId, source.id);
  assert.equal(renderer.previewInteraction.chainTransformDrag?.itemId, source.id);
  assert.equal(renderer.previewInteraction.chainTransformDrag?.mode, "boundary-move");
});

test("an already selected child inside a group owns the next preview drag", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const child = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const group = { id: "group-a", kind: "group", enabled: true, opacity: 1, transform: {}, chain: [child] };
  const component = { id: "component-a", type: "chain", chain: [group] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: child.id } };
  renderer.presentationRuntime.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  renderer.mousePressed(100, 50);
  renderer.mouseDragged(120, 50);

  assert.equal(renderer.state.ui.selectedChainItemId, child.id);
  assert.equal(renderer.previewInteraction.chainTransformDrag?.itemId, child.id);
  assert.equal(renderer.previewInteraction.chainTransformDrag?.mode, "boundary-move");
  assert.equal(renderer.state.components[0].chain[0].chain[0].boundary.x, 0.2);
  assert.deepEqual(child.transform, {}, "dragging does not mutate the store-owned fixture");
  assert.deepEqual(group.transform, {});
});

test("a selected Canvas Group cannot be picked outside the union of its placed children", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const childComponent = { id: "child-component", type: "chain", initialWidth: 100, initialHeight: 100, chain: [] };
  const child = {
    id: "child",
    kind: "source",
    enabled: true,
    opacity: 1,
    transform: {},
    source: { type: "component", componentId: childComponent.id, placement: { scale: 0.25 } },
  };
  const group = { id: "group", kind: "group", enabled: true, opacity: 1, transform: {}, chain: [child] };
  const canvas = { id: "canvas", type: "scene", canvas: { width: 400, height: 400 }, chain: [group] };
  renderer.state = {
    components: [canvas, childComponent],
    render: { canvasSize: { width: 400, height: 400 } },
    ui: { selectedComponentId: canvas.id, selectedChainItemId: group.id },
  };
  renderer.presentationRuntime.componentPreviewRect = () => ({ x: 0, y: 0, width: 400, height: 400 });

  assert.equal(renderer.previewInteraction.chainItemAtPoint(200, 200), group);
  assert.equal(renderer.previewInteraction.chainItemAtPoint(20, 20), null);
});

test("default Canvas Component references pick their placement instead of the whole Canvas", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const childComponent = { id: "child-component", type: "chain", frameShape: "landscape", chain: [] };
  const left = {
    id: "left",
    kind: "source",
    enabled: true,
    opacity: 1,
    transform: { x: -0.5, y: 0, scale: 1, rotation: 0 },
    source: { type: "component", componentId: childComponent.id, placement: { scale: 0.25 } },
  };
  const right = {
    id: "right",
    kind: "source",
    enabled: true,
    opacity: 1,
    transform: { x: 0.5, y: 0, scale: 1, rotation: 0 },
    source: { type: "component", componentId: childComponent.id, placement: { scale: 0.25 } },
  };
  const canvas = { id: "canvas", type: "scene", chain: [left, right] };
  renderer.state = {
    components: [canvas, childComponent],
    render: { sceneAspectRatio: 1, componentAspectRatio: 1 },
    ui: { selectedComponentId: canvas.id, selectedChainItemId: left.id },
  };
  renderer.presentationRuntime.componentPreviewRect = () => ({ x: 0, y: 0, width: 400, height: 400 });

  assert.equal(renderer.previewInteraction.chainItemAtPoint(100, 200), left);
  assert.equal(renderer.previewInteraction.chainItemAtPoint(300, 200), right);
  assert.equal(renderer.previewInteraction.chainItemAtPoint(20, 20), null);
});

test("child preview dragging is converted through its parent oriented boundary", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const child = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const group = { id: "group-a", kind: "group", enabled: true, opacity: 1, transform: {}, boundary: { x: 0, y: 0, width: 2, height: 2, rotation: Math.PI / 2 }, chain: [child] };
  const component = { id: "component-a", type: "chain", chain: [group] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: child.id } };
  renderer.presentationRuntime.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  renderer.mousePressed(100, 50);
  renderer.mouseDragged(120, 50);

  const renderedChild = renderer.state.components[0].chain[0].chain[0];
  assert.ok(Math.abs(renderedChild.boundary.x) < 1e-12);
  assert.equal(renderedChild.boundary.y, -0.2);
  assert.deepEqual(child.transform, {}, "nested dragging path-copies instead of mutating its source state");
  assert.deepEqual(group.boundary, { x: 0, y: 0, width: 2, height: 2, rotation: Math.PI / 2 });
});

test("releasing a direct element drag commits one undoable boundary change", () => {
  const changes = [];
  const renderer = new OutputRenderer({
    mode: "component",
    sendChainBoundary: (componentId, itemId, boundary, meta) => changes.push({ componentId, itemId, boundary, meta }),
  });
  const source = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const component = { id: "component-a", type: "chain", chain: [source] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: source.id } };
  renderer.presentationRuntime.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  renderer.mousePressed(100, 50);
  renderer.mouseDragged(120, 50);
  renderer.mouseReleased();

  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0].meta, { commit: false });
  assert.deepEqual(changes[1].meta, { commit: true });
  assert.deepEqual(changes[1].boundary, changes[0].boundary);
});

test("global time stretch changes output clock rate without changing its phase", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = {
    global: { playing: true, timeStretch: -1 },
    components: [{ id: "component-a", speed: 1 }],
  };
  renderer.frameRuntime.lastTickMs = 1000;

  renderer.frameRuntime.tickClock(1100);
  assert.equal(renderer.frameRuntime.visualTime, 0.05);
  assert.equal(renderer.frameRuntime.componentTimes.get("component-a"), 0.05);

  renderer.state.global.timeStretch = 1;
  renderer.frameRuntime.tickClock(1200);
  assert.equal(renderer.frameRuntime.visualTime, 0.25);
  assert.equal(renderer.frameRuntime.componentTimes.get("component-a"), 0.25);

  renderer.state.global.playing = false;
  renderer.frameRuntime.tickClock(1300);
  assert.equal(renderer.frameRuntime.visualTime, 0.25);
  assert.equal(renderer.frameRuntime.visualDeltaSeconds, 0);

  renderer.state.global = { playing: true };
  renderer.frameRuntime.tickClock(1400);
  assert.equal(renderer.frameRuntime.visualTime, 0.35);

  renderer.state.global.timeStretch = -4;
  renderer.frameRuntime.tickClock(1500);
  assert.equal(renderer.frameRuntime.visualTime, 0.35);
  assert.equal(renderer.frameRuntime.visualDeltaSeconds, 0);

  renderer.state.global.timeStretch = 4;
  renderer.frameRuntime.tickClock(1600);
  assert.ok(Math.abs(renderer.frameRuntime.visualTime - 1.95) < 1e-12);
});

test("camera capture settings map project preferences to the Portal camera contract", () => {
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 960, height: 540, mode: "preview", outputId: "" },
    camera: {
      facingMode: "environment",
      mirrored: true,
      maxResolution: true,
    },
  };
  assert.deepEqual(cameraCaptureSettings(render), {
    width: 960,
    height: 540,
    front: false,
    mirrored: true,
    maxResolution: true,
  });
  assert.equal(cameraSettingsSignature(render), "960x540:rear:mirror:max");
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

test("local surface mappings remain authoritative until their exact acknowledgement", () => {
  const renderer = new OutputRenderer({ mode: "preview" });
  const local = { surfaces: [{ id: "surface-main", corners: [{ x: 12, y: 18 }] }] };
  const stale = { surfaces: [{ id: "surface-main", corners: [{ x: 0, y: 0 }] }] };

  renderer.mappingRuntime.markLocal(local);
  assert.equal(renderer.mappingRuntime.shouldIgnoreIncoming(JSON.stringify(stale)), true);
  assert.equal(renderer.mappingRuntime.pendingMappingSignature, JSON.stringify(local));
  assert.equal(renderer.mappingRuntime.shouldIgnoreIncoming(JSON.stringify(local)), false);
  assert.equal(renderer.mappingRuntime.pendingMappingSignature, "");

  const source = readFileSync(new URL("../js/output/output-mapping-runtime.js", import.meta.url), "utf8");
  assert.ok(source.includes("if (previous.interactionActive && !mappingChanged) this.surfaceRebuildPending = true"));
  assert.ok(source.includes("this.rebuildSurfaces({ preferExistingMapping: true })"));
  assert.ok(source.includes("preferExistingMapping && existingProjectCorners?.length === 4"));
  assert.ok(!source.includes("localMappingProtectedUntil"));
});

test("an exact mapping echo acknowledges ownership while its drag is still active", () => {
  const renderer = new OutputRenderer({ mode: "preview" });
  const state = createInitialState();
  const local = {
    surfaces: state.surfaces.map((surface) => ({
      id: surface.id,
      name: surface.name,
      w: 100,
      h: 100,
      corners: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 110 }, { x: 10, y: 110 }],
    })),
  };
  state.mappingCalibration = local;
  state.mappings[0].calibration = structuredClone(local);
  renderer.state = structuredClone(state);
  renderer.mappingRuntime.mapper = {
    isActive: () => true,
    setCalibrate() {},
    setOverlayMode() {},
  };
  renderer.mappingRuntime.mappingSignature = renderer.mappingRuntime.currentSignature();
  renderer.mappingRuntime.markLocal(local);

  renderer.setState(state);

  assert.equal(renderer.mappingRuntime.pendingMappingSignature, "");
});

test("switching Mapping documents rebuilds retained handles even when IDs and calibration match", () => {
  const renderer = new OutputRenderer({ mode: "preview" });
  const surface = {
    id: "shared-surface-id",
    destination: { type: "mapped" },
  };
  renderer.state = {
    render: {},
    surfaces: [surface],
    mappingCalibration: {},
    ui: { selectedMappingId: "mapping-a" },
    global: {},
  };
  renderer.mappingRuntime.mapper = {
    isActive: () => true,
    setCalibrate() {},
    setOverlayMode() {},
  };
  renderer.mappingRuntime.mappingSignature = renderer.mappingRuntime.currentSignature();
  renderer.mappingRuntime.pendingMappingSignature = '{"surfaces":["mapping-a-local"]}';
  renderer.mappingRuntime.pendingMappingStartedAt = performance.now();
  const previous = renderer.mappingRuntime.captureState();
  const rebuilds = [];
  const applied = [];
  renderer.mappingRuntime.rebuildSurfaces = (options) => rebuilds.push(options);
  renderer.mappingRuntime.applyProject = (signature) => {
    applied.push(signature);
    renderer.mappingRuntime.mappingSignature = signature;
  };

  renderer.state = {
    ...renderer.state,
    surfaces: [{ ...surface }],
    ui: { selectedMappingId: "mapping-b" },
  };
  renderer.mappingRuntime.reconcileState(previous);

  assert.deepEqual(rebuilds, [{ preferExistingMapping: false }]);
  assert.deepEqual(applied, ["{}"]);
  assert.equal(renderer.mappingRuntime.pendingMappingSignature, "");
  assert.equal(renderer.mappingRuntime.surfaceRebuildPending, false);
});

test("standalone output permanently rejects calibration markers", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  let mapperCalibrating = true;
  renderer.state = { global: { calibrating: true } };
  renderer.mappingRuntime.mapper = {
    setCalibrate(value) {
      mapperCalibrating = value;
    },
    isCalibrating() {
      return mapperCalibrating;
    },
  };

  renderer.mappingRuntime.setCalibrate(true);

  assert.equal(renderer.state.global.calibrating, false);
  assert.equal(mapperCalibrating, false);
  assert.equal(renderer.mappingRuntime.isCalibrating(), false);
});

test("output diagnostics remain DOM-only and never add text to the GL surface path", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const metricsSource = readFileSync(new URL("../js/output/output-presentation-metrics.js", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");

  assert.equal(rendererSource.includes("renderOutputFrameOverlay"), false);
  assert.equal(rendererSource.includes("showLabels"), false);
  assert.ok(metricsSource.includes("this.resolutionLabel()"));
  assert.ok(appSource.includes('class="output-fps"'));
});

test("standalone output consumes its handshake baseline without requesting duplicate snapshots after setup", () => {
  const appSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");
  assert.ok(appSource.includes("await initialStateGate.ready;"));
  const importedFiles = appSource.indexOf("renderer.importFiles(acceptedFiles);");
  const compiledState = appSource.indexOf("await renderer.setup(", importedFiles);
  const initialStateStart = appSource.lastIndexOf("const initialState", importedFiles);
  const setupEnd = appSource.indexOf("\n  };", importedFiles);
  const initialActivation = appSource.slice(initialStateStart, compiledState);
  const setupTail = appSource.slice(importedFiles, setupEnd);

  assert.ok(importedFiles >= 0);
  assert.ok(initialStateStart >= 0);
  assert.ok(
    compiledState > importedFiles,
    "the Output must install its media baseline before compiling the activating state",
  );
  assert.match(
    initialActivation,
    /const initialState = pendingState;/,
    "the first activation must compile the prepared transport state just like every later activation",
  );
  assert.equal(
    initialActivation.includes("sanitizeState(pendingState)"),
    false,
    "Output must not rebuild authored mappings and discard Control's derived Live route bindings",
  );
  assert.ok(setupEnd > importedFiles);
  assert.equal(setupTail.includes("bridge?.requestState();"), false);
  assert.equal(setupTail.includes("bridge?.requestMediaFiles();"), false);
});

test("surface calibration keeps direct projection without materialized labels", () => {
  const renderer = new OutputRenderer({ mode: "preview" });
  renderer.state = {
    ui: { debugPreview: true },
    global: { showLabels: true },
  };
  renderer.mapper = { isCalibrating: () => true };

  assert.equal(renderer.surfaceRuntime.canDirectProjectSurfaceRoute({ surface: { finalShaderChain: [] } }), true);
  const source = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  assert.equal(source.includes("drawSurfaceLabel"), false);
});

test("standalone outputs crop the shared mapping world to their configured viewport", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const renderer = new OutputRenderer({ mode: "output", outputId: "right" });
  renderer.state = {
    render: {
      outputs: [
        { id: "left", name: "Left", aspectRatio: 16 / 9 },
        { id: "right", name: "Right", aspectRatio: 8 / 5 },
      ],
      hostViewport: { width: 1280, height: 800, mode: "output", outputId: "right" },
    },
  };
  globalThis.width = 1280;
  globalThis.height = 800;

  try {
    assert.deepEqual(renderer.presentationGeometry.outputFrameSize(), { width: 1280, height: 800 });
    const frames = outputFrames(renderer.presentationGeometry.mappingProjectRender());
    const selected = frames.find((frame) => frame.id === "right");
    assert.deepEqual(renderer.presentationGeometry.outputFrameOffset(), { x: selected.x, y: selected.y });
    const mapped = renderer.presentationGeometry.mappingForMode({
      surfaces: [{ id: "surface", corners: [
        { x: selected.x, y: selected.y },
        { x: selected.x + selected.width, y: selected.y },
        { x: selected.x + selected.width, y: selected.y + selected.height },
        { x: selected.x, y: selected.y + selected.height },
      ] }],
    });
    assertClose(mapped.surfaces[0].corners[0].x, 0);
    assertClose(mapped.surfaces[0].corners[0].y, 0);
    assertClose(mapped.surfaces[0].corners[2].x, 1280);
    assertClose(mapped.surfaces[0].corners[2].y, 800);
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("output fallback surfaces derive from the same world mapping as preview", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    outputs: [
      { id: "left", aspectRatio: 16 / 9 },
      { id: "right", aspectRatio: 8 / 5 },
    ],
    componentAspectRatio: 16 / 9,
    hostViewport: { width: 1280, height: 800, mode: "output", outputId: "right" },
  };
  const surface = { id: "mapped-surface", destination: { type: "mapped" } };
  const renderer = new OutputRenderer({ mode: "output", outputId: "right" });
  let added = null;
  renderer.state = {
    render,
    surfaces: [surface],
    mappings: { local: { surfaces: [] } },
  };
  renderer.mappingRuntime.mapper = {
    surfaces: [],
    clearSurfaces() {},
    addSurface(config) {
      added = config;
      return config;
    },
  };
  globalThis.width = 1280;
  globalThis.height = 800;

  try {
    renderer.mappingRuntime.rebuildSurfaces();
    const worldCorners = defaultProjectSurfaceMapping(renderer.presentationGeometry.mappingProjectRender(), [surface])[0].corners;
    assert.deepEqual(added.corners, worldCorners.map((corner) => renderer.presentationGeometry.worldPointToDisplay(corner)));
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
  const source = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const plannerSource = readFileSync(new URL("../js/libraries/composition-engine/surface-composition/index.js", import.meta.url), "utf8");
  assert.ok(source.includes("this.drawBufferedSurfaceTexture(target, route)"));
  assert.ok(source.includes("mapped.direct && Number(surface.feather) <= 0 && !viewUv"));
  assert.ok(plannerSource.includes("preserveFullFootprint: mapped.direct"));
});

test("covering a 3:2 component into a 5:3 output uses one centered crop", () => {
  const fitted = directFitRects(1360, 907, { x: 0, y: 0, width: 1272, height: 763 }, "cover");
  assert.deepEqual(fitted.destination, { x: 0, y: 0, width: 1272, height: 763 });
  assertClose(fitted.source.width / fitted.source.height, 1272 / 763);
  assertClose(fitted.source.x, 0);
  assertClose(fitted.source.y * 2 + fitted.source.height, 907);
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
  const source = readFileSync(new URL("../js/output/component-render-runtime.js", import.meta.url), "utf8");
  const lookup = source.slice(
    source.indexOf("    const stableGpuKey ="),
    source.indexOf("    const profile =")
  );

  assert.ok(lookup.includes("host.renderTargetRuntime.gpuTarget(stableGpuKey)"));
  assert.ok(lookup.includes("host.renderTargetRuntime.cpuTarget(stableGpuKey)"));
  assert.match(lookup, /host\.renderTargetRuntime\.touchGpu\(stableGpuKey\)/);
  assert.match(lookup, /host\.renderTargetRuntime\.touchCpu\(stableGpuKey\)/);
});

test("render-cache maintenance follows resource expiry or hard pressure instead of a frame cadence", () => {
  const stateRuntimeSource = readFileSync(new URL("../js/output/output-state-runtime.js", import.meta.url), "utf8");
  const frameRuntimeSource = readFileSync(new URL("../js/output/output-frame-runtime.js", import.meta.url), "utf8");
  const cacheSource = readFileSync(new URL("../js/libraries/cache-engine/render-cache/index.js", import.meta.url), "utf8");
  assert.match(cacheSource, /frameIndex < this\.nextIdlePruneFrame/);
  assert.match(cacheSource, /this\.gpuBufferUse\.size > COMPONENT_GPU_BUFFER_CACHE_LIMIT/);
  assert.match(cacheSource, /nextRenderCacheExpiry/);
  assert.match(stateRuntimeSource, /host\.frameRuntime\.pruneComponentTimes\(\);/);
  assert.doesNotMatch(frameRuntimeSource, /COMPONENT_TIME_MAINTENANCE_FRAMES/);
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

test("a nested regional Component allocates only its visible source fraction", () => {
  const request = componentReferenceRegionRequest({
    role: "texture",
    width: 3472,
    height: 3472,
    logicalWidth: 1500,
    logicalHeight: 1000,
    renderIdentity: "component-a",
  }, [0.25, 0.1, 0.5, 0.4], { reason: "test-region" });

  assert.equal(request.width, 1736);
  assert.equal(request.height, 1389);
  assert.equal(request.logicalWidth, 1500);
  assert.equal(request.logicalHeight, 1000);
  assert.equal(request.renderIdentity, "component-a");
  assert.equal(request.regionView, true);
  assert.deepEqual(request.uvRect, [0.25, 0.1, 0.5, 0.4]);
});

test("a visible nested-Component ROI is planned before the full-frame ceiling", () => {
  const render = { componentAspectRatio: 1.5, pixelDensity: 1 };
  const component = {
    id: "child",
    type: "chain",
    frameShape: "landscape",
    resolutionScale: 1,
  };
  const placement = { width: 12000, height: 8000 };
  const uvRect = [0.4, 0.4, 0.12, 0.09];
  const full = componentReferenceRenderRequest(render, component, placement);
  const croppedAfterCeiling = componentReferenceRegionRequest(full, uvRect);
  const visible = componentReferenceVisibleRenderRequest(render, component, placement, uvRect);

  assert.deepEqual(pickRequestSize(full), { width: 8192, height: 5461 });
  assert.deepEqual(pickRequestSize(croppedAfterCeiling), { width: 984, height: 492 });
  assert.deepEqual(pickRequestSize(visible), { width: 1440, height: 720 });
  assert.equal(visible.demandScale, 8);
  assert.equal(visible.regionView, true);
  assert.deepEqual(visible.uvRect, uvRect);
});

test("a full Scene request applies ROI to a heavily scaled nested Component", () => {
  const child = {
    id: "child",
    type: "chain",
    frameShape: "landscape",
    resolutionScale: 1,
    syncInstances: false,
    transform: {},
  };
  const parent = { id: "scene", type: "scene" };
  let childRequest = null;
  const runtime = new SourceRenderRuntime({
    state: {
      render: {
        sceneAspectRatio: 2,
        componentAspectRatio: 1.5,
        pixelDensity: 1,
      },
    },
    frameRuntime: { componentTimes: new Map() },
    componentProgramRuntime: {
      programs: new Map([[
        parent.id,
        {
          inspect: () => ({
            references: [{ kind: "component", id: child.id, path: "source.componentId" }],
          }),
        },
      ]]),
      componentForId: (id) => id === child.id ? child : null,
    },
    componentRenderRuntime: {
      render: (_component, _time, request) => {
        childRequest = request;
        return { width: request.width, height: request.height };
      },
    },
    renderTargetRuntime: {
      isShaderBuffer: () => false,
    },
  });
  runtime.componentRegionSafe = () => true;
  runtime.drawPlacedResultGeometry = () => {};

  runtime.drawComponentReferenceSource(
    { width: 1456, height: 728, push() {}, pop() {} },
    {
      type: "component",
      componentId: child.id,
      instanceId: "scaled-child",
      contentTransform: { scale: 8 },
      placement: { scale: 1 },
    },
    parent,
    0,
    { width: 1456, height: 728 },
  );

  assert.equal(childRequest.regionView, true);
  assert.equal(childRequest.reason, "component-reference-region");
  assert.deepEqual(pickRequestSize(childRequest), { width: 1472, height: 736 });
  assert.ok(childRequest.width < 2000, "the invisible scaled remainder must not allocate an 8K texture");

  childRequest = null;
  runtime.drawComponentReferenceSource(
    { width: 1456, height: 728, push() {}, pop() {} },
    {
      type: "component",
      componentId: child.id,
      instanceId: "fully-visible-child",
      contentTransform: { scale: 1 },
      placement: { scale: 0.5 },
    },
    parent,
    0,
    { width: 1456, height: 728 },
  );
  assert.notEqual(childRequest.regionView, true, "a fully visible child must retain stable full-request caching");
});

test("small repeated synchronized Component references converge on reusable resolution classes", () => {
  const render = { componentAspectRatio: 1, pixelDensity: 1 };
  const component = { id: "shared", type: "chain", frameShape: "square", syncInstances: true };
  const first = componentReferenceRenderRequest(render, component, { width: 300, height: 300 }, { sharedResolutionClass: true });
  const second = componentReferenceRenderRequest(render, component, { width: 320, height: 320 }, { sharedResolutionClass: true });

  assert.deepEqual(pickRequestSize(first), pickRequestSize(second));
  assert.ok(first.width >= 320 && first.width < 512);
  assert.equal(componentReferencePrefersSharedTexture(component, 5, first), true);
  assert.equal(componentReferencePrefersSharedTexture(component, 1, first), false);
  assert.equal(componentReferencePrefersSharedTexture({ ...component, syncInstances: false }, 5, first), false);
  assert.equal(componentReferencePrefersSharedTexture(component, 5, { width: 2048, height: 2048 }), false);
});

test("Component reference counting consumes compiled introspection and the renderer supplies its compiled program", () => {
  assert.equal(componentReferenceCount({
    inspect: () => ({
      references: [
        { kind: "component", id: "shared", path: "source.componentId" },
        { kind: "component", id: "shared", path: "source.componentId" },
        { kind: "component", id: "other", path: "source.componentId" },
      ],
    }),
  }, "shared"), 2);
  const source = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  assert.match(
    source,
    /componentReferenceCount\(\s*host\.componentProgramRuntime\.programs\.get\(component\.id\),\s*sourceComponent\.id,/,
    "nested Canvas rendering must query references through its compiled parent program",
  );
});

test("component post filters run after the upscale target", () => {
  const componentRenderSource = readFileSync(new URL("../js/output/component-render-runtime.js", import.meta.url), "utf8");
  const compositeSource = readFileSync(new URL("../js/output/composite-render-runtime.js", import.meta.url), "utf8");
  const pipelineSource = compositeSource.slice(
    compositeSource.indexOf("  renderComponentPipeline("),
    compositeSource.indexOf("  getPipelineShader(")
  );

  assert.ok(pipelineSource.indexOf('`${component.id}:upscale:') < pipelineSource.indexOf('`${component.id}:post:'));
  assert.ok(compositeSource.includes("COMPONENT_UPSCALE_FRAGMENT_SHADER"));
  assert.ok(compositeSource.includes("COMPONENT_POST_FRAGMENT_SHADER"));
  assert.match(pipelineSource, /shaderProgram\.setUniform\(\s*"noiseAmount"/);
  assert.match(pipelineSource, /shaderProgram\.setUniform\(\s*"grayscaleAmount"/);
  assert.ok(componentRenderSource.includes("host.compositeRuntime.renderComponentPipeline({"));
});

test("Live Component transform is placed by its parent instead of cropped into its own texture", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const presentationSource = readFileSync(new URL("../js/output/output-presentation-runtime.js", import.meta.url), "utf8");
  const componentRenderSource = readFileSync(new URL("../js/output/component-render-runtime.js", import.meta.url), "utf8");
  const sourceBackend = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const surfaceSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");

  assert.ok(componentRenderSource.includes("return host.compositeRuntime.renderComponentPipeline({"));
  assert.ok(!source.includes("renderComponentRootTransform("));
  assert.ok(presentationSource.includes("transform: component.transform"));
  assert.ok(sourceBackend.includes("combineContentTransforms("));
  assert.ok(sourceBackend.includes("source.contentTransform,"));
  assert.ok(sourceBackend.includes("dependency.transform,"));
  assert.ok(surfaceSource.includes("drawTransformedSampleRect("));
  assert.ok(surfaceSource.includes('surface.sourceFitActive ? surface.sourceFit : "stretch"'));
  assert.ok(surfaceSource.includes("isIdentityTransform(route.component?.transform)"));
});

test("output resize derives its backing geometry from the current host viewport", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 1920, height: 1080, mode: "output", outputId: "output-main" },
  };
  const renderer = new OutputRenderer({ mode: "output" });

  try {
    globalThis.width = 1920;
    globalThis.height = 1080;
    renderer.state = { render };

    assert.deepEqual(renderer.presentationGeometry.outputFrameSize(render), { width: 1920, height: 1080 });
    assert.deepEqual(renderer.presentationGeometry.displayCanvasSize(render), { width: 1920, height: 1080 });
    assert.deepEqual(renderer.presentationMetrics.resolutionSize(render), { width: 1920, height: 1080, density: 1 });
    assert.equal(renderer.presentationMetrics.resolutionLabel(render), "1920x1080");
    const projectFrame = outputFrameForId(renderer.presentationGeometry.mappingProjectRender(), "output-main");
    const topLeft = renderer.presentationGeometry.worldPointToDisplay({ x: projectFrame.x, y: projectFrame.y });
    const bottomRight = renderer.presentationGeometry.worldPointToDisplay({
      x: projectFrame.x + projectFrame.width,
      y: projectFrame.y + projectFrame.height,
    });
    assertClose(topLeft.x, 0);
    assertClose(topLeft.y, 0);
    assertClose(bottomRight.x, 1920);
    assertClose(bottomRight.y, 1080);
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("standalone Output presentation covers a mismatched window without non-uniform surface scaling", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 1200, height: 900, mode: "output", outputId: "output-main" },
  };
  const renderer = new OutputRenderer({ mode: "output", outputId: "output-main" });

  try {
    globalThis.width = 1200;
    globalThis.height = 900;
    renderer.state = { render };
    const transform = renderer.presentationGeometry.outputFrameTransform();
    const frame = outputFrames(renderer.presentationGeometry.mappingProjectRender())[0];
    assert.ok(Math.abs(transform.scale - (900 / frame.height)) < 1e-9);
    assert.ok(transform.x < 0);
    assert.ok(Math.abs(transform.y) < 1e-9);
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("stable and transition mapping shaders consume the shared fit operation", () => {
  const stable = mapperFragmentShaderSource();
  const transition = mapperTransitionFragmentShaderSource();
  assert.equal((stable.match(/vec3 vj1FitTargetUvToSourceUv\(/g) || []).length, 1);
  assert.equal((transition.match(/vec3 vj1FitTargetUvToSourceUv\(/g) || []).length, 1);
  assert.ok(stable.includes("projectionFit = vj1FitTargetUvToSourceUv"));
  assert.ok(transition.includes("fromProjectionFit = vj1FitTargetUvToSourceUv"));
  assert.ok(transition.includes("toProjectionFit = vj1FitTargetUvToSourceUv"));
});

test("standalone Output keeps relative Surface proportions across popup aspect changes", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const calibration = {
    coordinateSpace: "relative",
    surfaces: [{ id: "surface", corners: [
      { x: 0.1, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.7 },
      { x: 0.1, y: 0.7 },
    ] }],
  };
  const renderer = new OutputRenderer({ mode: "output", outputId: "output-main" });
  const aspectAt = (width, height) => {
    globalThis.width = width;
    globalThis.height = height;
    renderer.state = {
      render: {
        outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
        hostViewport: { width, height, mode: "output", outputId: "output-main" },
      },
      mappingCalibration: calibration,
    };
    const corners = renderer.presentationGeometry.projectSurfaceCorners("surface")
      .map((point) => renderer.presentationGeometry.worldPointToDisplay(point));
    return Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y)
      / Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
  };

  try {
    assertClose(aspectAt(1445, 855), aspectAt(1327, 204));
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("embedded Live retains Scene project-world geometry instead of covering its HTML host", () => {
  const renderer = new OutputRenderer({ mode: "live" });
  renderer.state = {
    render: {
      outputs: [{ id: "output-main", aspectRatio: 2 }],
      hostViewport: { width: 1000, height: 1000, mode: "preview", outputId: "" },
    },
  };

  assert.deepEqual(renderer.presentationGeometry.worldPointToDisplay({ x: 200, y: 300 }), { x: 200, y: 300 });
  assert.deepEqual(renderer.presentationGeometry.displayPointToWorld({ x: 200, y: 300 }), { x: 200, y: 300 });
});

test("hud render resolution reports GPU render pixels, not window size", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 1280, height: 720, mode: "output", outputId: "output-main" },
    pixelDensity: 1.5,
  };
  const renderer = new OutputRenderer({ mode: "output" });

  try {
    globalThis.width = 1280;
    globalThis.height = 720;
    renderer.state = { render };

    assert.deepEqual(renderer.presentationGeometry.displayCanvasSize(render), { width: 1280, height: 720 });
    assert.deepEqual(renderer.presentationMetrics.resolutionSize(render), { width: 1920, height: 1080, density: 1.5 });
    assert.equal(renderer.presentationMetrics.resolutionLabel(render), "1920x1080 @1.5x");
    assert.equal(renderer.presentationGeometry.pixelDensity({ pixelDensity: 4 }), 4);
    assert.deepEqual(renderer.presentationMetrics.resolutionSize({ ...render, pixelDensity: 4 }), {
      width: 5120,
      height: 2880,
      density: 4,
    });
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("Output HUD presents every authored render-chain allocation on its own line", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = {
    render: { outputs: [{ id: "output-main", aspectRatio: 16 / 9 }] },
  };
  renderer.componentRenderRuntime.lastResolutionTrace = [
    {
      componentId: "scene",
      itemId: "scene",
      kind: "scene",
      name: "Main Scene",
      width: 1920,
      height: 1080,
      depth: 0,
    },
    {
      componentId: "scene",
      itemId: "source",
      kind: "source",
      name: "Camera <A>",
      width: 960,
      height: 540,
      depth: 1,
    },
  ];

  const markup = renderer.presentationMetrics.outputChainMarkup(60);

  assert.match(markup, /60 fps/);
  assert.match(markup, /Main Scene/);
  assert.match(markup, /Camera &lt;A&gt;/);
  assert.match(markup, /1920x1080/);
  assert.match(markup, /960x540/);
  assert.equal((markup.match(/output-chain-row/g) || []).length, 2);
});

test("Preview diagnostics append the shared render-chain allocation list", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  renderer.state = {
    render: {
      outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
      hostViewport: { width: 640, height: 360, mode: "preview", outputId: "" },
    },
  };
  renderer.componentRenderRuntime.lastResolutionTrace = [
    {
      componentId: "component",
      itemId: "component",
      kind: "component",
      name: "Cow Component",
      width: 1280,
      height: 720,
      depth: 0,
    },
    {
      componentId: "component",
      itemId: "source",
      kind: "source",
      name: "brown-Guernsey-cow.webp",
      width: 960,
      height: 540,
      depth: 1,
    },
  ];

  const markup = renderer.presentationMetrics.previewDiagnosticMarkup(60);

  assert.match(markup, /preview-debug-line/);
  assert.match(markup, /Cow Component/);
  assert.match(markup, /brown-Guernsey-cow\.webp/);
  assert.match(markup, /1280x720/);
  assert.match(markup, /960x540/);
  assert.equal((markup.match(/output-chain-row/g) || []).length, 2);
});

test("cached Components replay their retained resolution trace without rerendering it", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  const component = { id: "component", name: "Component", type: "component" };
  const request = { width: 640, height: 360 };

  renderer.componentRenderRuntime.withResolutionTrace(component, "component-request", request, () => {
    renderer.componentRenderRuntime.recordResolution(component, {
      id: "source",
      name: "Source",
      source: { type: "generator" },
    }, "source", request);
  });

  renderer.profileRuntime.collectDetailed = true;
  renderer.componentRenderRuntime.activeResolutionTrace.length = 0;
  let rendered = 0;
  renderer.componentRenderRuntime.withResolutionTrace(component, "component-request", request, () => {
    renderer.componentRenderRuntime.useCachedResolutionTrace("component-request");
    rendered++;
  });

  assert.equal(rendered, 1);
  assert.deepEqual(
    renderer.componentRenderRuntime.activeResolutionTrace.map(({ kind, name, width, height }) => ({
      kind, name, width, height,
    })),
    [
      { kind: "component", name: "Component", width: 640, height: 360 },
      { kind: "source", name: "Source", width: 640, height: 360 },
    ],
  );
});

test("Good embedded preview reports its final render-chain request at 2x", () => {
  const renderer = new OutputRenderer({ mode: "live" });
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    pixelDensity: 1,
    previewRasterScale: 2,
  };
  renderer.state = { render };
  renderer.presentationGeometry.setViewport({ zoom: 1.25, x: 0, y: 0 });
  renderer.presentationMetrics.recordPresentedRequest({ width: 2000, height: 1000 });
  assert.deepEqual(renderer.presentationMetrics.resolutionSize(render), { width: 2000, height: 1000, density: 2 });
  assert.equal(renderer.presentationMetrics.resolutionLabel(render), "2000x1000 @2x");
  assert.equal(renderer.presentationGeometry.viewportLabel(), "1.25x view");
  const diagnostic = renderer.presentationMetrics.previewDiagnosticMarkup(60, {
    ...render,
    previewViewportZoom: 1.25,
    hostViewport: { width: 1000, height: 500 },
  });
  assert.match(diagnostic, /render 2000x1000 @2x/);
  assert.match(diagnostic, /1\.25x view/);
  assert.match(diagnostic, /p5 canvas/);
  assert.match(diagnostic, /windowWidth/);
  assert.match(diagnostic, /density param 1x/);
  assert.match(diagnostic, /p5 2x/);
});

test("preview viewport changes only retained p5 presentation state", () => {
  const renderer = new OutputRenderer({ mode: "live" });
  const state = {
    render: { previewViewportZoom: 1, previewViewportX: 0, previewViewportY: 0 },
    components: [{ id: "component", params: { opacity: 0.42 } }],
  };
  renderer.state = state;
  let invalidation = "";
  renderer.requestPresentationFrame = (reason) => {
    invalidation = reason;
  };

  assert.equal(renderer.presentationGeometry.setViewport({ zoom: 2, x: 15, y: -8 }), true);
  assert.strictEqual(renderer.state, state);
  assert.deepEqual(renderer.state.components[0].params, { opacity: 0.42 });
  assert.deepEqual(renderer.presentationGeometry.viewport, { zoom: 2, x: 15, y: -8 });
  assert.equal(invalidation, "preview-viewport");
});

test("terrain pass lowering retains one shared color and depth framebuffer", () => {
  const sourceRuntime = readFileSync(
    new URL("../js/output/source-render-runtime.js", import.meta.url),
    "utf8",
  );
  const planRuntime = readFileSync(
    new URL("../js/output/visual-plan-runtime.js", import.meta.url),
    "utf8",
  );
  assert.match(sourceRuntime, /renderFramebufferPassSequence\(/);
  assert.match(sourceRuntime, /createSharedFramebufferTarget\(/);
  assert.match(sourceRuntime, /operation\.framebufferSequence\?\.inputPort/);
  assert.match(planRuntime, /completedFramebufferSequences/);
  assert.match(planRuntime, /candidate\.framebufferSequence\?\.sequenceId/);
  return;
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
    const terrainLow = renderer.specializedSources.terrain.target(1000, 563, 0.5);
    assert.equal(terrainLow.__vj1SharedFramebuffer, true);
    assert.equal(terrainLow.pixelDensity(), 1);
    assert.equal(terrainLow.framebuffer.depth, true);
    assert.equal(renderer.specializedSources.model, undefined);

    renderer.state.render.pixelDensity = 1.5;
    const terrainHigh = renderer.specializedSources.terrain.target(1000, 563, 1.5);
    assert.equal(terrainHigh.__vj1PixelDensity, 1.5);
    assert.strictEqual(terrainHigh, terrainLow);

    const terrainResolved = renderer.specializedSources.terrain.target(500, 282, 1);
    assert.equal(terrainResolved.__vj1PixelDensity, 1);
    assert.strictEqual(terrainResolved, terrainLow);
    assert.equal(terrainResolved.framebuffer.resizeCount, 1);
    assert.equal(renderer.specializedSources.targets.targets.size, 1);
    assert.equal(framebuffers.length, 1);
    assert.equal(created.length, 0);
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

test("Terrain node helper and shader forks invalidate only their retained GPU resources", () => {
  const runtimeSource = readFileSync(new URL("../js/output/specialized/terrain-render-runtime.js", import.meta.url), "utf8");
  const terrainSource = readFileSync(new URL("../js/output/specialized/terrain-renderer.js", import.meta.url), "utf8");

  assert.match(runtimeSource, /const terrainModule = terrainNodeRuntimeModule\(operation\)/);
  assert.match(runtimeSource, /operation\?\.nodeCodeRevision\s*\|\|\s*operation\?\.nodeModuleRevision\s*\|\|\s*"legacy"/);
  assert.match(runtimeSource, /operation\?\.nodeShaderRevision\s*\|\|\s*operation\?\.nodeModuleRevision\s*\|\|\s*"legacy"/);
  assert.match(runtimeSource, /operation\?\.nodeShaderProgramRevisions\?\.surface\s*\|\|\s*shaderRevision/);
  assert.match(runtimeSource, /operation\?\.nodeShaderProgramRevisions\?\.wire\s*\|\|\s*shaderRevision/);
  assert.match(runtimeSource, /this\.drawSurface\([\s\S]*?terrainModule,\s*codeRevision,\s*nodeShaders,\s*surfaceShaderRevision,?\s*\);/);
  assert.match(runtimeSource, /this\.drawWire\([\s\S]*?terrainModule,\s*codeRevision,\s*nodeShaders,\s*wireShaderRevision,?\s*\);/);
  assert.match(terrainSource, /const sizeKey = `\$\{moduleRevision\}:\$\{widthCells\}:\$\{depthCells\}`/);
  assert.match(terrainSource, /const meshKey = `\$\{moduleRevision\}:\$\{widthCells\}:\$\{depthCells\}`/);
  assert.match(terrainSource, /resources\.shaderRevision !== shaderRevision/);
  assert.match(terrainSource, /nodeShaders\?\.\["terrain-surface-vertex"\]/);
  assert.match(terrainSource, /nodeShaders\?\.\["terrain-wire-vertex"\]/);
});

test("component thumbnails retain their aspect within the thumbnail bounds", () => {
  const source = readFileSync(new URL("../js/output/thumbnail-utils.js", import.meta.url), "utf8");

  assert.ok(source.includes("const COMPONENT_THUMBNAIL_WIDTH = 768;"));
  assert.ok(source.includes("const COMPONENT_THUMBNAIL_HEIGHT = 432;"));
  assert.ok(source.includes("const COMPONENT_THUMBNAIL_QUALITY = 0.92;"));
  assert.ok(source.includes('canvasToBlob(canvas, "image/webp", COMPONENT_THUMBNAIL_QUALITY)'));
  assert.ok(source.includes('canvasToBlob(canvas, "image/png")'));
  assert.deepEqual(fittedThumbnailSize(1920, 1080), { width: 768, height: 432 });
  assert.deepEqual(fittedThumbnailSize(1080, 1920), { width: 243, height: 432 });
  assert.deepEqual(fittedThumbnailSize(1000, 1000), { width: 432, height: 432 });
});

test("Scene Surface thumbnails crop the rendered Scene by authoritative Surface geometry", () => {
  const source = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");
  assert.ok(source.includes("component.scene?.surfaceThumbnails?.[surface.id]"));
  assert.ok(source.includes("sceneSurfaceCrop(output, state.surfaces, job.surfaceId)"));
  assert.ok(source.includes("job.surfaceId ? { surfaceId: job.surfaceId } : {}"));
  assert.ok(source.includes("const sample = boundedSampleRect(source, crop, sourceWidth, sourceHeight)"));
  assert.ok(source.includes("sample.x, sample.y, sample.width, sample.height"));
});

test("component thumbnails downsample on the GPU before a small readback", () => {
  const source = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");
  assert.ok(source.includes("const needsComponentThumbnail = !component.thumbnail || this.signatures.get(component.id) !== signature;"));
  assert.ok(source.includes("const size = fittedThumbnailSize(sampleWidth, sampleHeight);"));
  assert.ok(source.includes("return target.get();"));
  assert.doesNotMatch(source, /\boutput\.get\(/);
  assert.ok(source.includes("this.pending.set(job.key, { ...job, generation: ++this.generation })"));
  assert.ok(source.includes("requestIdleCallback"));
});

test("sampled shader work retains its owning Component for deep performance links", () => {
  const shaderSource = readFileSync(new URL("../js/output/shader-effect-runtime.js", import.meta.url), "utf8");
  const profileSource = readFileSync(new URL("../js/output/output-render-profile.js", import.meta.url), "utf8");
  assert.ok(profileSource.includes("this.componentContext.push(meta)"));
  assert.ok(profileSource.includes("this.componentContext.pop()"));
  assert.ok(shaderSource.includes("...profile.activeComponentIdentity()"));
});

test("thumbnail capture is blocked while live preview rendering is disabled", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  assert.ok(rendererSource.includes("if (!this.canCapture() || this.shouldUseThumbnailPreview()) return true;"));
  assert.ok(previewSource.includes("store.isDebugPreviewEnabled()"));
  assert.ok(previewSource.includes("if (!debugPreviewEnabled) return false;"));
});

test("paused previews contain thumbnails and canvas surface routes preserve sampling", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const presentationSource = readFileSync(new URL("../js/output/output-presentation-runtime.js", import.meta.url), "utf8");
  const surfaceSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const source = `${rendererSource}\n${presentationSource}\n${surfaceSource}`;
  assert.ok(source.includes("const rect = this.componentPreviewRect(component);"));
  assert.match(source, /sceneEditorWorld:\s*host\.mode === "component" &&\s*host\.state\?\.ui\?\.workspace === "scene"/);
  assert.ok(source.includes("thumbnail.img,"));
  assert.ok(source.includes('surface.sourceFitActive ? surface.sourceFit : "stretch"'));
  assert.ok(source.includes("drawBufferedSurfaceTexture(texture, route = {})"));
  assert.ok(source.includes("textureViewUv: viewUv"));
  assert.ok(source.includes("opacity: surfaceRouteOpacity(route)"));
});

test("thumbnail preview uses the authoritative Scene snapshot without component reconstruction", () => {
  const stateRuntimeSource = readFileSync(new URL("../js/output/output-state-runtime.js", import.meta.url), "utf8");
  const source = readFileSync(new URL("../js/output/output-presentation-runtime.js", import.meta.url), "utf8");

  assert.ok(stateRuntimeSource.includes("host.thumbnailRuntime.captureEditTransformBaselines()"));
  assert.ok(source.includes("renderSceneThumbnailSnapshotPreview(component)"));
  assert.doesNotMatch(source, /renderSceneThumbnailEditPreview\(/);
  assert.ok(source.includes("component?.type !== \"scene\""));
  assert.ok(source.includes("host.previewInteraction.renderSelectedChainTransformOverlay();"));
  assert.ok(source.includes("if (this.shouldUseThumbnailPreview()) this.renderThumbnailComponents();"));
  assert.ok(source.includes("const rect = this.componentPreviewRect(component);"));
  assert.ok(source.includes("withScreenScissor(rect"));
  assert.match(source, /drawImageCoverCrop\(\s*thumbnail\.img/);
});

test("Scene rendering evaluates ordinary sources, Groups, effects, and compiled Surface routes", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const visualPlanSource = readFileSync(new URL("../js/output/visual-plan-runtime.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/output/component-program-runtime.js", import.meta.url), "utf8");
  const componentRenderSource = readFileSync(new URL("../js/output/component-render-runtime.js", import.meta.url), "utf8");
  const surfaceRuntimeSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const plannerSource = readFileSync(new URL("../js/libraries/composition-engine/surface-composition/index.js", import.meta.url), "utf8");
  const compiledRenderer = componentRenderSource.slice(
    componentRenderSource.indexOf("  executeCompiled("),
    componentRenderSource.indexOf("  withResolutionTrace(")
  );
  assert.doesNotMatch(source, /^  renderComponentChainState\(/m);
  assert.match(visualPlanSource, /^  renderChainState\(/m);
  assert.ok(visualPlanSource.includes("externalInputStates,"));
  assert.ok(visualPlanSource.includes("host.sourceRuntime.renderDirectNodeState("));
  assert.ok(visualPlanSource.includes("host.compositeRuntime.renderLayerNodeState("));
  assert.ok(visualPlanSource.includes("host.compositeRuntime.renderBoundedLayerNodeState("));
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  assert.ok(sourceRuntime.includes("output.tint(255, 255 * clamp01(layer.opacity ?? 1))"));
  assert.ok(sourceRuntime.includes("applyBlend(output, layer.blend)"));
  assert.ok(sourceRuntime.includes('source.type === "component"'));
  assert.ok(surfaceRuntimeSource.includes("renderer.componentProgramRuntime.resolveRouteSourceNode(surface)"));
  assert.ok(programSource.includes("sceneSourceNodes(state || {}, { includeSystem: true })"));
  assert.ok(programSource.includes("resolveRouteSourceNode(surface = {})"));
  assert.ok(plannerSource.includes("resolveRouteSourceNode(storedSurface)"));
  assert.ok(!source.includes('item.role === "canvas-layer"'));
  assert.match(compiledRenderer, /program\.execute\(\s*host,\s*component/);
  assert.ok(compiledRenderer.includes("VJ1_COMPONENT_PROGRAM_MISSING"));
  assert.ok(!compiledRenderer.includes("component.chain"));
  assert.ok(!compiledRenderer.includes('item.kind === "source"'));
  assert.doesNotMatch(source, /\bcompileComponentPatch\b/);
  assert.doesNotMatch(source, /\brenderComponentPatch\b/);
  assert.doesNotMatch(source, /\blegacyChainItemsAreFrameDynamic\b/);
});

test("effect quality requests remain owned by the effect path", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const effectSource = readFileSync(new URL("../js/output/shader-effect-runtime.js", import.meta.url), "utf8");
  const directSourcePath = sourceRuntime.slice(
    sourceRuntime.indexOf("  renderDirectNodeState("),
    sourceRuntime.indexOf("  drawPlacedSourceResult("),
  );
  const effectPath = effectSource.slice(
    effectSource.indexOf("  renderNodeState("),
    effectSource.indexOf("  renderRunNodeState("),
  );

  assert.doesNotMatch(directSourcePath, /\bqualityRequest\b/);
  assert.doesNotMatch(directSourcePath, /qualityScaledRenderRequest\(evaluationRequest,\s*params\)/);
  assert.match(effectPath, /const qualityRequest = qualityScaledRenderRequest\(\s*evaluationRequest,\s*params,\s*\);/);
  assert.match(effectPath, /host\.componentRenderRuntime\.recordResolution\(\s*null,\s*item,\s*"effect",\s*qualityRequest,\s*\)/);
  assert.ok(
    effectPath.indexOf("const qualityRequest =") < effectPath.indexOf("host.renderEvaluationRuntime.evaluate("),
    "the quality request must exist before the effect evaluation callback closes over it",
  );
  assert.doesNotMatch(
    rendererSource,
    /^  (?:renderEffectNodeState|renderEffectRunNodeState|effectPassIsFrameDynamic)\(/m,
    "effect evaluation belongs to ShaderEffectRuntime rather than the renderer facade",
  );
});

test("stable compiled presentations suspend until a graph or media invalidation wakes them", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const outputSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");
  const renderer = new OutputRenderer({ mode: "component" });
  const component = { id: "empty-component" };
  renderer.state = {
    ui: { selectedComponentId: component.id, debugPreview: true },
    components: [component],
  };
  renderer.componentProgramRuntime.programs = new Map([[component.id, {}]]);
  renderer.sourceRuntime.componentContainsVideo = () => false;
  renderer.componentRenderRuntime.isFrameDynamic = () => false;

  assert.equal(renderer.frameRuntime.presentationMode(), "on-change");
  renderer.sourceRuntime.componentContainsVideo = () => true;
  assert.equal(renderer.frameRuntime.presentationMode(), "continuous", "active video graphs use the presentation clock rather than decoder callbacks");
  renderer.state.global = { playing: false };
  assert.equal(renderer.frameRuntime.isPlaybackActive(), false);
  assert.equal(renderer.frameRuntime.presentationMode(), "on-change", "paused Preview graphs suspend even when they contain video");
  renderer.state.global.playing = true;
  renderer.sourceRuntime.componentContainsVideo = () => false;
  renderer.componentRenderRuntime.isFrameDynamic = () => true;
  assert.equal(renderer.frameRuntime.presentationMode(), "continuous");
  renderer.componentRenderRuntime.isFrameDynamic = () => false;
  renderer.mode = "output";
  renderer.state.surfaces = [{ enabled: true, componentId: component.id }];
  assert.equal(renderer.frameRuntime.presentationMode(), "on-change", "stable mapped Outputs use the same policy");
  renderer.state.global.playing = false;
  assert.equal(renderer.frameRuntime.isPlaybackActive(), false, "Output and Preview modes consume the same playback state");
  const frameRuntimeSource = readFileSync(new URL("../js/output/output-frame-runtime.js", import.meta.url), "utf8");
  assert.ok(frameRuntimeSource.includes("presentationMode()"));
  assert.ok(frameRuntimeSource.includes("host.sourceRuntime.componentContainsVideo(component)"));
  assert.ok(frameRuntimeSource.includes("Decoder callbacks identify new media revisions, but they are not a"));
  assert.ok(previewSource.includes("suspendStablePreviewPresentation()"));
  assert.ok(previewSource.includes('renderer?.frameRuntime.presentationMode() !== "on-change"'));
  assert.ok(previewSource.includes("wakePreviewPresentation();"));
  assert.ok(previewSource.includes("idleSuspended = true;"));
  assert.ok(previewSource.includes("noLoop();"));
  assert.ok(outputSource.includes("suspendStableOutputPresentation()"));
  assert.ok(outputSource.includes("wakeOutputPresentation()"));
});

test("Scene Surface routes declare crop demand without changing uncropped Scene routes", () => {
  const render = { sceneAspectRatio: 16 / 9 };
  const scene = { type: "scene" };
  const surface = { id: "surface-a", sceneCrop: true, x: 0.1, y: 0.2, width: 0.25, height: 0.25 };
  const surfaceView = componentSourceView(render, scene, surface);
  const wholeView = componentSourceView(render, scene, {});
  assert.equal(surfaceView.samplingScale, 1);
  assert.equal(
    componentSourceView(render, { ...scene, transform: { scale: 8 } }, surface).samplingScale,
    surfaceView.samplingScale,
    "Scene root Content scale does not multiply routed texture demand",
  );
  assertClose(surfaceView.sampleRect.x, surfaceView.logicalSize.width * 0.1);
  assertClose(surfaceView.sampleRect.y, surfaceView.logicalSize.height * 0.2);
  assertClose(surfaceView.sampleRect.width, surfaceView.logicalSize.width * 0.25);
  assertClose(surfaceView.sampleRect.height, surfaceView.logicalSize.height * 0.25);
  assert.equal(wholeView.samplingScale, 1);
  assert.deepEqual(wholeView.sampleRect, { x: 0, y: 0, ...wholeView.logicalSize });

  const reducedSurfaceView = componentSourceView(
    { ...render, sampling: { surfaceDetailScale: 0.5 } },
    scene,
    surface
  );
  assert.equal(reducedSurfaceView.samplingScale, 0.5);
});

test("multiple Scene Surface crops share one parent Canvas texture request", () => {
  const component = { id: "canvas-a", type: "scene" };
  const sourceView = {
    logicalSize: { width: 3840, height: 2160 },
    maxRasterSize: { width: 3840, height: 2160 },
  };
  const requests = sharedComponentRenderRequests([
    { component, sourceView, demand: { rasterScale: 0.25 } },
    { component, sourceView, demand: { rasterScale: 0.5 } },
  ], "to:");

  assert.equal(requests.size, 1);
  assert.deepEqual(pickRequestSize(requests.get("canvas-a")), { width: 1920, height: 1080 });
  assert.equal(requests.get("canvas-a").renderIdentity, "to:canvas-a");
  assert.equal(requests.get("canvas-a").demandScale, 0.5);
});

test("component instance sync controls surface render sharing without changing component ids", () => {
  const synced = { id: "component-a", syncInstances: true };
  assert.equal(componentRenderInstanceKey(synced, "surface-a"), "component-a");
  assert.equal(componentRenderInstanceKey(synced, "surface-b"), "component-a");
  assert.equal(componentInstanceTime(synced, 12, "surface-a"), 12);

  const independent = { id: "component-a", syncInstances: false };
  const firstKey = componentRenderInstanceKey(independent, "surface-a");
  const secondKey = componentRenderInstanceKey(independent, "surface-b");
  assert.equal(independent.id, "component-a");
  assert.notEqual(firstKey, secondKey);
  assert.notEqual(componentInstanceTime(independent, 12, "surface-a"), componentInstanceTime(independent, 12, "surface-b"));

  const sourceView = {
    logicalSize: { width: 640, height: 360 },
    maxRasterSize: { width: 640, height: 360 },
  };
  const requests = sharedComponentRenderRequests([
    { component: independent, surface: { id: "surface-a" }, sourceView, demand: { rasterScale: 1 } },
    { component: independent, surface: { id: "surface-b" }, sourceView, demand: { rasterScale: 1 } },
  ]);
  assert.equal(requests.size, 2);
  assert.ok(requests.has(firstKey));
  assert.ok(requests.has(secondKey));
});

test("Canvas frame fanout retains ROI only when nested component placements can be shared", () => {
  const independent = { id: "component-a", type: "chain", syncInstances: false, chain: [] };
  const synced = { id: "component-b", type: "chain", syncInstances: true, chain: [] };
  const canvas = {
    id: "canvas-a",
    type: "scene",
    chain: [
      { id: "source-a", kind: "source", source: { type: "component", componentId: independent.id } },
    ],
  };
  const renderer = new OutputRenderer({});
  renderer.state = { components: [canvas, independent, synced] };
  renderer.componentProgramRuntime.programs = new Map([
    [canvas.id, { inspect: () => ({ dependencies: { components: [canvas.chain[0].source.componentId] } }) }],
    [independent.id, { inspect: () => ({ dependencies: { components: [] } }) }],
    [synced.id, { inspect: () => ({ dependencies: { components: [] } }) }],
  ]);

  assert.equal(renderer.sourceRuntime.sceneComponentFrameFanoutSafe(canvas), false);
  canvas.chain[0].source.componentId = synced.id;
  assert.equal(renderer.sourceRuntime.sceneComponentFrameFanoutSafe(canvas), true);
});

test("Surface route lookup indexes Components and explicit source nodes once per state", () => {
  const renderer = new OutputRenderer({});
  renderer.state = {
    components: [
      { id: "scene-a", type: "scene", name: "Scene A", scene: {} },
    ],
  };
  renderer.componentProgramRuntime.rebuildLookups();

  const node = renderer.componentProgramRuntime.resolveRouteSourceNode({
    sourceNodeId: "component:scene-a",
    componentId: "scene-a",
  });
  assert.equal(renderer.componentProgramRuntime.componentById.get("scene-a").type, "scene");
  assert.equal(node.componentId, "scene-a");
  assert.equal(renderer.componentProgramRuntime.resolveRouteSourceNode({
    sourceNodeId: "component:vj1-system-mapping-test-pattern",
    componentId: "vj1-system-mapping-test-pattern",
    outputFrameId: "",
  })?.componentId, "vj1-system-mapping-test-pattern");
  assert.equal(renderer.componentProgramRuntime.componentById.get("vj1-system-mapping-test-pattern")?.runtimeSource, true);
  assert.equal(renderer.componentProgramRuntime.resolveRouteSourceNode({ sourceNodeId: "", componentId: "", outputFrameId: "" }), null);
  assert.equal(renderer.componentProgramRuntime.resolveRouteSourceNode({ sourceNodeId: "missing", componentId: "", outputFrameId: "" }), null);
});

test("runtime visual sources compile through the ordinary retained Component program", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = {
    components: [],
    nodes: { groups: [] },
    surfaces: [{ enabled: true, componentId: MAPPING_TEST_PATTERN_COMPONENT_ID }],
    ui: {},
  };

  renderer.componentProgramRuntime.rebuild();
  renderer.componentProgramRuntime.rebuildLookups();

  assert.equal(renderer.componentProgramRuntime.programs.has(MAPPING_TEST_PATTERN_COMPONENT_ID), true);
  assert.equal(renderer.componentProgramRuntime.componentById.get(MAPPING_TEST_PATTERN_COMPONENT_ID)?.runtimeSource, true);
  let sourceOperation = null;
  renderer.componentProgramRuntime.programs
    .get(MAPPING_TEST_PATTERN_COMPONENT_ID)
    ?.forEachOperation((operation) => {
      if (operation.opcode === "source") sourceOperation = operation;
    });
  assert.equal(
    sourceOperation?.configuration?.source?.generatorId,
    "testPattern",
  );
});

test("Canvas demand is capped to logical size by default and can opt into supersampling", () => {
  assert.deepEqual(sceneMaxRasterSize({ pixelDensity: 1 }, { width: 4000, height: 2000 }), {
    width: 4000,
    height: 2000,
  });
  assert.deepEqual(sceneMaxRasterSize({ pixelDensity: 2 }, { width: 4000, height: 2000 }), {
    width: 4000,
    height: 2000,
  });
  assert.deepEqual(sceneMaxRasterSize({
    pixelDensity: 2,
    sampling: { limitSceneToLogicalSize: false },
  }, { width: 4000, height: 2000 }), {
    width: 8000,
    height: 4000,
  });
  assert.deepEqual(sceneMaxRasterSize({
    pixelDensity: 2,
    sampling: { limitSceneToLogicalSize: false },
  }, { width: 5000, height: 5000 }), {
    width: 8192,
    height: 8192,
  });
});

test("Component initial dimensions define geometry without capping adaptive render demand", () => {
  const render = { componentAspectRatio: 2, pixelDensity: 1 };
  const component = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const view = componentSourceView(render, component);
  assert.deepEqual(view.logicalSize, { width: 2000, height: 1000 });
  assert.deepEqual(view.maxRasterSize, { width: 8192, height: 4096 });
  assert.deepEqual(componentAdaptiveRasterLimit(view.logicalSize), view.maxRasterSize);
  assert.equal(
    componentSourceView(render, { ...component, transform: { scale: 8 } }).samplingScale,
    view.samplingScale,
    "root Content scale is not a component texture-resolution multiplier",
  );
  assert.deepEqual(
    pickRequestSize(componentReferenceRenderRequest(render, component, { width: 3000, height: 1500 })),
    { width: 3008, height: 1504 }
  );
});

test("Component preview raster follows visible demand instead of its initial dimensions", () => {
  const render = { componentAspectRatio: 2, pixelDensity: 1 };
  const component = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  assert.deepEqual(
    pickRequestSize(componentPreviewRenderRequest(render, component, 800, 600, 1)),
    { width: 800, height: 400 }
  );
});

test("Component preview geometry is independent from pixel density and raster dimensions", () => {
  const component = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const lowDensity = componentLogicalPreviewRect(
    { componentAspectRatio: 1.5, pixelDensity: 0.5 },
    component,
    900,
    700
  );
  const highDensity = componentLogicalPreviewRect(
    { componentAspectRatio: 1.5, pixelDensity: 2 },
    component,
    900,
    700
  );
  assert.deepEqual(lowDensity, highDensity);
  assert.deepEqual(highDensity, { x: 0, y: 50, width: 900, height: 600 });
});

test("Scene editor world leaves a stable margin around edge-aligned Frames", () => {
  const render = { sceneAspectRatio: 16 / 9, pixelDensity: 2 };
  const ordinary = componentLogicalPreviewRect(render, { type: "scene" }, 1000, 700);
  const editor = componentLogicalPreviewRect(render, { type: "scene" }, 1000, 700, { sceneEditorWorld: true });
  assert.ok(Math.abs(ordinary.x) < 1e-9);
  assert.ok(Math.abs(ordinary.y - 68.75) < 1e-9);
  assert.ok(Math.abs(ordinary.width - 1000) < 1e-9);
  assert.ok(Math.abs(ordinary.height - 562.5) < 1e-9);
  assert.ok(Math.abs(editor.x - 250) < 1e-9);
  assert.ok(Math.abs(editor.y - 209.375) < 1e-9);
  assert.ok(Math.abs(editor.width - 500) < 1e-9);
  assert.ok(Math.abs(editor.height - 281.25) < 1e-9);
});

test("Scene Surfaces move within bounds and corner resize changes both dimensions independently", () => {
  const moved = moveSurfaceRect({ x: 100, y: 100, width: 400, height: 200 }, 900, 900, 1200, 800);
  assert.deepEqual(moved, { x: 800, y: 600, width: 400, height: 200 });

  const resized = resizeSurfaceRect(
    { x: 100, y: 100, width: 400, height: 200 },
    "se",
    200,
    20,
    1200,
    800
  );
  assert.deepEqual(resized, { x: 100, y: 100, width: 600, height: 220 });

  const northwest = resizeSurfaceRect(
    { x: 100, y: 100, width: 400, height: 200 },
    "nw",
    -200,
    -300,
    1200,
    800
  );
  assert.deepEqual(northwest, { x: 0, y: 0, width: 500, height: 300 });
});

test("proportion-locked Frames scale from corners without changing their aspect", () => {
  const original = { x: 0.1, y: 0.2, width: 0.4, height: 0.2 };
  const resized = resizeSurfaceRect(original, "se", 0.2, 0.02, 1, 1, { keepProportions: true });
  assert.equal(resized.x, original.x);
  assert.equal(resized.y, original.y);
  assert.ok(resized.width > original.width);
  assert.ok(Math.abs(resized.width / resized.height - original.width / original.height) < 1e-9);
});

test("Scene Surfaces drag only from their border so the interior passes through", () => {
  const frame = { x: 100, y: 100, width: 400, height: 200 };
  assert.equal(surfaceBorderHit(frame, 102, 180), true);
  assert.equal(surfaceBorderHit(frame, 300, 296), true);
  assert.equal(surfaceBorderHit(frame, 300, 200), false);
  assert.equal(surfaceBorderHit(frame, 50, 200), false);
});

test("Canvas component placements use a stable normalized footprint", () => {
  assert.deepEqual(
    sceneComponentPlacementRect(
      { width: 3840, height: 2160 },
      { baseWidth: 1080, baseHeight: 1920, width: 540, height: 960 },
      {},
      { scale: 1080 / 3840 }
    ),
    { x: 1380, y: 120, width: 1080, height: 1920 }
  );
  assert.deepEqual(
    sceneComponentPlacementRect(
      { width: 3840, height: 2160 },
      { baseWidth: 1920, baseHeight: 1080 },
      { width: 960, height: 540 },
      { scale: 1920 / 3840 }
    ),
    { x: 240, y: 135, width: 480, height: 270 }
  );
});

test("Canvas Component placement is independent from raster-density changes", () => {
  const canvas = { type: "scene" };
  const child = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const placement = { scale: 0.325 };
  const target = { width: 1000, height: 500 };
  const low = componentReferencePlacement(
    canvas,
    child,
    { sceneAspectRatio: 2, componentAspectRatio: 1.3, pixelDensity: 0.5 },
    target,
    placement
  );
  const high = componentReferencePlacement(
    canvas,
    child,
    { sceneAspectRatio: 2, componentAspectRatio: 1.3, pixelDensity: 2 },
    target,
    placement
  );
  assert.deepEqual(high, low);
  assert.deepEqual(low, { x: 338, y: 125, width: 325, height: 250 });
});

test("Canvas placement follows changed Component aspect without stretching its old dimensions", () => {
  const canvas = { type: "scene" };
  const child = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const target = { width: 1000, height: 500 };
  const placement = { scale: 0.325 };
  const original = componentReferencePlacement(
    canvas,
    child,
    { sceneAspectRatio: 2, componentAspectRatio: 1.3, pixelDensity: 1 },
    target,
    placement
  );
  const wider = componentReferencePlacement(
    canvas,
    child,
    { sceneAspectRatio: 2, componentAspectRatio: 2, pixelDensity: 1 },
    target,
    placement
  );
  assert.equal(wider.width, original.width);
  assert.equal(wider.height, Math.round(wider.width / 2));
  assert.ok(wider.height < original.height);
});

test("Scene allocation aspect cannot override an embedded Component proportion", () => {
  const scene = { type: "scene" };
  const render = { sceneAspectRatio: 16 / 9, componentAspectRatio: 16 / 9, pixelDensity: 1 };
  const landscape = componentReferencePlacement(
    scene,
    { type: "chain", frameShape: "landscape" },
    render,
    { width: 900, height: 900 },
    { scale: 0.5 }
  );
  const portrait = componentReferencePlacement(
    scene,
    { type: "chain", frameShape: "portrait" },
    render,
    { width: 900, height: 900 },
    { scale: 0.5 }
  );
  const square = componentReferencePlacement(
    scene,
    { type: "chain", frameShape: "square" },
    render,
    { width: 900, height: 900 },
    { scale: 0.5 }
  );

  assertClose(landscape.width / landscape.height, 16 / 9, 0.01);
  assertClose(portrait.height / portrait.width, 16 / 9, 0.01);
  assert.equal(square.width, square.height);
});

test("nested components inherit physical demand from their placement for every parent type", () => {
  const render = { sceneAspectRatio: 10 / 7, componentAspectRatio: 10 / 7, pixelDensity: 1 };
  const child = { id: "child", type: "chain", frameShape: "landscape", resolutionScale: 2 };
  const canvasParent = { type: "scene" };
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
  assertClose(request.logicalWidth / request.logicalHeight, 10 / 7);
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
  renderer.state = {
    components: [dependency],
    media: [
      { id: "image", type: "image" },
      { id: "logo.svg", type: "image" },
      { id: "video", type: "video" },
    ],
  };
  renderer.media.set("image", { image: { width: 640, height: 360 } });
  renderer.media.set("logo.svg", { image: { width: 640, height: 360 } });

  const reference = { kind: "source", source: { type: "component", componentId: dependency.id } };
  assert.equal(renderer.sourceRuntime.canDirectComposite(reference), true);
  assert.equal(renderer.sourceRuntime.canDirectComposite({ ...reference, blend: "overlay" }), false);
  assert.equal(directPlacementKind({
    source: { type: "generator" },
    drawableResourceDrawable: true,
  }), "drawable-resource");
  assert.equal(directPlacementKind({
    source: { type: "generator" },
    drawableResourceDrawable: true,
    drawableResourceRequiresRetainedFrame: true,
  }), "");
  assert.equal(directPlacementKind({ source: { type: "generator" } }), "");

  const directPlacement = {
    kind: "drawable-resource",
    input: "resource",
    fitParameter: "fit",
    mirrorParameter: "mirrored",
    retainProjectVideoFrame: true,
  };
  const projectImageOperation = {
    directPlacement,
    runtimeValueInputs: new Map([["resource", {
      kind: "project-media-resource",
      mediaId: "image",
      ready: true,
    }]]),
  };
  const projectImage = {
    kind: "source",
    source: {
      type: "generator",
      generatorId: "mediaImage",
      params: { fit: "cover", mirrored: false },
    },
  };
  assert.equal(
    renderer.sourceRuntime.canDirectComposite(
      projectImage,
      { width: 640, height: 360 },
      projectImageOperation,
      { speed: 1 },
    ),
    true,
    "a declared typed-media placement eliminates the intermediate source target",
  );
  assert.equal(
    renderer.sourceRuntime.canDirectComposite(
      projectImage,
      nodeRoiRequest(
        { width: 640, height: 360 },
        { x: 0.75, y: 0, width: 1, height: 1 },
      ),
      projectImageOperation,
      { speed: 1 },
    ),
    false,
    "a cropped media ROI uses the render-view-aware retained path instead of fitting into the ROI allocation",
  );
  assert.equal(
    renderer.sourceRuntime.canDirectComposite(
      projectImage,
      nodeRoiRequest(
        { width: 640, height: 360 },
        { x: -0.75, y: 0, width: 1, height: 1 },
      ),
      {
        ...projectImageOperation,
        runtimeValueInputs: new Map([["resource", {
          kind: "project-media-resource",
          mediaId: "logo.svg",
          ready: true,
        }]]),
      },
      { speed: 1 },
    ),
    false,
    "SVG uses the same full-boundary retained crop contract as raster media",
  );
  assert.equal(
    renderer.sourceRuntime.canDirectComposite(
      {
        ...projectImage,
        source: {
          ...projectImage.source,
          params: { fit: "cover", mirrored: true },
        },
      },
      { width: 640, height: 360 },
      projectImageOperation,
      { speed: 1 },
    ),
    false,
    "mirroring stays in the ordinary node process until placed geometry declares reflection",
  );
  assert.equal(
    renderer.sourceRuntime.canDirectComposite(
      projectImage,
      { width: 640, height: 360 },
      {
        ...projectImageOperation,
        runtimeValueInputs: new Map([["resource", {
          kind: "project-media-resource",
          mediaId: "video",
          ready: true,
        }]]),
      },
      { speed: 1 },
    ),
    false,
    "project video keeps the atomic retained-frame boundary",
  );
});

test("bounded raster SVG shader and 3D sources keep node ROI separate from Component region views", () => {
  const sourceRequests = [];
  const composites = [];
  const transparent = {
    buffer: { id: "transparent" },
    instanceInvariant: true,
  };
  const host = {
    compositeRuntime: {
      transparentChainState: () => transparent,
      renderBoundedLayerNodeState: (
        id,
        input,
        layer,
        item,
        request,
        roi,
      ) => {
        composites.push({ id, input, layer, item, request, roi });
        return layer;
      },
    },
    sourceRuntime: {
      measureOperation: (_component, _item, _request, draw) => draw(),
      renderItemState: (
        _component,
        item,
        _time,
        request,
      ) => {
        sourceRequests.push({ item, request });
        return {
          buffer: {
            id: item.source.generatorId,
            width: request.width,
            height: request.height,
          },
          instanceInvariant: true,
        };
      },
    },
    visualNodeRuntime: {
      effect: () => null,
    },
  };
  const runtime = new VisualPlanRuntime(host);
  const component = { id: "bounded-sources" };
  const request = {
    role: "component",
    width: 800,
    height: 600,
  };
  const boundary = {
    x: 0.75,
    y: -0.25,
    width: 0.8,
    height: 0.6,
    rotation: 0,
  };
  const transform = {
    x: 0.2,
    y: -0.1,
    scale: 1.4,
    rotation: 0.15,
  };

  for (const generatorId of [
    "mediaImage:raster",
    "mediaImage:svg",
    "gradient",
    "modelMedia",
    "terrainFlyover",
  ]) {
    runtime.renderOperations(
      component,
      [{
        id: generatorId,
        opcode: "source",
        configuration: {
          id: generatorId,
          kind: "source",
          enabled: true,
          boundary,
          transform,
          opacity: 1,
          blend: "normal",
          source: {
            type: "generator",
            generatorId,
            params: {},
          },
        },
        contract: {
          roi: {
            coordinateSpace: "boundary",
            halo: 0,
          },
        },
      }],
      0,
      request,
      generatorId,
    );
  }

  assert.equal(sourceRequests.length, 5);
  assert.equal(composites.length, 5);
  for (const { request: sourceRequest } of sourceRequests) {
    assert.equal(sourceRequest.nodeRegionView, true);
    assert.notEqual(
      sourceRequest.regionView,
      true,
      "a bounded node must not masquerade as a regional Component render",
    );
    assert.ok(sourceRequest.width < request.width);
    assert.ok(sourceRequest.height < request.height);
  }
  for (const composite of composites) {
    assert.strictEqual(composite.request, request);
    assert.equal(composite.item.boundary, boundary);
    assert.deepEqual(
      composite.item.transform,
      {},
      "the source renderer owns Content placement; bounded compositing must not apply it twice",
    );
    assert.ok(composite.roi.centerX > request.width * 0.5);
  }
  for (const { item } of sourceRequests) {
    assert.deepEqual(
      item.transform,
      transform,
      "the authored transform reaches every bounded source renderer",
    );
  }
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
    renderer.sourceRuntime.drawPlacedSourceResult(output, createPlacedRenderResult(texture, {
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

test("direct WebGL surfaces use supported blend modes and deterministically fall back to BLEND", () => {
  const source = readFileSync(new URL("../js/output/component-render-layout.js", import.meta.url), "utf8");
  const helper = source.slice(
    source.indexOf("export function applyBlendGlobal("),
    source.indexOf("\n}\n\nexport function drawWebGLBuffer", source.indexOf("export function applyBlendGlobal("))
  );
  assert.ok(helper.includes('if (!blend || blend === "normal") blendMode(BLEND);'));
  assert.ok(helper.includes("else if (blend === \"add\") blendMode(ADD);"));
  assert.ok(helper.includes("else blendMode(BLEND);"));
  assert.doesNotMatch(helper, /globalThis|OVERLAY|HARD_LIGHT|SOFT_LIGHT|DODGE|BURN/);
});

test("Mapping runtime imports the bounds helper used while rebuilding direct surfaces", () => {
  const source = readFileSync(new URL("../js/output/output-mapping-runtime.js", import.meta.url), "utf8");
  assert.match(source, /import \{ cornersRect \} from "\.\/component-render-layout\.js/);
  assert.match(source, /const rect = cornersRect\(corners\);/);
});

test("Canvas preview requests match the visible backing density", () => {
  const fullSize = { sceneAspectRatio: 16 / 9, pixelDensity: 1, previewRasterScale: 1 };
  assert.deepEqual(
    pickRequestSize(scenePreviewRenderRequest(fullSize, { resolutionScale: 1 }, 1200, 800)),
    { width: 1200, height: 675 }
  );
  assert.deepEqual(
    pickRequestSize(scenePreviewRenderRequest({ ...fullSize, previewRasterScale: 2 }, { resolutionScale: 1 }, 1200, 800)),
    { width: 2400, height: 1350 }
  );
  assert.deepEqual(
    pickRequestSize(scenePreviewRenderRequest({ ...fullSize, previewRasterScale: 2 }, { resolutionScale: 0.5 }, 1200, 800)),
    { width: 1200, height: 675 }
  );
});

test("component groups render isolated from earlier parent layers", () => {
  const source = readFileSync(new URL("../js/output/visual-plan-runtime.js", import.meta.url), "utf8");
  const groupRenderSource = source.slice(
    source.indexOf("  renderOperations("),
    source.indexOf("  compiledGroupInputStates(")
  );

  assert.ok(groupRenderSource.includes("let state = host.compositeRuntime.transparentChainState("));
  assert.ok(groupRenderSource.includes("operation.executionModel === \"texture-dag\""));
  assert.ok(groupRenderSource.includes("? this.executeTextureDag("));
  assert.ok(groupRenderSource.includes(": this.renderOperations("));
  assert.ok(groupRenderSource.includes("requiredGroupOperations(operation, nodeId)"));
  assert.doesNotMatch(groupRenderSource, /\bitem\.chain\b/);
  assert.ok(groupRenderSource.includes("operation.placementLowering === \"terminal-coordinate\""));
  assert.ok(groupRenderSource.includes("const groupTransform ="));
  assert.ok(groupRenderSource.includes("compiledGroup && !lowersPlacementToTerminal"));
  assert.ok(groupRenderSource.includes("requiresFullBoundaryPlacement"));
  assert.ok(groupRenderSource.includes("extractNodeViewState("));
  assert.ok(groupRenderSource.includes("compoundPlacementTransform"));
  assert.ok(groupRenderSource.includes("host.compositeRuntime.renderBoundedLayerNodeState("));
  assert.ok(groupRenderSource.includes("host.compositeRuntime.renderLayerNodeState("));
  assert.ok(!groupRenderSource.includes("drawBuffer(groupState.buffer, state.buffer"));
});

test("compiled visual Groups publish their isolated public output as the outer interaction region", () => {
  const parentState = { buffer: { id: "parent" }, instanceInvariant: true };
  const isolatedState = { buffer: { id: "isolated-group" }, instanceInvariant: true };
  const compositedState = { buffer: { id: "composited" }, instanceInvariant: true };
  const coverageRecords = [];
  let transparentCalls = 0;
  const host = {
    compositeRuntime: {
      transparentChainState: () => (
        transparentCalls++ === 0 ? parentState : isolatedState
      ),
      renderLayerNodeState: () => compositedState,
      renderBoundedLayerNodeState: () => compositedState,
    },
    componentRenderRuntime: { recordResolution() {} },
    previewHitCoverage: {
      recordRaster(...args) {
        coverageRecords.push(args);
      },
    },
    mediaRuntime: null,
    media: new Map(),
    specializedSources: {
      capabilityReadiness: () => null,
    },
  };
  const runtime = new VisualPlanRuntime(host);
  const component = { id: "component", name: "Component" };
  const outerItem = {
    id: "model-group",
    kind: "source",
    enabled: true,
    boundary: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
    source: { type: "generator", generatorId: "modelMedia" },
  };
  const operation = {
    id: outerItem.id,
    opcode: "group",
    backend: "compiled-visual-group",
    configuration: outerItem,
    operations: [],
    runtimeStates: new Map(),
    runtimeOutputStates: new Map(),
    outputPorts: ["texture"],
    outputBindings: {},
    outputPort: "texture",
    publicTextureInputs: {},
    contract: {
      interaction: { hitRegion: "rendered-alpha" },
      roi: { halo: 0, coordinateSpace: "boundary" },
    },
  };

  const result = runtime.renderOperations(
    component,
    [operation],
    0,
    { role: "component", width: 800, height: 450 },
  );

  assert.strictEqual(result, compositedState);
  assert.equal(coverageRecords.length, 1);
  assert.strictEqual(coverageRecords[0][0], component);
  assert.strictEqual(coverageRecords[0][1], outerItem);
  assert.strictEqual(
    coverageRecords[0][2],
    isolatedState,
    "hit coverage cannot include pixels from earlier parent layers",
  );
  assert.equal(coverageRecords[0][5], "rendered-alpha");
});

test("bounded compound-output placement is evaluated in the full node boundary before ROI extraction", () => {
  const parentState = { buffer: { id: "parent" }, instanceInvariant: true };
  const rawState = { buffer: { id: "raw" }, instanceInvariant: true };
  const transformedState = {
    buffer: { id: "transformed" },
    instanceInvariant: true,
  };
  const visibleState = { buffer: { id: "visible" }, instanceInvariant: true };
  const compositedState = {
    buffer: { id: "composited" },
    instanceInvariant: true,
  };
  const transparentRequests = [];
  const transformCalls = [];
  const extractionCalls = [];
  const boundedCalls = [];
  const host = {
    compositeRuntime: {
      transparentChainState(_component, request) {
        transparentRequests.push(request);
        return transparentRequests.length === 1 ? parentState : rawState;
      },
      renderLayerContentTransformState(...args) {
        transformCalls.push(args);
        return transformedState;
      },
      extractNodeViewState(...args) {
        extractionCalls.push(args);
        return visibleState;
      },
      renderBoundedLayerNodeState(...args) {
        boundedCalls.push(args);
        return compositedState;
      },
    },
    componentRenderRuntime: { recordResolution() {} },
    previewHitCoverage: {
      prepareRegionRequest() {},
      recordRaster() {},
    },
    mediaRuntime: null,
    media: new Map(),
    specializedSources: {
      capabilityReadiness: () => null,
    },
  };
  const runtime = new VisualPlanRuntime(host);
  const transform = {
    x: 0.25,
    y: -0.15,
    scale: 1.3,
    rotation: 0.1,
  };
  const operation = {
    id: "bounded-compound",
    opcode: "group",
    backend: "compiled-visual-group",
    placementLowering: "compound-output",
    configuration: {
      id: "bounded-compound",
      kind: "group",
      enabled: true,
      boundary: {
        x: 0.75,
        y: 0,
        width: 0.8,
        height: 0.6,
        rotation: 0,
      },
      transform,
      opacity: 1,
      blend: "normal",
    },
    operations: [],
    runtimeStates: new Map(),
    runtimeOutputStates: new Map(),
    outputPorts: ["texture"],
    outputBindings: {},
    outputPort: "texture",
    publicTextureInputs: {},
    contract: { roi: { halo: 0, coordinateSpace: "boundary" } },
  };
  const request = { role: "component", width: 800, height: 600 };

  const result = runtime.renderOperations(
    { id: "component", name: "Component" },
    [operation],
    0,
    request,
  );

  assert.strictEqual(result, compositedState);
  assert.equal(transparentRequests.length, 2);
  const fullBoundaryRequest = transparentRequests[1];
  assert.deepEqual(fullBoundaryRequest.uvRect, [0, 0, 1, 1]);
  assert.equal(fullBoundaryRequest.nodeRegionView, false);
  assert.equal(fullBoundaryRequest.width, 640);
  assert.equal(fullBoundaryRequest.height, 360);
  assert.equal(transformCalls.length, 1);
  assert.strictEqual(transformCalls[0][1], rawState);
  assert.deepEqual(transformCalls[0][2], transform);
  assert.strictEqual(transformCalls[0][3], fullBoundaryRequest);
  assert.equal(extractionCalls.length, 1);
  assert.strictEqual(extractionCalls[0][1], transformedState);
  assert.strictEqual(extractionCalls[0][2], fullBoundaryRequest);
  assert.notDeepEqual(extractionCalls[0][3].uvRect, [0, 0, 1, 1]);
  assert.ok(extractionCalls[0][3].width < fullBoundaryRequest.width);
  assert.equal(boundedCalls.length, 1);
  assert.strictEqual(boundedCalls[0][2], visibleState);
  assert.deepEqual(
    boundedCalls[0][3].transform,
    {},
    "Content placement is complete before the ROI is placed into the parent",
  );
});

test("bounded full-frame sources keep a stable boundary target and extract only the visible ROI", () => {
  const parentState = { buffer: { id: "parent" }, instanceInvariant: true };
  const fullSourceState = { buffer: { id: "full-source" }, instanceInvariant: false };
  const visibleSourceState = { buffer: { id: "visible-source" }, instanceInvariant: false };
  const compositedState = { buffer: { id: "composited" }, instanceInvariant: false };
  const sourceRequests = [];
  const extractionCalls = [];
  const boundedCalls = [];
  const host = {
    compositeRuntime: {
      transparentChainState: () => parentState,
      extractNodeViewState(...args) {
        extractionCalls.push(args);
        return visibleSourceState;
      },
      renderBoundedLayerNodeState(...args) {
        boundedCalls.push(args);
        return compositedState;
      },
    },
    sourceRuntime: {
      measureOperation(_component, _item, request, render) {
        sourceRequests.push(request);
        return render();
      },
      renderItemState() {
        return fullSourceState;
      },
    },
    previewHitCoverage: { recordRaster() {} },
  };
  const runtime = new VisualPlanRuntime(host);
  const request = {
    role: "component",
    width: 800,
    height: 600,
    logicalWidth: 800,
    logicalHeight: 600,
  };
  const operation = {
    id: "persistent-isf-source",
    opcode: "source",
    configuration: {
      id: "persistent-isf-source",
      kind: "source",
      enabled: true,
      boundary: { x: 0.75, y: 0, width: 0.8, height: 0.6, rotation: 0 },
      transform: { scale: 0.1 },
      source: {
        type: "generator",
        generatorId: "persistent-isf",
        params: {},
      },
    },
    contract: {
      roi: {
        mode: "full-frame",
        halo: 0,
        coordinateSpace: "boundary",
      },
    },
  };

  const result = runtime.renderOperations(
    { id: "component", name: "Component" },
    [operation],
    0,
    request,
  );

  assert.strictEqual(result, compositedState);
  assert.equal(sourceRequests.length, 1);
  assert.deepEqual(sourceRequests[0].uvRect, [0, 0, 1, 1]);
  assert.equal(sourceRequests[0].nodeRegionView, false);
  assert.equal(sourceRequests[0].width, 640);
  assert.equal(sourceRequests[0].height, 360);
  assert.equal(extractionCalls.length, 1);
  assert.strictEqual(extractionCalls[0][1], fullSourceState);
  assert.strictEqual(extractionCalls[0][2], sourceRequests[0]);
  assert.ok(extractionCalls[0][3].width < sourceRequests[0].width);
  assert.strictEqual(boundedCalls[0][2], visibleSourceState);
});

test("bounded compound-output identity placement retains the ROI-sized optimized path", () => {
  const parentState = { buffer: { id: "parent" }, instanceInvariant: true };
  const rawState = { buffer: { id: "raw" }, instanceInvariant: true };
  const compositedState = {
    buffer: { id: "composited" },
    instanceInvariant: true,
  };
  const transparentRequests = [];
  let transformCalls = 0;
  let extractionCalls = 0;
  const host = {
    compositeRuntime: {
      transparentChainState(_component, request) {
        transparentRequests.push(request);
        return transparentRequests.length === 1 ? parentState : rawState;
      },
      renderLayerContentTransformState() {
        transformCalls += 1;
        return rawState;
      },
      extractNodeViewState() {
        extractionCalls += 1;
        return rawState;
      },
      renderBoundedLayerNodeState: () => compositedState,
    },
    componentRenderRuntime: { recordResolution() {} },
    previewHitCoverage: {
      prepareRegionRequest() {},
      recordRaster() {},
    },
    mediaRuntime: null,
    media: new Map(),
    specializedSources: {
      capabilityReadiness: () => null,
    },
  };
  const runtime = new VisualPlanRuntime(host);
  runtime.renderOperations(
    { id: "component", name: "Component" },
    [{
      id: "identity-compound",
      opcode: "group",
      backend: "compiled-visual-group",
      placementLowering: "compound-output",
      configuration: {
        id: "identity-compound",
        kind: "group",
        enabled: true,
        boundary: {
          x: 0.75,
          y: 0,
          width: 0.8,
          height: 0.6,
          rotation: 0,
        },
        transform: {},
      },
      operations: [],
      runtimeStates: new Map(),
      runtimeOutputStates: new Map(),
      outputPorts: ["texture"],
      outputBindings: {},
      outputPort: "texture",
      publicTextureInputs: {},
      contract: { roi: { halo: 0, coordinateSpace: "boundary" } },
    }],
    0,
    { role: "component", width: 800, height: 600 },
  );

  assert.equal(transparentRequests.length, 2);
  assert.equal(transparentRequests[1].nodeRegionView, true);
  assert.notDeepEqual(transparentRequests[1].uvRect, [0, 0, 1, 1]);
  assert.ok(transparentRequests[1].width < 640);
  assert.equal(transformCalls, 0);
  assert.equal(extractionCalls, 0);
});

test("disabled compiled visual Groups do not evaluate values or child render operations", () => {
  let valueEvaluations = 0;
  let sourceRenders = 0;
  const transparent = {
    buffer: { id: "transparent" },
    instanceInvariant: true,
  };
  const host = {
    compositeRuntime: {
      transparentChainState: () => transparent,
    },
    sourceRuntime: {
      measureOperation: (_component, _item, _request, draw) => draw(),
      renderItemState: () => {
        sourceRenders += 1;
        return transparent;
      },
    },
  };
  const runtime = new VisualPlanRuntime(host);
  const disabledGroup = {
    id: "disabled-compound",
    opcode: "group",
    backend: "compiled-visual-group",
    configuration: {
      id: "disabled-compound",
      kind: "group",
      enabled: false,
    },
    operations: [{
      id: "child-source",
      opcode: "source",
      configuration: {
        id: "child-source",
        kind: "source",
        enabled: true,
        source: { type: "generator", generatorId: "core.scene3d.render" },
      },
    }],
    valueProgram: {
      evaluate() {
        valueEvaluations += 1;
      },
    },
  };

  const result = runtime.renderOperations(
    { id: "component", name: "Component" },
    [disabledGroup],
    0,
    { role: "component", width: 800, height: 450 },
  );

  assert.strictEqual(result, transparent);
  assert.equal(valueEvaluations, 0);
  assert.equal(sourceRenders, 0);
});

test("compiled Group Content scale raises value-provider detail without enlarging its target", () => {
  let evaluation = null;
  let renderedChild = null;
  const transparent = { buffer: { id: "transparent" }, instanceInvariant: true };
  const host = {
    compositeRuntime: {
      transparentChainState: () => transparent,
      renderLayerNodeState: (_id, _state, output) => output,
      renderBoundedLayerNodeState: (_id, _state, output) => output,
    },
    componentRenderRuntime: { recordResolution() {} },
    sourceRuntime: {
      measureOperation: (_component, _item, _request, render) => render(),
      canDirectComposite: () => false,
      renderItemState: (_component, item) => {
        renderedChild = item;
        return transparent;
      },
    },
    mediaRuntime: null,
    media: new Map(),
    specializedSources: {
      capabilityReadiness: () => null,
    },
  };
  const runtime = new VisualPlanRuntime(host);
  const request = { role: "component", width: 800, height: 450 };
  const operation = {
    id: "scaled-group",
    opcode: "group",
    backend: "compiled-visual-group",
    configurationRevision: 2,
    placementLowering: "terminal-coordinate",
    configuration: {
      id: "scaled-group",
      kind: "group",
      enabled: true,
      transform: { x: 0, y: 0, scale: 3, rotation: 0 },
      boundary: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
    },
    operations: [{
      id: "render",
      opcode: "source",
      configuration: {
        id: "render",
        kind: "source",
        enabled: true,
        transform: {},
        source: {
          type: "generator",
          generatorId: "core.visual.media-resource-to-image",
        },
      },
    }],
    valueProgram: {
      evaluate(options) {
        evaluation = options;
      },
    },
    runtimeStates: new Map(),
    runtimeOutputStates: new Map(),
    outputPorts: ["texture"],
    outputBindings: {},
    outputPort: "texture",
    publicTextureInputs: {},
  };

  runtime.renderOperations(
    { id: "component", name: "Component" },
    [operation],
    0,
    request,
  );

  assert.deepEqual(evaluation.renderRequest, {
    ...request,
    configurationRevision: "scaled-group@2",
  });
  assert.deepEqual(evaluation.sourceDetail, {
    width: 2400,
    height: 1350,
    physicalWidth: 800,
    physicalHeight: 450,
    contentScale: 3,
  });
  assert.deepEqual(
    renderedChild.transform,
    { x: 0, y: 0, scale: 3, rotation: 0 },
    "the shared authored placement reaches a static compiled child without relying on animation",
  );
});

test("compiled visual Groups route named texture inputs by public port identity", () => {
  const runtime = new VisualPlanRuntime({});
  const foreground = { buffer: { id: "foreground" } };
  const background = { buffer: { id: "background" } };
  const fallback = { buffer: { id: "fallback" } };
  const plan = {
    runtimeStates: new Map([
      ["source-a", foreground],
      ["source-b", background],
    ]),
  };
  const operation = {
    textureInputs: {
      foreground: "source-a",
      background: "source-b",
    },
    textureInputPorts: ["foreground", "background"],
    publicTextureInputs: {
      foreground: "mix.a",
      background: "mix.b",
    },
  };
  const inputs = runtime.textureInputStates(plan, operation, fallback);

  assert.strictEqual(inputs.get("foreground"), foreground);
  assert.strictEqual(inputs.get("background"), background);
  assert.strictEqual(
    runtime.textureInputState(
      { runtimeStates: new Map() },
      { textureInputs: { a: "$in.foreground" } },
      "a",
      fallback,
      inputs,
    ),
    foreground,
  );
  assert.deepEqual(
    [...runtime.compiledGroupInputStates(operation, fallback, inputs)],
    [["foreground", foreground], ["background", background]],
  );
  assert.deepEqual(
    [...runtime.compiledGroupInputStates({
      textureInputs: { texture: "previous-chain-operation" },
      publicTextureInputs: {},
    }, fallback)],
    [],
    "an implicit chain edge cannot become an undeclared generator Group input",
  );
});

test("compiled visual Groups publish distinct retained output states by public port identity", () => {
  const host = {};
  const runtime = new VisualPlanRuntime(host);
  const transparent = { buffer: { id: "transparent" } };
  const primary = { buffer: { id: "primary" } };
  const alternate = { buffer: { id: "alternate" } };
  const compiledOutputs = {
    outputPorts: ["texture", "alternate"],
    outputBindings: {
      texture: "source-a",
      alternate: "source-b",
    },
    runtimeStates: new Map([
      ["source-a", primary],
      ["source-b", alternate],
    ]),
  };
  assert.deepEqual(
    [...runtime.compiledGroupOutputStates(compiledOutputs, transparent)],
    [["texture", primary], ["alternate", alternate]],
  );
  const group = {
    id: "compound",
    opcode: "group",
    configuration: { enabled: true },
    textureInputs: {},
    textureInputPorts: [],
    runtimeOutputStates: new Map(),
  };
  const select = {
    id: "select",
    opcode: "select",
    configuration: { enabled: true, params: { selection: true } },
    textureInputs: {
      a: "compound",
      b: "compound.alternate",
    },
    textureInputPorts: ["a", "b"],
  };
  const plan = {
    operations: [group, select],
    runtimeStates: new Map(),
  };
  host.compositeRuntime = {
    transparentChainState: () => transparent,
  };
  runtime.renderOperations = (_component, operations) => {
    assert.strictEqual(operations[0], group);
    group.runtimeOutputStates.set("texture", primary);
    group.runtimeOutputStates.set("alternate", alternate);
    return primary;
  };

  const result = runtime.executeTextureDag(
    plan,
    { id: "component" },
    0,
    { width: 64, height: 64 },
    "component",
  );

  assert.strictEqual(plan.runtimeStates.get("compound"), primary);
  assert.strictEqual(plan.runtimeStates.get("compound.alternate"), alternate);
  assert.strictEqual(result, alternate);
});

test("texture DAG composition forwards disabled chain nodes before a named-image effect", () => {
  const transparent = { buffer: { id: "transparent" } };
  const base = { buffer: { id: "base" } };
  const displacement = { buffer: { id: "displacement" } };
  const output = { buffer: { id: "output" } };
  const host = {
    compositeRuntime: {
      transparentChainState: () => transparent,
    },
  };
  const runtime = new VisualPlanRuntime(host);
  const operations = [
    {
      id: "base",
      opcode: "source",
      configuration: { enabled: true },
      textureInputs: {},
      textureInputPorts: [],
      runtimeInputStates: new Map(),
      compositionInput: "$in.texture",
    },
    {
      id: "disabled-generator",
      opcode: "source",
      configuration: { enabled: false },
      textureInputs: {},
      textureInputPorts: [],
      runtimeInputStates: new Map(),
      compositionInput: "base",
    },
    {
      id: "displacement",
      opcode: "source",
      configuration: { enabled: true, auxiliaryFor: { nodeId: "displace", port: "displaceImage" } },
      textureInputs: {},
      textureInputPorts: [],
      runtimeInputStates: new Map(),
      compositionInput: "",
    },
    {
      id: "displace",
      opcode: "effect",
      configuration: { enabled: true },
      textureInputs: {
        inputImage: "disabled-generator",
        displaceImage: "displacement",
      },
      textureInputPorts: ["inputImage", "displaceImage"],
      runtimeInputStates: new Map(),
      compositionInput: "",
    },
  ];
  const plan = { operations, runtimeStates: new Map() };
  runtime.renderOperations = (_component, [operation], _time, _request, _key, _transform, input, inputs) => {
    if (operation.id === "base") return base;
    if (operation.id === "displacement") return displacement;
    assert.equal(operation.id, "displace");
    assert.strictEqual(input, base, "the disabled generator forwards the composed base");
    assert.strictEqual(inputs.get("displaceImage"), displacement);
    return output;
  };

  assert.strictEqual(
    runtime.executeTextureDag(
      plan,
      { id: "component" },
      0,
      { width: 64, height: 64 },
      "component",
    ),
    output,
  );
  assert.strictEqual(plan.runtimeStates.get("disabled-generator"), base);

  operations[3].configuration.enabled = false;
  assert.strictEqual(
    runtime.executeTextureDag(
      plan,
      { id: "component" },
      0,
      { width: 64, height: 64 },
      "component",
    ),
    base,
    "disabling the named-image effect forwards inputImage",
  );
});

test("compiled framebuffer passes execute atomically and publish one retained state", () => {
  const transparent = { buffer: { id: "transparent" } };
  const retained = {
    buffer: { id: "shared-color-depth" },
    nodeKey: "terrain-pass",
    outputVersion: 1,
  };
  const calls = [];
  const host = {
    compositeRuntime: {
      transparentChainState: () => transparent,
    },
    sourceRuntime: {
      renderFramebufferPassSequence(
        component,
        operations,
        componentTime,
        renderRequest,
        scopeId,
        inputStates,
      ) {
        calls.push({
          component,
          operations,
          componentTime,
          renderRequest,
          scopeId,
          inputStates,
        });
        return retained;
      },
    },
  };
  const sequenceId = "terrain/shared-pass";
  const surface = {
    id: "surface",
    opcode: "source",
    configuration: { enabled: true },
    textureInputs: {},
    textureInputPorts: [],
    runtimeInputStates: new Map(),
    framebufferSequence: {
      sequenceId,
      phase: "begin",
      preserve: ["color", "depth"],
    },
  };
  const wire = {
    id: "wire",
    opcode: "source",
    configuration: { enabled: true },
    textureInputs: { target: "surface" },
    textureInputPorts: ["target"],
    runtimeInputStates: new Map(),
    framebufferSequence: {
      sequenceId,
      phase: "continue",
      inputPort: "target",
      preserve: ["color", "depth"],
    },
  };
  const plan = {
    operations: [surface, wire],
    runtimeStates: new Map(),
  };
  const runtime = new VisualPlanRuntime(host);
  const component = { id: "component" };
  const request = { width: 640, height: 360 };
  const result = runtime.executeTextureDag(
    plan,
    component,
    2,
    request,
    "component",
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].operations, [surface, wire]);
  assert.strictEqual(plan.runtimeStates.get("surface"), retained);
  assert.strictEqual(plan.runtimeStates.get("wire"), retained);
  assert.strictEqual(result, retained);
});

test("Group transforms place physical content but never resample a composition-wide effect input", () => {
  const groupTransform = { x: 0.25, y: -0.1, scale: 0.5, rotation: 0.2 };
  const hsv = { id: "key", kind: "effect", componentId: "hsvAlphaKey", transform: {} };
  const field = { id: "ripple", kind: "effect", componentId: "ripple", transform: {} };
  const source = { id: "plasma", kind: "source", transform: {} };

  const compositionResult = visualOperationRenderItem(
    { opcode: "effect", transformDomain: "composition" },
    hsv,
    groupTransform
  );
  const fieldResult = visualOperationRenderItem(
    { opcode: "effect", transformDomain: "group-field" },
    field,
    groupTransform
  );
  const sourceResult = visualOperationRenderItem({ opcode: "source" }, source, groupTransform);

  assert.equal(compositionResult, hsv, "the hot path neither transforms nor allocates a composition effect item");
  assert.notEqual(fieldResult, field);
  assert.deepEqual(fieldResult.transform, groupTransform);
  assert.notEqual(sourceResult, source);
  assert.deepEqual(sourceResult.transform, groupTransform);
});

test("rasterized sources own a full-frame coordinate transform before neutral layer compositing", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const sourceRuntimeSource = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const generatorSource = readFileSync(new URL("../js/output/shader-generator-runtime.js", import.meta.url), "utf8");
  const visualPlanSource = readFileSync(new URL("../js/output/visual-plan-runtime.js", import.meta.url), "utf8");
  const compositeSource = readFileSync(new URL("../js/output/composite-render-runtime.js", import.meta.url), "utf8");
  const specializedSource = readFileSync(new URL("../js/output/specialized/specialized-target-runtime.js", import.meta.url), "utf8");
  const meshRenderSource = readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8");
  const shaderSource = readFileSync(new URL("../js/output/render-pass-shaders.js", import.meta.url), "utf8");
  const chainRenderSource = visualPlanSource.slice(
    visualPlanSource.indexOf("  renderOperations("),
    visualPlanSource.indexOf("  compiledGroupInputStates(")
  );
  const layerRenderSource = compositeSource.slice(
    compositeSource.indexOf("  renderLayerNodeState("),
    compositeSource.indexOf("  renderBoundedLayerNodeState(")
  );
  const drawLayerSource = compositeSource.slice(
    compositeSource.indexOf("  drawChainLayer("),
    compositeSource.indexOf("  drawTransformedLayerFallback("),
  );

  const rasterSourceRender = sourceRuntimeSource.slice(
    sourceRuntimeSource.indexOf("  renderItemState("),
    sourceRuntimeSource.indexOf("  imageSourceNeedsAlphaEdge(")
  );
  assert.ok(rasterSourceRender.includes("contentTransform: item.transform || {}"));
  assert.ok(chainRenderSource.includes("host.compositeRuntime.renderLayerNodeState("));
  assert.ok(chainRenderSource.includes("{ ...renderedItem, transform: {} }"));
  assert.ok(layerRenderSource.includes("renderLayerContentTransformState("));
  assert.ok(layerRenderSource.includes('renderBufferKey(nodeId, "content-transform")'));
  assert.ok(shaderSource.includes("uniform mat3 sourceUvMatrix;"));
  assert.ok(shaderSource.includes("gl_FragColor = color * inside;"));
  assert.match(
    drawLayerSource,
    /drawBuffer\(\s*output,\s*source,\s*0,\s*0,\s*output\.width,\s*output\.height/,
  );
  assert.ok(!drawLayerSource.includes("output.translate("));
  assert.ok(!drawLayerSource.includes("output.scale("));
  assert.match(
    generatorSource,
    /setShaderUniformIfPresent\(\s*shader,\s*"contentUvMatrix",\s*uniformState\.sampling/,
  );
  assert.ok(specializedSource.includes("present(output, target)"));
  assert.ok(specializedSource.includes("GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER"));
  assert.ok(meshRenderSource.includes("rawModelMatrices("));
  assert.ok(meshRenderSource.includes("contentTransform,"));
});

test("component preview always draws its overarching frame independently of selection", () => {
  const source = readFileSync(new URL("../js/output/output-presentation-runtime.js", import.meta.url), "utf8");
  const interactionSource = readFileSync(new URL("../js/output/component-preview-interaction.js", import.meta.url), "utf8");
  const previewSource = source.slice(
    source.indexOf("  renderComponentPreview()"),
    source.indexOf("  renderFlattenedThumbnailEditPreview(component)")
  );

  assert.ok(previewSource.includes("host.previewInteraction.renderComponentFrameOverlay(component, source)"));
  assert.ok(interactionSource.includes('if (renderer.mode !== "component" || !component) return'));
  assert.ok(interactionSource.includes("renderer.presentationRuntime.componentPreviewRect(component, source)"));
  assert.ok(interactionSource.includes("stroke(101, 224, 211, 235)"));
});

test("scene surfaces render components at their configured shape and relative resolution", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const plannerSource = readFileSync(new URL("../js/libraries/composition-engine/surface-composition/index.js", import.meta.url), "utf8");
  const drawSurfaceRoute = runtimeSource.slice(
    runtimeSource.indexOf("  drawSurfaceRoute(target, route = {}, { compositeOpacity = 1 } = {})"),
    runtimeSource.indexOf("  drawSurfaceThumbnailRoute(target, surface")
  );
  const surfaceRenderPlan = plannerSource;

  assert.ok(surfaceRenderPlan.includes("sourceRenderDemand({"));
  assert.ok(surfaceRenderPlan.includes("componentSourceView("));
  assert.ok(surfaceRenderPlan.includes("componentById.get(surface.componentId)"));
  assert.ok(surfaceRenderPlan.includes("resolveRouteSourceNode(storedSurface)"));
  assert.ok(surfaceRenderPlan.includes("state.render?.sampling?.surfaceOverscan"));
  assert.ok(surfaceRenderPlan.includes("sharedComponentRenderRequests(requestableRoutes"));
  assert.ok(surfaceRenderPlan.includes("route.componentRequest = componentRequests.get(renderInstanceKey)"));
  assert.ok(!drawSurfaceRoute.includes("stableFrameRenderRequest(this.state.render"));
  assert.ok(drawSurfaceRoute.includes("scaledComponentSampleRect("));
  assert.ok(runtimeSource.includes("getSurfaceTexture(request)"));
  assert.ok(runtimeSource.includes("createSharedFramebufferTarget(widthPx, heightPx)"));
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

test("compiled shader sources allocate quality-scaled instance-owned targets", () => {
  const request = {
    role: "source",
    width: 1200,
    height: 800,
    logicalWidth: 1200,
    logicalHeight: 800,
    renderIdentity: "eye-instance",
  };
  assert.deepEqual(
    compiledSourceRenderRequest(
      { backend: "shader-generator" },
      { params: { renderQuality: 0 } },
      request,
    ),
    { ...request, width: 420, height: 280, qualityScale: 0.35 },
  );
  assert.strictEqual(
    compiledSourceRenderRequest(
      { backend: "native-specialized" },
      { params: { renderQuality: 0.5 } },
      request,
    ),
    request,
    "native renderers retain ownership of their declared internal quality policy",
  );
});

test("compiled source targets allocate depth only when the node declares it", () => {
  assert.deepEqual(compiledSourceRenderTargetOptions({}), { depth: false });
  assert.deepEqual(
    compiledSourceRenderTargetOptions({ renderTarget: { depth: true } }),
    { depth: true },
  );
});

test("shader generators preserve the component render contract", () => {
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
  const runtime = new ShaderGeneratorRuntime({
    renderRequestRuntime: {
      normalize: (nextRequest) => nextRequest,
    },
  });
  runtime.renderSource = (_id, _time, nextRequest) => {
    receivedRequest = nextRequest;
    return target;
  };

  assert.equal(runtime.draw(pg, "eyeball", 1.25, request), true);
  assert.deepEqual(receivedRequest, request);
});

test("shader generator host retains the shared source-detail contract after source extraction", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const generatorSource = readFileSync(new URL("../js/output/shader-generator-runtime.js", import.meta.url), "utf8");

  assert.match(generatorSource, /const sourceDetail = renderSourceDetail\(/);
  assert.match(generatorSource, /drawingSize,\s*renderRequest,/);
  assert.doesNotMatch(rendererSource, /\brenderSourceDetail\b/);
});

test("shader generators draw directly into a shared source framebuffer", () => {
  const request = { width: 640, height: 360, logicalWidth: 640, logicalHeight: 360 };
  const pg = {
    __vj1SharedFramebuffer: true,
    width: request.width,
    height: request.height,
    push() { throw new Error("direct generator output must not be copied"); },
  };
  let receivedTarget = null;
  const runtime = new ShaderGeneratorRuntime({
    renderRequestRuntime: {
      normalize: (nextRequest) => nextRequest,
    },
  });
  runtime.renderSource = (_id, _time, _request, _params, _instanceId, _transform, outputTarget) => {
    receivedTarget = outputTarget;
    return outputTarget;
  };

  assert.equal(runtime.draw(pg, "eyeball", 1.25, request), true);
  assert.equal(receivedTarget, pg);
});

test("shader generator capability owns retained uniform state and pruning", () => {
  const runtime = new ShaderGeneratorRuntime({ frameRuntime: { frameIndex: 20 } });
  runtime.uniformStates.set("active", { resolution: [1, 1] });
  runtime.uniformStates.set("stale", { resolution: [1, 1] });
  runtime.uniformStateUse.set("active", 19);
  runtime.uniformStateUse.set("stale", 2);

  runtime.prune(5);
  assert.equal(runtime.uniformStates.has("active"), true);
  assert.equal(runtime.uniformStates.has("stale"), false);
  assert.equal(runtime.uniformStateUse.has("stale"), false);

  runtime.dispose();
  assert.equal(runtime.uniformStates.size, 0);
  assert.equal(runtime.uniformStateUse.size, 0);

  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const generatorSource = readFileSync(new URL("../js/output/shader-generator-runtime.js", import.meta.url), "utf8");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  assert.match(rendererSource, /new ShaderGeneratorRuntime\(this\)/);
  assert.match(sourceRuntime, /host\.shaderGeneratorRuntime\.draw\(/);
  assert.doesNotMatch(
    rendererSource,
    /^  (?:drawShaderGenerator|renderShaderGeneratorSource|continuousRateTime)\(/m,
  );
  assert.doesNotMatch(
    rendererSource,
    /generatorUniformStates|generatorUniformStateUse/,
  );
  assert.match(generatorSource, /shaderRuntime\.getShader\(/);
  assert.match(generatorSource, /isfRuntime\.renderProgram\(/);
  assert.match(generatorSource, /qualityAdjustedGeneratorParams\(/);
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

test("every compiled generator backend remains tied to the component source target", () => {
  const source = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const generatorSource = readFileSync(new URL("../js/output/shader-generator-runtime.js", import.meta.url), "utf8");
  const drawSource = source.slice(
    source.indexOf("  drawGeneratorSource("),
    source.indexOf("  executeCompiledVisualNodeProcess(")
  );
  const drawShader = generatorSource.slice(
    generatorSource.indexOf("  draw("),
    generatorSource.indexOf("  renderSource(")
  );

  assert.ok(drawSource.includes("this.drawCompiledNativeSource("));
  assert.ok(drawSource.includes("nativeRenderer,"));
  assert.ok(drawSource.includes("target,"));
  assert.ok(drawSource.includes('typeof operation?.nodeProcess === "function"'));
  assert.ok(drawSource.includes("this.executeCompiledVisualNodeProcess("));
  assert.ok(source.includes("this.nativeRendererRegistry.execute("));
  assert.ok(!source.includes("this.host.specializedSources?.drawNativeRenderer?.("));
  assert.ok(drawSource.includes("host.shaderGeneratorRuntime.draw("));
  assert.ok(drawSource.includes("VJ1_GENERATOR_IMPLEMENTATION_MISSING"));
  assert.ok(!drawSource.includes("drawGenerator("));
  assert.ok(drawShader.includes("width: target.width"));
  assert.ok(drawShader.includes("height: target.height"));
});

test("window resize preserves the dedicated model context while final disposal releases it", () => {
  const source = readFileSync(new URL("../js/output/output-resource-runtime.js", import.meta.url), "utf8");
  const createBuffers = source.slice(source.indexOf("  createBuffers()"), source.indexOf("  matchesRenderSize()"));
  const disposeBuffers = source.slice(source.indexOf("  disposeBuffers({ preserveSpecialized = false } = {})"), source.indexOf("  applyPixelDensity()"));
  assert.ok(createBuffers.includes("this.disposeBuffers({ preserveSpecialized: true })"));
  assert.ok(disposeBuffers.includes("if (!preserveSpecialized) host.specializedSources.dispose()"));
});

test("projection mapper uses actual texture size for surface sampling math", () => {
  const source = readFileSync(new URL("../js/libraries/mapping-engine/mapping-engine/index.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");

  assert.ok(source.includes("const sourceWidth = sourceRect[2] * Math.max(1, Number(texture.width) || 1);"));
  assert.ok(source.includes("const sourceHeight = sourceRect[3] * Math.max(1, Number(texture.height) || 1);"));
  assert.ok(source.includes('projectionFit = "cover"'));
  assert.ok(rendererSource.includes("drawBufferedSurfaceTexture(texture, route = {})"));
  assert.ok(rendererSource.includes("opacity: surfaceRouteOpacity(route)"));
  assert.ok(rendererSource.includes("sourceRect: view.sourceRect"));
  assert.ok(rendererSource.includes("directSurfaceSamples"));
  assert.ok(source.includes("drawTextureBatch(items = [])"));
  assert.ok(source.includes("this._drawSurfaceQuad(cache.vertices)"));
  assert.ok(rendererSource.includes("drawSurfaceRouteViewBatch(batch, blend)"));
});

test("zero-duration Live output retains the original single-scene surface path", () => {
  const source = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const stateRuntimeSource = readFileSync(new URL("../js/output/output-state-runtime.js", import.meta.url), "utf8");
  const transitionSource = readFileSync(new URL("../js/output/transition-runtime.js", import.meta.url), "utf8");
  assert.ok(source.includes("if (transitions[0]) return this.renderTransitionSurfaces(transitions[0]);"));
  assert.ok(source.includes("if (transitions.length > 1) return this.renderConcurrentTransitionSurfaces(transitions);"));
  assert.ok(source.includes("this.renderMappingSurfaces();"));
  assert.ok(source.includes("this.releaseTransitionSurfaceTextures();"));
  assert.ok(source.includes("renderer.mappingRuntime.mapper.drawTransitionTextures("));
  assert.ok(source.includes("this.resolveTransition?.("));
  assert.ok(source.includes("transitionTime: renderer.frameRuntime.visualTime"));
  assert.ok(source.includes("transitionTimeDelta: renderer.frameRuntime.visualDeltaSeconds"));
  assert.ok(source.includes("transitionFrameIndex: renderer.frameRuntime.frameIndex"));
  assert.ok(stateRuntimeSource.includes("host.transitionRuntime.rebuild()"));
  assert.ok(transitionSource.includes("visualNodes?.transitionEntries || []"));
  assert.ok(transitionSource.includes("transitionParameterValues("));
  assert.doesNotMatch(
    rendererSource,
    /^  (?:rebuildTransitionCatalog|resolveTransition|currentLiveTransition|renderTransitionSurfaces|renderTransitionRouteTextures|getTransitionSurfaceTexture|getTransparentTransitionTexture|releaseTransitionSurfaceTextures)\(/m,
    "transition activation and Surface transition operations do not route through facade forwarding methods",
  );
});

test("Preview and Output resolve one project transition kernel and parameter contract", () => {
  const transitionDefinition = createIsfNodeDefinition({
    path: "shaders/transitions/mode-contract.fs",
    source: `/*{
      "ISFVSN": "2.0",
      "LABEL": "Mode Contract",
      "VJ1": {
        "ID": "org.vj1.transition.mode-contract",
        "VERSION": "1.0.0",
        "PROFILE": "vj1-isf-webgl2@1"
      },
      "INPUTS": [
        { "NAME": "startImage", "TYPE": "image" },
        { "NAME": "endImage", "TYPE": "image" },
        { "NAME": "progress", "TYPE": "float", "MIN": 0, "MAX": 1 },
        { "NAME": "softness", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0, "MAX": 1 }
      ]
    }*/
    void main() {
      float edge = smoothstep(progress - softness, progress + softness, isf_FragNormCoord.x);
      isf_FragColor = mix(
        IMG_THIS_NORM_PIXEL(startImage),
        IMG_THIS_NORM_PIXEL(endImage),
        edge
      );
    }`,
  });
  const state = createInitialState();
  state.nodes.definitions.push(transitionDefinition);
  const resolutions = ["preview", "output"].map((mode) => {
    const renderer = new OutputRenderer({ mode });
    renderer.state = structuredClone(state);
    renderer.visualNodeRuntime.rebuild();
    renderer.transitionRuntime.rebuild();
    const resolved = renderer.transitionRuntime.resolve(
      "org.vj1.transition.mode-contract",
      { softness: 0.37 }
    );
    return {
      kernelId: resolved.transitionKernel.id,
      kernelSource: resolved.transitionKernel.source,
      parameters: resolved.transitionParameters,
    };
  });

  assert.equal(resolutions[0].kernelId, "org.vj1.transition.mode-contract");
  assert.deepEqual(resolutions[0], resolutions[1]);
  assert.equal(resolutions[0].parameters.softness, 0.37);
  assert.match(resolutions[0].kernelSource, /vj1Transition/);
});

test("transition activation owns catalog invalidation, renderer retention, and shader invalidation", () => {
  const calls = [];
  const state = createInitialState();
  const visualNodes = {
    builtInTransitions: [DefaultBuiltInTransition],
    packageTransitions: [],
    transitionEntries: [DefaultBuiltInTransition],
    visualLibrary: BuiltInVisualLibrary,
  };
  const runtime = new TransitionRuntime({
    getState: () => state,
    getVisualNodes: () => visualNodes,
    disposeTransitionShaders: () => calls.push("dispose-shaders"),
    retainTransitionKernels: (kernels) => calls.push(["retain", kernels.map((kernel) => kernel.id)]),
  });

  assert.equal(runtime.rebuild(), true);
  assert.equal(runtime.rebuild(), false, "an unchanged catalog does not churn context-bound shaders");
  assert.equal(calls.filter((entry) => entry === "dispose-shaders").length, 1);
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "retain").length, 1);
  const resolved = runtime.resolve("").transitionKernel;
  assert.equal(resolved.id, "vj1.transition.dissolve");
  assert.equal(resolved.implementation, "isf");

  runtime.invalidate();
  assert.equal(runtime.rebuild(), true);
  assert.equal(calls.filter((entry) => entry === "dispose-shaders").length, 2);
});

test("visual node capability retains one catalog across equivalent package refreshes", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const nodePackage = {
    formatVersion: 3,
    id: "org.vj1.test.empty",
    name: "Empty test package",
    version: "1.0.0",
    dependencies: [],
    nodeDependencies: [],
    definitions: [],
    artifacts: [],
    groups: [],
    forks: [],
    visualLibrary: [],
    resources: [],
    metadata: {},
  };

  assert.equal(
    renderer.visualNodeRuntime.setInstalledPackages([]),
    false,
    "the constructor package set is already authoritative",
  );
  assert.equal(renderer.visualNodeRuntime.setInstalledPackages([nodePackage]), true);
  const retainedResolver = renderer.visualNodeRuntime.nodes;
  assert.equal(
    renderer.visualNodeRuntime.setInstalledPackages([structuredClone(nodePackage)]),
    false,
    "equivalent package content does not rebuild context-bound visual resources",
  );
  assert.strictEqual(renderer.visualNodeRuntime.nodes, retainedResolver);
  renderer.dispose();
});

test("Component program capability owns compilation lookup and prepared-state lifecycles", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  renderer.state = createInitialState();
  renderer.visualNodeRuntime.rebuild();
  const runtime = renderer.componentProgramRuntime;

  assert.equal(runtime.constructor.name, "ComponentProgramRuntime");
  runtime.rebuild();
  runtime.rebuildLookups();
  assert.equal(runtime.programs instanceof Map, true);
  assert.equal(runtime.componentById instanceof Map, true);
  assert.equal(
    runtime.componentForId(renderer.state.components[0].id),
    renderer.state.components[0],
  );

  const prepared = runtime.prepare(renderer.state);
  assert.equal(runtime.prepare(renderer.state), prepared);
  runtime.clearPrepared();
  assert.equal(runtime.prepared, null);

  const rendererSource = readFileSync(
    new URL("../js/output/output-renderer.js", import.meta.url),
    "utf8",
  );
  const runtimeSource = readFileSync(
    new URL("../js/output/component-program-runtime.js", import.meta.url),
    "utf8",
  );
  const sourceBackend = readFileSync(
    new URL("../js/output/source-render-runtime.js", import.meta.url),
    "utf8",
  );
  const surfaceBackend = readFileSync(
    new URL("../js/output/output-surface-runtime.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(rendererSource, /compileComponentRenderPrograms\(/);
  assert.match(runtimeSource, /compileComponentRenderPrograms\(/);
  assert.match(sourceBackend, /host\.componentProgramRuntime\.programs/);
  assert.match(surfaceBackend, /renderer\.componentProgramRuntime\.componentById/);
  assert.doesNotMatch(rendererSource, /get componentPrograms\(\)/);

  runtime.dispose();
});

test("reused Preview renderers compile roots for their current presentation mode", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const state = createInitialState();
  const selected = state.components[0];
  const routed = structuredClone(selected);
  routed.id = "component-live-route";
  routed.name = "Live route";
  state.components.push(routed);
  state.ui.selectedComponentId = selected.id;
  state.surfaces = [{
    ...state.surfaces[0],
    enabled: true,
    componentId: routed.id,
  }];
  renderer.state = state;
  renderer.visualNodeRuntime.rebuild();
  renderer.componentProgramRuntime.rebuild();

  assert.equal(renderer.componentProgramRuntime.programs.has(selected.id), true);
  assert.equal(
    renderer.componentProgramRuntime.programs.has(routed.id),
    false,
    "Component mode initially compiles only its selected editor root",
  );

  renderer.mode = "live";
  renderer.componentProgramRuntime.ensureStateRoots(state);
  assert.equal(
    renderer.componentProgramRuntime.programs.has(routed.id),
    true,
    "switching the retained Preview renderer to Live follows routed roots instead of its construction-time mode",
  );
  renderer.dispose();
});

test("Component render capability owns request reuse trace and execution lifecycles", () => {
  const component = { id: "render-capability", type: "chain", name: "Render capability" };
  const output = { width: 320, height: 180 };
  let executions = 0;
  let mediaClaims = 0;
  const host = {
    state: { render: {}, components: [component], media: [] },
    media: new Map(),
    resourceRuntime: {
      componentOutput: new Map(),
      mainMix: null,
    },
    renderTargetRuntime: {
      gpuTarget: () => null,
      cpuTarget: () => null,
      touchGpu() {},
      touchCpu() {},
      gpu: () => output,
      hasCpuPrefix: () => false,
      hasGpuPrefix: () => false,
    },
    componentProgramRuntime: {
      programs: new Map([[
        component.id,
        {
          inspect: () => ({ dynamics: { frameDependent: true } }),
          execute: () => {
            executions++;
            return { buffer: output };
          },
        },
      ]]),
    },
    compositeRuntime: {
      renderComponentPipeline: ({ source }) => source,
    },
    frameRuntime: { frameIndex: 1 },
    profileRuntime: new OutputRenderProfile(),
    renderRequestRuntime: {
      normalize: (request) => request,
    },
    sourceRuntime: {
      claimRetainedComponentMedia: () => {
        mediaClaims++;
      },
    },
    visualNodeRuntime: { effect: () => null },
  };
  const runtime = new ComponentRenderRuntime(host);
  host.componentRenderRuntime = runtime;
  const request = {
    role: "component",
    width: 320,
    height: 180,
  };

  assert.strictEqual(runtime.render(component, 0, request), output);
  assert.strictEqual(runtime.render(component, 0, request), output);
  assert.equal(executions, 1);
  assert.equal(mediaClaims, 1);
  assert.equal(host.profileRuntime.frameProfile.componentCacheHits, 1);
  assert.equal(runtime.resolutionTraces.size, 1);

  runtime.activeResolutionTrace.push({ componentId: component.id });
  host.profileRuntime.collectDetailed = true;
  runtime.finishFrame();
  assert.deepEqual(runtime.lastResolutionTrace, [{ componentId: component.id }]);
  runtime.clear();
  assert.equal(runtime.stableSignatures.size, 0);
  assert.equal(runtime.resolutionTraces.size, 0);
  assert.deepEqual(runtime.lastResolutionTrace, []);
});

test("Live transition shares stable route views and preserves endpoint projection fit", () => {
  const source = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const transitionCall = source.slice(
    source.indexOf("renderer.mappingRuntime.mapper.drawTransitionTextures("),
    source.indexOf("renderer.mappingRuntime.mapper.drawTransitionTextures(") + 1800
  );

  assert.ok(source.includes("const directTransitionViews = new Map()"));
  assert.ok(source.includes("this.renderSurfaceRouteView(fromRoute)"));
  assert.ok(source.includes("this.renderSurfaceRouteView(toRoute)"));
  assert.ok(transitionCall.includes("fromProjectionFit: fromRoute?.surface?.projectionFit"));
  assert.ok(transitionCall.includes("toProjectionFit: toRoute?.surface?.projectionFit"));
  assert.ok(!transitionCall.includes('fromProjectionFit: "stretch"'));
  assert.ok(!transitionCall.includes('toProjectionFit: "stretch"'));
  assert.ok(transitionCall.includes("fromSourceRect: directViews.fromView.sourceRect"));
  assert.ok(transitionCall.includes("toSourceRect: directViews.toView.sourceRect"));
  assert.ok(transitionCall.includes("fromSourceFitActive:"));
  assert.ok(transitionCall.includes("toSourceFitActive:"));
});

test("Live transition mapper applies the stable source-view contract per endpoint", () => {
  const source = mapperTransitionFragmentShaderSource({ feather: true });
  assert.match(source, /uniform vec4 uFromSourceRect/);
  assert.match(source, /uniform vec4 uToSourceRect/);
  assert.match(source, /uniform vec4 uFromTextureView/);
  assert.match(source, /uniform vec4 uToTextureView/);
  assert.match(source, /uniform bool uFromUseSourceFit/);
  assert.match(source, /uniform bool uToUseSourceFit/);
  assert.match(source, /float fromProjectionSourceAspect = uFromUseSourceFit \? uFromSourceTargetAspect : uFromSourceAspect/);
  assert.match(source, /float toProjectionSourceAspect = uToUseSourceFit \? uToSourceTargetAspect : uToSourceAspect/);
  assert.match(source, /vec2 fromTextureUv = uFromSourceRect\.xy/);
  assert.match(source, /vec2 toTextureUv = uToSourceRect\.xy/);
  assert.match(source, /vec2 fromViewUv = \(fromUv - uFromTextureView\.xy\)/);
  assert.match(source, /vec2 toViewUv = \(toUv - uToTextureView\.xy\)/);
  assert.match(source, /fromInside \* uFromOpacity/);
  assert.match(source, /toInside \* uToOpacity/);
});

test("media renditions are saved without lossy jpeg compression", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const thumbnailSource = readFileSync(new URL("../js/output/thumbnail-utils.js", import.meta.url), "utf8");
  const renditionSource = readFileSync(new URL("../js/services/media-rendition-service.js", import.meta.url), "utf8");

  assert.ok(thumbnailSource.includes('canvas.toBlob(resolve, "image/png")'));
  assert.ok(!rendererSource.includes('"image/jpeg"'));
  assert.ok(!thumbnailSource.includes('"image/jpeg"'));
  assert.ok(renditionSource.includes(".png"));
  assert.ok(renditionSource.includes("png|jpe?g"));
});

test("projection mapper uses high precision for homography sampling", () => {
  const shaderSource = mapperFragmentShaderSource();

  assert.ok(shaderSource.includes("precision highp float;"));
  assert.ok(!shaderSource.includes("precision mediump float;"));
});
