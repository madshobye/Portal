const showOverlay = false;
const TINY_NN_STORAGE_KEY = "portal.tinyNNLab.v1";
const DEFAULT_NN_LAYERS = [1, 4, 10, 4, 1];
const MIN_HIDDEN_NEURONS = 1;
const MAX_HIDDEN_NEURONS = 16;
const MIN_HIDDEN_LAYERS = 1;
const MAX_HIDDEN_LAYERS = 6;
const NEW_LAYER_NEURONS = 4;

let nn;
let samples = [];
let predictions = [];
let selectedConnection = null;
let selectedConnectionKey = "";
let lastNeuronToggleKey = "";
let lastActivationCycleKey = "";
let lastActivationCycleMs = -1000;
let neuronHitZones = [];
let activationHitZones = [];
let architectureHitZones = [];
let suppressConnectionSelection = false;
let training = false;
let presetIndex = 0;
let sampleCount = 90;
let noiseAmount = 0.04;
let graphCenter = 0;
const GRAPH_SPAN = 2;
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
  target: "#e65f55",
  prediction: "#7aa7ff",
  samples: "#e2c95c",
  loss: "#a4c96a",
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
      { key: "b", label: "b", min: -0.8, max: 0.8, value: 0 },
    ],
    fn: (x, p) => p.a * Math.sin(Math.PI * p.f * x) + p.b,
    label: (p) => `y = ${nf(p.a, 1, 2)}sin(${nf(p.f, 1, 2)}PI x) + ${nf(p.b, 1, 2)}`,
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
  document.addEventListener("pointerdown", (event) => {
    const canvas = document.querySelector("canvas");
    if (!canvas || !nn) return;
    const rect = canvas.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) return;

    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * height;
    if (isPointInPanel(x, y)) return;

    for (const zone of activationHitZones) {
      if (x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height) {
        nn.cycleNeuronActivation(zone.layer, zone.neuron);
        lastActivationCycleKey = `${zone.layer}:${zone.neuron}`;
        lastActivationCycleMs = millis();
        suppressConnectionSelection = true;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
  }, { capture: true });
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
  drawHeader();

  if (training && nn) {
    nn.train(samples, { steps: 1, learningRate: lastUi.learningRate ?? 0.012 });
  }
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
  for (let i = 0; i < sampleCount; i++) {
    const x = map(i, 0, sampleCount - 1, -1, 1);
    const jitter = randomGaussian() * noiseAmount;
    const clean = preset.fn(x, params);
    const y = constrain(clean + jitter, -1.15, 1.15);
    samples.push({ input: [x], output: [y], clean });
  }
  if (nn) nn.lossHistory = [];
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

function updatePredictions() {
  if (!nn) return;
  const win = getGraphWindow();
  predictions = [];
  for (let i = 0; i <= 120; i++) {
    const x = map(i, 0, 120, win.xMin, win.xMax);
    predictions.push({ x, y: nn.predict([x])[0] });
  }
}

function drawHeader() {
  noStroke();
  fill(LAB_UI.line);
  textAlign(LEFT, TOP);
  textSize(18);
  text("Tiny NN Lab", 24, 16);
  textSize(11);
  fill(LAB_UI.muted);
  text("Minimal Portal-native neural network sketch, after Halim Rahman and Mads Hobye.", 25, 40);
}

function getLayout() {
  const compact = width < 820;
  const panelW = compact ? constrain(width * 0.34, 184, 228) : 252;
  const gap = compact ? 24 : 48;
  const networkX = panelW + gap + 24;
  const networkW = max(220, width - networkX - 24);
  const graphH = compact ? 150 : 178;
  const graphY = height - graphH - 48;
  const networkY = compact ? 114 : 96;
  return {
    compact,
    panelX: 24,
    panelY: 72,
    panelW,
    networkX,
    networkY,
    networkW,
    networkH: max(230, graphY - networkY - 24),
    graphX: networkX,
    graphY,
    graphW: networkW,
    graphH,
  };
}

function drawMainSurface(layout) {
  const graphX = layout.graphX;
  const graphY = layout.graphY;
  const graphW = layout.graphW;
  const graphH = layout.graphH;

  noStroke();
  fill(LAB_UI.panel);
  rect(graphX - 14, layout.networkY - 16, graphW + 28, graphY + graphH - layout.networkY + 58, LAB_UI.radius);

  const win = getGraphWindow();
  const target = Array.from({ length: 121 }, (_, i) => {
    const x = map(i, 0, 120, win.xMin, win.xMax);
    const preset = presets[presetIndex];
    return { x, y: preset.fn(x, getPresetParams(preset)) };
  });
  uiPlot("fit-plot", [
    { label: "target", values: target, color: LAB_UI.target, weight: 2.5 },
    { label: "prediction", values: predictions, color: LAB_UI.prediction, weight: 2.5 },
  ], {
    x: graphX,
    y: graphY,
    width: graphW,
    height: graphH,
    label: "target / prediction",
    xMin: win.xMin,
    xMax: win.xMax,
    yMin: -1.2,
    yMax: 1.2,
    bgColor: LAB_UI.panelSoft,
    gridColor: [244, 240, 232, 18],
    axisColor: [244, 240, 232, 52],
    textColor: [244, 240, 232, 140],
    rounding: LAB_UI.radius,
  });

  drawTrainingDomainMarkers(graphX, graphY, graphW, graphH, win);
  drawSampleDots(graphX, graphY, graphW, graphH, win);
  drawLegend(graphX, graphY + graphH + 14);
}

function drawTrainingDomainMarkers(x, y, w, h, win) {
  const pad = 14;
  const plotX = x + pad;
  const plotW = w - pad * 2;
  stroke(244, 240, 232, 58);
  strokeWeight(1);
  for (const edge of [-1, 1]) {
    if (edge < win.xMin || edge > win.xMax) continue;
    const sx = map(edge, win.xMin, win.xMax, plotX, plotX + plotW);
    line(sx, y + pad, sx, y + h - pad);
  }
  noStroke();
}

function drawSampleDots(x, y, w, h, win) {
  noStroke();
  fill(226, 201, 92, 155);
  for (const s of samples) {
    if (s.input[0] < win.xMin || s.input[0] > win.xMax) continue;
    const sx = map(s.input[0], win.xMin, win.xMax, x + 14, x + w - 14);
    const sy = map(s.output[0], -1.2, 1.2, y + h - 14, y + 14);
    circle(sx, sy, 4);
  }
}

function drawLegend(x, y) {
  const items = [
    ["target", LAB_UI.target],
    ["prediction", LAB_UI.prediction],
    ["samples", LAB_UI.samples],
  ];
  textSize(12);
  textAlign(LEFT, CENTER);
  for (let i = 0; i < items.length; i++) {
    fill(items[i][1]);
    noStroke();
    circle(x + i * 112, y, 9);
    fill(LAB_UI.muted);
    text(items[i][0], x + 12 + i * 112, y);
  }
}

function drawNetwork(x, y, w, h) {
  if (!nn) return;
  const weights = nn.getWeights();
  const biases = nn.getBiases();
  const layers = nn.layers;
  const positions = [];
  let hovered = null;
  neuronHitZones = [];
  activationHitZones = [];
  architectureHitZones = [];

  for (let layer = 0; layer < layers.length; layer++) {
    positions[layer] = [];
    for (let n = 0; n < layers[layer]; n++) {
      positions[layer][n] = {
        x: x + map(layer, 0, layers.length - 1, 0, w),
        y: y + h * 0.5 + (n - (layers[layer] - 1) * 0.5) * min(78, h / max(1, layers[layer])),
      };
    }
  }

  for (let layer = 1; layer < layers.length; layer++) {
    const maxAbs = maxWeightAbs(weights[layer]);
    for (let row = 0; row < layers[layer]; row++) {
      for (let col = 0; col < layers[layer - 1]; col++) {
        const a = positions[layer - 1][col];
        const b = positions[layer][row];
        const value = weights[layer][row][col];
        const strength = constrain(abs(value) / maxAbs, 0, 1);
        const connectionEnabled = isNeuronEnabled(layer, row) && isNeuronEnabled(layer - 1, col);
        const isSelected = selectedConnection &&
          selectedConnection.layer === layer &&
          selectedConnection.row === row &&
          selectedConnection.col === col;
        const d = distToSegment({ x: mouseX, y: mouseY }, a, b);
        if (d < 8) hovered = { layer, row, col, value, a, b };

        strokeWeight(isSelected ? 6 : map(strength, 0, 1, 1, 5));
        const alpha = connectionEnabled ? (isSelected ? 230 : map(strength, 0, 1, 42, 170)) : 20;
        if (value >= 0) stroke(122, 167, 255, alpha);
        else stroke(230, 95, 85, alpha);
        line(a.x, a.y, b.x, b.y);
      }
    }
  }

  for (let layer = 0; layer < layers.length; layer++) {
    for (let n = 0; n < layers[layer]; n++) {
      const p = positions[layer][n];
      const bias = layer > 0 ? biases[layer][n][0] : null;
      const activationLabel = getNeuronActivationLabel(layer, n);
      const enabled = isNeuronEnabled(layer, n);
      const canToggle = layer > 0 && layer < layers.length - 1;
      const neuronHover = canToggle && dist(mouseX, mouseY, p.x, p.y) < 18;
      if (canToggle) neuronHitZones.push({ layer, neuron: n, x: p.x, y: p.y });
      noStroke();
      fill(enabled ? LAB_UI.line : [88, 89, 92]);
      circle(p.x, p.y, 26);
      if (!enabled) {
        stroke(LAB_UI.bg[0], LAB_UI.bg[1], LAB_UI.bg[2], 220);
        strokeWeight(2);
        line(p.x - 8, p.y + 8, p.x + 8, p.y - 8);
        noStroke();
      }
      if (neuronHover) {
        noFill();
        stroke(244, 240, 232, 145);
        strokeWeight(2);
        circle(p.x, p.y, 34);
        noStroke();
      }
      fill(LAB_UI.ink);
      textAlign(CENTER, CENTER);
      textSize(11);
      text(layer === 0 ? "x" : layer === layers.length - 1 ? "y" : n + 1, p.x, p.y);
      if (nn.activations?.[layer] === "magic") {
        drawMagicActivationLabel(activationLabel, p.x + 22, p.y, layer, n);
      } else {
        drawActivationLabel(activationLabel, p.x, p.y - 25, layer, n);
      }
      if (bias !== null && nn.activations?.[layer] !== "magic") {
        fill(244, 240, 232, 115);
        textSize(10);
        text(nf(bias, 1, 2), p.x, p.y + 24);
      }
    }
  }

  if (drawArchitectureControls(positions)) return;

  if (hovered) {
    drawConnectionTooltip(hovered);
    if (mouseIsPressed && !suppressConnectionSelection && !isMouseInPanel()) {
      selectedConnection = { layer: hovered.layer, row: hovered.row, col: hovered.col };
      selectedConnectionKey = `${hovered.layer}:${hovered.row}:${hovered.col}`;
      uiSetState("selected-weight", hovered.value);
    }
  }
}

function drawArchitectureControls(positions) {
  if (!nn?.resizeLayers || !positions?.length) return false;
  let changed = false;
  for (let layer = 1; layer < nn.layers.length - 1; layer++) {
    const layerPositions = positions[layer] || [];
    if (!layerPositions.length) continue;
    const cx = layerPositions[0].x;
    const y = max(72, min(...layerPositions.map((p) => p.y)) - 46);
    const count = nn.layers[layer];
    const rowW = 118;
    const left = cx - rowW * 0.5;
    const buttonStyle = labButtonStyle({ width: 26, height: 22, fontSize: 13, hAlign: "center", padding: 0 });
    const labelStyle = labTextStyle({
      x: left + 30,
      y,
      width: 58,
      height: 22,
      fontSize: 11,
      hAlign: "center",
      bgColor: [15, 16, 18, 220],
      textColor: [244, 240, 232, 185],
      padding: 0,
    });

    architectureHitZones.push({ layer, delta: -1, x: left, y, width: 26, height: 22, disabled: count <= MIN_HIDDEN_NEURONS });
    architectureHitZones.push({ layer, delta: 1, x: left + 92, y, width: 26, height: 22, disabled: count >= MAX_HIDDEN_NEURONS });
    uiButton("-", { ...buttonStyle, x: left, y, disabled: count <= MIN_HIDDEN_NEURONS });
    uiText(`h${layer}:${count}`, labelStyle);
    uiButton("+", { ...buttonStyle, x: left + 92, y, disabled: count >= MAX_HIDDEN_NEURONS });
  }
  return changed;
}

function resizeHiddenLayer(layer, delta) {
  if (!nn?.resizeLayers) return;
  const nextLayers = [...nn.layers];
  if (layer <= 0 || layer >= nextLayers.length - 1) return;
  const nextCount = constrain(nextLayers[layer] + delta, MIN_HIDDEN_NEURONS, MAX_HIDDEN_NEURONS);
  if (nextCount === nextLayers[layer]) return;
  nextLayers[layer] = nextCount;
  nn.resizeLayers(nextLayers, { activations: buildNetworkActivations(nextLayers, nn.activations), preserve: true });
  selectedConnection = null;
  selectedConnectionKey = "";
  saveLabStateThrottled(true);
}

function addHiddenLayer() {
  if (!nn?.resizeLayers || nn.layers.length - 2 >= MAX_HIDDEN_LAYERS) return;
  const nextLayers = [...nn.layers];
  nextLayers.splice(nextLayers.length - 1, 0, NEW_LAYER_NEURONS);
  nn.resizeLayers(nextLayers, { activations: buildNetworkActivations(nextLayers, nn.activations), preserve: true });
  selectedConnection = null;
  selectedConnectionKey = "";
  saveLabStateThrottled(true);
}

function removeHiddenLayer() {
  if (!nn?.resizeLayers || nn.layers.length - 2 <= MIN_HIDDEN_LAYERS) return;
  const nextLayers = [...nn.layers];
  nextLayers.splice(nextLayers.length - 2, 1);
  nn.resizeLayers(nextLayers, { activations: buildNetworkActivations(nextLayers, nn.activations), preserve: true });
  selectedConnection = null;
  selectedConnectionKey = "";
  saveLabStateThrottled(true);
}

function drawMagicActivationLabel(label, x, y, layer, neuron) {
  const labelW = 48;
  const labelH = 15;
  const hover = mouseX >= x && mouseX <= x + labelW && mouseY >= y - labelH * 0.5 && mouseY <= y + labelH * 0.5;
  activationHitZones.push({ layer, neuron, x, y: y - labelH * 0.5, width: labelW, height: labelH });
  maybeCycleActivationLabel(hover, layer, neuron);
  noStroke();
  fill(hover ? [244, 240, 232, 42] : [15, 16, 18, 190]);
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
  const hover = canCycle && mouseX >= boxX && mouseX <= boxX + labelW && mouseY >= boxY && mouseY <= boxY + labelH;
  if (canCycle) activationHitZones.push({ layer, neuron, x: boxX, y: boxY, width: labelW, height: labelH });
  maybeCycleActivationLabel(hover, layer, neuron);
  noStroke();
  if (hover) {
    fill(244, 240, 232, 42);
    rect(boxX, boxY, labelW, labelH, LAB_UI.radius);
  }
  fill(244, 240, 232, 160);
  textAlign(CENTER, CENTER);
  textSize(10);
  text(label, x, y);
}

function maybeCycleActivationLabel(hover, layer, neuron) {
  if (!hover || !mouseIsPressed || !nn?.cycleNeuronActivation) return;
  const key = `${layer}:${neuron}`;
  if (lastActivationCycleKey === key) return;
  nn.cycleNeuronActivation(layer, neuron);
  lastActivationCycleKey = key;
  suppressConnectionSelection = true;
}

function getNeuronActivationLabel(layer, neuronIndex) {
  if (!nn) return "";
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
    bgColor: [220, 218, 211],
    textColor: LAB_UI.ink,
    hover: { bgColor: [238, 235, 226] },
    pressed: { bgColor: [196, 194, 188] },
    fontSize: 13,
    height: 32,
    rounding: LAB_UI.radius,
    padding: 8,
    ...extra,
  };
}

