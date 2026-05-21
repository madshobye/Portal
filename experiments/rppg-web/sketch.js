const RPPG_IMPORT_URLS = [
  "https://cdn.jsdelivr.net/npm/@elata-biosciences/rppg-web/+esm",
  "https://esm.sh/@elata-biosciences/rppg-web?bundle",
];
const SAMPLE_RATE = 30;
const HISTORY_SECONDS = 45;
const HISTORY_LIMIT = SAMPLE_RATE * HISTORY_SECONDS;
const SIGNAL_WINDOW_SECONDS = 16;
const MIN_BPM = 45;
const MAX_BPM = 130;
const MIN_STABLE_SAMPLES = 12;
const MAX_FACE_MOTION_PER_SAMPLE = 0.065;
const BPM_SMOOTHING = 0.28;
const MAX_BPM_STEP = 22;
const MIN_DISPLAY_QUALITY = 0.04;

let videoEl;
let cam;
let faceMesh = null;
let mediaStream = null;
let rppgModule = null;
let sampleCanvas = null;
let sampleContext = null;
let lastSampleAtMs = 0;
let statusText = "Click START to enable camera";
let diagnosticsText = "";
let lastErrorText = "";
let running = false;
let starting = false;
let metrics = {};
let displayReason = "waiting";
let bpmHistory = [];
let qualityHistory = [];
let signalSamples = [];
let smoothedBpm = NaN;
let lastFaceCenter = null;
let latestRoi = null;
let latestSamplePreview = null;
let samplePreviewImage = null;
let roiScaleSlider = null;
let startButtonRect = null;
let stopButtonRect = null;

function logInfo(message, detail = null) {
  if (detail === null) {
    console.log(`[rppg-web] ${message}`);
    return;
  }
  console.log(`[rppg-web] ${message}`, detail);
}

function logError(message, error = null) {
  console.error(`[rppg-web] ${message}`, error || "");
}

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  textFont("Helvetica Neue");
  roiScaleSlider = createSlider(0.5, 2.5, 1, 0.01);
  roiScaleSlider.class("rppg-roi-slider");
}

function draw() {
  background("#111316");
  updateMetrics();
  drawFullWebcamPreview();
  drawMetricPanel();
  drawHistoryGraph();
  drawControls();
  positionRoiSlider();
  drawStatus();
}

async function startRppg() {
  if (running || starting) return;
  starting = true;
  lastErrorText = "";
  statusText = "Loading rPPG library...";
  logInfo("start requested");

  try {
    if (!rppgModule) rppgModule = await importRppgModule();
    logInfo("module exports", Object.keys(rppgModule || {}));
    await loadScript("portal/faceMesh.js");

    statusText = "Requesting camera...";
    cam = await setupWebcamera(false, 640, 480, false, false);
    videoEl = cam?.elt || null;
    if (!videoEl) throw new Error("Portal camera did not return a video element.");
    mediaStream = videoEl.srcObject || null;
    videoEl.muted = true;
    videoEl.playsInline = true;
    await videoEl.play();

    statusText = "Starting FaceMesh...";
    faceMesh = await new FaceMesh({
      video: cam,
      backend: "webgl",
      videoIsFlipped: true,
      onResults: () => {},
    }).init();
    await faceMesh.start();

    statusText = "Starting local rPPG sampler...";
    sampleCanvas = document.createElement("canvas");
    sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
    lastSampleAtMs = 0;
    signalSamples = [];
    smoothedBpm = NaN;
    lastFaceCenter = null;
    latestRoi = null;
    latestSamplePreview = null;
    samplePreviewImage = null;
    metrics = {};
    displayReason = "warming up";

    running = true;
    statusText = "Measuring";
    diagnosticsText = "Portal FaceMesh ROI sampler";
  } catch (error) {
    lastErrorText = error?.message || String(error);
    statusText = "Could not start";
    logError("start failed", error);
    stopRppg();
  } finally {
    starting = false;
  }
}

