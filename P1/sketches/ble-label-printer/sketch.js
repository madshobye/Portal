let printer;
let blePrinter;
let usbPrinter;
let activeTransport = "ble";
let usbAvailable = false;
let statusText = "loading";
let detailText = "Connect to a BLE printer, then test label or ESC/POS receipt commands.";
let busy = false;
let labelGraphic;
const labelWidthCm = 10;
const labelHeightCm = 15;
const labelWidthMm = labelWidthCm * 10;
const labelHeightMm = labelHeightCm * 10;
const labelDpi = 203;
const labelDotsPerMm = labelDpi / 25.4;
const labelPixelWidth = Math.round(labelWidthMm * labelDotsPerMm);
const labelPixelHeight = Math.round(labelHeightMm * labelDotsPerMm);

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  await loadScript("portal/labelPrinterProtocol.js");
  await loadScript("portal/bleLabelPrinter.js");
  await loadScript("portal/usbLabelPrinter.js");

  blePrinter = await new BleLabelPrinter({
    protocol: "zpl",
    chunkSize: 20,
    chunkDelayMs: 0,
    operationTimeoutMs: 3000,
    parallelServiceLookup: true,
    autoReconnectOnRefresh: false,
    autoReconnectOnDisconnect: false,
    waitForAutoReconnect: false,
    autoReconnectAttempts: 1,
    reconnectDelayMs: 700,
    onState: (state) => handlePrinterState("ble", state),
    onError: (error) => handlePrinterError("ble", error),
  }).init();

  try {
    usbPrinter = await new UsbLabelPrinter({
      protocol: "tspl",
      autoReconnectOnRefresh: false,
      onState: (state) => handlePrinterState("usb", state),
      onError: (error) => handlePrinterError("usb", error),
    }).init();
    usbAvailable = true;
  } catch (error) {
    usbAvailable = false;
    console.warn("[usb-label-printer] unavailable", error);
  }

  printer = blePrinter;

  textSize(18);
  generateRandomLabelGraphic();
}

function draw() {
  background(245, 243, 238);

  if (debugButton("BLE Connect", 0, 0).clicked) {
    connectPrinter("ble", { acceptAllDevices: false });
  }

  if (debugButton("BLE All", 1, 0).clicked) {
    connectPrinter("ble", { acceptAllDevices: true });
  }

  if (debugButton("USB Connect", 2, 0).clicked) {
    connectPrinter("usb");
  }

  if (debugButton("Reconnect", 3, 0).clicked) {
    reconnectSavedPrinter();
  }

  if (debugButton("Print ZPL", 4, 0).clicked) {
    printTestLabel("zpl");
  }

  if (debugButton("Print TSPL", 5, 0).clicked) {
    printTestLabel("tspl");
  }

  if (debugButton("Print CPCL", 6, 0).clicked) {
    printTestLabel("cpcl");
  }

  if (debugButton("Disconnect", 7, 0).clicked) {
    printer?.disconnect();
  }

  if (debugButton("Forget BLE", 8, 0).clicked) {
    forgetPrinter();
  }

  if (debugButton("New Image", 0, 1).clicked) {
    generateRandomLabelGraphic();
  }

  if (debugButton("Print Image", 1, 1).clicked) {
    printRandomImageLabel();
  }

  if (debugButton("Print B1", 2, 1).clicked) {
    printNiimbotB1ImageLabel();
  }

  if (debugButton("Query B1", 3, 1).clicked) {
    queryNiimbotB1();
  }

  if (debugButton("ESC Text", 4, 1).clicked) {
    printEscposTextReceipt();
  }

  if (debugButton("ESC Feed", 5, 1).clicked) {
    feedEscposReceipt();
  }

  if (debugButton("Raw Text", 6, 1).clicked) {
    printRawReceiptText("lf");
  }

  if (debugButton("Raw CRLF", 7, 1).clicked) {
    printRawReceiptText("crlf");
  }

  if (debugButton("Black Bar", 0, 2).clicked) {
    printEscposBlackBar();
  }

  if (debugButton("Long Text", 1, 2).clicked) {
    promptAndPrintRotatedReceiptText();
  }

  fill(15);
  noStroke();
  textSize(28);
  text("BLE Label Printer", 24, 142);

  textSize(18);
  text(`status: ${formatStatus(statusText)}`, 24, 182);
  text(`transport: ${activeTransport.toUpperCase()} | protocols: zpl / tspl / cpcl / escpos`, 24, 212);
  text(detailText, 24, 252);

  drawLabelPreview(520, 310, min(260, height - 360));

  textSize(14);
  fill(80);
  text(
    "Note: if GATT connect times out, turn the printer off/on and make sure it is not paired or connected in another app.",
    24,
    height - 36
  );
}

