const showOverlay = false;
const TINY_NN_STORAGE_KEY = "portal.tinyNNLab.v1";
const DEFAULT_NN_LAYERS = [1, 4, 10, 4, 1];
const MIN_HIDDEN_NEURONS = 1;
const MAX_HIDDEN_NEURONS = 16;
const MIN_HIDDEN_LAYERS = 1;
const MAX_HIDDEN_LAYERS = 6;
const NEW_LAYER_NEURONS = 4;
const FIT_PLOT_Y_MIN = -1.2;
const FIT_PLOT_Y_MAX = 1.2;
const FIT_PLOT_PAD_X = 8;
const FIT_PLOT_PAD_Y = 26;
const LOSS_PLOT_PAD_X = 8;
const LOSS_PLOT_PAD_Y = 22;
const LAB_ROW_H = 22;
const LAB_MODEL_ROW_H = 28;
const LAB_SECTION_H = 20;
const LAB_GAP = 5;
const LAB_OUTER_PAD = 24;
const DEFAULT_ARCHITECTURE_MODELS = [
  { name: "tiny", layers: [1, 3, 1] },
  { name: "classic", layers: [1, 4, 10, 4, 1] },
  { name: "deep", layers: [1, 8, 8, 8, 1] },
  { name: "wide", layers: [1, 16, 16, 1] },
  { name: "magic", layers: [1, 3, 6, 10, 6, 3, 1] },
  { name: "weaver", layers: [1, 4, 10, 4, 4, 1] },
];

let nn;
let samples = [];
let predictions = [];
let selectedConnection = null;
let selectedConnectionKey = "";
let selectedNeuron = null;
let lastNeuronToggleKey = "";
let lastActivationCycleKey = "";
let lastActivationCycleMs = -1000;
let neuronHitZones = [];
let architectureHitZones = [];
let suppressConnectionSelection = false;
let training = false;
let presetIndex = 0;
let sampleCount = 90;
let noiseAmount = 0.04;
let graphCenter = 0;
const GRAPH_SPAN = 2;
let customModels = [];
let activeCustomModelIndex = -1;
let architectureModelIndex = 1;
let lastUi = {};
let restoredState = null;
let lastStateSaveMs = 0;
let magicParams = {
  sinFreq: 1,
  cosFreq: 1,
  logCurve: 1,
  expCurve: 1,
  sqrtCurve: 1,
  squareGain: 1,
};

const LAB_UI = {
  bg: [15, 16, 18],
  panel: [28, 29, 32],
  panelSoft: [36, 37, 40],
  line: [244, 240, 232],
  muted: [244, 240, 232, 150],
  faint: [244, 240, 232, 22],
  stroke: [244, 240, 232, 34],
  ink: [15, 16, 18],
  accent: [126, 164, 255],
  target: "#5f5f5f",
  prediction: "#c66a2d",
  samples: "#d9c34a",
  loss: "#6f6f6f",
  radius: 3,
};

const presets = [
  {
    name: "line",
    params: [
      { key: "a", label: "a", min: -1.4, max: 1.4, value: 0.62 },
      { key: "b", label: "b", min: -0.8, max: 0.8, value: 0.12 },
    ],
    fn: (x, p) => p.a * x + p.b,
    label: (p) => `y = ${nf(p.a, 1, 2)}x + ${nf(p.b, 1, 2)}`,
  },
  {
    name: "curve",
    params: [
      { key: "a", label: "a", min: -1.4, max: 1.4, value: 0.82 },
      { key: "b", label: "b", min: -1.0, max: 1.0, value: 0 },
      { key: "c", label: "c", min: -0.8, max: 0.8, value: -0.38 },
    ],
    fn: (x, p) => p.a * x * x + p.b * x + p.c,
    label: (p) => `y = ${nf(p.a, 1, 2)}x^2 + ${nf(p.b, 1, 2)}x + ${nf(p.c, 1, 2)}`,
  },
  {
    name: "wave",
    params: [
      { key: "a", label: "a", min: -1.0, max: 1.0, value: 0.58 },
      { key: "f", label: "freq", min: 0.5, max: 5, value: 1 },
      { key: "p", label: "phase", min: -2, max: 2, value: 0 },
      { key: "b", label: "b", min: -0.8, max: 0.8, value: 0 },
    ],
    fn: (x, p) => p.a * Math.sin(Math.PI * p.f * x + Math.PI * p.p) + p.b,
    label: (p) => `y = ${nf(p.a, 1, 2)}sin(${nf(p.f, 1, 2)}PI x + ${nf(p.p, 1, 2)}PI) + ${nf(p.b, 1, 2)}`,
  },
  {
    name: "sin+cos",
    params: [
      { key: "sa", label: "sin a", min: -1.0, max: 1.0, value: 0.46 },
      { key: "sf", label: "sin f", min: 0.5, max: 6, value: 1.55 },
      { key: "ca", label: "cos a", min: -1.0, max: 1.0, value: 0.32 },
      { key: "cf", label: "cos f", min: 0.5, max: 6, value: 3.25 },
      { key: "b", label: "b", min: -0.8, max: 0.8, value: -0.06 },
    ],
    fn: (x, p) => (
      p.sa * Math.sin(Math.PI * p.sf * x) +
      p.ca * Math.cos(Math.PI * p.cf * x) +
      p.b
    ),
    label: (p) => `${nf(p.sa, 1, 2)}sin(${nf(p.sf, 1, 2)}PI x) + ${nf(p.ca, 1, 2)}cos(${nf(p.cf, 1, 2)}PI x) + ${nf(p.b, 1, 2)}`,
  },
  {
    name: "bend",
    params: [
      { key: "a", label: "a", min: -1.0, max: 1.0, value: 0.72 },
      { key: "s", label: "steep", min: 0.2, max: 5, value: 2.4 },
      { key: "b", label: "b", min: -0.8, max: 0.8, value: 0 },
    ],
    fn: (x, p) => Math.tanh(p.s * x) * p.a + p.b,
    label: (p) => `y = ${nf(p.a, 1, 2)}tanh(${nf(p.s, 1, 2)}x) + ${nf(p.b, 1, 2)}`,
  },
  {
    name: "noise",
    params: [
      { key: "a", label: "amp", min: -1.4, max: 1.4, value: 0.92 },
      { key: "s", label: "scale", min: 0.2, max: 5, value: 1.4 },
      { key: "o", label: "offset", min: -8, max: 8, value: 0 },
      { key: "b", label: "b", min: -0.8, max: 0.8, value: 0 },
    ],
    fn: (x, p) => p.a * (noise(x * p.s + p.o) * 2 - 1) + p.b,
    label: (p) => `y = ${nf(p.a, 1, 2)}noise(${nf(p.s, 1, 2)}x + ${nf(p.o, 1, 2)}) + ${nf(p.b, 1, 2)}`,
  },
];

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await waitForPortalRuntime();
  await loadScript("portal/PortalTinyNN.js");
  restoredState = loadLabState();
  applySavedPresetState(restoredState);
  createNetwork();
  applySavedRuntimeState(restoredState);
  regenerateSamples();
  installTinyNNPointerHandlers();
  installTinyNNSaveHandlers();
  training = restoredState?.training ?? true;
  uiSetState("tiny-nn-training", training);
}

function waitForPortalRuntime() {
  if (typeof loadScript === "function") return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (typeof loadScript === "function") resolve();
      else setTimeout(check, 20);
    };
    check();
  });
}

function installTinyNNPointerHandlers() {
  if (window.__tinyNNPointerHandlersInstalled) return;
  window.__tinyNNPointerHandlersInstalled = true;
}

function installTinyNNSaveHandlers() {
  if (window.__tinyNNSaveHandlersInstalled) return;
  window.__tinyNNSaveHandlersInstalled = true;
  window.addEventListener("beforeunload", () => saveLabStateThrottled(true));
}

function draw() {
  background(LAB_UI.bg);
  if (!mouseIsPressed) {
    lastNeuronToggleKey = "";
    lastActivationCycleKey = "";
    suppressConnectionSelection = false;
  }

  if (training && nn) {
    nn.train(samples, { steps: 1, learningRate: lastUi.learningRate ?? 0.012 });
  }
  syncGraphWindowFromUi();
  saveLabStateThrottled();

  updatePredictions();
  const layout = getLayout();
  drawMainSurface(layout);
  drawNetwork(layout.networkX, layout.networkY, layout.networkW, layout.networkH);
  drawSidePanel(layout);
}

