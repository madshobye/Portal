import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createCompositionEffect, createCompositionLayer, createDefaultComposition, createInitialState, createLiveCompositionView, sanitizeState } from "../js/domain/models.js?v=world-frame-27";
import { normalizeParamValue } from "../js/graph/component-schema.js";
import { getGeneratorComponent } from "../js/graph/generator-registry.js";
import { compileCompositionPatch } from "../js/graph/render-scheduler.js?v=world-frame-27";
import { shouldHoldCurrentOutputState } from "../js/output/output-app.js";
import { OutputRenderer } from "../js/output/output-renderer.js?v=world-frame-27";
import { getMediaType, isMediaFile } from "../js/services/media-library-service.js";

test("media sources keep trim and playback speed through normalization and graph compile", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, {
      type: "media",
      mediaId: "clips/loop.mov",
      start: 1.25,
      end: 5.5,
      speed: 0.65,
      params: {
        fit: "contain",
      },
    }),
  ];
  state.compositions = [composition];

  const normalized = sanitizeState(state);
  const source = normalized.compositions[0].chain[0].source;
  assert.equal(source.start, 1.25);
  assert.equal(source.end, 5.5);
  assert.equal(source.speed, 0.65);
  assert.equal(source.params.fit, "contain");

  const patch = compileCompositionPatch(normalized.compositions[0]);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.start, 1.25);
  assert.equal(sourceNode.params.end, 5.5);
  assert.equal(sourceNode.params.speed, 0.65);
  assert.equal(sourceNode.params.fit, "contain");
});

test("generator sources keep personality params through normalization and graph compile", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, {
      type: "generator",
      generatorId: "eyeball",
      params: {
        irisSize: 1.2,
        pupilSize: 1.35,
        motionSpeed: 0.45,
        pauseAmount: 0.9,
        jitter: 0.8,
      },
    }),
  ];
  state.compositions = [composition];

  const normalized = sanitizeState(state);
  const source = normalized.compositions[0].chain[0].source;
  assert.equal(source.generatorId, "eyeball");
  assert.equal(source.params.irisSize, 1.2);
  assert.equal(source.params.pupilSize, 1.35);
  assert.equal(source.params.motionSpeed, 0.45);
  assert.equal(source.params.pauseAmount, 0.9);
  assert.equal(source.params.jitter, 0.8);

  const patch = compileCompositionPatch(normalized.compositions[0]);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.generatorId, "eyeball");
  assert.equal(sourceNode.params.irisSize, 1.2);
  assert.equal(sourceNode.params.pupilSize, 1.35);
  assert.equal(sourceNode.params.motionSpeed, 0.45);
  assert.equal(sourceNode.params.pauseAmount, 0.9);
  assert.equal(sourceNode.params.jitter, 0.8);
});

test("fireflies generator exposes cost and motion controls", () => {
  const component = getGeneratorComponent("fireflies");
  const ids = component.params.map((param) => param.id);
  const tintParam = component.params.find((param) => param.id === "tintColor");

  assert.deepEqual(ids, ["count", "glowSize", "speed", "trail", "brightness", "twinkle", "tintColor"]);
  assert.equal(normalizeParamValue(component.params.find((param) => param.id === "count"), undefined), 18);
  assert.equal(normalizeParamValue(component.params.find((param) => param.id === "trail"), undefined), 0.25);
  assert.equal(tintParam.type, "color");
  assert.equal(normalizeParamValue(tintParam, undefined), "#fff06dff");
});

test("gradient generator exposes rgba color stops", () => {
  const component = getGeneratorComponent("gradient");
  const colorParams = component.params.filter((param) => param.type === "color");
  const modeParam = component.params.find((param) => param.id === "mode");

  assert.equal(modeParam.type, "enum");
  assert.deepEqual(modeParam.values, ["linear", "radial", "single"]);
  assert.equal(modeParam.defaultValue, "linear");
  assert.deepEqual(colorParams.map((param) => param.id), ["colorA", "colorB", "colorC", "colorD"]);
  assert.equal(normalizeParamValue(colorParams[3], undefined), "#00000000");
  assert.equal(normalizeParamValue(colorParams[0], "#11223380"), "#11223380");
});