function debugButton(label, column, row) {
  const margin = 16;
  const gap = 6;
  const buttonW = max(82, min(112, (width - margin * 2 - gap * 8) / 9));
  const buttonH = 34;
  return uiButton(label, {
    x: margin + column * (buttonW + gap),
    y: 16 + row * (buttonH + gap),
    width: buttonW,
    height: buttonH,
    fontSize: 12,
  });
}

async function connectPrinter(transport = activeTransport, options = {}) {
  if (busy) return;
  busy = true;
  try {
    selectTransport(transport);
    statusText = "connecting";
    if (activeTransport === "ble") {
      await printer.connectWithPicker({ acceptAllDevices: !!options.acceptAllDevices });
    } else {
      await printer.connect();
    }
    console.log("[label-printer] connected state", printer.getConnectionState());
  } catch (error) {
    console.error("[label-printer] connect failed", error);
    statusText = "connect failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function reconnectSavedPrinter() {
  if (busy) return;
  busy = true;
  try {
    statusText = "reconnecting saved";
    const connected = activeTransport === "ble"
      ? await printer.reconnectKnown({ reason: "manual", attempts: 3, delayMs: 700 })
      : await printer.tryReconnectKnown();
    statusText = connected ? "connected" : "needs_connection";
    console.log("[label-printer] reconnect saved result", {
      connected,
      state: printer.getConnectionState(),
    });
  } catch (error) {
    console.error("[label-printer] reconnect saved failed", error);
    statusText = "reconnect failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function printTestLabel(protocol) {
  if (busy) return;
  busy = true;
  try {
    statusText = `printing ${protocol}`;
    await ensurePrinterConnected();
    if (protocol === "tspl") {
      await printer.printTsplText("Portal BLE TSPL");
    } else if (protocol === "cpcl") {
      await printer.printCpclText("Portal BLE CPCL");
    } else {
      await printer.printZplText("Portal BLE ZPL", {
        widthDots: 609,
        heightDots: 203,
        x: 32,
        y: 36,
        fontHeight: 44,
        fontWidth: 44,
      });
    }
    statusText = `printed ${protocol}`;
  } catch (error) {
    console.error("[ble-label-printer] print failed", error);
    statusText = "print failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function printEscposTextReceipt() {
  if (busy) return;
  busy = true;
  try {
    statusText = "printing escpos text";
    await ensurePrinterConnected();
    await printer.printEscposText([
      "Receipt printer test",
      new Date().toLocaleString(),
      "",
      "If you can read this,",
      "ESC/POS text works.",
    ].join("\n"), {
      title: "Portal BLE",
      feedLines: 4,
      align: "center",
    });
    statusText = "printed escpos text";
    detailText = "ESC/POS text command sent.";
  } catch (error) {
    console.error("[ble-label-printer] escpos text failed", error);
    statusText = "escpos text failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function printEscposBlackBar() {
  if (busy) return;
  busy = true;
  try {
    statusText = "printing black bar";
    await ensurePrinterConnected();
    const widthBytes = 48; // JK-5803P: 384 dots / 8 = 48 bytes.
    const heightDots = 16;
    const imageBytes = new Uint8Array(widthBytes * heightDots);
    imageBytes.fill(0xff);
    const header = new Uint8Array([
      0x1b, 0x40,
      0x1d, 0x76, 0x30, 0x00,
      widthBytes & 0xff,
      (widthBytes >> 8) & 0xff,
      heightDots & 0xff,
      (heightDots >> 8) & 0xff,
    ]);
    const feed = new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a]);
    const payload = new Uint8Array(header.length + imageBytes.length + feed.length);
    payload.set(header, 0);
    payload.set(imageBytes, header.length);
    payload.set(feed, header.length + imageBytes.length);
    await printer.writeBytes(payload);
    statusText = "printed black bar";
    detailText = "Black raster bar sent.";
  } catch (error) {
    console.error("[ble-label-printer] black bar failed", error);
    statusText = "black bar failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function promptAndPrintRotatedReceiptText() {
  if (busy) return;
  const input = window.prompt("Text to print sideways across the receipt width:", "PORTAL");
  const textToPrint = String(input || "").trim();
  if (!textToPrint) {
    detailText = "Long text print cancelled.";
    return;
  }

  busy = true;
  try {
    statusText = "rendering long text";
    await ensurePrinterConnected();
    const result = await printRotatedReceiptText(textToPrint, {
      widthDots: 384,
      fontFamily: getReceiptFontFamily(),
      fontSize: 330,
      paddingDots: 28,
      stripWidth: 48,
      chunkDelayMs: 6,
      lineDelayMs: 8,
      threshold: 210,
    });
    statusText = "printed long text";
    detailText = `Printed ${textToPrint.length} chars sideways (${result.rasterRows} raster rows).`;
  } catch (error) {
    console.error("[ble-label-printer] long text failed", error);
    statusText = "long text failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function printRotatedReceiptText(textToPrint, {
  widthDots = 384,
  fontFamily = "serif",
  fontSize = 330,
  paddingDots = 28,
  stripWidth = 48,
  chunkDelayMs = 6,
  lineDelayMs = 8,
  threshold = 210,
} = {}) {
  const metrics = measureReceiptText(textToPrint, {
    fontFamily,
    fontSize,
    paddingDots,
  });
  await withTemporaryPrinterChunkDelay(chunkDelayMs, async () => {
    await printer.writeBytes(new Uint8Array([
      0x1b, 0x40,
      0x1b, 0x33, 0x00,
    ]));
    for (let sourceX = 0; sourceX < metrics.sourceWidth; sourceX += stripWidth) {
      statusText = `printing long text ${Math.round((sourceX / metrics.sourceWidth) * 100)}%`;
      const currentStripWidth = Math.min(stripWidth, metrics.sourceWidth - sourceX);
      const stripGraphic = makeReceiptTextSourceStrip(textToPrint, {
        widthDots,
        fontFamily,
        fontSize,
        paddingDots,
        baseline: Math.round((widthDots - metrics.ascent - metrics.descent) / 2 + metrics.ascent),
        sourceX,
        sourceWidth: currentStripWidth,
      });
      await printReceiptTextSourceStripAsRows(stripGraphic, {
        widthDots,
        threshold,
        lineDelayMs,
      });
      stripGraphic.remove();
    }
    await printer.writeBytes(new Uint8Array([
      0x1b, 0x32,
      0x0a, 0x0a, 0x0a, 0x0a,
    ]));
  });
  return { rasterRows: metrics.sourceWidth };
}

function measureReceiptText(textToPrint, {
  fontFamily = "serif",
  fontSize = 330,
  paddingDots = 28,
} = {}) {
  const measurer = createGraphics(16, 16);
  measurer.pixelDensity(1);
  measurer.textFont(fontFamily);
  measurer.textSize(fontSize);
  const textWidthDots = Math.ceil(measurer.textWidth(textToPrint));
  const ascent = measurer.textAscent();
  const descent = measurer.textDescent();
  measurer.remove();
  return {
    ascent,
    descent,
    sourceWidth: Math.max(1, textWidthDots + paddingDots * 2),
  };
}

function makeReceiptTextSourceStrip(textToPrint, {
  widthDots = 384,
  fontFamily = "serif",
  fontSize = 330,
  paddingDots = 28,
  baseline = 330,
  sourceX = 0,
  sourceWidth = 512,
} = {}) {
  const source = createGraphics(sourceWidth, widthDots);
  source.pixelDensity(1);
  source.background(255);
  source.noStroke();
  source.fill(0);
  source.textFont(fontFamily);
  source.textSize(fontSize);
  source.textAlign(LEFT, BASELINE);
  source.text(textToPrint, paddingDots - sourceX, baseline);
  return source;
}

async function printReceiptTextSourceStripAsRows(graphic, {
  widthDots = 384,
  threshold = 210,
  lineDelayMs = 8,
} = {}) {
  graphic.loadPixels();
  const widthBytes = Math.ceil(widthDots / 8);
  for (let sourceX = 0; sourceX < graphic.width; sourceX += 1) {
    const rowBytes = packReceiptTextColumnAsRasterRow(graphic, {
      sourceX,
      widthDots,
      threshold,
    });
    await printer.writeBytes(makeEscposRasterPayload(widthBytes, 1, rowBytes));
    if (lineDelayMs > 0) {
      await waitMs(lineDelayMs);
    }
  }
}

function packReceiptTextColumnAsRasterRow(graphic, {
  sourceX = 0,
  widthDots = 384,
  threshold = 210,
} = {}) {
  const widthBytes = Math.ceil(widthDots / 8);
  const output = new Uint8Array(widthBytes);
  const pixels = graphic.pixels;
  for (let dot = 0; dot < widthDots; dot += 1) {
    const sourceY = widthDots - 1 - dot;
    const pixelIndex = (sourceY * graphic.width + sourceX) * 4;
    const alpha = pixels[pixelIndex + 3];
    if (alpha <= 20) continue;
    const red = pixels[pixelIndex];
    const green = pixels[pixelIndex + 1];
    const blue = pixels[pixelIndex + 2];
    const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
    if (luminance >= threshold) continue;
    output[dot >> 3] |= 0x80 >> (dot & 7);
  }
  return output;
}

async function printEscposRasterGraphic(graphic, {
  widthDots = 384,
  bandHeight = 16,
  threshold = 210,
  initialize = true,
  feed = true,
} = {}) {
  const widthBytes = Math.ceil(widthDots / 8);
  if (initialize) {
    await printer.writeBytes(new Uint8Array([0x1b, 0x40]));
  }
  graphic.loadPixels();
  for (let y = 0; y < graphic.height; y += bandHeight) {
    const currentHeight = Math.min(bandHeight, graphic.height - y);
    const imageBytes = packEscposRasterBand(graphic, {
      x: 0,
      y,
      widthDots,
      heightDots: currentHeight,
      threshold,
    });
    const payload = makeEscposRasterPayload(widthBytes, currentHeight, imageBytes);
    await printer.writeBytes(payload);
  }
  if (feed) {
    await printer.writeBytes(new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a]));
  }
}

async function printEscposBitImageGraphic(graphic, {
  widthDots = 384,
  threshold = 210,
  initialize = true,
  feed = true,
  lineDelayMs = 25,
} = {}) {
  if (initialize) {
    await printer.writeBytes(new Uint8Array([0x1b, 0x40]));
  }
  graphic.loadPixels();
  for (let y = 0; y < graphic.height; y += 8) {
    const currentHeight = Math.min(8, graphic.height - y);
    const imageBytes = packEscposBitImageBand(graphic, {
      x: 0,
      y,
      widthDots,
      heightDots: currentHeight,
      threshold,
    });
    const payload = makeEscposBitImagePayload(widthDots, imageBytes);
    await printer.writeBytes(payload);
    if (lineDelayMs > 0) {
      await waitMs(lineDelayMs);
    }
  }
  if (feed) {
    await printer.writeBytes(new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a]));
  }
}