function createNetwork({ keepToggles = false, keepMagicParams = true, layers = null } = {}) {
  const disabled = keepToggles && nn?.getDisabledNeurons ? nn.getDisabledNeurons() : null;
  const activations = keepToggles && nn?.getNeuronActivations ? nn.getNeuronActivations() : null;
  const params = keepMagicParams && nn?.getMagicParams ? nn.getMagicParams() : magicParams;
  const nextLayers = layers || nn?.layers || DEFAULT_NN_LAYERS;
  nn = new PortalTinyNN({
    layers: nextLayers,
    activations: buildNetworkActivations(nextLayers, nn?.activations),
    learningRate: 0.012,
    optimizer: "adam",
    magicParams: params,
    seed: floor(random(1, 999999)),
  });
  if (disabled) nn.setDisabledNeurons(disabled);
  if (activations) nn.setNeuronActivations(activations);
  magicParams = nn.getMagicParams();
  selectedConnection = null;
  selectedConnectionKey = "";
  selectedNeuron = null;
}

function buildNetworkActivations(layers, previous = null) {
  const last = layers.length - 1;
  const magicLayer = constrain(Math.floor(last * 0.5), 1, max(1, last - 1));
  return layers.map((_, layer) => {
    if (layer === 0) return "input";
    if (layer === last) return "linear";
    if (previous?.[layer] && previous[layer] !== "input" && previous[layer] !== "linear") return previous[layer];
    return layer === magicLayer ? "magic" : "tanh";
  });
}

function hiddenSignature(layers = nn?.layers || DEFAULT_NN_LAYERS) {
  return layers.slice(1, -1).join(" / ");
}

function layersEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => value === b[i]);
}

function getArchitectureModels() {
  const custom = customModels.map((model, i) => ({ ...model, custom: true, customIndex: i }));
  return [...DEFAULT_ARCHITECTURE_MODELS, ...custom];
}

function getCurrentArchitectureModelLabel() {
  const current = nn?.layers || DEFAULT_NN_LAYERS;
  if (activeCustomModelIndex >= 0 && customModels[activeCustomModelIndex]) {
    return `${customModels[activeCustomModelIndex].name}: ${hiddenSignature(current)}`;
  }
  const defaultMatch = DEFAULT_ARCHITECTURE_MODELS.find((model) => layersEqual(model.layers, current));
  if (defaultMatch) return `${defaultMatch.name}: ${hiddenSignature(current)}`;
  const customMatch = customModels.findIndex((model) => layersEqual(model.layers, current));
  if (customMatch >= 0) return `${customModels[customMatch].name}: ${hiddenSignature(current)}`;
  return `custom: ${hiddenSignature(current)}`;
}

function snapshotCurrentArchitecture(name = null) {
  return {
    name: name || `Custom ${customModels.length + 1}`,
    layers: [...(nn?.layers || DEFAULT_NN_LAYERS)],
    activations: [...(nn?.activations || buildNetworkActivations(nn?.layers || DEFAULT_NN_LAYERS))],
    neuronActivations: nn?.getNeuronActivations ? nn.getNeuronActivations() : {},
  };
}

function updateActiveCustomModel() {
  if (activeCustomModelIndex < 0 || !customModels[activeCustomModelIndex] || !nn) return;
  customModels[activeCustomModelIndex] = {
    ...customModels[activeCustomModelIndex],
    layers: [...nn.layers],
    activations: [...nn.activations],
    neuronActivations: nn.getNeuronActivations ? nn.getNeuronActivations() : {},
  };
}

function ensureCustomForEdit() {
  if (!nn) return;
  if (activeCustomModelIndex >= 0 && customModels[activeCustomModelIndex]) {
    updateActiveCustomModel();
    return;
  }
  const currentDefault = DEFAULT_ARCHITECTURE_MODELS.find((model) => layersEqual(model.layers, nn.layers));
  const name = currentDefault ? `${displayName(currentDefault.name)} Edit` : `Custom ${customModels.length + 1}`;
  customModels.push(snapshotCurrentArchitecture(name));
  activeCustomModelIndex = customModels.length - 1;
}

function duplicateCurrentArchitecture() {
  if (!nn) return;
  const fallback = activeCustomModelIndex >= 0 && customModels[activeCustomModelIndex]
    ? `${customModels[activeCustomModelIndex].name} Copy`
    : `${displayName(getCurrentArchitectureModelLabel().split(":")[0])} Copy`;
  const name = (window.prompt("Name custom model", fallback) || "").trim();
  if (!name) return;
  customModels.push(snapshotCurrentArchitecture(name));
  activeCustomModelIndex = customModels.length - 1;
  saveLabStateThrottled(true);
}

function deleteCustomModel(index) {
  if (!customModels[index]) return;
  customModels.splice(index, 1);
  if (activeCustomModelIndex === index) activeCustomModelIndex = -1;
  else if (activeCustomModelIndex > index) activeCustomModelIndex -= 1;
  saveLabStateThrottled(true);
}

function rememberCustomArchitecture(layers = nn?.layers) {
  if (!Array.isArray(layers)) return;
  ensureCustomForEdit();
  updateActiveCustomModel();
}

function cycleArchitectureModel() {
  const models = getArchitectureModels();
  if (!models.length || !nn?.resizeLayers) return;
  const currentIndex = models.findIndex((model) => layersEqual(model.layers, nn.layers));
  architectureModelIndex = (currentIndex >= 0 ? currentIndex + 1 : architectureModelIndex + 1) % models.length;
  applyArchitectureModel(models[architectureModelIndex]);
}

function applyArchitectureModel(model) {
  if (!model?.layers || !nn?.resizeLayers) return;
  nn.resizeLayers(model.layers, { activations: model.activations || buildNetworkActivations(model.layers, nn.activations), preserve: true });
  if (model.neuronActivations && nn.setNeuronActivations) nn.setNeuronActivations(model.neuronActivations);
  activeCustomModelIndex = Number.isInteger(model.customIndex) ? model.customIndex : -1;
  selectedConnection = null;
  selectedConnectionKey = "";
  selectedNeuron = null;
  saveLabStateThrottled(true);
}