test("live source param overrides compile through node params", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, {
      type: "generator",
      generatorId: "gradient",
      params: {
        colorA: "#111111ff",
        colorB: "#222222ff",
      },
    }),
  ];
  state.compositions = [composition];
  state.ui.live = {
    selectedSceneId: "",
    compositionOverrides: {
      [composition.id]: {
        chain: [{
          params: {
            colorA: "#ff000080",
            mode: "single",
          },
        }],
      },
    },
  };

  const liveView = createLiveCompositionView(composition, state);
  assert.equal(liveView.chain[0].params.colorA, "#ff000080");
  assert.equal(liveView.chain[0].params.mode, "single");

  const patch = compileCompositionPatch(liveView);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.colorA, "#ff000080");
  assert.equal(sourceNode.params.mode, "single");
});

test("3d model media is detected and keeps render params", () => {
  assert.equal(isMediaFile("models/head.stl"), true);
  assert.equal(isMediaFile("models/head.obj"), true);
  assert.equal(isMediaFile("vectors/logo.svg"), true);
  assert.equal(getMediaType("models/head.stl"), "model");
  assert.equal(getMediaType("vectors/logo.svg"), "image");

  const state = createInitialState();
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, {
      type: "media",
      mediaId: "models/head.stl",
      params: {
        renderMode: "wireframe",
        rotationX: 0.4,
        rotationY: -0.25,
        rotationZ: 0.1,
        modelScale: 1.4,
        pointBudget: 8000,
        spinY: 0.2,
        surfaceColor: "#3366ccaa",
        wireColor: "#ffcc00ff",
      },
    }),
  ];
  state.compositions = [composition];
  state.media = [{ id: "models/head.stl", name: "head.stl", path: "models/head.stl", type: "model" }];

  const normalized = sanitizeState(state);
  const source = normalized.compositions[0].chain[0].source;
  assert.equal(source.params.renderMode, "wireframe");
  assert.equal(source.params.rotationX, 0.4);
  assert.equal(source.params.modelScale, 1.4);
  assert.equal(source.params.pointBudget, 8000);
  assert.equal(source.params.surfaceColor, "#3366ccaa");
  assert.equal(source.params.wireColor, "#ffcc00ff");

  const patch = compileCompositionPatch(normalized.compositions[0]);
  const sourceNode = patch.nodes.find((node) => node.role === "source");
  assert.equal(sourceNode.params.mediaId, "models/head.stl");
  assert.equal(sourceNode.params.renderMode, "wireframe");
  assert.equal(sourceNode.params.spinY, 0.2);
  assert.equal(sourceNode.params.pointBudget, 8000);
  assert.equal(sourceNode.params.surfaceColor, "#3366ccaa");
  assert.equal(sourceNode.params.wireColor, "#ffcc00ff");
});

test("3d model point mode uses cached bounded point clouds", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("drawRawParsedModel(target, item, params, compositionTime, \"points\""));
  assert.ok(source.includes("drawRawParsedModel(target, item, params, compositionTime, \"wireframe\""));
  assert.ok(source.includes("gl.drawArrays(mode === \"wireframe\" ? gl.LINES : gl.POINTS"));
  assert.ok(source.includes("ensureParsedModelPointCloud(item, pointBudget)"));
  assert.ok(source.includes("ensureParsedModelWireLines(item)"));
  assert.ok(source.includes("ensureP5ModelPointCloud(item, pointBudget)"));
  assert.ok(source.includes("Math.min(50000"));
  assert.ok(!source.includes("function drawModelPoints"));
});

test("renderer source extraction merges source node params", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("sourceWithNodeParams(node.state.source, node.params || {}"));
  assert.ok(source.includes("...generatorParams"));
  assert.ok(source.includes("...mediaParams"));
});

test("live source controls use dynamic param metadata", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(source.includes("liveSourceParamControlsTemplate(item, compositionId, path)"));
  assert.ok(source.includes("getGeneratorComponent(source.generatorId || \"testPattern\").params"));
  assert.ok(source.includes("MODEL_SOURCE_PARAMS"));
  assert.ok(source.includes("paramControlTemplate(param,"));
  assert.ok(!source.includes("function liveParamControlTemplate"));
});

