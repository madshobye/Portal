let printer;
let cam;
let labelGraphic;
let frozenGraphic;

let statusText = "loading";
let detailText = "Starting camera...";
let busy = false;

let labelFormat = "10x15";
let orientation = "landscape";

const storageKey = "portal.photoboothlabel.state";

const labelFormats = {
  "10x10": { widthCm: 10, heightCm: 10 },
  "10x15": { widthCm: 10, heightCm: 15 },
};

const labelDpi = 203;
const dotsPerMm = labelDpi / 25.4;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  loadState();
  rebuildLabelGraphic();

  await loadScript("portal/labelPrinterProtocol.js");
  await loadScript("portal/bleLabelPrinter.js");

  printer = await new BleLabelPrinter({
    protocol: "tspl",
    chunkSize: 488,
    chunkDelayMs: 0,
    connectTimeoutMs: 20000,
    gattConnectAttempts: 3,
    gattConnectRetryDelayMs: 900,
    autoReconnectOnRefresh: false,
    waitForAutoReconnect: false,
    autoReconnectAttempts: 2,
    reconnectDelayMs: 700,
    onState: (state) => {
      statusText = state.state || statusText;
      if (state.connected && !busy) {
        detailText = "Live grayscale preview. Press Print any time.";
      }
      if (!state.connected && !busy) {
        detailText = "Press + to connect printer.";
      }
    },
    onError: (error) => {
      console.error("[photoboothlabel] printer error", error);
      statusText = "error";
      detailText = error?.message || String(error);
    },
  }).init();

  cam = await setupWebcamera(false, 1280, 720, false, false);
  statusText = "ready";
  detailText = "Live grayscale preview. Press + to connect printer.";
}

function draw() {
  background(0);
  renderLabelSurface();

  const preview = getPreviewRect();
  drawPreviewCard(preview);
  drawHeader(preview);
  drawFooter(preview);
  drawControls(preview);
}

function drawHeader(preview) {
  push();
  textAlign(LEFT, BOTTOM);
  textStyle(BOLD);
  textSize(34);
  fill(255);
  noStroke();
  text("PHOTOBOOTH LABEL", preview.x, preview.y - 14);
  pop();
}

function drawFooter(preview) {
  push();
  textAlign(LEFT, TOP);
  textSize(14);
  fill(180);
  noStroke();
  text(`Status: ${statusText}`, preview.x, preview.y + preview.height + 68);
  text(detailText, preview.x, preview.y + preview.height + 88, preview.width, 60);
  pop();
}

function drawControls(preview) {
  const connectionState = printer?.getConnectionState?.() || {};
  const isConnected = !!connectionState.connected;

  const primaryLabel = busy ? "..." : (isConnected ? "Print" : "+");
  const primaryWidth = isConnected ? 104 : 56;
  const controlsY = preview.y + preview.height + 12;

  const primaryButton = uiButton(primaryLabel, {
    x: preview.x + preview.width - primaryWidth,
    y: controlsY,
    width: primaryWidth,
    height: 46,
    fontSize: primaryLabel === "+" ? 28 : 18,
    fillBg: busy ? "#3a3a3a" : "#ff9f1a",
    fillBgHover: busy ? "#3a3a3a" : "#ffb347",
    stroke: busy ? "#4a4a4a" : "#ff9f1a",
    textFill: busy ? "#9a9a9a" : "#000000",
  });
  if (!busy && primaryButton.clicked) {
    handlePrimaryButton();
  }

  const formatButton = uiButton(labelFormat, {
    x: preview.x,
    y: controlsY,
    width: 84,
    height: 46,
    fontSize: 16,
    fillBg: busy ? "#1f1f1f" : "#ffffff",
    fillBgHover: busy ? "#1f1f1f" : "#f1f1f1",
    stroke: busy ? "#2c2c2c" : "#ffffff",
    textFill: busy ? "#5a5a5a" : "#000000",
  });
  if (!busy && formatButton.clicked) {
    toggleLabelFormat();
  }

  const orientationButton = uiButton(orientation === "portrait" ? "P" : "L", {
    x: preview.x + 96,
    y: controlsY,
    width: 56,
    height: 46,
    fontSize: 16,
    fillBg: busy ? "#1f1f1f" : "#ffffff",
    fillBgHover: busy ? "#1f1f1f" : "#f1f1f1",
    stroke: busy ? "#2c2c2c" : "#ffffff",
    textFill: busy ? "#5a5a5a" : "#000000",
  });
  if (!busy && orientationButton.clicked) {
    toggleOrientation();
  }
}

function renderLabelSurface() {
  if (!labelGraphic) return;

  labelGraphic.background(255);
  const source = busy && frozenGraphic ? frozenGraphic : cam;
  if (!source) return;

  drawGrayscaleCover(labelGraphic, source, 0, 0, labelGraphic.width, labelGraphic.height);
}

function drawGrayscaleCover(target, source, dx, dy, dw, dh) {
  const ctx = target.drawingContext;
  const previousFilter = ctx.filter || "none";
  ctx.filter = "grayscale(100%)";
  drawImageCover(target, source, dx, dy, dw, dh);
  ctx.filter = previousFilter;
}

function drawImageCover(target, source, dx, dy, dw, dh) {
  const sourceSize = getSourceSize(source);
  if (!sourceSize) return;
  const { width: sw, height: sh } = sourceSize;
  if (sw <= 0 || sh <= 0) return;

  const scale = Math.max(dw / sw, dh / sh);
  const cropW = dw / scale;
  const cropH = dh / scale;
  const sx = (sw - cropW) * 0.5;
  const sy = (sh - cropH) * 0.5;

  target.image(source, dx, dy, dw, dh, sx, sy, cropW, cropH);
}