function labToggleStyle(extra = {}) {
  return labButtonStyle({
    onBgColor: [210, 226, 202],
    offBgColor: [92, 93, 96],
    textColor: LAB_UI.ink,
    ...extra,
  });
}

function labSliderStyle(extra = {}) {
  return {
    trackColor: [220, 218, 211],
    fillColor: LAB_UI.accent,
    textColor: LAB_UI.ink,
    fontSize: 13,
    height: 32,
    rounding: LAB_UI.radius,
    padding: 8,
    ...extra,
  };
}

function drawConnectionTooltip(c) {
  const tx = constrain(mouseX + 14, 12, width - 128);
  const ty = constrain(mouseY + 12, 88, height - 56);
  noStroke();
  fill(LAB_UI.line);
  rect(tx, ty, 112, 34, LAB_UI.radius);
  fill(LAB_UI.ink);
  textAlign(LEFT, CENTER);
  textSize(12);
  text(`w ${c.layer}.${c.row}.${c.col}`, tx + 8, ty + 11);
  text(nf(c.value, 1, 3), tx + 8, ty + 24);
}

function drawSidePanel(layout) {
  const panelX = layout.panelX;
  const panelY = layout.panelY;
  const panelW = layout.panelW;
  const stats = nn?.getStats?.() || {};

  uiListStart({ x: panelX, y: panelY, width: panelW, gap: 6 });
  uiText("controls", labTextStyle({ bgColor: LAB_UI.panel, hAlign: "center", height: 28 }));

  const trainToggle = uiToggle("tiny-nn-training", "training", labToggleStyle({ showStateText: true }));
  training = trainToggle.value;

  if (uiButton("step once", labButtonStyle()).clicked && nn) {
    nn.train(samples, { steps: 1, learningRate: lastUi.learningRate ?? 0.012 });
  }

  if (uiButton("reset weights", labButtonStyle()).clicked) {
    createNetwork({ keepToggles: true });
  }

  uiText(`layers: ${nn?.layers?.slice(1, -1).join(" / ") || ""}`, labTextStyle({ hAlign: "center", height: 24, fontSize: 11 }));
  uiListStart({ width: panelW, dir: "horizontal", gap: 6 });
  if (uiButton("- layer", labButtonStyle({ width: (panelW - 6) * 0.5, height: 28, fontSize: 12, disabled: (nn?.layers?.length || 0) - 2 <= MIN_HIDDEN_LAYERS })).clicked) {
    removeHiddenLayer();
  }
  if (uiButton("+ layer", labButtonStyle({ width: (panelW - 6) * 0.5, height: 28, fontSize: 12, disabled: (nn?.layers?.length || 0) - 2 >= MAX_HIDDEN_LAYERS })).clicked) {
    addHiddenLayer();
  }
  uiListEnd();

  if (uiButton(`function: ${presets[presetIndex].name}`, labButtonStyle()).clicked) {
    presetIndex = (presetIndex + 1) % presets.length;
    regenerateSamples();
    createNetwork();
    training = true;
    uiSetState("tiny-nn-training", true);
  }

  const lr = uiSlider("tiny-nn-lr", "learning", { min: 0.001, max: 0.08, init: 0.012 }, labSliderStyle());
  const noise = uiSlider("tiny-nn-noise", "noise", { min: 0, max: 0.22, init: noiseAmount }, labSliderStyle());
  const view = uiSlider("tiny-nn-graph-center", "view x", { min: -2, max: 2, init: graphCenter }, labSliderStyle());
  lastUi.learningRate = lr.value;
  graphCenter = view.value;

  if (noise.changed) {
    noiseAmount = noise.value;
    regenerateSamples();
  }

  uiText("function params", labTextStyle({ hAlign: "center", height: 26 }));
  drawFunctionParamSliders(panelW);

  const win = getGraphWindow();
  uiText(fitLabel(`window ${nf(win.xMin, 1, 2)}..${nf(win.xMax, 1, 2)}`, panelW - 16, 11), labTextStyle({ height: 26, fontSize: 11 }));
  uiText(fitLabel(`curve: ${getPresetLabel()}`, panelW - 16, 11), labTextStyle({ height: 42, fontSize: 11 }));
  uiText(`epoch ${stats.iteration ?? 0}  loss ${nf(stats.loss ?? 0, 1, 5)}`, labTextStyle({ height: 28 }));

  uiPlot("loss-plot", [{ values: stats.lossHistory || [], color: LAB_UI.loss, weight: 2 }], {
    width: panelW,
    height: 100,
    label: "loss",
    bgColor: LAB_UI.panelSoft,
    gridColor: [244, 240, 232, 18],
    axisColor: [244, 240, 232, 48],
    textColor: [244, 240, 232, 132],
    rounding: LAB_UI.radius,
  });

  if (selectedConnection) {
    const current = nn.getWeight(selectedConnection.layer, selectedConnection.row, selectedConnection.col);
    uiText(`selected w ${selectedConnectionKey}`, labTextStyle({ height: 28 }));
    const slider = uiSlider("selected-weight", "weight", { min: -4, max: 4, init: current }, labSliderStyle());
    if (slider.changed) {
      nn.setWeight(selectedConnection.layer, selectedConnection.row, selectedConnection.col, slider.value);
    }
  } else {
    uiText("connection: none", labTextStyle({ height: 32 }));
  }

  uiListEnd();
}

