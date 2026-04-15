let starPrinter;
let statusText = "loading";
let detailText = "Connect the Star TSP700 over WebUSB.";
let busy = false;
let storeDefaultsArmed = false;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/starUsbPrinter.js");

  try {
    starPrinter = await new StarUsbPrinter({
      vendorId: 0x0519,
      productId: 0x0001,
      onState: (state) => {
        statusText = state.state;
        detailText = formatState(state);
      },
      onError: (error) => {
        console.error("[star-usb-printer] error", error);
        statusText = "error";
        detailText = error?.message || String(error);
      },
    }).init();
  } catch (error) {
    console.error("[star-usb-printer] init failed", error);
    statusText = "unavailable";
    detailText = error?.message || String(error);
  }
}

function draw() {
  background(245, 243, 238);

  if (uiButton("Connect Star USB", { x: 24, y: 24, width: 230, height: 44, fontSize: 18 }).clicked) {
    connectStarPrinter();
  }

  if (uiButton("Reconnect", { x: 270, y: 24, width: 160, height: 44, fontSize: 18 }).clicked) {
    reconnectStarPrinter();
  }

  if (uiButton("Test Print", { x: 446, y: 24, width: 160, height: 44, fontSize: 18 }).clicked) {
    testPrint();
  }

  if (uiButton("Reset Printer", { x: 622, y: 24, width: 180, height: 44, fontSize: 18 }).clicked) {
    resetPrinter();
  }

  if (uiButton("Disconnect", { x: 818, y: 24, width: 160, height: 44, fontSize: 18 }).clicked) {
    starPrinter?.disconnect();
  }

  const storeLabel = storeDefaultsArmed ? "Confirm Store" : "Arm Store Defaults";
  if (uiButton(storeLabel, { x: 994, y: 24, width: 220, height: 44, fontSize: 18 }).clicked) {
    storeContinuousDefaults();
  }

  fill(15);
  noStroke();
  textSize(30);
  text("Star USB Printer", 24, 128);

  textSize(18);
  text(`status: ${formatStatus(statusText)}`, 24, 174);
  text(detailText, 24, 210);

  textSize(14);
  fill(80);
  text(
    "Target: Vendor 0x0519, Product 0x0001, Star TSP700 / STR_T-U001. Sends plain Star Line text first.",
    24,
    height - 36
  );
}

async function connectStarPrinter() {
  if (busy || !starPrinter) return;
  busy = true;
  try {
    statusText = "connecting";
    await starPrinter.connect();
    console.log("[star-usb-printer] connected", starPrinter.getConnectionState());
  } catch (error) {
    console.error("[star-usb-printer] connect failed", error);
    statusText = "connect failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function reconnectStarPrinter() {
  if (busy || !starPrinter) return;
  busy = true;
  try {
    statusText = "reconnecting";
    const connected = await starPrinter.tryReconnectKnown();
    statusText = connected ? "connected" : "needs_usb_permission";
    console.log("[star-usb-printer] reconnect result", {
      connected,
      state: starPrinter.getConnectionState(),
    });
  } catch (error) {
    console.error("[star-usb-printer] reconnect failed", error);
    statusText = "reconnect failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function testPrint() {
  if (busy || !starPrinter) return;
  busy = true;
  try {
    statusText = "printing";
    if (!starPrinter.getConnectionState().connected) {
      const connected = await starPrinter.tryReconnectKnown();
      if (!connected) throw new Error("Star printer is not connected. Press Connect Star USB first.");
    }
    await starPrinter.testPrint();
    statusText = "printed";
  } catch (error) {
    console.error("[star-usb-printer] print failed", error);
    statusText = "print failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function resetPrinter() {
  if (busy || !starPrinter) return;
  busy = true;
  try {
    statusText = "resetting";
    if (!starPrinter.getConnectionState().connected) {
      const connected = await starPrinter.tryReconnectKnown();
      if (!connected) throw new Error("Star printer is not connected. Press Connect Star USB first.");
    }
    await starPrinter.resetPrinter();
    statusText = "reset sent";
  } catch (error) {
    console.error("[star-usb-printer] reset failed", error);
    statusText = "reset failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
}

async function storeContinuousDefaults() {
  if (busy || !starPrinter) return;
  if (!storeDefaultsArmed) {
    storeDefaultsArmed = true;
    statusText = "store armed";
    detailText = "Press Confirm Store to write continuous/default memory switch settings to printer EEPROM.";
    return;
  }

  busy = true;
  try {
    statusText = "storing defaults";
    if (!starPrinter.getConnectionState().connected) {
      const connected = await starPrinter.tryReconnectKnown();
      if (!connected) throw new Error("Star printer is not connected. Press Connect Star USB first.");
    }
    await starPrinter.storeContinuousDefaults();
    statusText = "defaults stored";
    detailText = "Stored continuous/default memory switch settings. Power-cycle the printer if it does not reset itself.";
  } catch (error) {
    console.error("[star-usb-printer] store defaults failed", error);
    statusText = "store failed";
    detailText = error?.message || String(error);
  } finally {
    storeDefaultsArmed = false;
    busy = false;
  }
}

function formatState(state) {
  const device = state.device || {};
  return [
    `device: ${device.manufacturerName || "unknown"} ${device.productName || ""}`.trim(),
    `usb: ${formatUsbId(device.vendorId, device.productId)}`,
    `interface: ${state.interfaceNumber ?? "none"}`,
    `out endpoint: ${state.endpointOut ?? "none"}`,
  ].join("\n");
}

function formatUsbId(vendorId, productId) {
  const vendor = vendorId == null ? "????" : vendorId.toString(16).padStart(4, "0");
  const product = productId == null ? "????" : productId.toString(16).padStart(4, "0");
  return `${vendor}:${product}`;
}

function formatStatus(status) {
  if (status === "needs_usb_permission") return "USB permission missing - press Connect Star USB";
  return status;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
