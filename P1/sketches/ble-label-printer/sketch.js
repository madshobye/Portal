let printer;
let blePrinter;
let usbPrinter;
let activeTransport = "ble";
let usbAvailable = false;
let statusText = "loading";
let detailText = "Connect to a BLE label printer, then print a TSPL bitmap label.";
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
    waitForAutoReconnect: true,
    autoReconnectAttempts: 3,
    reconnectDelayMs: 700,
    onState: (state) => handlePrinterState("ble", state),
    onError: (error) => handlePrinterError("ble", error),
  }).init();

  try {
    usbPrinter = await new UsbLabelPrinter({
      protocol: "tspl",
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

  if (uiButton("BLE Connect", { x: 24, y: 24, width: 160, height: 44, fontSize: 18 }).clicked) {
    connectPrinter("ble", { acceptAllDevices: false });
  }

  if (uiButton("BLE All", { x: 200, y: 24, width: 130, height: 44, fontSize: 18 }).clicked) {
    connectPrinter("ble", { acceptAllDevices: true });
  }

  if (uiButton("USB Connect", { x: 346, y: 24, width: 160, height: 44, fontSize: 18 }).clicked) {
    connectPrinter("usb");
  }

  if (uiButton("Reconnect", { x: 522, y: 24, width: 160, height: 44, fontSize: 18 }).clicked) {
    reconnectSavedPrinter();
  }

  if (uiButton("Print ZPL", { x: 698, y: 24, width: 150, height: 44, fontSize: 18 }).clicked) {
    printTestLabel("zpl");
  }

  if (uiButton("Print TSPL", { x: 864, y: 24, width: 150, height: 44, fontSize: 18 }).clicked) {
    printTestLabel("tspl");
  }

  if (uiButton("Print CPCL", { x: 1030, y: 24, width: 150, height: 44, fontSize: 18 }).clicked) {
    printTestLabel("cpcl");
  }

  if (uiButton("Disconnect", { x: 1196, y: 24, width: 150, height: 44, fontSize: 18 }).clicked) {
    printer?.disconnect();
  }

  if (uiButton("Forget BLE", { x: 1362, y: 24, width: 140, height: 44, fontSize: 18 }).clicked) {
    forgetPrinter();
  }

  if (uiButton("New Image", { x: 24, y: 82, width: 150, height: 44, fontSize: 18 }).clicked) {
    generateRandomLabelGraphic();
  }

  if (uiButton("Print Image", { x: 190, y: 82, width: 150, height: 44, fontSize: 18 }).clicked) {
    printRandomImageLabel();
  }

  if (uiButton("Print B1", { x: 356, y: 82, width: 140, height: 44, fontSize: 18 }).clicked) {
    printNiimbotB1ImageLabel();
  }

  if (uiButton("Query B1", { x: 512, y: 82, width: 140, height: 44, fontSize: 18 }).clicked) {
    queryNiimbotB1();
  }

  fill(15);
  noStroke();
  textSize(28);
  text("BLE Label Printer", 24, 172);

  textSize(18);
  text(`status: ${formatStatus(statusText)}`, 24, 212);
  text(`transport: ${activeTransport.toUpperCase()} | protocols: zpl / tspl / cpcl`, 24, 242);
  text(detailText, 24, 282);

  drawLabelPreview(520, 120, 240);

  textSize(14);
  fill(80);
  text(
    "Note: if GATT connect times out, turn the printer off/on and make sure it is not paired or connected in another app.",
    24,
    height - 36
  );
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