async function importRppgModule() {
  const errors = [];
  for (const url of RPPG_IMPORT_URLS) {
    try {
      logInfo(`importing ${url}`);
      const module = await import(url);
      logInfo(`import succeeded ${url}`);
      return module;
    } catch (error) {
      logError(`import failed ${url}`, error);
      errors.push(`${url}: ${error?.message || error}`);
    }
  }
  throw new Error(`Could not import rPPG package. ${errors.join(" | ")}`);
}

function stopRppg() {
  logInfo("stop/cleanup");
  try {
    faceMesh?.stop?.();
  } catch {}
  faceMesh = null;
  sampleCanvas = null;
  sampleContext = null;
  lastSampleAtMs = 0;
  signalSamples = [];
  smoothedBpm = NaN;
  lastFaceCenter = null;
  latestRoi = null;
  latestSamplePreview = null;
  samplePreviewImage = null;

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
  }
  mediaStream = null;
  if (cam?.remove) cam.remove();
  cam = null;
  videoEl = null;

  running = false;
  if (!starting) statusText = "Stopped";
}

function updateMetrics() {
  if (!running) return;
  try {
    maybePushCameraSample();
    metrics = estimateLocalRppgMetrics();
    const bpm = pickNumber(metrics, ["bpm", "heartRate", "heart_rate", "pulse", "pulseRate"]);
    const quality = pickNumber(metrics, ["quality", "confidence", "signalQuality", "snr"]);
    if (Number.isFinite(bpm)) pushHistory(bpmHistory, bpm);
    if (Number.isFinite(quality)) pushHistory(qualityHistory, quality);
  } catch (error) {
    lastErrorText = error?.message || String(error);
  }
}

function maybePushCameraSample() {
  if (!videoEl || !sampleCanvas || !sampleContext) return;
  const now = performance.now();
  const minIntervalMs = 1000 / SAMPLE_RATE;
  if (now - lastSampleAtMs < minIntervalMs) return;
  if (videoEl.readyState < 2) return;

  const sample = readCentralSkinSample();
  if (!sample) return;
  lastSampleAtMs = now;

  signalSamples.push({ t: now, ...sample });
  const oldest = now - SIGNAL_WINDOW_SECONDS * 1000;
  while (signalSamples.length && signalSamples[0].t < oldest) {
    signalSamples.shift();
  }
}

function readCentralSkinSample() {
  const sourceW = videoEl.videoWidth || cam?.width || 640;
  const sourceH = videoEl.videoHeight || cam?.height || 480;
  if (!sourceW || !sourceH) return null;

  const roi = getFaceRoi(sourceW, sourceH);
  latestRoi = roi;
  diagnosticsText = roi.fromFace
    ? `Portal FaceMesh ROI | samples ${signalSamples.length}`
    : `waiting for face | samples ${signalSamples.length}`;
  if (!roi.fromFace) return null;
  if (roi.motion > MAX_FACE_MOTION_PER_SAMPLE) {
    diagnosticsText = `hold still | motion ${roi.motion.toFixed(3)}`;
  }
  const targetW = 96;
  const targetH = 72;
  sampleCanvas.width = targetW;
  sampleCanvas.height = targetH;
  sampleContext.drawImage(
    videoEl,
    roi.x,
    roi.y,
    roi.w,
    roi.h,
    0,
    0,
    targetW,
    targetH
  );
  latestSamplePreview = sampleCanvas;
  updateSamplePreviewImage();

  const pixels = sampleContext.getImageData(0, 0, targetW, targetH).data;
  let rTotal = 0;
  let gTotal = 0;
  let bTotal = 0;
  let skinCount = 0;
  let clipCount = 0;
  const pixelCount = targetW * targetH;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const looksSkinLike =
      r > 45 &&
      g > 35 &&
      b > 25 &&
      r > b &&
      maxChannel - minChannel > 10 &&
      Math.abs(r - g) > 6;

    if (maxChannel >= 250 || minChannel <= 4) clipCount += 1;
    if (!looksSkinLike) continue;
    rTotal += r;
    gTotal += g;
    bTotal += b;
    skinCount += 1;
  }

  if (skinCount < pixelCount * 0.05) return null;
  return {
    r: rTotal / skinCount,
    g: gTotal / skinCount,
    b: bTotal / skinCount,
    skinRatio: skinCount / pixelCount,
    clipRatio: clipCount / pixelCount,
    fromFace: roi.fromFace,
    motion: roi.motion || 0,
  };
}