function packEscposBitImageBand(graphic, {
  x = 0,
  y = 0,
  widthDots = 384,
  heightDots = 8,
  threshold = 210,
} = {}) {
  const output = new Uint8Array(widthDots);
  const pixels = graphic.pixels;
  for (let column = 0; column < widthDots; column += 1) {
    let packed = 0;
    for (let row = 0; row < 8; row += 1) {
      if (row >= heightDots) continue;
      const pixelIndex = ((y + row) * graphic.width + x + column) * 4;
      const alpha = pixels[pixelIndex + 3];
      if (alpha <= 20) continue;
      const red = pixels[pixelIndex];
      const green = pixels[pixelIndex + 1];
      const blue = pixels[pixelIndex + 2];
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      if (luminance < threshold) {
        packed |= 0x80 >> row;
      }
    }
    output[column] = packed;
  }
  return output;
}

function makeEscposBitImagePayload(widthDots, imageBytes) {
  const header = new Uint8Array([
    0x1b, 0x2a, 0x00,
    widthDots & 0xff,
    (widthDots >> 8) & 0xff,
  ]);
  const payload = new Uint8Array(header.length + imageBytes.length + 1);
  payload.set(header, 0);
  payload.set(imageBytes, header.length);
  payload[payload.length - 1] = 0x0a;
  return payload;
}