function drawFunctionParamSliders(panelW) {
  const preset = presets[presetIndex];
  let changed = false;
  for (const param of preset.params || []) {
    const slider = uiSlider(`target-${preset.name}-${param.key}`, param.label, {
      min: param.min,
      max: param.max,
      init: param.value,
    }, {
      ...labSliderStyle({ height: 28, fontSize: 12 }),
      width: panelW,
    });
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
}

function fitLabel(label, maxWidth, fontSize = 12) {
  textSize(fontSize);
  if (textWidth(label) <= maxWidth) return label;
  let out = String(label);
  while (out.length > 4 && textWidth(`${out}...`) > maxWidth) out = out.slice(0, -1);
  return `${out}...`;
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
  return mouseX < layout.panelX + layout.panelW + 12 && mouseY > 80;
}

function isPointInPanel(x, y) {
  const layout = getLayout();
  return x < layout.panelX + layout.panelW + 12 && y > 80;
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
  if (!nn || isMouseInPanel()) return;
  if (resizeArchitectureUnderMouse()) return;
  if (cycleActivationUnderMouse()) return;

  let best = null;
  for (const zone of neuronHitZones) {
    const d = dist(mouseX, mouseY, zone.x, zone.y);
    if (d < 22 && (!best || d < best.d)) best = { ...zone, d };
  }
  if (!best) return;

  nn.toggleNeuron(best.layer, best.neuron);
  suppressConnectionSelection = true;
  lastNeuronToggleKey = `${best.layer}:${best.neuron}`;
  if (selectedConnection && (
    (selectedConnection.layer === best.layer && selectedConnection.row === best.neuron) ||
    (selectedConnection.layer - 1 === best.layer && selectedConnection.col === best.neuron)
  )) {
    selectedConnection = null;
    selectedConnectionKey = "";
  }
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
      resizeHiddenLayer(zone.layer, zone.delta);
      suppressConnectionSelection = true;
      return true;
    }
  }
  return false;
}

function mouseClicked() {
  if (!nn || isMouseInPanel()) return;
  if (millis() - lastActivationCycleMs < 160) return;
  cycleActivationUnderMouse();
}

function cycleActivationUnderMouse() {
  for (const zone of activationHitZones) {
    if (
      mouseX >= zone.x &&
      mouseX <= zone.x + zone.width &&
      mouseY >= zone.y &&
      mouseY <= zone.y + zone.height
    ) {
      nn.cycleNeuronActivation(zone.layer, zone.neuron);
      lastActivationCycleKey = `${zone.layer}:${zone.neuron}`;
      lastActivationCycleMs = millis();
      suppressConnectionSelection = true;
      return true;
    }
  }
  return false;
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