function getFaceRoi(sourceW, sourceH) {
  const face = faceMesh?.getFacesRaw?.()?.[0] || null;
  const points = face?.keypoints || [];
  if (!points.length) return getFallbackRoi(sourceW, sourceH);

  const faceBounds = getPointBounds(points);
  const faceW = faceBounds?.w || sourceW * 0.22;
  const faceH = faceBounds?.h || sourceH * 0.28;
  const target = getForeheadTarget(points, faceBounds);
  if (!target) return getFallbackRoi(sourceW, sourceH);

  const roiScale = getRoiScale();
  const roiW = Math.max(24, faceW * 0.26 * roiScale);
  const roiH = Math.max(18, faceH * 0.14 * roiScale);
  const motion = getFaceMotion(target.x, target.y, faceW, sourceW, sourceH);

  return clampRoi({
    x: target.x - roiW * 0.5,
    y: target.y - roiH * 0.5,
    w: roiW,
    h: roiH,
    fromFace: true,
    motion,
  }, sourceW, sourceH);
}

function getForeheadTarget(points, faceBounds) {
  const forehead = getAveragePoint(points, [9, 10, 67, 69, 104, 108, 109, 151, 299, 337, 338]);
  if (forehead) {
    return {
      x: forehead.x,
      y: faceBounds ? lerp(forehead.y, faceBounds.y, 0.28) : forehead.y,
    };
  }
  if (!faceBounds) return null;
  return {
    x: faceBounds.cx,
    y: faceBounds.y + faceBounds.h * 0.18,
  };
}

function getFallbackRoi(sourceW, sourceH) {
  const roiScale = getRoiScale();
  const roiW = sourceW * 0.34;
  const roiH = sourceH * 0.28;
  return {
    x: (sourceW - roiW * roiScale) * 0.5,
    y: sourceH * 0.24,
    w: roiW * roiScale,
    h: roiH * roiScale,
    fromFace: false,
    motion: 0,
  };
}

function getRoiScale() {
  const value = Number(roiScaleSlider?.value?.());
  return Number.isFinite(value) ? value : 1;
}

function getFaceMotion(cx, cy, faceW, sourceW, sourceH) {
  const normalized = {
    x: cx / Math.max(1, sourceW),
    y: cy / Math.max(1, sourceH),
    w: faceW / Math.max(1, sourceW),
  };
  if (!lastFaceCenter) {
    lastFaceCenter = normalized;
    return 0;
  }

  const dx = normalized.x - lastFaceCenter.x;
  const dy = normalized.y - lastFaceCenter.y;
  const dw = normalized.w - lastFaceCenter.w;
  lastFaceCenter = {
    x: lerp(lastFaceCenter.x, normalized.x, 0.35),
    y: lerp(lastFaceCenter.y, normalized.y, 0.35),
    w: lerp(lastFaceCenter.w, normalized.w, 0.35),
  };
  return Math.hypot(dx, dy) + Math.abs(dw) * 0.8;
}

function getAveragePoint(points, indices) {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const index of indices) {
    const point = points[index];
    const px = Number(point?.x);
    const py = Number(point?.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    x += px;
    y += py;
    count += 1;
  }
  if (!count) return null;
  return { x: x / count, y: y / count };
}

function getPointBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
    cx: (minX + maxX) * 0.5,
    cy: (minY + maxY) * 0.5,
  };
}