function packEscposRasterBand(graphic, {
  x = 0,
  y = 0,
  widthDots = 384,
  heightDots = 16,
  threshold = 210,
} = {}) {
  const widthBytes = Math.ceil(widthDots / 8);
  const output = new Uint8Array(widthBytes * heightDots);
  const pixels = graphic.pixels;
  for (let row = 0; row < heightDots; row += 1) {
    for (let column = 0; column < widthDots; column += 1) {
      const pixelIndex = ((y + row) * graphic.width + x + column) * 4;
      const alpha = pixels[pixelIndex + 3];
      if (alpha <= 20) continue;
      const red = pixels[pixelIndex];
      const green = pixels[pixelIndex + 1];
      const blue = pixels[pixelIndex + 2];
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      if (luminance >= threshold) continue;
      output[row * widthBytes + (column >> 3)] |= 0x80 >> (column & 7);
    }
  }
  return output;
}

function makeEscposRasterPayload(widthBytes, heightDots, imageBytes) {
  const header = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    heightDots & 0xff,
    (heightDots >> 8) & 0xff,
  ]);
  const payload = new Uint8Array(header.length + imageBytes.length);
  payload.set(header, 0);
  payload.set(imageBytes, header.length);
  return payload;
}

function getReceiptFontFamily() {
  return '"Rubik Mono One", monospace';
}