test("color picker commits do not rebuild the inspector while open", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(source.includes("reason.startsWith(\"color:\")"));
  assert.ok(source.includes("rgbInput?.addEventListener(\"change\", () => updateFromRgb(`color:${control.dataset.colorPath}`));"));
  assert.ok(source.includes("alphaInput?.addEventListener(\"change\", () => updateColorParamFromControl(control, `color:${control.dataset.colorPath}`));"));
  assert.ok(source.includes("input?.addEventListener(\"change\", () => updateFromHsv(`color:${control.dataset.colorPath}`));"));
});

test("output renderer blackouts while active media sources are missing or loading", () => {
  const previousMillis = globalThis.millis;
  globalThis.millis = () => 2000;
  try {
    const state = createInitialState();
    const composition = createDefaultComposition(0);
    composition.chain = [
      createCompositionLayer(0, { type: "media", mediaId: "clips/loop.mov" }),
    ];
    state.compositions = [composition];
    state.surfaces = [{ ...state.surfaces[0], enabled: true, compositionId: composition.id }];
    const requested = [];
    const renderer = new OutputRenderer({
      mode: "output",
      requestMediaFiles: (ids) => requested.push(ids),
    });
    renderer.state = sanitizeState(state);

    let status = renderer.outputMediaReadiness();
    renderer.outputMediaStatus = status;
    assert.equal(status.blocked, true);
    assert.equal(status.missingIds.has("clips/loop.mov"), true);
    assert.deepEqual(requested, [["clips/loop.mov"]]);
    assert.equal(renderer.isOutputBlackout(), true);

    renderer.media.set("clips/loop.mov", { id: "clips/loop.mov", video: null, image: null, ready: false });
    status = renderer.outputMediaReadiness();
    renderer.outputMediaStatus = status;
    assert.equal(status.blocked, true);
    assert.equal(status.loadingIds.has("clips/loop.mov"), true);

    renderer.media.set("clips/loop.mov", { id: "clips/loop.mov", image: { width: 64, height: 64 }, ready: true });
    status = renderer.outputMediaReadiness();
    renderer.outputMediaStatus = status;
    assert.equal(status.blocked, false);
    assert.equal(renderer.isOutputBlackout(), false);
  } finally {
    if (previousMillis === undefined) delete globalThis.millis;
    else globalThis.millis = previousMillis;
  }
});

test("output client holds current project state during control window refresh boot state", () => {
  const current = createInitialState();
  current.project.folderName = "Loaded show";
  current.media = [{ id: "media/a.png", name: "a.png", type: "image" }];
  const boot = createInitialState();

  assert.equal(shouldHoldCurrentOutputState(boot, current), true);

  const restored = createInitialState();
  restored.project.folderName = "Loaded show";
  restored.media = [{ id: "media/a.png", name: "a.png", type: "image" }];
  assert.equal(shouldHoldCurrentOutputState(restored, current), false);
  assert.equal(shouldHoldCurrentOutputState(boot, null), false);
});

test("dirty cache classifier keeps static photo chains cacheable and animated noise dynamic", () => {
  const renderer = new OutputRenderer({ mode: "composition" });
  const state = createInitialState();
  state.media = [{ id: "media/a.png", path: "media/a.png", type: "image", size: 42 }];
  renderer.state = state;
  renderer.media.set("media/a.png", { ready: true });
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, { type: "media", mediaId: "media/a.png" }),
    createCompositionEffect("photoGrade"),
  ];
  composition.chain[1].params = { exposure: 0.25, contrast: 0.15 };

  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));

  composition.chain[1].params = { grain: 0.5, seedMode: "animated" };
  assert.equal(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }), "");

  composition.chain[1].params = { grain: 0.5, seedMode: "fixed", seed: 9 };
  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));

  composition.chain[1] = createCompositionEffect("smear");
  composition.chain[1].params = {
    cctvAmount: 0,
    screenPrintAmount: 0,
    dotMatrixAmount: 0,
    receiptAmount: 0,
    ditherAmount: 0,
    smearAmount: 0,
    seedMode: "animated",
  };
  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));

  composition.chain[1].params = { cctvAmount: 0.35, seedMode: "animated" };
  assert.equal(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }), "");

  composition.chain[1].params = { cctvAmount: 0.35, screenPrintAmount: 0.25, seedMode: "fixed", seed: 4 };
  assert.ok(renderer.stableCompositionSignature(composition, { role: "composition", width: 640, height: 360 }));
});