function clampRoi(roi, sourceW, sourceH) {
  const w = constrain(roi.w, 8, sourceW);
  const h = constrain(roi.h, 8, sourceH);
  return {
    x: constrain(roi.x, 0, sourceW - w),
    y: constrain(roi.y, 0, sourceH - h),
    w,
    h,
    fromFace: !!roi.fromFace,
    motion: Number(roi.motion) || 0,
  };
}

function estimateLocalRppgMetrics() {
  if (signalSamples.length < MIN_STABLE_SAMPLES) {
    displayReason = `warming up ${signalSamples.length}/${MIN_STABLE_SAMPLES}`;
    return {
      bpm: NaN,
      quality: 0,
      sampleRate: getActualSampleRate(),
      samples: signalSamples.length,
    };
  }

  const values = signalSamples.map((sample) => sample.g);
  const sampleRate = getActualSampleRate();
  const normalized = detrendAndNormalize(values);
  const result = estimateBpmByAutocorrelation(normalized, sampleRate);
  const stableBpm = stabilizeBpm(result.bpm, result.quality);
  return {
    bpm: Number.isFinite(stableBpm) ? stableBpm : result.bpm,
    rawBpm: result.bpm,
    quality: result.quality,
    sampleRate,
    samples: signalSamples.length,
  };
}

function getActualSampleRate() {
  if (signalSamples.length < 2) return 0;
  const first = signalSamples[0].t;
  const last = signalSamples[signalSamples.length - 1].t;
  const seconds = Math.max(0.001, (last - first) / 1000);
  return (signalSamples.length - 1) / seconds;
}

function detrendAndNormalize(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const centered = values.map((value) => value - mean);
  const variance = centered.reduce((sum, value) => sum + value * value, 0) / centered.length;
  const sd = Math.sqrt(Math.max(1e-9, variance));
  return centered.map((value) => value / sd);
}

function estimateBpmByAutocorrelation(values, sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || values.length < MIN_STABLE_SAMPLES) {
    return { bpm: NaN, quality: 0 };
  }

  const minLag = Math.max(1, Math.floor((60 / MAX_BPM) * sampleRate));
  const maxLag = Math.min(values.length - 2, Math.ceil((60 / MIN_BPM) * sampleRate));
  const candidates = [];

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const correlation = autocorrelationAtLag(values, lag);
    if (!Number.isFinite(correlation)) continue;
    candidates.push({
      lag,
      bpm: 60 * sampleRate / lag,
      correlation,
    });
  }

  if (!candidates.length) {
    return { bpm: NaN, quality: 0 };
  }

  candidates.sort((a, b) => b.correlation - a.correlation);
  let best = candidates[0];

  return {
    bpm: best.bpm,
    quality: constrain((best.correlation - 0.22) / 0.45, 0, 1),
  };
}

function autocorrelationAtLag(values, lag) {
  let numerator = 0;
  let aEnergy = 0;
  let bEnergy = 0;
  for (let i = lag; i < values.length; i += 1) {
    const a = values[i];
    const b = values[i - lag];
    numerator += a * b;
    aEnergy += a * a;
    bEnergy += b * b;
  }
  const denominator = Math.sqrt(aEnergy * bEnergy);
  if (denominator <= 1e-9) return NaN;
  return numerator / denominator;
}

function stabilizeBpm(nextBpm, quality) {
  if (!Number.isFinite(nextBpm)) {
    displayReason = "no periodic signal";
    return smoothedBpm;
  }
  if (nextBpm < MIN_BPM || nextBpm > MAX_BPM) {
    displayReason = `raw out of range ${nextBpm.toFixed(0)}`;
    return smoothedBpm;
  }
  if (quality < MIN_DISPLAY_QUALITY) {
    displayReason = `quality too low ${quality.toFixed(2)}`;
    if (Number.isFinite(smoothedBpm)) return smoothedBpm;
  }
  if (!Number.isFinite(smoothedBpm)) {
    smoothedBpm = nextBpm;
    displayReason = "first estimate";
    return smoothedBpm;
  }
  if (Math.abs(nextBpm - smoothedBpm) > MAX_BPM_STEP && quality < 0.55) {
    displayReason = `rejecting jump ${nextBpm.toFixed(0)}`;
    smoothedBpm = lerp(smoothedBpm, nextBpm, 0.08);
    return smoothedBpm;
  }
  smoothedBpm = lerp(smoothedBpm, nextBpm, BPM_SMOOTHING);
  displayReason = "tracking";
  return smoothedBpm;
}