async function withTemporaryPrinterChunkDelay(chunkDelayMs, callback) {
  const previousChunkDelayMs = printer?.chunkDelayMs;
  if (typeof previousChunkDelayMs === "number") {
    printer.chunkDelayMs = Math.max(0, Number(chunkDelayMs) || 0);
  }
  try {
    return await callback();
  } finally {
    if (typeof previousChunkDelayMs === "number") {
      printer.chunkDelayMs = previousChunkDelayMs;
    }
  }
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function feedEscposReceipt() {
  if (busy) return;
  busy = true;
  try {
    statusText = "feeding escpos";
    await ensurePrinterConnected();
    await printer.feedEscpos(5);
    statusText = "fed escpos";
    detailText = "ESC/POS feed command sent.";
  } catch (error) {
    console.error("[ble-label-printer] escpos feed failed", error);
    statusText = "escpos feed failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function printRawReceiptText(lineEnding = "lf") {
  if (busy) return;
  busy = true;
  try {
    statusText = `printing raw ${lineEnding}`;
    await ensurePrinterConnected();
    const newline = lineEnding === "crlf" ? "\r\n" : "\n";
    const text = [
      "PORTAL RAW TEXT TEST",
      new Date().toLocaleString(),
      "No ESC/POS formatting.",
      "",
      "",
      "",
    ].join(newline);
    await printer.writeText(text);
    statusText = `printed raw ${lineEnding}`;
    detailText = `Raw ${lineEnding.toUpperCase()} text sent in 20-byte chunks.`;
  } catch (error) {
    console.error("[ble-label-printer] raw text failed", error);
    statusText = "raw text failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function forgetPrinter() {
  if (busy) return;
  busy = true;
  try {
    statusText = "forgetting";
    await printer.forgetKnownDevice();
    statusText = "forgot device";
    detailText = "Browser Bluetooth permission was cleared. Power-cycle the printer, then connect again.";
  } catch (error) {
    console.error("[ble-label-printer] forget failed", error);
    statusText = "forget failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function ensurePrinterConnected() {
  const state = printer.getConnectionState();
  if (state.connected) return;
  const reconnected = activeTransport === "ble"
    ? await printer.reconnectKnown({ reason: "print", attempts: 2, delayMs: 500 })
    : await printer.tryReconnectKnown();
  if (reconnected) return;
  throw new Error(`Printer is not connected. Press ${activeTransport.toUpperCase()} Connect once, then print again.`);
}

async function printRandomImageLabel() {
  if (busy) return;
  busy = true;
  try {
    statusText = "printing image";
    await ensurePrinterConnected();
    labelGraphic.loadPixels();
    const imageData = labelGraphic.drawingContext.getImageData(0, 0, labelGraphic.width, labelGraphic.height);
    await printer.printTsplBitmap(imageData, {
      labelWidthMm,
      labelHeightMm,
      gapMm: 2,
      threshold: 210,
      invert: true,
      dither: true,
    });
    statusText = "printed image";
  } catch (error) {
    console.error("[ble-label-printer] image print failed", error);
    statusText = "image print failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function printNiimbotB1ImageLabel() {
  if (busy) return;
  busy = true;
  try {
    statusText = "printing niimbot b1";
    await ensurePrinterConnected();
    labelGraphic.loadPixels();
    const imageData = labelGraphic.drawingContext.getImageData(0, 0, labelGraphic.width, labelGraphic.height);
    await printer.printNiimbotB1Bitmap(imageData, {
      labelWidthMm: 48,
      labelHeightMm: 30,
      dpi: 203,
      density: 3,
      labelType: 1,
      copies: 1,
      threshold: 210,
      dither: true,
      invert: false,
    });
    statusText = "printed niimbot b1";
  } catch (error) {
    console.error("[label-printer] niimbot b1 print failed", error);
    statusText = "niimbot b1 print failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function queryNiimbotB1() {
  if (busy) return;
  busy = true;
  try {
    selectTransport("ble");
    statusText = "querying niimbot b1";
    await ensurePrinterConnected();
    const result = await blePrinter.queryNiimbotB1MediaInfo();
    console.log("[label-printer] niimbot b1 media query", result);
    const media = result.media || {};
    statusText = "queried niimbot b1";
    detailText = [
      `paper inserted: ${media.paperInserted}`,
      `paper rfid ok: ${media.paperRfidOk}`,
      `ribbon inserted: ${media.ribbonInserted}`,
      `charge: ${media.chargeLevel}`,
    ].join("\n");
  } catch (error) {
    console.error("[label-printer] niimbot b1 query failed", error);
    statusText = "niimbot b1 query failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

function generateRandomLabelGraphic() {
  labelGraphic = createGraphics(labelPixelWidth, labelPixelHeight);
  labelGraphic.pixelDensity(1);
  labelGraphic.background(255);
  labelGraphic.noStroke();

  const ellipseCount = 70;
  for (let index = 0; index < ellipseCount; index += 1) {
    labelGraphic.fill(random([0, 40, 80, 120]));
    labelGraphic.ellipse(
      random(labelGraphic.width),
      random(labelGraphic.height),
      random(30, 180),
      random(30, 180)
    );
  }

  labelGraphic.noFill();
  labelGraphic.stroke(0);
  labelGraphic.strokeWeight(2);
  labelGraphic.rect(1, 1, labelGraphic.width - 2, labelGraphic.height - 2);
}

function drawLabelPreview(x, y, previewHeight) {
  if (!labelGraphic) return;
  const previewWidth = previewHeight * (labelGraphic.width / labelGraphic.height);
  fill(20);
  noStroke();
  textSize(16);
  text(`${labelWidthCm} x ${labelHeightCm} cm bitmap (${labelGraphic.width} x ${labelGraphic.height} dots)`, x, y - 14);
  image(labelGraphic, x, y, previewWidth, previewHeight);
  noFill();
  stroke(20);
  strokeWeight(1);
  rect(x, y, previewWidth, previewHeight);
}

function formatStatus(status) {
  if (status === "ready") return "starting";
  if (status === "needs_connection") return "not connected - press Connect Printer";
  if (status === "needs_browser_permission") return "paired, but browser permission missing - press Connect Printer";
  if (status === "needs_picker_after_refresh") return "browser cannot list saved BLE devices - press Connect Printer";
  if (status === "needs_port_permission") return "USB permission missing - press USB Connect";
  if (status === "connected") return "connected";
  return status;
}

function selectTransport(transport) {
  if (transport === "usb" && !usbPrinter) {
    throw new Error("USB serial label printer is unavailable in this browser");
  }
  activeTransport = transport === "usb" ? "usb" : "ble";
  printer = activeTransport === "usb" ? usbPrinter : blePrinter;
}

function handlePrinterState(transport, state) {
  if (transport !== activeTransport) return;
  statusText = state.state;
  if (transport === "usb") {
    const info = state.portInfo || {};
    detailText = [
      `port: ${formatUsbId(info.usbVendorId, info.usbProductId)}`,
      `baud: ${usbPrinter?.baudRate || ""}`,
    ].join("\n");
    return;
  }

  detailText = [
    state.deviceName ? `device: ${state.deviceName}` : "device: none",
    state.serviceUuid ? `service: ${state.serviceUuid}` : "service: searching",
    state.characteristicUuid ? `char: ${state.characteristicUuid}` : "char: searching",
  ].join("\n");
}

function handlePrinterError(transport, error) {
  console.error(`[${transport}-label-printer] printer error`, error);
  if (transport !== activeTransport) return;
  statusText = "error";
  detailText = error?.message || String(error);
}

function formatUsbId(vendorId, productId) {
  if (vendorId == null && productId == null) return "none";
  const vendor = vendorId == null ? "????" : vendorId.toString(16).padStart(4, "0");
  const product = productId == null ? "????" : productId.toString(16).padStart(4, "0");
  return `${vendor}:${product}`;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