function getSourceSize(source) {
  if (!source) return null;
  const videoW = Number(source?.elt?.videoWidth);
  const videoH = Number(source?.elt?.videoHeight);
  if (videoW > 0 && videoH > 0) {
    return { width: videoW, height: videoH };
  }

  const w = Number(source.width);
  const h = Number(source.height);
  if (w > 0 && h > 0) {
    return { width: w, height: h };
  }
  return null;
}

function drawPreviewCard(preview = getPreviewRect()) {
  image(labelGraphic, preview.x, preview.y, preview.width, preview.height);
  noFill();
  stroke(255);
  strokeWeight(1);
  rect(preview.x, preview.y, preview.width, preview.height);
}

function getPreviewRect() {
  const availableWidth = width - 120;
  const availableHeight = height - 220;
  const scale = Math.min(availableWidth / labelGraphic.width, availableHeight / labelGraphic.height);
  const previewWidth = labelGraphic.width * scale;
  const previewHeight = labelGraphic.height * scale;
  return {
    x: (width - previewWidth) * 0.5,
    y: 96,
    width: previewWidth,
    height: previewHeight,
  };
}

async function handlePrimaryButton() {
  if (busy) return;

  const state = printer?.getConnectionState?.() || {};
  if (!state.connected) {
    busy = true;
    statusText = "connecting";
    detailText = "Opening BLE picker...";
    try {
      await printer.connectWithPicker({ acceptAllDevices: false });
      statusText = "connected";
      detailText = "Live grayscale preview. Press Print any time.";
    } catch (error) {
      console.error("[photoboothlabel] connect failed", error);
      statusText = "connect failed";
      detailText = error?.message || String(error);
    } finally {
      busy = false;
    }
    return;
  }

  busy = true;
  statusText = "printing";
  detailText = "Printing frozen capture...";

  try {
    freezeLatestFrame();
    renderLabelSurface();
    labelGraphic.loadPixels();

    const imageData = getPrintableImageData();
    const format = getCurrentLabelFormat();
    await printer.printTsplBitmap(imageData, {
      labelWidthMm: format.widthCm * 10,
      labelHeightMm: format.heightCm * 10,
      gapMm: 2,
      threshold: 210,
      invert: true,
      dither: true,
    });

    statusText = "printed";
    detailText = "Printed the frozen frame.";
  } catch (error) {
    console.error("[photoboothlabel] print failed", error);
    statusText = "print failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

function freezeLatestFrame() {
  if (!labelGraphic || !cam) return;
  if (
    !frozenGraphic ||
    frozenGraphic.width !== labelGraphic.width ||
    frozenGraphic.height !== labelGraphic.height
  ) {
    frozenGraphic = createGraphics(labelGraphic.width, labelGraphic.height);
    frozenGraphic.pixelDensity(1);
  }

  frozenGraphic.background(255);
  drawGrayscaleCover(frozenGraphic, cam, 0, 0, frozenGraphic.width, frozenGraphic.height);
}

function getPrintableImageData() {
  const source = labelGraphic.drawingContext.getImageData(0, 0, labelGraphic.width, labelGraphic.height);
  if (orientation !== "landscape") return source;
  return rotateImageDataClockwise(source);
}

function rotateImageDataClockwise(imageData) {
  const sourceWidth = imageData.width;
  const sourceHeight = imageData.height;
  const rotated = new ImageData(sourceHeight, sourceWidth);

  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const sourceIndex = (y * sourceWidth + x) * 4;
      const destX = sourceHeight - 1 - y;
      const destY = x;
      const destIndex = (destY * rotated.width + destX) * 4;
      rotated.data[destIndex] = imageData.data[sourceIndex];
      rotated.data[destIndex + 1] = imageData.data[sourceIndex + 1];
      rotated.data[destIndex + 2] = imageData.data[sourceIndex + 2];
      rotated.data[destIndex + 3] = imageData.data[sourceIndex + 3];
    }
  }

  return rotated;
}

function toggleLabelFormat() {
  labelFormat = labelFormat === "10x15" ? "10x10" : "10x15";
  rebuildLabelGraphic();
  saveState();
}

function toggleOrientation() {
  orientation = orientation === "portrait" ? "landscape" : "portrait";
  rebuildLabelGraphic();
  saveState();
}

function rebuildLabelGraphic() {
  const format = getCurrentLabelFormat();
  const widthCm = orientation === "landscape" ? format.heightCm : format.widthCm;
  const heightCm = orientation === "landscape" ? format.widthCm : format.heightCm;
  const labelPixelWidth = Math.round(widthCm * 10 * dotsPerMm);
  const labelPixelHeight = Math.round(heightCm * 10 * dotsPerMm);
  labelGraphic = createGraphics(labelPixelWidth, labelPixelHeight);
  labelGraphic.pixelDensity(1);
  frozenGraphic = null;
}

function getCurrentLabelFormat() {
  return labelFormats[labelFormat] || labelFormats["10x15"];
}

function saveState() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      labelFormat,
      orientation,
    }));
  } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const data = JSON.parse(raw);
    labelFormat = labelFormats[data.labelFormat] ? data.labelFormat : "10x15";
    orientation = data.orientation === "portrait" ? "portrait" : "landscape";
  } catch {}
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