function pushHistory(list, value) {
  list.push({ t: millis(), value });
  if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
}

function drawFullWebcamPreview() {
  if (cam && videoEl?.readyState >= 2) {
    drawVideoCover(cam, 0, 0, width, height);
    drawLatestRoiOverlay();
    drawSamplePreview();
    return;
  }

  fill(244, 240, 232, 80);
  textAlign(CENTER, CENTER);
  textSize(18);
  text("camera preview", width * 0.5, height * 0.5);
}

function drawLatestRoiOverlay() {
  if (!latestRoi?.fromFace || !videoEl) return;
  const sourceW = videoEl.videoWidth || cam?.width || 640;
  const sourceH = videoEl.videoHeight || cam?.height || 480;
  const rectInfo = mapVideoRoiToCanvas(latestRoi, sourceW, sourceH);
  if (!rectInfo) return;

  noFill();
  stroke(92, 218, 177, 230);
  strokeWeight(2);
  rect(rectInfo.x, rectInfo.y, rectInfo.w, rectInfo.h, 4);

  noStroke();
  fill(17, 19, 22, 220);
  rect(rectInfo.x, rectInfo.y - 24, 128, 20, 4);
  fill(244, 240, 232);
  textAlign(LEFT, CENTER);
  textStyle(BOLD);
  textSize(11);
  text("FOREHEAD ROI", rectInfo.x + 8, rectInfo.y - 14);
}

function mapVideoRoiToCanvas(roi, sourceW, sourceH) {
  if (!roi || !sourceW || !sourceH) return null;
  const coverScale = Math.max(width / sourceW, height / sourceH);
  const drawW = sourceW * coverScale;
  const drawH = sourceH * coverScale;
  const drawX = (width - drawW) * 0.5;
  const drawY = (height - drawH) * 0.5;
  return {
    x: width - (drawX + (roi.x + roi.w) * coverScale),
    y: drawY + roi.y * coverScale,
    w: roi.w * coverScale,
    h: roi.h * coverScale,
  };
}

function drawSamplePreview() {
  if (!samplePreviewImage) return;
  const previewW = 180;
  const previewH = 135;
  const x = width - previewW - 28;
  const y = height - previewH - 148;

  noStroke();
  fill(17, 19, 22, 220);
  rect(x - 8, y - 30, previewW + 16, previewH + 38, 6);
  fill(244, 240, 232);
  textAlign(LEFT, CENTER);
  textStyle(BOLD);
  textSize(11);
  text("EXTRACTED SAMPLE", x, y - 18);
  image(samplePreviewImage, x, y, previewW, previewH);
}

function updateSamplePreviewImage() {
  if (!latestSamplePreview || !sampleContext) return;
  const sourceW = latestSamplePreview.width;
  const sourceH = latestSamplePreview.height;
  if (!sourceW || !sourceH) return;
  if (!samplePreviewImage || samplePreviewImage.width !== sourceW || samplePreviewImage.height !== sourceH) {
    samplePreviewImage = createImage(sourceW, sourceH);
  }

  const imageData = sampleContext.getImageData(0, 0, sourceW, sourceH);
  samplePreviewImage.loadPixels();
  for (let i = 0; i < imageData.data.length; i += 1) {
    samplePreviewImage.pixels[i] = imageData.data[i];
  }
  samplePreviewImage.updatePixels();
}