function loadLabState() {
  try {
    const raw = localStorage.getItem(TINY_NN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Tiny NN state load failed:", error);
    return null;
  }
}

function saveLabStateThrottled(force = false) {
  if (!nn) return;
  if (!force && millis() - lastStateSaveMs < 600) return;
  lastStateSaveMs = millis();
  try {
    localStorage.setItem(TINY_NN_STORAGE_KEY, JSON.stringify({
      version: 1,
      presetIndex,
      presetName: presets[presetIndex]?.name,
      presetParams: exportPresetParams(),
      noiseAmount,
      graphCenter,
      customModels,
      activeCustomModelIndex,
      architectureModelIndex,
      training,
      learningRate: lastUi.learningRate ?? 0.012,
      network: nn.exportState(),
    }));
  } catch (error) {
    console.warn("Tiny NN state save failed:", error);
  }
}

function applySavedPresetState(state) {
  if (!state || typeof state !== "object") return;
  const savedPresetIndex = typeof state.presetName === "string"
    ? presets.findIndex((preset) => preset.name === state.presetName)
    : -1;
  if (savedPresetIndex >= 0) {
    presetIndex = savedPresetIndex;
  } else if (Number.isInteger(state.presetIndex)) {
    presetIndex = constrain(state.presetIndex, 0, presets.length - 1);
  }
  if (Number.isFinite(Number(state.noiseAmount))) noiseAmount = Number(state.noiseAmount);
  if (Number.isFinite(Number(state.graphCenter))) graphCenter = constrain(Number(state.graphCenter), -2, 2);
  if (Array.isArray(state.customModels)) {
    customModels = state.customModels
      .filter((model) => model && Array.isArray(model.layers))
      .map((model, i) => ({
        name: String(model.name || `Custom ${i + 1}`),
        layers: model.layers.map((n) => Math.max(1, Math.floor(Number(n) || 1))).filter(Number.isFinite),
        activations: Array.isArray(model.activations) ? [...model.activations] : null,
        neuronActivations: model.neuronActivations && typeof model.neuronActivations === "object" ? model.neuronActivations : {},
      }))
      .filter((model) => model.layers.length >= 3);
  } else if (Array.isArray(state.recentCustomModels)) {
    customModels = state.recentCustomModels
      .filter((layers) => Array.isArray(layers))
      .map((layers, i) => ({
        name: `Custom ${i + 1}`,
        layers: layers.map((n) => Math.max(1, Math.floor(Number(n) || 1))),
        activations: null,
        neuronActivations: {},
      }))
      .filter((model) => model.layers.length >= 3);
  }
  if (Number.isInteger(state.activeCustomModelIndex)) {
    activeCustomModelIndex = state.activeCustomModelIndex >= 0 && state.activeCustomModelIndex < customModels.length
      ? state.activeCustomModelIndex
      : -1;
  }
  if (Number.isInteger(state.architectureModelIndex)) architectureModelIndex = state.architectureModelIndex;
  if (Number.isFinite(Number(state.learningRate))) lastUi.learningRate = Number(state.learningRate);
  importPresetParams(state.presetParams);
}

function applySavedRuntimeState(state) {
  if (!state || typeof state !== "object") return;
  if (state.network && nn?.importState) nn.importState(state.network);
  magicParams = nn?.getMagicParams?.() || magicParams;
  uiSetState("tiny-nn-noise", noiseAmount);
  uiSetState("tiny-nn-lr", lastUi.learningRate ?? 0.012);
  uiSetState("tiny-nn-graph-center", graphCenter);
  for (const preset of presets) {
    for (const param of preset.params || []) {
      uiSetState(`target-${preset.name}-${param.key}`, param.value);
    }
  }
}

function exportPresetParams() {
  const out = {};
  for (const preset of presets) {
    out[preset.name] = {};
    for (const param of preset.params || []) out[preset.name][param.key] = param.value;
  }
  return out;
}

function importPresetParams(saved = {}) {
  if (!saved || typeof saved !== "object") return;
  for (const preset of presets) {
    const presetSaved = saved[preset.name];
    if (!presetSaved || typeof presetSaved !== "object") continue;
    for (const param of preset.params || []) {
      if (Number.isFinite(Number(presetSaved[param.key]))) {
        param.value = Number(presetSaved[param.key]);
      }
    }
  }
}

function regenerateSamples() {
  samples = [];
  const preset = presets[presetIndex];
  const params = getPresetParams(preset);
  const win = getGraphWindow();
  for (let i = 0; i < sampleCount; i++) {
    const x = map(i, 0, sampleCount - 1, win.xMin, win.xMax);
    const jitter = randomGaussian() * noiseAmount;
    const clean = preset.fn(x, params);
    const y = clean + jitter;
    samples.push({ input: [x], output: [y], clean });
  }
  if (nn) nn.lossHistory = [];
}

function syncGraphWindowFromUi() {
  if (typeof uiGetState !== "function") return;
  const nextCenter = constrain(Number(uiGetState("tiny-nn-graph-center", graphCenter)) || 0, -2, 2);
  const win = getGraphWindow();
  const staleSamples = !samples.length ||
    abs(samples[0].input[0] - win.xMin) > 1e-6 ||
    abs(samples[samples.length - 1].input[0] - win.xMax) > 1e-6;
  if (abs(nextCenter - graphCenter) > 1e-9) {
    graphCenter = nextCenter;
    regenerateSamples();
  } else if (staleSamples) {
    regenerateSamples();
  }
}

function getPresetParams(preset = presets[presetIndex]) {
  const out = {};
  for (const param of preset.params || []) out[param.key] = param.value;
  return out;
}

function getPresetLabel(preset = presets[presetIndex]) {
  return typeof preset.label === "function" ? preset.label(getPresetParams(preset)) : preset.label;
}

function getGraphWindow() {
  const half = GRAPH_SPAN * 0.5;
  return {
    xMin: graphCenter - half,
    xMax: graphCenter + half,
  };
}

function getSampleWindow(fallback = getGraphWindow()) {
  if (!samples.length) return fallback;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const sample of samples) {
    const x = sample?.input?.[0];
    if (!Number.isFinite(x)) continue;
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return fallback;
  if (abs(xMax - xMin) < 1e-6) {
    xMin -= 0.5;
    xMax += 0.5;
  }
  return { xMin, xMax };
}

function getFitPlotYRange(seriesLists = []) {
  let yMin = FIT_PLOT_Y_MIN;
  let yMax = FIT_PLOT_Y_MAX;
  for (const values of seriesLists) {
    for (const p of values || []) {
      const y = Array.isArray(p) ? Number(p[1]) : Number(p?.y ?? p?.value);
      if (!Number.isFinite(y)) continue;
      yMin = min(yMin, y);
      yMax = max(yMax, y);
    }
  }
  const pad = max(0.08, (yMax - yMin) * 0.06);
  return {
    yMin: yMin - pad,
    yMax: yMax + pad,
  };
}

function updatePredictions() {
  if (!nn) return;
  const win = getSampleWindow();
  predictions = [];
  for (let i = 0; i <= 120; i++) {
    const x = map(i, 0, 120, win.xMin, win.xMax);
    predictions.push({ x, y: nn.predict([x])[0] });
  }
}

function getLayout() {
  const compact = width < 820;
  const panelY = LAB_OUTER_PAD;
  const panelW = compact ? constrain(width * 0.34, 184, 228) : 252;
  const panelListW = panelW * 0.5;
  const gap = compact ? 12 : 24;
  const networkX = LAB_OUTER_PAD + panelListW + gap;
  const surfaceInsetX = 14;
  const networkW = max(220, width - networkX - LAB_OUTER_PAD - surfaceInsetX);
  const graphStatsW = compact ? 112 : 128;
  const graphRunW = compact ? 96 : 112;
  const graphSamplingW = compact ? 104 : 124;
  const graphGap = 10;
  const graphRowX = networkX - surfaceInsetX;
  const graphRowW = networkW + surfaceInsetX * 2;
  const graphW = max(180, graphRowW - graphSamplingW - graphRunW - graphStatsW - graphGap * 3);
  const graphH = compact ? 150 : 172;
  const graphBottomGap = LAB_OUTER_PAD;
  const graphY = height - graphH - graphBottomGap;
  const networkY = panelY + 16;
  return {
    compact,
    panelX: LAB_OUTER_PAD,
    panelY,
    panelW,
    panelListW,
    networkX,
    networkY,
    networkW,
    surfaceInsetX,
    networkH: max(230, graphY - networkY - 24),
    graphSamplingX: graphRowX,
    graphSamplingW,
    graphX: graphRowX + graphSamplingW + graphGap,
    graphY,
    graphW,
    graphH,
    graphRunX: graphRowX + graphSamplingW + graphGap + graphW + graphGap,
    graphRunW,
    graphStatsX: graphRowX + graphSamplingW + graphGap + graphW + graphGap + graphRunW + graphGap,
    graphStatsW,
  };
}

function drawMainSurface(layout) {
  const graphX = layout.graphX;
  const graphY = layout.graphY;
  const graphW = layout.graphW;
  const graphH = layout.graphH;
  const surfaceW = layout.networkW;
  const surfaceInsetX = layout.surfaceInsetX;
  const surfacePadTop = 16;
  const surfaceBottom = graphY - 10;

  noStroke();
  fill(LAB_UI.panel);
  rect(
    layout.networkX - surfaceInsetX,
    layout.networkY - surfacePadTop,
    surfaceW + surfaceInsetX * 2,
    surfaceBottom - layout.networkY + surfacePadTop,
    LAB_UI.radius
  );

  const sampleWin = getSampleWindow();
  const target = Array.from({ length: 121 }, (_, i) => {
    const x = map(i, 0, 120, sampleWin.xMin, sampleWin.xMax);
    const preset = presets[presetIndex];
    return { x, y: preset.fn(x, getPresetParams(preset)) };
  });
  const samplePoints = samples.map((s) => ({ x: s.input[0], y: s.output[0] }));
  const yRange = getFitPlotYRange([target, predictions, samplePoints]);
  uiPlot("fit-plot", [
    { label: "target", values: target, color: LAB_UI.target, weight: 2.5 },
    { label: "prediction", values: predictions, color: LAB_UI.prediction, weight: 2.5 },
    { label: "samples", values: samplePoints, color: LAB_UI.samples, pointSize: 5.5 },
  ], {
    x: graphX,
    y: graphY,
    width: graphW,
    height: graphH,
    xMin: sampleWin.xMin,
    xMax: sampleWin.xMax,
    yMin: yRange.yMin,
    yMax: yRange.yMax,
    bgColor: LAB_UI.panelSoft,
    gridColor: [244, 240, 232, 18],
    axisColor: [244, 240, 232, 52],
    textColor: [244, 240, 232, 140],
    paddingX: FIT_PLOT_PAD_X,
    paddingY: FIT_PLOT_PAD_Y,
    dataInsetXRatio: 0,
    dataInsetYRatio: 0.035,
    dataInsetPx: 4,
    headerItems: [
      { label: "target", color: LAB_UI.target },
      { label: "prediction", color: LAB_UI.prediction },
      { label: "samples", color: LAB_UI.samples },
    ],
    headerText: getPresetLabel(),
    headerTextColor: [244, 240, 232, 105],
    footerText: `Window ${nf(sampleWin.xMin, 1, 2)}..${nf(sampleWin.xMax, 1, 2)}`,
    footerTextColor: [244, 240, 232, 105],
    rounding: LAB_UI.radius,
  });

  drawGraphSamplingControls(layout);
  drawGraphViewSlider(graphX, graphY, graphW, graphH, sampleWin);
  drawTrainingDomainMarkers(graphX, graphY, graphW, graphH, sampleWin);
  drawGraphRunControls(layout);
  drawGraphStats(layout);
}

function drawGraphRunControls(layout) {
  const x = layout.graphRunX;
  let y = layout.graphY;
  const w = layout.graphRunW;
  const rowH = LAB_ROW_H;
  const gap = LAB_GAP;

  const trainToggle = uiToggle("tiny-nn-training", training ? "Training" : "Train", labToggleStyle({
    x,
    y,
    width: w,
    height: rowH,
    fontSize: 11,
    padding: 6,
    textColor: training ? [244, 240, 232] : LAB_UI.muted,
  }));
  training = trainToggle.value;
  y += rowH + gap;

  if (uiButton("Reset Weights", labButtonStyle({ x, y, width: w, height: rowH, fontSize: 11, padding: 6 })).clicked) {
    createNetwork({ keepToggles: true });
  }
  y += rowH + gap;

  const lr = uiSlider("tiny-nn-lr", "Learning", { min: 0.001, max: 0.08, init: 0.012 }, labSliderStyle({
    x,
    y,
    width: w,
    height: rowH,
    fontSize: 11,
    padding: 6,
  }));
  lastUi.learningRate = lr.value;
  y += rowH + gap;

  const noise = uiSlider("tiny-nn-noise", "Sample noise", { min: 0, max: 0.22, init: noiseAmount }, labSliderStyle({
    x,
    y,
    width: w,
    height: rowH,
    fontSize: 11,
    padding: 6,
  }));
  if (noise.changed) {
    noiseAmount = noise.value;
    regenerateSamples();
  }
}

function drawGraphSamplingControls(layout) {
  const x = layout.graphSamplingX;
  let y = layout.graphY;
  const w = layout.graphSamplingW;
  const rowH = LAB_ROW_H;
  const gap = LAB_GAP;

  if (uiButton(`F: ${displayName(presets[presetIndex].name)}`, labButtonStyle({ x, y, width: w, height: rowH, fontSize: 11, padding: 6 })).clicked) {
    presetIndex = (presetIndex + 1) % presets.length;
    regenerateSamples();
    createNetwork();
  }
  y += rowH + gap;

  drawFunctionParamSliders(x, y, w, rowH, gap);
}

function drawGraphViewSlider(x, y, w, h, win) {
  const label = `Window ${nf(win.xMin, 1, 2)}..${nf(win.xMax, 1, 2)}`;
  textSize(11);
  const sliderX = x + 150;
  const rangeLabelReserve = 54;
  const sliderW = constrain(w * 0.28, 180, 340);
  const availableW = max(0, x + w - rangeLabelReserve - sliderX);
  if (availableW < 68) return;
  const view = uiSlider("tiny-nn-graph-center", "", { min: -2, max: 2, init: graphCenter }, {
    ...labSliderStyle({
      x: sliderX,
      y: y + h - 18,
      width: min(sliderW, availableW),
      height: 12,
      rounding: 6,
      padding: 0,
      fontSize: 10,
    }),
    trackColor: [244, 240, 232, 28],
    fillColor: [244, 240, 232, 48],
    textColor: [244, 240, 232, 130],
    hideText: true,
  });
  graphCenter = view.value;
  if (view.changed) {
    regenerateSamples();
  }
}

function drawGraphStats(layout) {
  if (!nn) return;
  const stats = nn.getStats?.() || {};
  const x = layout.graphStatsX;
  const y = layout.graphY;
  const w = layout.graphStatsW;
  const rowH = LAB_ROW_H;
  const gap = LAB_GAP;
  const labelW = min(48, w * 0.43);
  const valueW = w - labelW - gap;
  const statText = (label, value, yy) => {
    uiText(label, labTextStyle({ x, y: yy, width: labelW, height: rowH, fontSize: 11, hAlign: "left", padding: 6 }));
    uiText(value, labTextStyle({ x: x + labelW + gap, y: yy, width: valueW, height: rowH, fontSize: 11, hAlign: "right", padding: 6 }));
  };

  statText("Epoch", String(stats.iteration ?? 0), y);
  statText("Loss", nf(stats.loss ?? 0, 1, 5), y + rowH + gap);

  const lossY = y + (rowH + gap) * 2;
  const lossBottom = layout.graphY + layout.graphH;
  const lossH = max(58, lossBottom - lossY);
  uiPlot("loss-plot", [{ values: stats.lossHistory || [], color: LAB_UI.loss, weight: 2 }], {
    x,
    y: lossY,
    width: w,
    height: lossH,
    label: "Loss",
    bgColor: LAB_UI.panelSoft,
    gridColor: [244, 240, 232, 18],
    axisColor: [244, 240, 232, 48],
    textColor: [244, 240, 232, 132],
    paddingX: LOSS_PLOT_PAD_X,
    paddingY: LOSS_PLOT_PAD_Y,
    rounding: LAB_UI.radius,
  });

}

function drawTrainingDomainMarkers(x, y, w, h, win) {
  const plotX = x + FIT_PLOT_PAD_X;
  const plotW = w - FIT_PLOT_PAD_X * 2;
  stroke(244, 240, 232, 58);
  strokeWeight(1);
  for (const edge of [-1, 1]) {
    if (edge < win.xMin || edge > win.xMax) continue;
    const sx = map(edge, win.xMin, win.xMax, plotX, plotX + plotW);
    line(sx, y + FIT_PLOT_PAD_Y, sx, y + h - FIT_PLOT_PAD_Y);
  }
  noStroke();
}

function drawNetwork(x, y, w, h) {
  if (!nn) return;
  drawNetworkCredit(x, y, w);
  const weights = nn.getWeights();
  const biases = nn.getBiases();
  const layers = nn.layers;
  const positions = [];
  const weightVisuals = getWeightVisualStats(weights, layers);
  const networkPadX = min(58, max(26, w * 0.07));
  const networkPadTop = 48;
  const networkControlBand = 46;
  const neuronTop = y + networkPadTop;
  const neuronBottom = y + h - networkControlBand;
  const neuronH = max(80, neuronBottom - neuronTop);
  let hovered = null;
  neuronHitZones = [];
  architectureHitZones = [];

  for (let layer = 0; layer < layers.length; layer++) {
    positions[layer] = [];
    for (let n = 0; n < layers[layer]; n++) {
      positions[layer][n] = {
        x: x + map(layer, 0, layers.length - 1, networkPadX, w - networkPadX),
        y: neuronTop + neuronH * 0.5 + (n - (layers[layer] - 1) * 0.5) * min(66, neuronH / max(1, layers[layer])),
      };
    }
  }

  const hoveredNeuron = findHoveredNeuron(positions, layers);
  hovered = hoveredNeuron ? null : findHoveredConnection(positions, weights, layers);
  const focus = hoveredNeuron || hovered || getSelectedConnectionFocus(positions, weights) || getSelectedNeuronFocus(positions);

  for (let layer = 1; layer < layers.length; layer++) {
    for (let row = 0; row < layers[layer]; row++) {
      for (let col = 0; col < layers[layer - 1]; col++) {
        const a = positions[layer - 1][col];
        const b = positions[layer][row];
        const value = weights[layer][row][col];
        const strength = getWeightStrength(value, weightVisuals.scale);
        const connectionEnabled = isNeuronEnabled(layer, row) && isNeuronEnabled(layer - 1, col);
        const isSelected = selectedConnection &&
          selectedConnection.layer === layer &&
          selectedConnection.row === row &&
          selectedConnection.col === col;
        const relation = getConnectionRelation({ layer, row, col }, focus);
        const focusActive = !!focus;
        const primary = relation === "primary" || isSelected;
        const related = relation === "incoming" || relation === "outgoing";
        const propagated = relation === "propagate-in" || relation === "propagate-out";
        const baseAlpha = focusActive && !primary && !related ? 16 : map(strength, 0, 1, 28, 155);
        const alpha = connectionEnabled ? (primary ? 245 : related ? 195 : propagated ? 90 : baseAlpha) : 16;
        const width = primary
          ? map(strength, 0, 1, 4.8, 9.4)
          : related
            ? map(strength, 0, 1, 2.5, 6.2)
            : propagated
              ? map(strength, 0, 1, 1.2, 3.4)
              : map(strength, 0, 1, 0.6, 4.6);
        drawWeightedConnection(a, b, value, width, alpha, { primary, related, propagated });
      }
    }
  }

  for (let layer = 0; layer < layers.length; layer++) {
    for (let n = 0; n < layers[layer]; n++) {
      const p = positions[layer][n];
      const bias = layer > 0 ? biases[layer][n][0] : null;
      const activationLabel = getNeuronActivationLabel(layer, n);
      const enabled = isNeuronEnabled(layer, n);
      const selectable = layer > 0;
      const canToggle = layer > 0 && layer < layers.length - 1;
      const neuronHover = hoveredNeuron &&
        hoveredNeuron.layer === layer &&
        hoveredNeuron.neuron === n;
      const neuronSelected = selectedNeuron &&
        selectedNeuron.layer === layer &&
        selectedNeuron.neuron === n;
      if (selectable) neuronHitZones.push({ layer, neuron: n, x: p.x, y: p.y, canToggle });
      drawNeuronFlowHalo(p.x, p.y, layer, n, weightVisuals, focus);
      noStroke();
      fill(enabled ? [104, 105, 108] : [58, 59, 62]);
      circle(p.x, p.y, 26);
      if (!enabled) {
        stroke(LAB_UI.bg[0], LAB_UI.bg[1], LAB_UI.bg[2], 220);
        strokeWeight(2);
        line(p.x - 8, p.y + 8, p.x + 8, p.y - 8);
        noStroke();
      }
      if (neuronHover || neuronSelected) {
        noFill();
        stroke(244, 240, 232, neuronSelected ? 210 : 145);
        strokeWeight(neuronSelected ? 3 : 2);
        circle(p.x, p.y, 34);
        noStroke();
      }
      fill(enabled ? LAB_UI.line : LAB_UI.muted);
      textAlign(CENTER, CENTER);
      textSize(layer === 0 ? 11 : 9);
      text(layer === 0 ? "x" : nf(bias, 1, 1), p.x, p.y);
      if (nn.activations?.[layer] === "magic") {
        drawMagicActivationLabel(activationLabel, p.x + 22, p.y, layer, n);
      } else {
        drawActivationLabel(activationLabel, p.x, p.y - 25, layer, n);
      }
    }
  }

  if (drawArchitectureControls(positions, x, y, w, h)) return;

  if (hovered) {
    drawConnectionTooltip(hovered);
    if (mouseIsPressed && !suppressConnectionSelection && !isMouseInPanel()) {
      selectedConnection = { layer: hovered.layer, row: hovered.row, col: hovered.col };
      selectedConnectionKey = `${hovered.layer}:${hovered.row}:${hovered.col}`;
      selectedNeuron = null;
      uiSetState("selected-weight", hovered.value);
    }
  }
}

function drawNetworkCredit(x, y, w) {
  fill(LAB_UI.muted);
  noStroke();
  textSize(11);
  textAlign(RIGHT, TOP);
  text("NN-LAB by Halim Rahman and Mads Hobye", x + w + 6, y - 8);
}

function drawArchitectureControls(positions, x, y, w, h) {
  if (!nn?.resizeLayers || !positions?.length) return false;
  let changed = false;
  const controlY = y + h - 24;
  const controlH = 18;
  const overlayButtonStyle = labButtonStyle({
    width: 24,
    height: controlH,
    fontSize: 12,
    hAlign: "center",
    padding: 0,
    bgColor: [31, 32, 35, 190],
    textColor: [244, 240, 232, 170],
    hover: { bgColor: [88, 89, 92, 220], textColor: [244, 240, 232] },
    pressed: { bgColor: [104, 105, 108, 235], textColor: [244, 240, 232] },
  });
  for (let layer = 1; layer < nn.layers.length - 1; layer++) {
    const layerPositions = positions[layer] || [];
    if (!layerPositions.length) continue;
    const cx = layerPositions[0].x;
    const count = nn.layers[layer];
    const rowW = 86;
    const left = cx - rowW * 0.5;

    architectureHitZones.push({ kind: "neurons", layer, delta: -1, x: left, y: controlY, width: 24, height: controlH, disabled: count <= MIN_HIDDEN_NEURONS });
    architectureHitZones.push({ kind: "remove-layer", layer, x: left + 31, y: controlY, width: 24, height: controlH, disabled: nn.layers.length - 2 <= MIN_HIDDEN_LAYERS });
    architectureHitZones.push({ kind: "neurons", layer, delta: 1, x: left + 62, y: controlY, width: 24, height: controlH, disabled: count >= MAX_HIDDEN_NEURONS });
    uiButton("-", { ...overlayButtonStyle, x: left, y: controlY, disabled: count <= MIN_HIDDEN_NEURONS });
    uiButton("x", { ...overlayButtonStyle, x: left + 31, y: controlY, disabled: nn.layers.length - 2 <= MIN_HIDDEN_LAYERS });
    uiButton("+", { ...overlayButtonStyle, x: left + 62, y: controlY, disabled: count >= MAX_HIDDEN_NEURONS });
  }

  if (nn.layers.length - 2 < MAX_HIDDEN_LAYERS) {
    for (let layer = 0; layer < nn.layers.length - 1; layer++) {
      const nextLayer = layer + 1;
      const leftLayer = positions[layer]?.[0];
      const rightLayer = positions[nextLayer]?.[0];
      if (!leftLayer || !rightLayer) continue;
      const ix = (leftLayer.x + rightLayer.x) * 0.5 - 13;
      const iy = controlY;
      architectureHitZones.push({ kind: "insert-layer", afterLayer: layer, x: ix, y: iy, width: 24, height: controlH, disabled: false });
      uiButton("+", {
        ...overlayButtonStyle,
        x: ix,
        y: iy,
      });
    }
  }
  return changed;
}

function getWeightVisualStats(weights, layers) {
  const values = [];
  const incomingAbs = [];
  const outgoingAbs = [];
  let maxFlow = 1e-6;
  for (let layer = 0; layer < layers.length; layer++) {
    incomingAbs[layer] = Array.from({ length: layers[layer] }, () => 0);
    outgoingAbs[layer] = Array.from({ length: layers[layer] }, () => 0);
  }
  for (let layer = 1; layer < layers.length; layer++) {
    for (let row = 0; row < layers[layer]; row++) {
      for (let col = 0; col < layers[layer - 1]; col++) {
        const value = weights?.[layer]?.[row]?.[col] ?? 0;
        const magnitude = abs(value);
        values.push(magnitude);
        incomingAbs[layer][row] += magnitude;
        outgoingAbs[layer - 1][col] += magnitude;
      }
    }
  }
  for (let layer = 0; layer < layers.length; layer++) {
    for (let n = 0; n < layers[layer]; n++) {
      maxFlow = max(maxFlow, incomingAbs[layer][n], outgoingAbs[layer][n]);
    }
  }
  values.sort((a, b) => a - b);
  const percentileIndex = floor(constrain(values.length * 0.9, 0, max(0, values.length - 1)));
  const scale = max(0.08, values[percentileIndex] || 1);
  return { scale, incomingAbs, outgoingAbs, maxFlow };
}

function getWeightStrength(value, scale) {
  return constrain(sqrt(abs(value) / max(1e-6, scale)), 0, 1);
}

function drawWeightedConnection(a, b, value, width, alpha, state = {}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = max(1e-6, sqrt(dx * dx + dy * dy));
  const nx = -dy / len;
  const ny = dx / len;
  const warm = value >= 0;
  const base = warm ? [230, 95, 85] : [122, 167, 255];
  const thinW = max(0.5, width * 0.22);
  const thickW = width;
  const tailW = warm ? thinW : thickW;
  const headW = warm ? thickW : thinW;
  const midW = (tailW + headW) * 0.5;
  const mx = (a.x + b.x) * 0.5;
  const my = (a.y + b.y) * 0.5;

  noStroke();
  fill(base[0], base[1], base[2], alpha * 0.7);
  beginShape();
  vertex(a.x + nx * tailW * 0.5, a.y + ny * tailW * 0.5);
  vertex(mx + nx * midW * 0.5, my + ny * midW * 0.5);
  vertex(b.x + nx * headW * 0.5, b.y + ny * headW * 0.5);
  vertex(b.x - nx * headW * 0.5, b.y - ny * headW * 0.5);
  vertex(mx - nx * midW * 0.5, my - ny * midW * 0.5);
  vertex(a.x - nx * tailW * 0.5, a.y - ny * tailW * 0.5);
  endShape(CLOSE);
  noStroke();
}

function findHoveredConnection(positions, weights, layers) {
  let best = null;
  for (let layer = 1; layer < layers.length; layer++) {
    for (let row = 0; row < layers[layer]; row++) {
      for (let col = 0; col < layers[layer - 1]; col++) {
        const a = positions[layer - 1][col];
        const b = positions[layer][row];
        const d = distToSegment({ x: mouseX, y: mouseY }, a, b);
        if (d < 8 && (!best || d < best.d)) {
          best = { layer, row, col, value: weights[layer][row][col], a, b, d };
        }
      }
    }
  }
  return best;
}

function findHoveredNeuron(positions, layers) {
  if (isMouseInPanel()) return null;
  let best = null;
  for (let layer = 0; layer < layers.length; layer++) {
    for (let neuron = 0; neuron < layers[layer]; neuron++) {
      const p = positions?.[layer]?.[neuron];
      if (!p) continue;
      const d = dist(mouseX, mouseY, p.x, p.y);
      if (d < 18 && (!best || d < best.d)) {
        best = {
          kind: "neuron",
          layer,
          neuron,
          a: p,
          b: p,
          d,
        };
      }
    }
  }
  return best;
}

function getSelectedConnectionFocus(positions, weights) {
  if (!selectedConnection) return null;
  const { layer, row, col } = selectedConnection;
  const a = positions?.[layer - 1]?.[col];
  const b = positions?.[layer]?.[row];
  const value = weights?.[layer]?.[row]?.[col];
  if (!a || !b || !Number.isFinite(value)) return null;
  return { layer, row, col, value, a, b };
}

function getSelectedNeuronFocus(positions) {
  if (!selectedNeuron) return null;
  const p = positions?.[selectedNeuron.layer]?.[selectedNeuron.neuron];
  if (!p) return null;
  return {
    kind: "neuron",
    layer: selectedNeuron.layer,
    neuron: selectedNeuron.neuron,
    a: p,
    b: p,
  };
}

function getConnectionRelation(connection, focus) {
  if (!focus) return "";
  if (focus.kind === "neuron") {
    if (connection.layer === focus.layer && connection.row === focus.neuron) return "incoming";
    if (connection.layer === focus.layer + 1 && connection.col === focus.neuron) return "outgoing";
    if (connection.layer < focus.layer) return "propagate-in";
    if (connection.layer > focus.layer + 1) return "propagate-out";
    return "";
  }
  if (connection.layer === focus.layer && connection.row === focus.row && connection.col === focus.col) return "primary";
  if (connection.layer === focus.layer + 1 && connection.col === focus.row) return "outgoing";
  if (connection.layer > focus.layer + 1) return "propagate-out";
  return "";
}

function drawNeuronFlowHalo(x, y, layer, neuron, stats, focus) {
  const incoming = stats.incomingAbs?.[layer]?.[neuron] || 0;
  const outgoing = stats.outgoingAbs?.[layer]?.[neuron] || 0;
  const flow = constrain(max(incoming, outgoing) / stats.maxFlow, 0, 1);
  const isFocusNeuron = focus?.kind === "neuron" && focus.layer === layer && focus.neuron === neuron;
  const isFocusSource = focus && focus.kind !== "neuron" && focus.layer - 1 === layer && focus.col === neuron;
  const isFocusTarget = focus && focus.kind !== "neuron" && focus.layer === layer && focus.row === neuron;
  const inPropagationPath = focus?.kind === "neuron" && layer !== focus.layer;
  if (flow <= 0.02 && !isFocusNeuron && !isFocusSource && !isFocusTarget && !inPropagationPath) return;

  noFill();
  const focused = isFocusNeuron || isFocusSource || isFocusTarget;
  strokeWeight(focused ? 3 : map(flow, 0, 1, 1, 3));
  stroke(244, 240, 232, focused ? 180 : inPropagationPath ? 72 : map(flow, 0, 1, 26, 95));
  circle(x, y, focused ? 42 : map(flow, 0, 1, 31, 44));

  if (incoming > 0 && outgoing > 0) {
    const balance = incoming / (incoming + outgoing);
    stroke(230, 95, 85, map(balance, 0, 1, 35, 115));
    arc(x, y, 38, 38, -HALF_PI, -HALF_PI + TWO_PI * balance);
    stroke(122, 167, 255, map(1 - balance, 0, 1, 35, 115));
    arc(x, y, 38, 38, -HALF_PI + TWO_PI * balance, -HALF_PI + TWO_PI);
  }
  noStroke();
}

function resizeHiddenLayer(layer, delta) {
  if (!nn?.resizeLayers) return;
  const nextLayers = [...nn.layers];
  if (layer <= 0 || layer >= nextLayers.length - 1) return;
  const nextCount = constrain(nextLayers[layer] + delta, MIN_HIDDEN_NEURONS, MAX_HIDDEN_NEURONS);
  if (nextCount === nextLayers[layer]) return;
  nextLayers[layer] = nextCount;
  nn.resizeLayers(nextLayers, { activations: buildNetworkActivations(nextLayers, nn.activations), preserve: true });
  rememberCustomArchitecture(nextLayers);
  selectedConnection = null;
  selectedConnectionKey = "";
  selectedNeuron = null;
  saveLabStateThrottled(true);
}

function addHiddenLayer(afterLayer = null) {
  if (!nn?.resizeLayers || nn.layers.length - 2 >= MAX_HIDDEN_LAYERS) return;
  const oldLayers = [...nn.layers];
  const oldActivations = [...(nn.activations || [])];
  const oldNeuronActivations = nn.getNeuronActivations?.() || {};
  const oldDisabled = nn.getDisabledNeurons?.() || {};
  const nextLayers = [...nn.layers];
  const insertIndex = Number.isInteger(afterLayer)
    ? constrain(afterLayer + 1, 1, nextLayers.length - 1)
    : nextLayers.length - 1;
  nextLayers.splice(insertIndex, 0, NEW_LAYER_NEURONS);
  nn.resizeLayers(nextLayers, {
    activations: remapLayerActivationsForInsert(oldActivations, nextLayers, insertIndex),
    preserve: true,
  });
  nn.setNeuronActivations?.(remapNeuronMapForInsert(oldNeuronActivations, oldLayers, insertIndex));
  nn.setDisabledNeurons?.(remapNeuronMapForInsert(oldDisabled, oldLayers, insertIndex));
  rememberCustomArchitecture(nextLayers);
  selectedConnection = null;
  selectedConnectionKey = "";
  selectedNeuron = null;
  saveLabStateThrottled(true);
}

function removeHiddenLayer(layerIndex = null) {
  if (!nn?.resizeLayers || nn.layers.length - 2 <= MIN_HIDDEN_LAYERS) return;
  const oldLayers = [...nn.layers];
  const oldActivations = [...(nn.activations || [])];
  const oldNeuronActivations = nn.getNeuronActivations?.() || {};
  const oldDisabled = nn.getDisabledNeurons?.() || {};
  const nextLayers = [...nn.layers];
  const removeIndex = Number.isInteger(layerIndex)
    ? constrain(layerIndex, 1, nextLayers.length - 2)
    : nextLayers.length - 2;
  nextLayers.splice(removeIndex, 1);
  nn.resizeLayers(nextLayers, {
    activations: remapLayerActivationsForRemove(oldActivations, nextLayers, removeIndex),
    preserve: true,
  });
  nn.setNeuronActivations?.(remapNeuronMapForRemove(oldNeuronActivations, oldLayers, removeIndex));
  nn.setDisabledNeurons?.(remapNeuronMapForRemove(oldDisabled, oldLayers, removeIndex));
  rememberCustomArchitecture(nextLayers);
  selectedConnection = null;
  selectedConnectionKey = "";
  selectedNeuron = null;
  saveLabStateThrottled(true);
}

function remapLayerActivationsForInsert(oldActivations, nextLayers, insertIndex) {
  const next = buildNetworkActivations(nextLayers, oldActivations);
  const oldLast = oldActivations.length - 1;
  const newLast = nextLayers.length - 1;
  for (let oldLayer = 1; oldLayer < oldLast; oldLayer++) {
    const newLayer = oldLayer < insertIndex ? oldLayer : oldLayer + 1;
    if (newLayer > 0 && newLayer < newLast) next[newLayer] = oldActivations[oldLayer];
  }
  next[0] = "input";
  next[newLast] = "linear";
  return next;
}

function remapLayerActivationsForRemove(oldActivations, nextLayers, removeIndex) {
  const next = buildNetworkActivations(nextLayers, oldActivations);
  const oldLast = oldActivations.length - 1;
  const newLast = nextLayers.length - 1;
  for (let oldLayer = 1; oldLayer < oldLast; oldLayer++) {
    if (oldLayer === removeIndex) continue;
    const newLayer = oldLayer < removeIndex ? oldLayer : oldLayer - 1;
    if (newLayer > 0 && newLayer < newLast) next[newLayer] = oldActivations[oldLayer];
  }
  next[0] = "input";
  next[newLast] = "linear";
  return next;
}

function remapNeuronMapForInsert(mapByLayer = {}, oldLayers = [], insertIndex) {
  const out = {};
  const oldLast = oldLayers.length - 1;
  for (const [layer, values] of Object.entries(mapByLayer || {})) {
    const oldLayer = Number(layer);
    if (!Number.isFinite(oldLayer) || oldLayer <= 0 || oldLayer >= oldLast) continue;
    const newLayer = oldLayer < insertIndex ? oldLayer : oldLayer + 1;
    out[newLayer] = cloneNeuronMapValues(values);
  }
  return out;
}

function remapNeuronMapForRemove(mapByLayer = {}, oldLayers = [], removeIndex) {
  const out = {};
  const oldLast = oldLayers.length - 1;
  for (const [layer, values] of Object.entries(mapByLayer || {})) {
    const oldLayer = Number(layer);
    if (!Number.isFinite(oldLayer) || oldLayer <= 0 || oldLayer >= oldLast || oldLayer === removeIndex) continue;
    const newLayer = oldLayer < removeIndex ? oldLayer : oldLayer - 1;
    out[newLayer] = cloneNeuronMapValues(values);
  }
  return out;
}

function cloneNeuronMapValues(values) {
  if (Array.isArray(values)) return [...values];
  if (values && typeof values === "object") return { ...values };
  return values;
}

function drawMagicActivationLabel(label, x, y, layer, neuron) {
  const labelW = 48;
  const labelH = 15;
  const canCycle = layer > 0 && layer < nn.layers.length - 1;
  if (canCycle) {
    const button = uiButton(label, {
      ...labButtonStyle({
        x,
        y: y - labelH * 0.5,
        width: labelW,
        height: labelH,
        fontSize: 10,
        hAlign: "left",
        padding: 5,
        bgColor: [15, 16, 18, 190],
        textColor: [244, 240, 232, 190],
        hover: { bgColor: [244, 240, 232, 42], textColor: [244, 240, 232, 210] },
        pressed: { bgColor: [244, 240, 232, 58], textColor: [244, 240, 232] },
      }),
    });
    if (button.clicked) cycleNeuronActivationOnce(layer, neuron);
    return;
  }
  noStroke();
  fill(15, 16, 18, 190);
  rect(x, y - labelH * 0.5, labelW, labelH, LAB_UI.radius);
  fill(244, 240, 232, 190);
  textAlign(LEFT, CENTER);
  textSize(10);
  text(label, x + 5, y);
}

function drawActivationLabel(label, x, y, layer, neuron) {
  const labelW = max(36, textWidth(label) + 10);
  const labelH = 15;
  const boxX = x - labelW * 0.5;
  const boxY = y - labelH * 0.5;
  const canCycle = layer > 0 && layer < nn.layers.length - 1;
  if (canCycle) {
    const button = uiButton(label, {
      ...labButtonStyle({
        x: boxX,
        y: boxY,
        width: labelW,
        height: labelH,
        fontSize: 10,
        hAlign: "center",
        padding: 0,
        bgColor: [0, 0, 0, 0],
        textColor: [244, 240, 232, 160],
        hover: { bgColor: [244, 240, 232, 42], textColor: [244, 240, 232, 210] },
        pressed: { bgColor: [244, 240, 232, 58], textColor: [244, 240, 232] },
      }),
    });
    if (button.clicked) cycleNeuronActivationOnce(layer, neuron);
    return;
  }
  noStroke();
  fill(244, 240, 232, 160);
  textAlign(CENTER, CENTER);
  textSize(10);
  text(label, x, y);
}

function getNeuronActivationLabel(layer, neuronIndex) {
  if (!nn) return "";
  if (typeof nn.getNeuronActivation === "function") {
    return nn.getNeuronActivation(layer, neuronIndex);
  }
  const activation = nn.activations?.[layer] || "";
  if (activation === "input") return "input";
  if (activation === "magic" && typeof nn.getMagicKind === "function") {
    return nn.getMagicKind(neuronIndex);
  }
  return activation;
}

function isNeuronEnabled(layer, neuronIndex) {
  if (!nn || typeof nn.isNeuronEnabled !== "function") return true;
  return nn.isNeuronEnabled(layer, neuronIndex);
}

function labTextStyle(extra = {}) {
  return {
    bgColor: LAB_UI.panelSoft,
    textColor: LAB_UI.muted,
    fontSize: 12,
    height: 28,
    rounding: LAB_UI.radius,
    padding: 8,
    ...extra,
  };
}

function labButtonStyle(extra = {}) {
  return {
    bgColor: LAB_UI.panelSoft,
    textColor: LAB_UI.muted,
    hover: { bgColor: [88, 89, 92], textColor: [244, 240, 232] },
    pressed: { bgColor: [104, 105, 108], textColor: [244, 240, 232] },
    fontSize: 13,
    height: 32,
    rounding: LAB_UI.radius,
    padding: 8,
    ...extra,
  };
}

function labToggleStyle(extra = {}) {
  return labButtonStyle({
    onBgColor: [116, 34, 32],
    offBgColor: LAB_UI.panelSoft,
    textColor: LAB_UI.muted,
    ...extra,
  });
}

function labSliderStyle(extra = {}) {
  return {
    trackColor: LAB_UI.panelSoft,
    fillColor: [244, 240, 232, 48],
    textColor: LAB_UI.muted,
    fontSize: 13,
    height: 32,
    rounding: LAB_UI.radius,
    padding: 8,
    ...extra,
  };
}

function drawConnectionTooltip(c) {
  const label = `W: ${c.value >= 0 ? "+" : ""}${nf(c.value, 1, 3)}`;
  textSize(11);
  const boxW = textWidth(label) + 16;
  const tx = constrain(mouseX + 14, 12, width - boxW - 12);
  const ty = constrain(mouseY + 12, 88, height - 34);
  noStroke();
  fill(LAB_UI.line);
  rect(tx, ty, boxW, 24, LAB_UI.radius);
  fill(LAB_UI.ink);
  textAlign(LEFT, CENTER);
  text(label, tx + 8, ty + 12);
}

function drawSidePanel(layout) {
  const panelX = layout.panelX;
  const panelY = layout.panelY;
  const panelW = layout.panelListW;
  const gap = 6;
  const leftX = panelX;
  let leftY = panelY;

  leftY = drawArchitectureModelList(leftX, leftY, panelW, LAB_MODEL_ROW_H, gap);
  drawManualEditPanel(leftX, leftY + gap * 2, panelW, LAB_MODEL_ROW_H, gap);
}

function drawManualEditPanel(x, y, w, rowH = LAB_MODEL_ROW_H, gap = LAB_GAP) {
  if (!nn) return y;
  if (!selectedNeuron && !selectedConnection) return y;

  uiText("Tweak", labTextStyle({
    x,
    y,
    width: w,
    height: rowH,
    fontSize: 10,
    hAlign: "left",
    padding: 6,
    bgColor: [0, 0, 0, 0],
  }));
  y += rowH + gap;

  if (selectedNeuron) return drawSelectedNeuronPanel(x, y, w, rowH, gap);
  if (selectedConnection) return drawSelectedConnectionPanel(x, y, w, rowH, gap);
  return y;
}

function drawSelectedNeuronPanel(x, y, w, rowH, gap) {
  const layer = selectedNeuron.layer;
  const neuron = selectedNeuron.neuron;
  const bias = nn.getBias?.(layer, neuron);
  if (!Number.isFinite(bias)) return y;

  uiText(`Neuron ${layer}.${neuron}`, labTextStyle({
    x,
    y,
    width: w,
    height: rowH,
    fontSize: 10,
    hAlign: "left",
    padding: 6,
  }));
  y += rowH + gap;

  const biasSlider = uiSlider(`manual-bias-${layer}-${neuron}`, "Bias", {
    min: -5,
    max: 5,
    init: bias,
    syncValue: bias,
  }, labSliderStyle({ x, y, width: w, height: rowH, fontSize: 10, padding: 6 }));
  if (biasSlider.changed) {
    nn.setBias(layer, neuron, biasSlider.value);
    saveLabStateThrottled(true);
  }
  y += rowH + gap;

  if (layer > 0 && layer < nn.layers.length - 1) {
    const active = isNeuronEnabled(layer, neuron);
    uiSetState(`manual-neuron-enabled-${layer}-${neuron}`, active);
    const enabledToggle = uiToggle(`manual-neuron-enabled-${layer}-${neuron}`, active ? "Enabled" : "Disabled", labToggleStyle({
      x,
      y,
      width: w,
      height: rowH,
      fontSize: 10,
      padding: 6,
      onBgColor: LAB_UI.panelSoft,
      offBgColor: [48, 49, 52],
      textColor: LAB_UI.muted,
    }));
    if (enabledToggle.toggled) {
      nn.setNeuronEnabled(layer, neuron, enabledToggle.value);
      saveLabStateThrottled(true);
    }
    y += rowH + gap;

    const activation = getNeuronActivationLabel(layer, neuron);
    if (uiButton(`Act: ${activation}`, labButtonStyle({ x, y, width: w, height: rowH, fontSize: 10, padding: 6 })).clicked) {
      cycleNeuronActivationOnce(layer, neuron);
    }
    y += rowH + gap;
  }
  return y;
}

function drawSelectedConnectionPanel(x, y, w, rowH, gap) {
  const { layer, row, col } = selectedConnection;
  const weight = nn.getWeight?.(layer, row, col);
  if (!Number.isFinite(weight)) return y;

  uiText(`Connection ${layer}.${row}.${col}`, labTextStyle({
    x,
    y,
    width: w,
    height: rowH,
    fontSize: 10,
    hAlign: "left",
    padding: 6,
  }));
  y += rowH + gap;

  const slider = uiSlider(`manual-weight-${layer}-${row}-${col}`, "Weight", {
    min: -30,
    max: 30,
    init: weight,
    syncValue: weight,
  }, labSliderStyle({ x, y, width: w, height: rowH, fontSize: 10, padding: 6 }));
  if (slider.changed) {
    nn.setWeight(layer, row, col, slider.value);
    uiSetState("selected-weight", slider.value);
    saveLabStateThrottled(true);
  }
  return y + rowH + gap;
}

function drawFunctionParamSliders(x, y, w, rowH = LAB_ROW_H, gap = LAB_GAP) {
  const preset = presets[presetIndex];
  let changed = false;
  for (const param of preset.params || []) {
    const slider = uiSlider(`target-${preset.name}-${param.key}`, param.label, {
      min: param.min,
      max: param.max,
      init: param.value,
    }, {
      ...labSliderStyle({ x, y, width: w, height: rowH, fontSize: 11, padding: 6 }),
    });
    y += rowH + gap;
    if (slider.changed) {
      param.value = slider.value;
      changed = true;
    } else {
      param.value = slider.value;
    }
  }
  if (changed) {
    regenerateSamples();
  }
  return y;
}

function drawArchitectureModelList(x, y, w, rowH = LAB_ROW_H, gap = LAB_GAP) {
  const current = nn?.layers || DEFAULT_NN_LAYERS;
  const listW = w;
  const selectedBg = [88, 89, 92];
  const inactiveBg = LAB_UI.panelSoft;
  const selectedText = [244, 240, 232];
  const inactiveText = LAB_UI.muted;
  const modelRowStateStyle = {
    hover: { bgColor: selectedBg, textColor: selectedText },
    pressed: { bgColor: selectedBg, textColor: selectedText },
  };
  for (let i = 0; i < DEFAULT_ARCHITECTURE_MODELS.length; i++) {
    const model = DEFAULT_ARCHITECTURE_MODELS[i];
    const active = activeCustomModelIndex < 0 && layersEqual(model.layers, current);
    const label = fitLabel(`${displayName(model.name)}: ${hiddenSignature(model.layers)}`, listW - 10, 10);
    const item = uiButton(label, labButtonStyle({
      x,
      y,
      width: listW,
      height: rowH,
      fontSize: 10,
      padding: 6,
      bgColor: active ? selectedBg : inactiveBg,
      textColor: active ? selectedText : inactiveText,
      ...modelRowStateStyle,
    }));
    if (item.clicked) applyArchitectureModel(model);
    y += rowH + gap;
  }

  for (let i = 0; i < customModels.length; i++) {
    const model = customModels[i];
    const labelW = listW - 30;
    const active = i === activeCustomModelIndex;
    const label = fitLabel(`${model.name}: ${hiddenSignature(model.layers)}`, labelW - 10, 10);
    const item = uiButton(label, labButtonStyle({
      x,
      y,
      width: labelW,
      height: rowH,
      fontSize: 10,
      padding: 6,
      bgColor: active ? selectedBg : inactiveBg,
      textColor: active ? selectedText : inactiveText,
      ...modelRowStateStyle,
    }));
    if (item.clicked) applyArchitectureModel({ ...model, custom: true, customIndex: i });
    const del = uiButton("x", labButtonStyle({
      x: x + labelW + 6,
      y,
      width: 24,
      height: rowH,
      fontSize: 11,
      hAlign: "center",
      padding: 0,
      bgColor: inactiveBg,
      textColor: inactiveText,
      ...modelRowStateStyle,
    }));
    if (del.clicked) {
      deleteCustomModel(i);
      return y + rowH + gap;
    }
    y += rowH + gap;
  }
  return y;
}

function fitLabel(label, maxWidth, fontSize = 12) {
  textSize(fontSize);
  if (textWidth(label) <= maxWidth) return label;
  let out = String(label);
  while (out.length > 4 && textWidth(`${out}...`) > maxWidth) out = out.slice(0, -1);
  return `${out}...`;
}

function displayName(name) {
  return String(name || "")
    .split(/([+\s-])/)
    .map((part) => /^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part)
    .join("");
}

function maxWeightAbs(matrix) {
  let m = 1e-6;
  for (const row of matrix || []) {
    for (const v of row) m = max(m, abs(v));
  }
  return m;
}

function isMouseInPanel() {
  const layout = getLayout();
  return mouseX < layout.panelX + layout.panelListW + 12 && mouseY > layout.panelY - 4;
}

function isPointInPanel(x, y) {
  const layout = getLayout();
  return x < layout.panelX + layout.panelListW + 12 && y > layout.panelY - 4;
}

function isMouseInNetworkArea() {
  const layout = getLayout();
  const surfaceTop = layout.networkY - 16;
  const surfaceBottom = layout.graphY - 10;
  return (
    mouseX >= layout.networkX - layout.surfaceInsetX &&
    mouseX <= layout.networkX + layout.networkW + layout.surfaceInsetX &&
    mouseY >= surfaceTop &&
    mouseY <= surfaceBottom
  );
}

function keyReleased() {
  if (key === " ") {
    training = !training;
    uiSetState("tiny-nn-training", training);
  }
  if (key === "r" || key === "R") createNetwork({ keepToggles: true });
  if (key === "n" || key === "N") {
    presetIndex = (presetIndex + 1) % presets.length;
    regenerateSamples();
    createNetwork();
  }
}

function mousePressed() {
  if (!nn) return;
  if (isMouseInPanel()) return;
  if (resizeArchitectureUnderMouse()) return;

  const neuron = getNeuronUnderMouse();
  if (neuron) {
    selectedNeuron = { layer: neuron.layer, neuron: neuron.neuron };
    selectedConnection = null;
    selectedConnectionKey = "";
    suppressConnectionSelection = true;
    return;
  }

  if (isMouseInNetworkArea() && !getConnectionUnderMouse()) {
    clearNetworkSelection();
  }
}

function doubleClicked() {
  if (!nn) return;
  if (isMouseInPanel()) return;
  if (resizeArchitectureUnderMouse()) return;

  const neuron = getNeuronUnderMouse();
  if (!neuron?.canToggle) return;

  nn.toggleNeuron(neuron.layer, neuron.neuron);
  selectedNeuron = { layer: neuron.layer, neuron: neuron.neuron };
  selectedConnection = null;
  selectedConnectionKey = "";
  suppressConnectionSelection = true;
  lastNeuronToggleKey = `${neuron.layer}:${neuron.neuron}`;
}

function getNeuronUnderMouse() {
  let best = null;
  for (const zone of neuronHitZones) {
    const d = dist(mouseX, mouseY, zone.x, zone.y);
    if (d < 22 && (!best || d < best.d)) best = { ...zone, d };
  }
  return best;
}

function getConnectionUnderMouse() {
  if (!nn) return null;
  return findHoveredConnection(computeNetworkPositions(getLayout()), nn.getWeights(), nn.layers);
}

function computeNetworkPositions(layout) {
  if (!nn) return [];
  const positions = [];
  const layers = nn.layers;
  const x = layout.networkX;
  const y = layout.networkY;
  const w = layout.networkW;
  const h = layout.networkH;
  const networkPadX = min(58, max(26, w * 0.07));
  const networkPadTop = 48;
  const networkControlBand = 46;
  const neuronTop = y + networkPadTop;
  const neuronBottom = y + h - networkControlBand;
  const neuronH = max(80, neuronBottom - neuronTop);
  for (let layer = 0; layer < layers.length; layer++) {
    positions[layer] = [];
    for (let n = 0; n < layers[layer]; n++) {
      positions[layer][n] = {
        x: x + map(layer, 0, layers.length - 1, networkPadX, w - networkPadX),
        y: neuronTop + neuronH * 0.5 + (n - (layers[layer] - 1) * 0.5) * min(66, neuronH / max(1, layers[layer])),
      };
    }
  }
  return positions;
}

function clearNetworkSelection() {
  selectedNeuron = null;
  selectedConnection = null;
  selectedConnectionKey = "";
}

function resizeArchitectureUnderMouse() {
  for (const zone of architectureHitZones) {
    if (
      !zone.disabled &&
      mouseX >= zone.x &&
      mouseX <= zone.x + zone.width &&
      mouseY >= zone.y &&
      mouseY <= zone.y + zone.height
    ) {
      if (zone.kind === "insert-layer") addHiddenLayer(zone.afterLayer);
      else if (zone.kind === "remove-layer") removeHiddenLayer(zone.layer);
      else resizeHiddenLayer(zone.layer, zone.delta);
      suppressConnectionSelection = true;
      return true;
    }
  }
  return false;
}

function cycleNeuronActivationOnce(layer, neuron) {
  if (!nn?.cycleNeuronActivation) return false;
  const key = `${layer}:${neuron}`;
  const now = millis();
  if (lastActivationCycleKey === key && now - lastActivationCycleMs < 180) {
    suppressConnectionSelection = true;
    return true;
  }
  nn.cycleNeuronActivation(layer, neuron);
  rememberCustomArchitecture();
  lastActivationCycleKey = key;
  lastActivationCycleMs = now;
  suppressConnectionSelection = true;
  return true;
}

function sqr(x) {
  return x * x;
}

function dist2(v, w) {
  return sqr(v.x - w.x) + sqr(v.y - w.y);
}

function distToSegmentSquared(p, v, w) {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  const t = max(0, min(1, ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2));
  return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

function distToSegment(p, v, w) {
  return sqrt(distToSegmentSquared(p, v, w));
}