function drawVideoCover(video, x, y, w, h) {
  const sourceW = Math.max(1, video.width || video.elt?.videoWidth || 640);
  const sourceH = Math.max(1, video.height || video.elt?.videoHeight || 480);
  const coverScale = Math.max(w / sourceW, h / sourceH);
  const drawW = sourceW * coverScale;
  const drawH = sourceH * coverScale;
  const drawX = x + (w - drawW) * 0.5;
  const drawY = y + (h - drawH) * 0.5;

  push();
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(x, y, w, h);
  drawingContext.clip();
  translate(drawX + drawW, drawY);
  scale(-1, 1);
  image(video, 0, 0, drawW, drawH);
  drawingContext.restore();
  pop();
}

function drawMetricPanel() {
  const layout = getPanelLayout();
  const { x: panelX, y: panelY, w: panelW, h: panelH } = layout.metrics;

  noStroke();
  fill(17, 19, 22, 218);
  rect(panelX, panelY, panelW, panelH, 8);

  const bpm = pickNumber(metrics, ["bpm", "heartRate", "heart_rate", "pulse", "pulseRate"]);
  const rawBpm = pickNumber(metrics, ["rawBpm"]);
  const quality = pickNumber(metrics, ["quality", "confidence", "signalQuality", "snr"]);
  const fps = pickNumber(metrics, ["fps", "frameRate", "sampleRate"]);
  const samples = pickNumber(metrics, ["samples"]);
  const cameraW = videoEl?.videoWidth || cam?.width || 0;
  const cameraH = videoEl?.videoHeight || cam?.height || 0;

  fill(244, 240, 232);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(15);
  text("REMOTE PPG", panelX + 22, panelY + 18);

  textSize(62);
  const displayBpm = Number.isFinite(bpm) ? bpm : rawBpm;
  text(formatNumber(displayBpm, "--"), panelX + 22, panelY + 50);
  textSize(18);
  text("BPM", panelX + 22, panelY + 120);

  textStyle(NORMAL);
  textSize(16);
  const lines = [
    `Quality: ${formatNumber(quality, "--")}`,
    `Sample target: ${SAMPLE_RATE} Hz`,
    `Estimator: local JS`,
    `Raw BPM: ${formatNumber(rawBpm, "--")}`,
    `Actual FPS: ${formatNumber(fps, "--")}`,
    `Camera: ${cameraW && cameraH ? `${cameraW}x${cameraH}` : "--"}`,
    `Samples: ${formatNumber(samples, "--")}`,
    `Display: ${displayReason}`,
    `Session: ${running ? "running" : starting ? "starting" : "idle"}`,
  ];
  text(lines.join("\n"), panelX + 22, panelY + 158, panelW - 44, 120);
}

function drawHistoryGraph() {
  const layout = getPanelLayout();
  const { x, y, w, h } = layout.graph;
  if (h < 110) return;

  noStroke();
  fill(17, 19, 22, 188);
  rect(x, y, w, h, 8);

  fill(244, 240, 232, 170);
  textAlign(LEFT, TOP);
  textSize(13);
  textStyle(BOLD);
  text("BPM HISTORY", x + 18, y + 14);

  stroke(244, 240, 232, 30);
  strokeWeight(1);
  for (let i = 0; i <= 4; i += 1) {
    const gy = y + 48 + (h - 68) * (i / 4);
    line(x + 18, gy, x + w - 18, gy);
  }

  drawSeries(bpmHistory, x + 18, y + 48, w - 36, h - 68, 45, 145, color(92, 218, 177));
}

function drawSeries(series, x, y, w, h, minValue, maxValue, strokeColor) {
  if (series.length < 2) return;
  const newest = series[series.length - 1].t;
  const oldest = newest - HISTORY_SECONDS * 1000;

  noFill();
  stroke(strokeColor);
  strokeWeight(2.2);
  beginShape();
  for (const point of series) {
    const nx = constrain((point.t - oldest) / (HISTORY_SECONDS * 1000), 0, 1);
    const ny = constrain((point.value - minValue) / (maxValue - minValue), 0, 1);
    vertex(x + nx * w, y + h - ny * h);
  }
  endShape();
}

function drawControls() {
  const y = height - 64;
  const buttonW = width < 430 ? Math.max(110, (width - 72) * 0.5) : 142;
  startButtonRect = { x: 28, y, w: buttonW, h: 42 };
  stopButtonRect = { x: 42 + buttonW, y, w: buttonW, h: 42 };
  drawButton(startButtonRect, starting ? "STARTING" : "START", !running && !starting);
  drawButton(stopButtonRect, "STOP", running || starting);

  fill(244, 240, 232, 220);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(12);
  text(`ROI scale ${getRoiScale().toFixed(2)}`, 28, y - 30);
}

function positionRoiSlider() {
  if (!roiScaleSlider) return;
  const y = height - 42;
  const x = width < 760 ? 28 : 348;
  const sliderW = Math.min(280, width - x - 28);
  roiScaleSlider.position(x, y);
  roiScaleSlider.size(Math.max(120, sliderW));
}

function getPanelLayout() {
  const margin = 28;
  const controlReserve = 92;
  const availableW = width - margin * 2;
  const compact = width < 760;
  const metricW = compact ? availableW : Math.min(360, Math.max(300, width * 0.26));
  const metricH = compact ? 190 : 260;
  const metricX = compact ? margin : width - margin - metricW;
  const metricY = margin;
  const graphW = compact ? availableW : Math.min(680, width * 0.5);
  const graphH = compact ? Math.min(150, height * 0.2) : Math.min(190, height * 0.22);
  const graphY = height - controlReserve - graphH;
  return {
    metrics: { x: metricX, y: metricY, w: metricW, h: metricH },
    graph: {
      x: margin,
      y: graphY,
      w: graphW,
      h: graphH,
    },
  };
}

function drawButton(rectInfo, label, enabled) {
  noStroke();
  fill(enabled ? "#5cdab1" : "#34383e");
  rect(rectInfo.x, rectInfo.y, rectInfo.w, rectInfo.h, 8);
  fill(enabled ? "#111316" : "rgba(244,240,232,0.52)");
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(13);
  text(label, rectInfo.x + rectInfo.w * 0.5, rectInfo.y + rectInfo.h * 0.5);
}

function drawStatus() {
  const compact = width < 760;
  const x = compact ? 28 : 348;
  const y = compact ? height - 118 : height - 68;
  const maxH = compact ? 46 : 58;
  fill(244, 240, 232, 210);
  textAlign(LEFT, TOP);
  textStyle(NORMAL);
  textSize(13);
  const detail = [statusText, diagnosticsText, lastErrorText ? `Error: ${lastErrorText}` : ""]
    .filter(Boolean)
    .join("\n");
  text(detail, x, y, width - x - 28, maxH);
}

function mousePressed() {
  const pointer = { x: mouseX, y: mouseY };
  if (hitRect(pointer, startButtonRect)) {
    startRppg();
    return false;
  }
  if (hitRect(pointer, stopButtonRect)) {
    stopRppg();
    return false;
  }
  return true;
}

function hitRect(pointer, rectInfo) {
  if (!rectInfo) return false;
  return (
    pointer.x >= rectInfo.x &&
    pointer.x <= rectInfo.x + rectInfo.w &&
    pointer.y >= rectInfo.y &&
    pointer.y <= rectInfo.y + rectInfo.h
  );
}

function pickNumber(source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function formatNumber(value, fallback = "--") {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.abs(number) >= 100 ? number.toFixed(0) : number.toFixed(1);
}

function formatDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object") return "";
  const parts = [];
  for (const [key, value] of Object.entries(diagnostics).slice(0, 4)) {
    if (value === undefined || value === null) continue;
    parts.push(`${key}: ${typeof value === "number" ? formatNumber(value) : value}`);
  }
  return parts.join(" | ");
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
