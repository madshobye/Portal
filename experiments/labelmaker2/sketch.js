let printer;
let printServer = null;
let printServerState = { running: false, starting: false, id: "", connections: 0, queued: 0, processing: false };
let connectMenuOpen = false;
let settingsPanelOpen = false;
let connectingPrinter = false;
let lastPeerStateLogKey = "";
let statusText = "loading";
let detailText = "Type on the keyboard. Return inserts a new line.";
let busy = false;
let activePrintId = 0;
let printCancelRequested = false;
let activePrintJob = null;
let printProgress = 0;
let labelGraphic;
let labelTextGraphic;
let labelPhotoGraphic;
let chromaticAberrationShader = null;
let noiseShader = null;
let noiseThresholdShader = null;
let textChromaticAberrationShader = null;
let textNoiseShader = null;
let textNoiseThresholdShader = null;
let photoFilterShaderTarget = null;
let textFilterShaderTarget = null;
const disabledCustomPhotoFilters = new Set();
const loggedPhotoFilterHits = new Set();
let cam = null;
let photoCameraStarting = false;
let droppedPhotoImage = null;
let droppedPhotoName = "";
let photoOffsetX = 0;
let photoOffsetY = 0;
let storedPhotoDataUrl = "";
let previewPointerPress = null;
let labelText = "";
let cursorIndex = 0;
let caretWhite = false;
let lastCaretToggleMs = 0;
let lineFontSizes = {};
let textStyleRanges = {
  bold: [],
  italic: [],
  underline: [],
};
let pendingTextStyle = {
  bold: false,
  italic: false,
  underline: false,
};
let textInputEl = null;
let terminusFont = null;
let perfectDosFont = null;
const storageKey = "portal.labelmaker2.state";
const printHistoryStorageKey = "portal.labelmaker2.printHistory";
const printHistorySliderKey = "labelmaker2.printHistoryIndex";
const peerPrinterUrlParam = "peerPrinter";
const editorPhotoDbName = "portal.labelmaker2.photos";
const editorPhotoStoreName = "photos";
const editorPhotoStorageId = "current";
let labelFormat = "10x15";
let orientation = "landscape";
let editorFontMode = "helvetica";
let autoSizingEnabled = true;
let useSoftKeyboardInput = false;
let useP5SoftKeyboardInput = false;
let textInputComposing = false;
let lastBridgeInput = { time: 0, text: "", kind: "" };
let outputMode = "label";
let outputModeAuto = true;
let peerHostnames = [];
let pendingPeerHostname = "";
let labelPaddingMode = "minimal";
let labelQrText = "";
let labelQrCode = null;
let photoEnabled = false;
let photoMergeMode = "below";
let photoGrayscaleEnabled = true;
let labelInverted = false;
let textOutlineMode = "none";
let textEffectMode = "none";
const debugCharacterBounds = false;
let tooltipKey = "";
let tooltipLabel = "";
let tooltipX = 0;
let tooltipY = 0;
let tooltipStartedAt = 0;
let tooltipActiveThisFrame = false;
let printHistory = [];
let printHistoryIndex = -1;
let peerHostnameLongPress = { hostname: "", startedAt: 0, fired: false };
let peerAutoConnectFromUrl = "";
let restoreLiveCameraOnSetup = false;
let editorStatePhotoStorageDropped = false;
let labelRenderDirty = true;
let labelRenderKey = "";
let cachedLabelLayout = null;
let cachedTextOrigin = null;
let photoRevision = 0;
let photoLoadToken = 0;
let historyRestoreToken = 0;
let pendingPhotoRestore = false;

const labelFormats = {
  "10x10": { widthCm: 10, heightCm: 10 },
  "10x15": { widthCm: 10, heightCm: 15 },
};
const labelDpi = 203;
const dotsPerMm = labelDpi / 25.4;
const labelPaddingPresets = {
  minimal: {
    left: 24,
    right: 17,
    top: 24,
    bottom: 24,
  },
  some: {
    left: 48,
    right: 34,
    top: 48,
    bottom: 48,
  },
  lot: {
    left: 72,
    right: 50,
    top: 72,
    bottom: 72,
  },
};
const labelPaddingModes = ["minimal", "some", "lot"];
const photoMergeModes = ["below", "blur", "erode", "invert", "invertblur", "chromatic", "noise", "noisethreshold", "chromaticblur", "stencil", "hardblack"];
const textOutlineModes = ["none", "outline", "opposite"];
const textEffectModes = ["none", "chromatic", "noise", "noisethreshold", "blur", "chromaticblur"];
const minFontSize = 24;
const maxFontSize = 2560;
const defaultFontSize = 96;
const fontSizeScale = [24, 28, 32, 36, 40, 46, 52, 60, 68, 78, 88, 100, 112, 128, 144, 164, 184, 208, 232, 256, 280, 300, 320, 360, 400, 448, 512, 576, 640, 720, 800, 896, 1024, 1152, 1280, 1440, 1600, 1792, 2048, 2304, 2560];
const lineHeightFactor = 1.16;
const toolbarButtonSize = 46;
const toolbarButtonHeight = toolbarButtonSize;
const toolbarIconSize = Math.round(toolbarButtonSize * 0.68);
const toolbarSmallIconSize = Math.round(toolbarButtonSize * 0.54);
const toolbarGap = Math.round(toolbarButtonSize * 0.14);
const toolbarRowGap = Math.round(toolbarButtonSize * 0.18);
const toolbarPreviewGap = 8;
const tooltipDelayMs = 450;
const historySliderHeight = Math.round(toolbarButtonSize * 0.65);
const maxPeerHostnameMenuItems = 5;
const peerHostnameDeleteHoldMs = 3000;
const connectMenuMinWidth = 190;
const printHistoryStoragePressureLimit = 0.9;
const tsplTextPrintDensity = 6;
const tsplPhotoPrintDensity = 3;
const tsplHardBlackPhotoPrintDensity = 5;
const storedPhotoJpegQuality = 0.92;
const fallbackFontFamily = "Helvetica";
const googleFontFamilies = [
  "Material Symbols Rounded",
  "Bebas Neue",
  "Oswald",
  "Rubik Mono One",
  "Space Mono",
  "Special Elite",
  "IBM Plex Sans Condensed",
];
const fontOptions = [
  { key: "helvetica", label: "Helv", kind: "system", family: "Helvetica" },
  { key: "arial", label: "Arial", kind: "system", family: "Arial" },
  { key: "terminus", label: "Term", kind: "local" },
  { key: "perfectdos", label: "DOS", kind: "local" },
  { key: "bebas", label: "Bebas", kind: "google", family: "Bebas Neue" },
  { key: "oswald", label: "Oswald", kind: "google", family: "Oswald" },
  { key: "rubikmonoone", label: "Rubik", kind: "google", family: "Rubik Mono One" },
  { key: "spacemono", label: "Mono", kind: "google", family: "Space Mono" },
  { key: "specialelite", label: "Elite", kind: "google", family: "Special Elite" },
  { key: "ibmplexcondensed", label: "Plex", kind: "google", family: "IBM Plex Sans Condensed" },
];

async function setup() {
  installWillReadFrequentlyCanvasHint();
  const canvas = createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  initPhotoFilterShaders();
  canvas.drop(handlePhotoDrop);
  useSoftKeyboardInput = detectSoftKeyboardMode();
  useP5SoftKeyboardInput = useSoftKeyboardInput && detectIOSLikeBrowser();
  installTextInputBridge();
  installKeyCapture();
  terminusFont = await loadFont("../textprompt/Terminus.ttf");
  perfectDosFont = await loadFont("../textprompt/PerfectDOSVGA437.ttf");
  if (typeof loadGoogleFont === "function") {
    try {
      await loadGoogleFont(googleFontFamilies);
    } catch (error) {
      console.warn("[labelmaker2] Google font load failed", error);
    }
  }
  await loadScript("portal/labelPrinterProtocol.js");
  await loadScript("portal/bleLabelPrinter.js");
  await loadScript("portal/usbLabelPrinter.js");
  await loadScript("portal/starUsbPrinter.js");
  await loadScript("portal/peerLabelPrinter.js");
  await loadScript("portal/peerPrintServer.js");
  await loadScript("portal/labelPrinterTransport.js");
  await loadScript("portal/qrCodeGen.js");

  printer = await new LabelPrinterTransport({
    ble: {
      protocol: "tspl",
      chunkSize: 488,
      chunkDelayMs: 0,
      preferWriteWithResponse: true,
    },
    usb: {
      protocol: "tspl",
      chunkSize: 4096,
      chunkDelayMs: 2,
      autoReconnectOnRefresh: true,
      debug: false,
    },
    webusb: {
      vendorId: 0x0416,
      productId: 0x5011,
      chunkSize: 4096,
      chunkDelayMs: 0,
      debug: false,
    },
    peer: {
      protocol: "tspl",
      host: "0.peerjs.com",
      port: 443,
      path: "/",
      key: "peerjs",
      secure: true,
      remoteId: "printhost",
      chunkSize: 512,
      chunkDelayMs: 12,
      progressCooldownMs: 0,
      connectTimeoutMs: 30000,
      dataChannelTimeoutMs: 60000,
      candidateRetryCount: 0,
      connectedSettleMs: 1000,
      heartbeatIntervalMs: 5000,
      heartbeatTimeoutMs: 45000,
      debug: false,
    },
    onState: handlePrinterState,
    onError: handlePrinterError,
  }).init();

  printServer = await new PeerPrintServer({
    host: "0.peerjs.com",
    port: 443,
    path: "/",
    key: "peerjs",
    secure: true,
    onState: handlePrintServerState,
    onError: handlePrintServerError,
  }).init();
  printServer.setTransport(printer);

  loadEditorState();
  applyPeerPrinterFromUrl();
  loadPrintHistory();
  applyEditorFont();
  rebuildLabelGraphic();
  if (restoreLiveCameraOnSetup) {
    restoreLiveCameraOnSetup = false;
    await startPhotoCamera({ clearStoredPhoto: false, detail: "Restoring camera..." });
  }
  if (useSoftKeyboardInput) {
    focusEditorInput();
  }
  await autoConnectPeerPrinterFromUrl();
}

function installWillReadFrequentlyCanvasHint() {
  if (HTMLCanvasElement.prototype.__labelmakerWillReadFrequently) return;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, attributes) {
    if (type === "2d") {
      return originalGetContext.call(this, type, {
        ...(attributes || {}),
        willReadFrequently: true,
      });
    }
    return originalGetContext.call(this, type, attributes);
  };
  HTMLCanvasElement.prototype.__labelmakerWillReadFrequently = true;
}

function draw() {
  updateCaretBlink();
  if (!activePrintJob) {
    renderLabelGraphic();
  }

  background(0);
  beginTooltipFrame();

  const preview = getPreviewRect();
  const toolbar = getToolbarRect(preview);
  const connectionState = printer?.getConnectionState?.() || {};
  const isConnected = !!connectionState.connected;
  const isConnecting = connectingPrinter || !!connectionState.connecting;
  const squareButtonWidth = toolbarButtonHeight;
  const printButtonWidth = busy ? squareButtonWidth * 3 + toolbarGap * 2 : (isConnected ? squareButtonWidth * 2 + toolbarGap : 0);
  const toolbarLayout = createToolbarLayout(toolbar, { isConnected, isConnecting, printButtonWidth });
  drawToolbarLayout(toolbarLayout, { isConnected, isConnecting });
  const connectButtonRect = toolbarLayout.rects.connect || { x: toolbar.x + toolbar.width - squareButtonWidth, width: squareButtonWidth };

  drawPreviewCard(preview);
  if (settingsPanelOpen) {
    drawSettingsPanel(preview, toolbar);
  }
  if (!busy && !isConnected && connectMenuOpen) {
    drawConnectMenu(preview, connectButtonRect.x, connectButtonRect.width);
  }
  drawCanvasCornerMarker();
  drawPendingTooltip();
}

function drawCanvasCornerMarker() {
  push();
  noStroke();
  fill(255, 130, 0);
  circle(18, 18, 18);
  pop();
}

function drawConnectMenu(preview, anchorX, buttonWidth) {
  const menuWidth = Math.min(Math.max(buttonWidth, connectMenuMinWidth), Math.max(96, preview.width - 16));
  const menuX = constrain(anchorX, preview.x + 8, preview.x + preview.width - menuWidth - 8);
  const bleButtonY = preview.y + 8;
  const usbButtonY = bleButtonY + toolbarButtonHeight + toolbarGap;
  const peerButtonY = usbButtonY + toolbarButtonHeight + toolbarGap;
  const peerHostnameItems = peerHostnames.slice(0, maxPeerHostnameMenuItems);
  const menuPad = 5;
  const menuItemCount = 3 + peerHostnameItems.length;
  const menuHeight = toolbarButtonHeight * menuItemCount + toolbarGap * (menuItemCount - 1);

  push();
  noStroke();
  fill(0, 190);
  rect(menuX - menuPad, bleButtonY - menuPad, menuWidth + menuPad * 2, menuHeight + menuPad * 2, 8);
  pop();

  const bleButton = uiButton("BLE", {
    x: menuX,
    y: bleButtonY,
    width: menuWidth,
    height: toolbarButtonHeight,
    fontSize: 12,
    bgColor: printer?.canConnect?.("ble") ? "#ffffff" : "#1f1f1f",
    textColor: printer?.canConnect?.("ble") ? "#000000" : "#5a5a5a",
    stroke: { weight: 0 },
  });
  registerTooltip("connect-ble", printer?.canConnect?.("ble") ? "Connect BLE" : "BLE unavailable", menuX, bleButtonY, menuWidth, toolbarButtonHeight);
  if (printer?.canConnect?.("ble") && bleButton.clicked) {
    connectMenuOpen = false;
    connectPrinter("ble");
  }

  const usbTransport = printer?.canConnect?.("webusb") ? "webusb" : "usb";
  const usbAvailable = !!printer?.canConnect?.(usbTransport);
  const usbButton = uiButton("USB", {
    x: menuX,
    y: usbButtonY,
    width: menuWidth,
    height: toolbarButtonHeight,
    fontSize: 12,
    bgColor: usbAvailable ? "#ffffff" : "#1f1f1f",
    textColor: usbAvailable ? "#000000" : "#5a5a5a",
    stroke: { weight: 0 },
  });
  registerTooltip("connect-usb", usbAvailable ? "Connect USB" : "USB unavailable", menuX, usbButtonY, menuWidth, toolbarButtonHeight);
  if (usbAvailable && usbButton.clicked) {
    connectMenuOpen = false;
    connectPrinter(usbTransport);
  }

  const peerAvailable = !!printer?.canConnect?.("peer");
  const peerButton = uiButton("P+", {
    x: menuX,
    y: peerButtonY,
    width: menuWidth,
    height: toolbarButtonHeight,
    fontSize: 12,
    bgColor: peerAvailable ? "#ffffff" : "#1f1f1f",
    textColor: peerAvailable ? "#000000" : "#5a5a5a",
    stroke: { weight: 0 },
  });
  registerTooltip("connect-peer", peerAvailable ? "Add/connect PeerJS hostname" : "PeerJS unavailable", menuX, peerButtonY, menuWidth, toolbarButtonHeight);
  if (peerAvailable && peerButton.clicked) {
    connectMenuOpen = false;
    promptForPeerHostname();
  }

  for (let i = 0; i < peerHostnameItems.length; i++) {
    const hostname = peerHostnameItems[i];
    const y = peerButtonY + (toolbarButtonHeight + toolbarGap) * (i + 1);
    const deleted = handlePeerHostnameLongPress(hostname, menuX, y, menuWidth, toolbarButtonHeight, peerAvailable);
    if (deleted) {
      continue;
    }
    const hostnameButton = uiButton(hostname, {
      x: menuX,
      y,
      width: menuWidth,
      height: toolbarButtonHeight,
      fontSize: 11,
      bgColor: peerAvailable ? "#ffffff" : "#1f1f1f",
      textColor: peerAvailable ? "#000000" : "#5a5a5a",
      stroke: { weight: 0 },
    });
    registerTooltip(`connect-peer-${hostname}`, peerAvailable ? `Connect ${hostname}` : "PeerJS unavailable", menuX, y, menuWidth, toolbarButtonHeight);
    if (peerAvailable && hostnameButton.clicked && !peerHostnameLongPress.fired) {
      connectMenuOpen = false;
      connectPrinter("peer", { peerHostname: hostname });
    }
  }
}

function handlePeerHostnameLongPress(hostname, x, y, w, h, enabled = true) {
  if (!enabled || !mouseIsPressed) {
    if (!mouseIsPressed && peerHostnameLongPress.hostname === hostname) {
      peerHostnameLongPress = { hostname: "", startedAt: 0, fired: false };
    }
    return false;
  }

  const inside = mouseX >= x && mouseX <= x + w && mouseY >= y && mouseY <= y + h;
  if (!inside) {
    if (peerHostnameLongPress.hostname === hostname) {
      peerHostnameLongPress = { hostname: "", startedAt: 0, fired: false };
    }
    return false;
  }

  const now = millis();
  if (peerHostnameLongPress.hostname !== hostname) {
    peerHostnameLongPress = { hostname, startedAt: now, fired: false };
    return false;
  }

  if (!peerHostnameLongPress.fired && now - peerHostnameLongPress.startedAt >= peerHostnameDeleteHoldMs) {
    peerHostnameLongPress.fired = true;
    const shouldDelete = window.confirm(`Delete PeerJS printer "${hostname}"?`);
    if (shouldDelete) {
      deletePeerHostname(hostname);
      return true;
    }
  }

  return false;
}

function createToolbarLayout(toolbar, state = {}) {
  const square = toolbarButtonHeight;
  const printWidth = Number(state.printButtonWidth) || 0;
  const leftItems = buildToolbarLeftItems(square);
  const rightItems = buildToolbarRightItems(square, printWidth, state);
  return layoutTwoSidedToolbar(toolbar, leftItems, rightItems);
}

function buildToolbarLeftItems(square) {
  const items = [
    {
      key: "settings",
      width: square,
      draw: (rect) => {
        const result = drawIconButton("settings", {
          ...rect,
          active: settingsPanelOpen,
          disabled: busy,
          tooltip: settingsPanelOpen ? "Hide settings" : "Settings",
        });
        if (!busy && result.clicked) settingsPanelOpen = !settingsPanelOpen;
      },
    },
    makeClearToolbarItem(square, { gapAfter: Math.round(square * 0.5) }),
    {
      key: "qr",
      width: square,
      draw: (rect) => {
        const result = drawIconButton(labelQrText ? "qr_code_2" : "qr_code", {
          ...rect,
          active: !!labelQrText,
          disabled: busy,
          tooltip: labelQrText ? "Remove QR" : "Add QR",
        });
        if (!busy && result.clicked) promptForQrCode();
      },
    },
    {
      key: "photo",
      width: square,
      draw: (rect) => {
        const result = drawIconButton(photoEnabled ? "videocam" : "photo_camera", {
          ...rect,
          active: photoEnabled,
          disabled: busy || photoCameraStarting,
          tooltip: photoEnabled ? "Camera on" : "Camera off",
        });
        if (!busy && !photoCameraStarting && result.clicked) togglePhotoCamera();
      },
    },
  ];

  appendInlineSettingsItems(items, square);

  if (hasStoredPhoto()) {
    items.push({
      key: "remove-photo",
      width: square,
      draw: (rect) => {
        const result = drawIconButton("hide_image", {
          ...rect,
          disabled: busy,
          tooltip: "Remove photo",
        });
        if (!busy && result.clicked) removeStoredPhoto();
      },
    });
  }

  return items;
}

function buildSettingsPanelItems(square) {
  const printerState = printer?.getConnectionState?.() || {};
  const isConnected = !!printerState.connected;
  const isConnecting = connectingPrinter || !!printerState.connecting;
  const items = [
    {
      key: "grayscale",
      width: square,
      draw: (rect) => {
        const result = drawIconButton(photoGrayscaleEnabled ? "filter_b_and_w" : "gradient", {
          ...rect,
          active: photoGrayscaleEnabled,
          disabled: busy,
          tooltip: photoGrayscaleEnabled ? "Grayscale on" : "Grayscale off",
        });
        if (!busy && result.clicked) togglePhotoGrayscale();
      },
    },
    {
      key: "format",
      width: square,
      draw: (rect) => {
        const result = drawIconButton(labelFormat === "10x10" ? "crop_square" : "aspect_ratio", {
          ...rect,
          disabled: busy,
          tooltip: labelFormat === "10x10" ? "Use 10 x 15" : "Use square",
        });
        if (!busy && result.clicked) toggleLabelFormat();
      },
    },
    {
      key: "orientation",
      width: square,
      draw: (rect) => {
        const result = drawIconButton(orientation === "portrait" ? "stay_current_portrait" : "stay_current_landscape", {
          ...rect,
          disabled: busy,
          tooltip: orientation === "portrait" ? "Portrait" : "Landscape",
        });
        if (!busy && result.clicked) toggleOrientation();
      },
    },
    {
      key: "autosize",
      width: square,
      draw: (rect) => {
        const result = drawIconButton(autoSizingEnabled ? "autorenew" : "sync_disabled", {
          ...rect,
          active: autoSizingEnabled,
          disabled: busy,
          tooltip: autoSizingEnabled ? "Auto size on" : "Auto size off",
        });
        if (!busy && result.clicked) {
          autoSizingEnabled = !autoSizingEnabled;
          detailText = autoSizingEnabled ? "Auto sizing on." : "Auto sizing off.";
          saveEditorState();
        }
      },
    },
  ];

  items.push(makeDownloadToolbarItem(square));
  if (printHistory.length) items.push(makeClearHistoryToolbarItem(square));

  const printServerItem = makePrintServerToolbarItem(square);
  if (printServerItem) items.push(printServerItem);
  if (isConnected) items.push(makeConnectToolbarItem(square, { isConnected, isConnecting }));

  return items;
}

function appendInlineSettingsItems(items, square) {
  items.push({
    key: "padding",
    width: square,
    draw: (rect) => {
      const result = drawIconButton("padding", {
        ...rect,
        active: labelPaddingMode !== "minimal",
        disabled: busy,
        markerText: labelPaddingMode === "minimal" ? "min" : (labelPaddingMode === "some" ? "mid" : "max"),
        tooltip: `Padding: ${labelPaddingMode}`,
      });
      if (!busy && result.clicked) toggleLabelPadding();
    },
  });

  items.push({
    key: "photo-blend",
    width: square,
    draw: (rect) => {
      const hasPhotoContext = hasPhotoSource() || photoEnabled || photoCameraStarting;
      const result = drawIconButton(getBlendModeIcon(), {
        ...rect,
        active: photoMergeMode !== "below",
        disabled: busy || !hasPhotoContext,
        iconSize: toolbarSmallIconSize,
        tooltip: `Photo: ${getPhotoMergeModeLabel()}`,
      });
      if (!busy && hasPhotoContext && result.clicked) togglePhotoMergeMode();
    },
  });

  items.push(
    {
      key: "invert",
      width: square,
      draw: (rect) => {
        const result = drawIconButton(labelInverted ? "invert_colors_off" : "invert_colors", {
          ...rect,
          active: labelInverted,
          disabled: busy,
          iconSize: toolbarSmallIconSize,
          tooltip: labelInverted ? "Invert off" : "Invert",
        });
        if (!busy && result.clicked) toggleInvertMode();
      },
    },
    {
      key: "outline",
      width: square,
      draw: (rect) => {
        const result = drawIconButton(getTextOutlineModeIcon(), {
          ...rect,
          active: textOutlineMode !== "none",
          disabled: busy,
          tooltip: `Text: ${getTextOutlineModeLabel()}`,
        });
        if (!busy && result.clicked) toggleTextOutlineMode();
      },
    },
    {
      key: "text-effect",
      width: square,
      draw: (rect) => {
        const result = drawIconButton(getTextEffectModeIcon(), {
          ...rect,
          active: textEffectMode !== "none",
          disabled: busy,
          iconSize: toolbarSmallIconSize,
          tooltip: `Text FX: ${getTextEffectModeLabel()}`,
        });
        if (!busy && result.clicked) toggleTextEffectMode();
      },
    }
  );

  if (!autoSizingEnabled) {
    items.push(
      makeStyleToolbarItem("bold", "format_bold", "Bold", () => toggleCurrentLineStyle("bold"), true, square),
      makeStyleToolbarItem("italic", "format_italic", "Italic", () => toggleCurrentLineStyle("italic"), true, square),
      makeStyleToolbarItem("underline", "format_underlined", "Underline", () => toggleCurrentLineStyle("underline"), true, square),
      makeStyleToolbarItem("smaller", "text_decrease", "Smaller", () => adjustCurrentLineFontSize(-1), false, square),
      makeStyleToolbarItem("reset-size", "restart_alt", "Reset size", () => resetCurrentLineFontSize(), false, square),
      makeStyleToolbarItem("larger", "text_increase", "Larger", () => adjustCurrentLineFontSize(+1), false, square)
    );
  }

  items.push(
    {
      key: "font",
      width: 104,
      draw: (rect) => {
        const result = uiButton(getEditorFontLabel(), {
          ...rect,
          fontSize: 15,
          hAlign: "left",
          vAlign: "middle",
          padding: 12,
          bgColor: busy ? "#1f1f1f" : "#ffffff",
          hover: { bgColor: busy ? "#1f1f1f" : "#f1f1f1", cursor: busy ? "default" : "pointer" },
          pressed: { bgColor: busy ? "#1f1f1f" : "#d0d0d0", cursor: busy ? "default" : "pointer" },
          stroke: { weight: 0 },
          textColor: busy ? "#5a5a5a" : "#000000",
        });
        registerTooltip("font", `Font: ${getEditorFontLabel()}`, rect.x, rect.y, rect.width, rect.height);
        if (!busy && result.clicked) toggleEditorFont();
      },
    }
  );
}

function makeStyleToolbarItem(key, icon, tooltip, action, hasActiveState, width) {
  return {
    key: `style-${key}`,
    width,
    draw: (rect) => {
      const result = drawIconButton(icon, {
        ...rect,
        active: hasActiveState ? isTextStyleControlActive(key) : false,
        disabled: busy,
        iconSize: toolbarSmallIconSize,
        tooltip,
      });
      if (!busy && result.clicked) action();
    },
  };
}

function buildToolbarRightItems(square, printWidth, state = {}) {
  const isConnected = !!state.isConnected;
  const isConnecting = !!state.isConnecting;
  const items = [];

  if (printWidth > 0) {
    items.push({
      key: "print",
      width: printWidth,
      draw: (rect) => {
        const result = busy
          ? drawPrintProgressButton({ ...rect, progress: printProgress })
          : drawIconButton("print", {
            ...rect,
            primary: true,
            disabled: false,
            tooltip: "Print",
          });
        if (busy && result.clicked) {
          cancelActivePrint();
        } else if (!busy && result.clicked) {
          handlePrimaryButton();
        }
      },
    });
  }

  if (!isConnected) {
    items.push(makeConnectToolbarItem(square, { isConnected, isConnecting }));
  }

  return items;
}

function makeClearToolbarItem(square, options = {}) {
  return {
    key: "clear",
    width: square,
    gapAfter: options.gapAfter,
    draw: (rect) => {
      const result = drawIconButton("cancel", {
        ...rect,
        disabled: busy,
        tooltip: "Clear",
      });
      if (!busy && result.clicked) clearEditor();
    },
  };
}

function makeDownloadToolbarItem(square) {
  return {
    key: "download",
    width: square,
    draw: (rect) => {
      const result = drawIconButton("download", {
        ...rect,
        disabled: busy,
        tooltip: "Save and download",
      });
      if (!busy && result.clicked) downloadCurrentLabel();
    },
  };
}

function makeClearHistoryToolbarItem(square) {
  return {
    key: "clear-history",
    width: square,
    draw: (rect) => {
      const result = drawIconButton("delete_sweep", {
        ...rect,
        disabled: busy,
        tooltip: "Clear history",
      });
      if (!busy && result.clicked) {
        confirmAndClearPrintHistory();
      }
    },
  };
}

function makePrintServerToolbarItem(square) {
  const printerState = printer?.getConnectionState?.() || {};
  const showPrintServerButton = !!printerState.connected || !!printServerState.running || !!printServerState.starting;
  if (!showPrintServerButton) return null;
  return {
    key: "print-server",
    width: square,
    draw: (rect) => {
      const markerText = `${Number(printServerState.connections) || 0}/${Number(printServerState.queued) || 0}`;
      const result = drawIconButton(printServerState.running || printServerState.starting ? "hub" : "lan", {
        ...rect,
        active: !!printServerState.running,
        disabled: !!printServerState.starting,
        tooltip: printServerState.running
          ? `Printserver ${printServerState.id || ""}: ${markerText}`
          : "Start printserver",
      });
      if (!printServerState.starting && result.clicked) {
        togglePrintServer();
      }
    },
  };
}

function makeConnectToolbarItem(square, state = {}) {
  const isConnected = !!state.isConnected;
  const isConnecting = !!state.isConnecting;
  return {
    key: "connect",
    width: square,
    draw: (rect) => {
      const result = drawIconButton(isConnected ? "link_off" : (isConnecting ? "sync" : "add"), {
        ...rect,
        primary: !isConnected,
        active: isConnected,
        disabled: busy || isConnecting,
        markerText: isConnecting ? "..." : "",
        tooltip: isConnected ? `Disconnect ${formatTransport()}` : (isConnecting ? "Connecting" : "Connect"),
      });
      if (!busy && !isConnecting && result.clicked) {
        if (isConnected) {
          disconnectPrinter();
        } else {
          connectMenuOpen = !connectMenuOpen;
        }
      }
    },
  };
}

function layoutTwoSidedToolbar(toolbar, leftItems, rightItems) {
  const rowHeight = toolbarButtonHeight;
  const rows = [];
  const placements = [];
  const rects = {};

  const ensureRow = (rowIndex) => {
    while (rows.length <= rowIndex) {
      rows.push({
        leftCursor: toolbar.x,
        rightCursor: toolbar.x + toolbar.width,
        y: toolbar.y + rows.length * (rowHeight + toolbarRowGap),
      });
    }
    return rows[rowIndex];
  };

  let rightRowIndex = 0;
  for (let index = rightItems.length - 1; index >= 0; index -= 1) {
    const item = rightItems[index];
    let row = ensureRow(rightRowIndex);
    const nextX = row.rightCursor - item.width;
    if (nextX < toolbar.x && row.rightCursor < toolbar.x + toolbar.width) {
      rightRowIndex++;
      row = ensureRow(rightRowIndex);
    }
    const x = row.rightCursor - item.width;
    const rect = { x, y: row.y, width: item.width, height: rowHeight };
    row.rightCursor = x - (item.gapAfter ?? toolbarGap);
    placements.push({ item, rect });
    rects[item.key] = rect;
  }

  let leftRowIndex = 0;
  for (const item of leftItems) {
    let row = ensureRow(leftRowIndex);
    if (row.leftCursor + item.width > row.rightCursor) {
      leftRowIndex++;
      row = ensureRow(leftRowIndex);
    }
    const rect = { x: row.leftCursor, y: row.y, width: item.width, height: rowHeight };
    row.leftCursor += item.width + (item.gapAfter ?? toolbarGap);
    placements.push({ item, rect });
    rects[item.key] = rect;
  }

  return { rows, placements, rects };
}

function drawToolbarLayout(layout, state = {}) {
  const rightKeys = new Set(["download", "clear", "print", "print-server", "connect"]);
  for (const placement of layout.placements) {
    if (rightKeys.has(placement.item.key)) continue;
    placement.item.draw(placement.rect, state);
  }
  for (const placement of layout.placements) {
    if (!rightKeys.has(placement.item.key)) continue;
    placement.item.draw(placement.rect, state);
  }
}

function drawSettingsPanel(preview, toolbar) {
  const square = toolbarButtonHeight;
  const items = buildSettingsPanelItems(square);
  const panelX = toolbar.x;
  const panelWidth = toolbar.width;
  const hasHistory = printHistory.length > 0;
  const rows = [];
  let row = [];
  let rowWidth = 0;

  for (const item of items) {
    const nextWidth = row.length ? rowWidth + toolbarGap + item.width : item.width;
    if (row.length && nextWidth > panelWidth) {
      rows.push({ items: row, width: rowWidth });
      row = [];
      rowWidth = 0;
    }
    row.push(item);
    rowWidth = row.length === 1 ? item.width : rowWidth + toolbarGap + item.width;
  }
  if (row.length) rows.push({ items: row, width: rowWidth });

  const historyHeight = hasHistory ? historySliderHeight + toolbarRowGap : 0;
  const panelHeight = historyHeight + rows.length * toolbarButtonHeight + Math.max(0, rows.length - 1) * toolbarRowGap;
  const y = Math.max(preview.y + 8, toolbar.y - panelHeight - toolbarRowGap);

  push();
  noStroke();
  fill(0, 210);
  rect(panelX - 4, y - 4, panelWidth + 8, panelHeight + 8, 8);
  pop();

  let rowsY = y;
  if (hasHistory) {
    drawPrintHistorySliderInRect(panelX, rowsY, panelWidth);
    rowsY += historySliderHeight + toolbarRowGap;
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const panelRow = rows[rowIndex];
    let x = panelX;
    const itemY = rowsY + rowIndex * (toolbarButtonHeight + toolbarRowGap);
    for (const item of panelRow.items) {
      item.draw({ x, y: itemY, width: item.width, height: toolbarButtonHeight });
      x += item.width + toolbarGap;
    }
  }
}

function drawTextStyleControls(x, y, disabled = false, options = {}) {
  const buttonWidth = options.buttonWidth || 38;
  const buttonHeight = options.buttonHeight || 46;
  const gap = options.gap || 8;
  const buttons = [
    { icon: "format_bold", tooltip: "Bold", active: isTextStyleControlActive("bold"), action: () => toggleCurrentLineStyle("bold") },
    { icon: "format_italic", tooltip: "Italic", active: isTextStyleControlActive("italic"), action: () => toggleCurrentLineStyle("italic") },
    { icon: "format_underlined", tooltip: "Underline", active: isTextStyleControlActive("underline"), action: () => toggleCurrentLineStyle("underline") },
    { icon: "text_decrease", tooltip: "Smaller", action: () => adjustCurrentLineFontSize(-1) },
    { icon: "restart_alt", tooltip: "Reset size", action: () => resetCurrentLineFontSize() },
    { icon: "text_increase", tooltip: "Larger", action: () => adjustCurrentLineFontSize(+1) },
  ];

  for (let index = 0; index < buttons.length; index += 1) {
    const item = buttons[index];
    const result = drawIconButton(item.icon, {
      x: x + index * (buttonWidth + gap),
      y,
      width: buttonWidth,
      height: buttonHeight,
      active: !!item.active,
      disabled,
      iconSize: toolbarSmallIconSize,
      tooltip: item.tooltip,
    });
    if (!disabled && result.clicked) {
      item.action();
    }
  }
}

function drawPrintHistorySliderInRect(x, y, widthValue) {
  if (!printHistory.length) return;
  const sliderWidth = Math.max(60, widthValue);
  const sliderX = x;
  const sliderY = y;
  const activeIndex = constrain(printHistoryIndex, 0, printHistory.length - 1);
  const label = `Print ${activeIndex + 1}/${printHistory.length}`;
  const result = uiSlider(printHistorySliderKey, label, {
    min: 0,
    max: Math.max(0, printHistory.length - 1),
    init: activeIndex,
  }, {
    x: sliderX,
    y: sliderY,
    width: sliderWidth,
    height: historySliderHeight,
    rounding: 6,
    trackColor: "#1f1f1f",
    fillColor: "#ff9f1a",
    textColor: "#ffffff",
    fontSize: 12,
    hideValue: true,
    persist: false,
  });
  registerTooltip("print-history", "Print history", sliderX, sliderY, sliderWidth, historySliderHeight);

  const nextIndex = constrain(Math.round(result.value), 0, printHistory.length - 1);
  if (!busy && result.changed && nextIndex !== printHistoryIndex) {
    restorePrintHistoryIndex(nextIndex);
  }
}

function isTextStyleControlActive(styleKey) {
  const target = getStyleToggleTarget();
  if (!target) return false;
  if (target.mode === "pending") return !!pendingTextStyle[styleKey];
  return isRangeFullyStyled(styleKey, target.start, target.end);
}

function drawIconButton(icon, options = {}) {
  const disabled = !!options.disabled;
  const primary = !!options.primary;
  const active = !!options.active;
  const bg = disabled
    ? (primary ? "#3a3a3a" : "#1f1f1f")
    : primary
      ? "#ff9f1a"
      : active
        ? "#1e1e1e"
        : "#ffffff";
  const hoverBg = disabled
    ? bg
    : primary
      ? "#ffb347"
      : active
        ? "#343434"
        : "#f1f1f1";
  const textColor = disabled
    ? (primary ? "#9a9a9a" : "#5a5a5a")
    : primary || !active
      ? "#000000"
      : "#ffffff";
  const result = uiButton(icon, {
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    padding: 0,
    rounding: 6,
    hAlign: "center",
    vAlign: "middle",
    bgColor: bg,
    textColor,
    materialSymbol: true,
    fontSize: options.iconSize || toolbarIconSize,
    textOffsetY: options.textOffsetY ?? Math.round(options.height * 0.12),
    stroke: { weight: 0 },
    hover: { bgColor: hoverBg, cursor: disabled ? "default" : "pointer" },
    pressed: { bgColor: disabled ? bg : (primary ? "#e88800" : "#d0d0d0"), cursor: disabled ? "default" : "pointer" },
    persist: false,
  });
  if (options.tooltip) {
    registerTooltip(
      options.tooltipKey || `${icon}:${options.x}:${options.y}`,
      options.tooltip,
      options.x,
      options.y,
      options.width,
      options.height
    );
  }

  push();
  textAlign(CENTER, CENTER);
  noStroke();
  textStyle(NORMAL);

  if (options.marker) {
    textFont("Material Symbols Rounded");
    textSize(Math.round(options.height * 0.35));
    fill(primary ? "#000000" : (active ? "#ffffff" : "#000000"));
    text(options.marker, options.x + options.width - options.width * 0.35, options.y + options.height * 0.38);
  }

  if (options.markerText) {
    textFont(fallbackFontFamily);
    textSize(Math.round(options.height * 0.25));
    fill(textColor);
    text(options.markerText, options.x + options.width / 2, options.y + options.height - options.height * 0.24);
  }
  pop();

  if (disabled) {
    result.clicked = false;
    result.pressedDown = false;
    result.pressedUp = false;
  }
  return result;
}

function drawPrintProgressButton(options = {}) {
  const x = options.x;
  const y = options.y;
  const w = options.width;
  const h = options.height;
  const progress = constrain(Number(options.progress) || 0, 0, 1);
  const result = uiButton("", {
    x,
    y,
    width: w,
    height: h,
    padding: 0,
    rounding: 6,
    bgColor: "#1e1e1e",
    textColor: "#ffffff",
    stroke: { weight: 0 },
    hover: { bgColor: "#2a2a2a", cursor: "pointer" },
    pressed: { bgColor: "#111111", cursor: "pointer" },
    persist: false,
  });

  push();
  noStroke();
  fill("#ff9f1a");
  rect(x, y, Math.max(0, w * progress), h, 6);
  fill("#ffffff");
  textFont(fallbackFontFamily);
  textStyle(NORMAL);
  textSize(12);
  textAlign(LEFT, CENTER);
  text(`${Math.round(progress * 100)}%`, x + 10, y + h * 0.5 + 1);
  textFont("Material Symbols Rounded");
  textSize(24);
  textAlign(RIGHT, CENTER);
  text("cancel", x + w - 10, y + h * 0.5 + 4);
  pop();

  registerTooltip("print-progress", `${Math.round(progress * 100)}% - cancel print`, x, y, w, h);
  return result;
}

function beginTooltipFrame() {
  tooltipActiveThisFrame = false;
}

function registerTooltip(key, label, x, y, w, h) {
  if (!label) return;
  const hover = mouseX >= x && mouseX <= x + w && mouseY >= y && mouseY <= y + h;
  if (!hover) return;

  const now = millis();
  if (tooltipKey !== key) {
    tooltipKey = key;
    tooltipStartedAt = now;
  }
  tooltipLabel = label;
  tooltipX = x + w * 0.5;
  tooltipY = y;
  tooltipActiveThisFrame = true;
}

function drawPendingTooltip() {
  if (!tooltipActiveThisFrame) {
    tooltipKey = "";
    return;
  }
  if (millis() - tooltipStartedAt < tooltipDelayMs) return;
  drawTooltip(tooltipLabel, tooltipX, tooltipY);
}

function drawTooltip(label, anchorX, anchorY) {
  push();
  textFont(fallbackFontFamily);
  textStyle(NORMAL);
  textSize(12);
  const paddingX = 8;
  const tooltipW = Math.ceil(textWidth(label) + paddingX * 2);
  const tooltipH = 24;
  const x = constrain(anchorX - tooltipW * 0.5, 8, width - tooltipW - 8);
  const y = Math.max(8, anchorY - tooltipH - 8);
  noStroke();
  fill(20, 235);
  rect(x, y, tooltipW, tooltipH, 6);
  fill(255);
  textAlign(CENTER, CENTER);
  text(label, x + tooltipW * 0.5, y + tooltipH * 0.5 + 0.5);
  pop();
}

async function connectPrinter(transport = "ble", options = {}) {
  if (busy || connectingPrinter) return;
  try {
    const currentPeerHostname = normalizePeerHostname(getPeerPrinterFromUrl() || printer?.peerPrinter?.remoteId || peerHostnames[0] || "printhost");
    const peerHostname = transport === "peer" ? (normalizePeerHostname(options.peerHostname) || currentPeerHostname) : "";
    if (transport === "peer") {
      setPeerRemoteId(peerHostname || "printhost");
      pendingPeerHostname = peerHostname;
    }
    connectingPrinter = true;
    connectMenuOpen = false;
    statusText = "connecting";
    detailText = transport === "peer"
      ? `Connecting to ${peerHostname || "printhost"} over PeerJS...`
      : `Choose a ${formatTransport(transport)} printer.`;
    console.info(`[labelmaker2] connecting ${formatTransport(transport)}`);
    await printer.connect(transport);
    outputMode = printer.getSuggestedOutputMode?.() || "label";
    if (transport === "peer" && pendingPeerHostname) {
      rememberPeerHostname(pendingPeerHostname);
    }
    if (transport === "peer") {
      const connectedState = printer?.getConnectionState?.() || {};
      const connectedPeerId = normalizePeerHostname(connectedState.remoteId || pendingPeerHostname || peerHostname);
      if (connectedPeerId) {
        rememberPeerHostname(connectedPeerId);
        updatePeerPrinterUrl(connectedPeerId);
      }
    }
    statusText = "connected";
    detailText = `Connected over ${formatTransport()}. Press Print for ${outputMode}.`;
    console.info(`[labelmaker2] connected ${formatTransport()}`);
  } catch (error) {
    console.error("[labelmaker2] connect failed", error);
    statusText = "connect failed";
    detailText = error?.message || String(error);
  } finally {
    connectingPrinter = false;
    pendingPeerHostname = "";
  }
}

function promptForPeerHostname() {
  const fallback = peerHostnames[0] || printer?.peerPrinter?.remoteId || "printhost";
  const value = window.prompt("PeerJS ESP32 base hostname, without a/b/c/d/e suffix", fallback);
  if (value === null) return;
  const hostname = normalizePeerHostname(value);
  if (!hostname) {
    detailText = "PeerJS hostname is empty.";
    return;
  }
  connectPrinter("peer", { peerHostname: hostname });
}

function normalizePeerHostname(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[./]+$/g, "");
}

function setPeerRemoteId(remoteId) {
  if (printer?.peerPrinter) {
    printer.peerPrinter.remoteId = remoteId;
  }
}

function applyPeerPrinterFromUrl() {
  const hostname = getPeerPrinterFromUrl();
  peerAutoConnectFromUrl = hostname;
  if (!hostname) return;
  setPeerRemoteId(hostname);
  peerHostnames = [
    hostname,
    ...peerHostnames.filter((item) => normalizePeerHostname(item) !== hostname),
  ].slice(0, maxPeerHostnameMenuItems);
}

async function autoConnectPeerPrinterFromUrl() {
  const hostname = normalizePeerHostname(peerAutoConnectFromUrl);
  peerAutoConnectFromUrl = "";
  if (!hostname || busy || connectingPrinter) return;
  const state = printer?.getConnectionState?.() || {};
  if (state.connected || state.connecting) return;
  await connectPrinter("peer", { peerHostname: hostname });
}

function getPeerPrinterFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return normalizePeerHostname(params.get(peerPrinterUrlParam));
  } catch {
    return "";
  }
}

function updatePeerPrinterUrl(hostname) {
  const normalized = normalizePeerHostname(hostname);
  if (!normalized || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(peerPrinterUrlParam) === normalized) return;
    url.searchParams.set(peerPrinterUrlParam, normalized);
    window.history.replaceState(window.history.state, "", url);
  } catch (error) {
    console.warn(`[labelmaker2] could not update peer printer URL: ${formatErrorMessage(error)}`);
  }
}

function rememberPeerHostname(hostname) {
  const normalized = normalizePeerHostname(hostname);
  if (!normalized) return;
  peerHostnames = [
    normalized,
    ...peerHostnames.filter((item) => item !== normalized),
  ].slice(0, maxPeerHostnameMenuItems);
  saveEditorState();
}

function deletePeerHostname(hostname) {
  const normalized = normalizePeerHostname(hostname);
  if (!normalized) return;
  peerHostnames = peerHostnames.filter((item) => normalizePeerHostname(item) !== normalized);
  peerHostnameLongPress = { hostname: "", startedAt: 0, fired: false };
  saveEditorState();
  detailText = `Deleted PeerJS printer ${normalized}.`;
}

async function togglePrintServer() {
  if (!printServer) return;
  if (printServerState.running || printServerState.starting) {
    await printServer.stop();
    detailText = "Printserver stopped.";
    return;
  }
  await promptAndStartPrintServer();
}

async function promptAndStartPrintServer(defaultId = "") {
  const fallback = defaultId || printServerState.id || `labelmaker-${Math.floor(Math.random() * 10000)}`;
  const value = window.prompt("PeerJS printserver id", fallback);
  if (value === null) return;
  const id = normalizePeerHostname(value);
  if (!id) {
    detailText = "Printserver id is empty.";
    return;
  }
  try {
    await printServer.start(id, printer);
    detailText = `Printserver ${id} started.`;
  } catch (error) {
    const message = error?.message || String(error);
    detailText = message;
    if (message.includes("already taken")) {
      window.setTimeout(() => promptAndStartPrintServer(id), 0);
    } else {
      console.error("[labelmaker2] printserver start failed", error);
    }
  }
}

function sanitizePeerHostnames(value) {
  if (!Array.isArray(value)) return [];
  const hostnames = [];
  for (const item of value) {
    const hostname = normalizePeerHostname(item);
    if (hostname && !hostnames.includes(hostname)) {
      hostnames.push(hostname);
    }
    if (hostnames.length >= maxPeerHostnameMenuItems) break;
  }
  return hostnames;
}

async function disconnectPrinter() {
  if (busy) return;
  await printer?.disconnect?.();
  printServer?.setTransport?.(printer);
  connectMenuOpen = false;
  statusText = "disconnected";
  detailText = "Disconnected printer.";
}

function handlePrinterState(state) {
  printServer?.setTransport?.(printer);
  statusText = state.state;
  if (state.transport === "peer") {
    outputMode = "label";
    const target = state.remoteId || state.candidate || "ESP32";
    const peerStateKey = `${state.state}:${state.candidate || ""}:${state.responded ? "1" : "0"}:${state.connected ? "1" : "0"}`;
    if (peerStateKey !== lastPeerStateLogKey) {
      lastPeerStateLogKey = peerStateKey;
      if (state.state === "error") {
        console.error("[labelmaker2] PeerJS state", state.state, state.error || "");
      } else if (state.state !== "connected") {
        console.info("[labelmaker2] PeerJS state", state.state, state.candidate || "");
      }
    }
    detailText = state.connected
      ? `Connected to ${target} over PeerJS. Press Print for label.`
      : state.connecting
        ? (state.responded
          ? `ESP32 ${state.candidate || target} answered. Opening data channel...`
          : (state.candidate ? `Trying ESP32 id ${state.candidate}...` : "Connecting to PeerJS..."))
        : "Type on the keyboard. Return inserts a new line.";
    return;
  }

  if (state.transport === "usb" || state.transport === "webusb") {
    const device = state.device || state.portInfo || {};
    const vendorId = device.vendorId ?? device.usbVendorId;
    const productId = device.productId ?? device.usbProductId;
    outputMode = "label";
    detailText = state.connected
      ? `Connected over USB. Press Print for label.`
      : (vendorId ? `USB ${printer?.formatUsbId?.(vendorId, productId) || "connected"}` : "Type on the keyboard. Return inserts a new line.");
    return;
  }

  if (state.connected) {
    outputMode = state.suggestedOutputMode || "label";
  }
  detailText = state.connected
    ? `Connected over BLE. Press Print for ${outputMode}.`
    : "Type on the keyboard. Return inserts a new line.";
}

function handlePrinterError(error) {
  console.error("[labelmaker2] printer error", error);
  statusText = "error";
  detailText = error?.message || String(error);
}

function handlePrintServerState(state) {
  printServerState = {
    running: !!state.running,
    starting: !!state.starting,
    id: state.id || printServerState.id || "",
    connections: Number(state.connections) || 0,
    queued: Number(state.queued) || 0,
    processing: !!state.processing,
  };
  if (state.state === "waiting_for_printer") {
    detailText = `Printserver queued ${printServerState.queued} print${printServerState.queued === 1 ? "" : "s"}; reconnect a printer.`;
  }
}

function handlePrintServerError(error) {
  console.error("[labelmaker2] printserver error", error);
  detailText = error?.message || String(error);
}

function formatTransport(transport) {
  return printer?.formatTransport?.(transport) || (transport === "peer" ? "Peer" : (transport === "usb" || transport === "webusb" ? "USB" : "BLE"));
}

async function handlePrimaryButton() {
  if (busy) return;
  const printId = activePrintId + 1;
  activePrintId = printId;
  printCancelRequested = false;
  printProgress = 0;
  busy = true;
  let backgroundPrintStarted = false;
  try {
    const state = printer.getConnectionState();
    if (!state.connected) {
      statusText = "not connected";
      detailText = "Connect a printer before printing.";
      return;
    }

    statusText = "printing";
    freezeLiveCameraPhoto();
    renderLabelGraphic();
    labelGraphic.loadPixels();
    const imageData = getPrintableImageData();
    recordPrintHistory();
    if (outputMode === "receipt") {
      await printReceiptPreview(imageData);
      if (printId !== activePrintId) return;
      statusText = "printed";
      detailText = "Printed the current preview on the receipt printer.";
      return;
    }

    const printOptions = getTsplPrintOptions();
    const printJob = printer.printTsplBitmapAsync(imageData, {
      ...printOptions,
      onProgress: (progress) => {
        if (printId !== activePrintId) return;
        printProgress = constrain(Number(progress?.ratio) || 0, 0, 1);
      },
    });
    backgroundPrintStarted = true;
    activePrintJob = printJob;
    printJob.promise
      .then(() => {
        if (printId !== activePrintId) return;
        printProgress = 1;
        statusText = "printed";
        detailText = `Printed the current label preview over ${formatTransport()}.`;
      })
      .catch((error) => {
        if (printId !== activePrintId || printCancelRequested) return;
        console.error("[labelmaker2] action failed", error);
        statusText = "action failed";
        detailText = error?.message || String(error);
      })
      .finally(() => {
        if (printId !== activePrintId) return;
        activePrintJob = null;
        busy = false;
        printCancelRequested = false;
        printProgress = 0;
      });
    return;
  } catch (error) {
    if (printId !== activePrintId || printCancelRequested) return;
    console.error("[labelmaker2] action failed", error);
    statusText = "action failed";
    detailText = error?.message || String(error);
  } finally {
    if (!backgroundPrintStarted && printId === activePrintId) {
      busy = false;
      printCancelRequested = false;
    }
  }
}

async function downloadCurrentLabel() {
  renderLabelGraphic();
  const savedToHistory = recordPrintHistory();
  const canvas = labelGraphic?.canvas || labelGraphic?.elt;
  if (!canvas) {
    detailText = "No label image to download.";
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `labelmaker2-${timestamp}.png`;

  const finishDownloadMessage = () => {
    detailText = savedToHistory
      ? `Saved and downloaded label ${printHistoryIndex + 1}/${printHistory.length}.`
      : "Downloaded current label.";
  };

  const tryShareImage = async (blob) => {
    if (!detectIOSLikeBrowser()) return false;
    if (!blob || typeof navigator.share !== "function" || typeof File !== "function") return false;
    const file = new File([blob], filename, { type: "image/png" });
    if (typeof navigator.canShare === "function" && !navigator.canShare({ files: [file] })) return false;
    try {
      await navigator.share({
        files: [file],
        title: "Label image",
        text: "Save this label image to Photos.",
      });
      finishDownloadMessage();
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        detailText = "Image save cancelled.";
        return true;
      }
      console.warn("[labelmaker2] image share failed", error);
      return false;
    }
  };

  const downloadBlob = (blob) => {
    if (!blob) {
      detailText = "Could not create label image.";
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    finishDownloadMessage();
  };

  if (typeof canvas.toBlob === "function") {
    canvas.toBlob(async (blob) => {
      if (await tryShareImage(blob)) return;
      downloadBlob(blob);
    }, "image/png");
    return;
  }

  const dataUrl = canvas.toDataURL("image/png");
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (await tryShareImage(blob)) return;
  } catch (error) {
    console.warn("[labelmaker2] image share fallback failed", error);
  }

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  finishDownloadMessage();
}

function cancelActivePrint() {
  if (!busy) return;
  printCancelRequested = true;
  activePrintJob?.cancel?.();
  activePrintJob = null;
  activePrintId += 1;
  busy = false;
  printProgress = 0;
  statusText = "cancelled";
  detailText = "Cancelled print.";
}

function getPrintableImageData() {
  const source = labelGraphic.drawingContext.getImageData(0, 0, labelGraphic.width, labelGraphic.height);
  if (orientation !== "landscape") return source;
  return rotateImageDataClockwise(source);
}

function getTsplPrintOptions() {
  const format = getCurrentLabelFormat();
  const hasPhoto = hasPhotoSource();
  const hardBlackPhoto = hasPhoto && photoMergeMode === "hardblack";
  return {
    labelWidthMm: format.widthCm * 10,
    labelHeightMm: format.heightCm * 10,
    gapMm: 2,
    threshold: hasPhoto ? 145 : 190,
    density: hasPhoto ? (hardBlackPhoto ? tsplHardBlackPhotoPrintDensity : tsplPhotoPrintDensity) : tsplTextPrintDensity,
    invert: true,
    dither: !hardBlackPhoto,
  };
}

async function printReceiptPreview(imageData) {
  await printer.withWriteSettings({
    chunkSize: 300,
    chunkDelayMs: 0,
  }, async () => {
    await printer.printEscposBitmap(imageData, {
      widthDots: 384,
      threshold: hasPhotoSource() ? 145 : 190,
      dither: shouldDitherPhotoPrint(),
      initialize: true,
      feedLines: 4,
    });
  });
}

function shouldDitherPhotoPrint() {
  return !(hasPhotoSource() && photoMergeMode === "hardblack");
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

function renderLabelGraphic() {
  if (!labelGraphic) return;
  const nextKey = getLabelRenderKey();
  const source = getPhotoSource();
  const hasPhoto = !!source;
  const livePhoto = photoEnabled && isCameraReady();
  const maskMode = hasPhoto && isPhotoMaskMergeMode();
  const needsTextLayer = labelRenderDirty || nextKey !== labelRenderKey || !labelTextGraphic;
  const needsOutputLayer = needsTextLayer || livePhoto || maskMode;

  if (needsTextLayer) {
    renderLabelTextLayer();
    labelRenderKey = nextKey;
    labelRenderDirty = false;
  }
  if (!needsOutputLayer) return;

  if (hasPhoto) {
    if (maskMode) {
      composePhotoWithCurrentLabelMask();
      return;
    }
    renderPhotoBelowText(source);
    return;
  }

  labelGraphic.background(getPaperColor());
  labelGraphic.image(labelTextGraphic, 0, 0);
}

function renderLabelTextLayer() {
  ensureTextGraphic();
  labelTextGraphic.clear();
  labelTextGraphic.fill(getInkColor());
  labelTextGraphic.noStroke();
  labelTextGraphic.rectMode(CORNER);

  const labelLayout = getLabelLayout();
  const layout = fitTextLayout(labelText, labelLayout.textArea.width, labelLayout.textArea.height);
  const textOrigin = getTextRenderOrigin(layout, labelLayout);
  cachedLabelLayout = layout;
  cachedTextOrigin = textOrigin;
  drawLabelQrCode(labelLayout.qrBox, labelTextGraphic);
  applyEditorFont(labelTextGraphic);
  labelTextGraphic.textAlign(LEFT, TOP);

  let y = textOrigin.y;
  for (const line of layout.lines) {
    drawStyledLine(line, y, textOrigin.x, labelTextGraphic);
    if (debugCharacterBounds) {
      drawCharacterBoundaryDebug(line, y, textOrigin.x, labelTextGraphic);
    }
    y += line.lineHeight;
  }
  labelTextGraphic.noStroke();
  labelTextGraphic.textStyle(NORMAL);
  applyTextEffectMode(labelTextGraphic);
}

function ensureTextGraphic() {
  if (
    labelTextGraphic &&
    labelTextGraphic.width === labelGraphic.width &&
    labelTextGraphic.height === labelGraphic.height
  ) {
    if (textFilterShaderTarget !== labelTextGraphic) {
      initTextEffectShaders();
    }
    return;
  }
  disposeGraphic(labelTextGraphic);
  textChromaticAberrationShader = null;
  textNoiseShader = null;
  textNoiseThresholdShader = null;
  textFilterShaderTarget = null;
  labelTextGraphic = createGraphics(labelGraphic.width, labelGraphic.height);
  labelTextGraphic.pixelDensity(1);
  applyEditorFont(labelTextGraphic);
  initTextEffectShaders();
  labelRenderDirty = true;
}

function getLabelRenderKey() {
  return JSON.stringify({
    text: labelText,
    lineFontSizes,
    textStyleRanges,
    pendingTextStyle,
    labelFormat,
    orientation,
    editorFontMode,
    autoSizingEnabled,
    labelPaddingMode,
    labelQrText,
    photoMergeMode,
    photoGrayscaleEnabled,
    labelInverted,
    textOutlineMode,
    textEffectMode,
    photoOffsetX,
    photoOffsetY,
    photoSource: hasPhotoSource() ? (photoEnabled && isCameraReady() ? "camera" : "stored") : "none",
    photoRevision,
    width: labelGraphic?.width || 0,
    height: labelGraphic?.height || 0,
  });
}

function renderPhotoBelowText(source) {
  labelGraphic.background(getPaperColor());
  drawFilteredPhotoCover(labelGraphic, source);
  labelGraphic.image(labelTextGraphic, 0, 0);
}

function isPhotoMaskMergeMode() {
  return photoMergeMode === "stencil";
}

function composePhotoWithCurrentLabelMask() {
  const source = getPhotoSource();
  if (!source) return;

  labelGraphic.background(getPaperColor());
  drawFilteredPhotoCover(labelGraphic, source);

  labelPhotoGraphic.clear();
  labelPhotoGraphic.background(getPaperColor());
  if (textOutlineMode === "outline") {
    labelPhotoGraphic.blendMode(REMOVE);
    drawStencilFillCutouts(labelPhotoGraphic);
    labelPhotoGraphic.blendMode(BLEND);
    drawStencilOutlineText(labelPhotoGraphic, getInkColor());
  } else if (textOutlineMode === "opposite") {
    labelPhotoGraphic.blendMode(REMOVE);
    drawStencilOutlineCutouts(labelPhotoGraphic);
  } else {
    labelPhotoGraphic.blendMode(REMOVE);
    drawStencilFillCutouts(labelPhotoGraphic);
  }
  labelPhotoGraphic.blendMode(BLEND);

  labelGraphic.image(labelPhotoGraphic, 0, 0);
}

function drawFilteredPhotoCover(target, source) {
  ensurePhotoGraphic();
  labelPhotoGraphic.clear();
  drawPhotoCoverForMode(labelPhotoGraphic, source, 0, 0, labelPhotoGraphic.width, labelPhotoGraphic.height);
  target.image(labelPhotoGraphic, 0, 0);
}

function drawStencilFillCutouts(target) {
  const labelLayout = getLabelLayout();
  const layout = cachedLabelLayout || fitTextLayout(labelText, labelLayout.textArea.width, labelLayout.textArea.height);
  const textOrigin = cachedTextOrigin || getTextRenderOrigin(layout, labelLayout);

  drawLabelQrCode(labelLayout.qrBox, target, { drawPaper: false, inkColor: 255 });
  applyEditorFont(target);
  target.textAlign(LEFT, TOP);

  let y = textOrigin.y;
  for (const line of layout.lines) {
    drawStyledLineFillOnly(line, y, textOrigin.x, target);
    y += line.lineHeight;
  }
  target.noStroke();
  target.textStyle(NORMAL);
}

function drawStencilOutlineCutouts(target) {
  const labelLayout = getLabelLayout();
  const layout = cachedLabelLayout || fitTextLayout(labelText, labelLayout.textArea.width, labelLayout.textArea.height);
  const textOrigin = cachedTextOrigin || getTextRenderOrigin(layout, labelLayout);

  drawLabelQrCode(labelLayout.qrBox, target, { drawPaper: false, inkColor: 255 });
  applyEditorFont(target);
  target.textAlign(LEFT, TOP);

  let y = textOrigin.y;
  for (const line of layout.lines) {
    drawStyledLineOutlineOnly(line, y, textOrigin.x, target, 255);
    y += line.lineHeight;
  }
  target.noStroke();
  target.textStyle(NORMAL);
}

function drawStencilOutlineText(target, colorValue) {
  const labelLayout = getLabelLayout();
  const layout = cachedLabelLayout || fitTextLayout(labelText, labelLayout.textArea.width, labelLayout.textArea.height);
  const textOrigin = cachedTextOrigin || getTextRenderOrigin(layout, labelLayout);

  applyEditorFont(target);
  target.textAlign(LEFT, TOP);

  let y = textOrigin.y;
  for (const line of layout.lines) {
    drawStyledLineOutlineOnly(line, y, textOrigin.x, target, colorValue);
    y += line.lineHeight;
  }
  target.noStroke();
  target.textStyle(NORMAL);
}

function drawStyledLineFillOnly(line, y, startX = getLabelTextRect().x, target = labelGraphic) {
  const segments = getLineSegments(line.start, line.end, line.text);
  const autoLineBold = isAutoLineBold(line.text);
  let x = startX - getLineLeadingInkOffset(line);

  for (const segment of segments) {
    const textValue = segment.text || " ";
    const style = segment.style || {};
    const mergedStyle = {
      bold: !!(style.bold || autoLineBold),
      italic: !!style.italic,
      underline: false,
    };
    const whitespaceOnly = isWhitespaceOnly(textValue);
    const renderStyle = whitespaceOnly
      ? { bold: false, italic: false, underline: false }
      : mergedStyle;
    const widthValue = whitespaceOnly
      ? measureWhitespaceWidth(textValue, line.fontSize)
      : measureTextWidth(textValue, line.fontSize, renderStyle);

    if (!whitespaceOnly) {
      target.push();
      applyEditorFont(target, line.fontSize);
      target.textLeading(line.lineHeight);
      applySegmentTextStyle(renderStyle, target);
      target.fill(255);
      target.noStroke();
      target.text(textValue, x, y);
      target.pop();
    }

    x += widthValue;
  }
}

function drawStyledLineOutlineOnly(line, y, startX = getLabelTextRect().x, target = labelGraphic, colorValue = getInkColor()) {
  const segments = getLineSegments(line.start, line.end, line.text);
  const autoLineBold = isAutoLineBold(line.text);
  let x = startX - getLineLeadingInkOffset(line);

  for (const segment of segments) {
    const textValue = segment.text || " ";
    const style = segment.style || {};
    const mergedStyle = {
      bold: !!(style.bold || autoLineBold),
      italic: !!style.italic,
      underline: false,
    };
    const whitespaceOnly = isWhitespaceOnly(textValue);
    const renderStyle = whitespaceOnly
      ? { bold: false, italic: false, underline: false }
      : mergedStyle;
    const widthValue = whitespaceOnly
      ? measureWhitespaceWidth(textValue, line.fontSize)
      : measureTextWidth(textValue, line.fontSize, renderStyle);

    if (!whitespaceOnly) {
      target.push();
      applyEditorFont(target, line.fontSize);
      target.textLeading(line.lineHeight);
      applySegmentTextStyle(renderStyle, target);
      target.noFill();
      target.stroke(colorValue);
      target.strokeWeight(getTextOutlineWeight(line.fontSize));
      target.text(textValue, x, y);
      target.pop();
    }

    x += widthValue;
  }
}

function applyColorPhotoFilterMode(target) {
  if (photoMergeMode === "chromatic" || photoMergeMode === "chromaticblur") {
    logPhotoFilterHit(photoMergeMode);
    applyChromaticAberration(target);
  } else if (photoMergeMode === "noise") {
    logPhotoFilterHit("noise");
    applyNoiseFilter(target, "soft");
  } else if (photoMergeMode === "noisethreshold") {
    logPhotoFilterHit("noise + threshold");
    applyNoiseFilter(target, "threshold");
  }
}

function applyGrayscalePhotoFilterMode(target) {
  if (photoMergeMode === "blur") {
    applyP5Filter(target, globalThis.BLUR, 4);
  } else if (photoMergeMode === "erode") {
    applyP5Filter(target, globalThis.ERODE);
  } else if (photoMergeMode === "invert") {
    applyP5Filter(target, globalThis.INVERT);
  } else if (photoMergeMode === "invertblur") {
    applyP5Filter(target, globalThis.INVERT);
    applyP5Filter(target, globalThis.BLUR, 4);
  } else if (photoMergeMode === "noisethreshold") {
    applyP5Filter(target, globalThis.THRESHOLD, 150 / 255);
  } else if (photoMergeMode === "chromaticblur") {
    applyP5Filter(target, globalThis.BLUR, 4);
  } else if (photoMergeMode === "hardblack") {
    const threshold = outputMode === "receipt" ? 190 : 150;
    applyP5Filter(target, globalThis.THRESHOLD, threshold / 255);
  }
}

function applyTextEffectMode(target) {
  if (textEffectMode === "none") return;
  if (textEffectMode === "chromatic" || textEffectMode === "chromaticblur") {
    applyTextChromaticAberration(target);
    if (photoGrayscaleEnabled) {
      applyP5Filter(target, globalThis.GRAY);
    }
  } else if (textEffectMode === "noise") {
    applyTextNoiseFilter(target, "soft");
  } else if (textEffectMode === "noisethreshold") {
    applyTextNoiseFilter(target, "threshold");
  } else if (textEffectMode === "blur") {
    applyP5Filter(target, globalThis.BLUR, 2);
  }

  if (textEffectMode === "chromaticblur") {
    applyP5Filter(target, globalThis.BLUR, 2);
  }
}

function applyP5Filter(target, filterType, filterParam = null) {
  if (!filterType || typeof target?.filter !== "function") return;
  if (filterParam === null) {
    target.filter(filterType);
    return;
  }
  target.filter(filterType, filterParam);
}

function initPhotoFilterShaders() {
  if (!labelPhotoGraphic || typeof labelPhotoGraphic.createFilterShader !== "function") {
    chromaticAberrationShader = null;
    noiseShader = null;
    noiseThresholdShader = null;
    photoFilterShaderTarget = null;
    return;
  }

  try {
    chromaticAberrationShader = labelPhotoGraphic.createFilterShader(getChromaticAberrationFilterSource());
    noiseShader = labelPhotoGraphic.createFilterShader(getNoiseFilterSource(false));
    noiseThresholdShader = labelPhotoGraphic.createFilterShader(getNoiseFilterSource(true));
    photoFilterShaderTarget = labelPhotoGraphic;
    disabledCustomPhotoFilters.delete("chromatic");
    disabledCustomPhotoFilters.delete("noise");
    disabledCustomPhotoFilters.delete("noise threshold");
  } catch (error) {
    chromaticAberrationShader = null;
    noiseShader = null;
    noiseThresholdShader = null;
    photoFilterShaderTarget = null;
    console.warn("[labelmaker2] photo filter shader setup failed", error);
  }
}

function initTextEffectShaders() {
  if (!labelTextGraphic || typeof labelTextGraphic.createFilterShader !== "function") {
    textChromaticAberrationShader = null;
    textNoiseShader = null;
    textNoiseThresholdShader = null;
    textFilterShaderTarget = null;
    return;
  }

  try {
    textChromaticAberrationShader = labelTextGraphic.createFilterShader(getChromaticAberrationFilterSource());
    textNoiseShader = labelTextGraphic.createFilterShader(getTextNoiseFilterSource(false));
    textNoiseThresholdShader = labelTextGraphic.createFilterShader(getTextNoiseFilterSource(true));
    textFilterShaderTarget = labelTextGraphic;
    disabledCustomPhotoFilters.delete("text chromatic");
    disabledCustomPhotoFilters.delete("text noise");
    disabledCustomPhotoFilters.delete("text noise threshold");
  } catch (error) {
    textChromaticAberrationShader = null;
    textNoiseShader = null;
    textNoiseThresholdShader = null;
    textFilterShaderTarget = null;
    console.warn("[labelmaker2] text effect shader setup failed", error);
  }
}

function getChromaticAberrationFilterSource() {
  return `
    precision highp float;

    uniform sampler2D tex0;
    uniform vec2 texelSize;
    varying vec2 vTexCoord;

    void main() {
      vec2 offset = vec2(texelSize.x * 14.0, 0.0);
      vec4 baseColor = texture2D(tex0, vTexCoord);
      vec4 redColor = texture2D(tex0, vTexCoord - offset);
      vec4 blueColor = texture2D(tex0, vTexCoord + offset);
      gl_FragColor = vec4(redColor.r, baseColor.g, blueColor.b, baseColor.a);
    }
  `;
}

function getNoiseFilterSource(thresholdVariant = false) {
  const strength = thresholdVariant ? "0.52" : "0.45";
  const scanlineStrength = thresholdVariant ? "0.24" : "0.18";
  return `
    precision highp float;

    uniform sampler2D tex0;
    varying vec2 vTexCoord;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 color = texture2D(tex0, vTexCoord);
      float fine = hash(vTexCoord * vec2(16000.0, 12000.0));
      float rough = hash(vTexCoord * vec2(1700.0, 2100.0) + vec2(19.0, 73.0));
      float grain = ((fine - 0.5) * 0.75 + (rough - 0.5) * 0.55) * ${strength};
      float scanline = step(0.82, fract(vTexCoord.y * 900.0)) * ${scanlineStrength};
      vec3 nextColor = color.rgb + vec3(grain) - vec3(scanline);
      gl_FragColor = vec4(clamp(nextColor, 0.0, 1.0), color.a);
    }
  `;
}

function getTextNoiseFilterSource(thresholdVariant = false) {
  const alphaDrop = thresholdVariant ? "0.42" : "0.18";
  const speckleScale = thresholdVariant ? "2200.0" : "1300.0";
  const grainStrength = thresholdVariant ? "0.85" : "0.45";
  return `
    precision highp float;

    uniform sampler2D tex0;
    varying vec2 vTexCoord;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 color = texture2D(tex0, vTexCoord);
      float fine = hash(vTexCoord * vec2(16000.0, 12000.0));
      float speckle = hash(vTexCoord * vec2(${speckleScale}, ${speckleScale}) + vec2(19.0, 73.0));
      float grain = (fine - 0.5) * ${grainStrength};
      float keep = step(${alphaDrop}, speckle);
      vec3 nextColor = clamp(color.rgb + vec3(grain), 0.0, 1.0);
      gl_FragColor = vec4(nextColor, color.a * keep);
    }
  `;
}

function chromaticAberrationShaderCallback() {
  filterColor.begin();
  let result = getTexture(filterColor.canvasContent, filterColor.texCoord);
  let redCoord = filterColor.texCoord + [-0.004, 0];
  let blueCoord = filterColor.texCoord + [0.004, 0];
  let redResult = getTexture(filterColor.canvasContent, redCoord);
  let blueResult = getTexture(filterColor.canvasContent, blueCoord);
  result.r = redResult.r;
  result.b = blueResult.b;
  filterColor.set(result);
  filterColor.end();
}

function noiseShaderCallback() {
  filterColor.begin();
  let result = getTexture(filterColor.canvasContent, filterColor.texCoord);
  let coord = filterColor.texCoord;
  let fineGrain = fract(sin(dot(coord * 14000, [12.9898, 78.233])) * 43758.5453) - 0.5;
  let roughGrain = fract(sin(dot(coord * 1800 + [19, 73], [39.3468, 11.135])) * 24634.6345) - 0.5;
  let grain = fineGrain * 0.8 + roughGrain * 0.45;
  result.r = clamp(result.r + grain * 0.9, 0, 1);
  result.g = clamp(result.g + grain * 0.9, 0, 1);
  result.b = clamp(result.b + grain * 0.9, 0, 1);
  if (fract(coord.y * 8) < 0.18) {
    result.r = 0;
    result.g = 0;
    result.b = 0;
  }
  filterColor.set(result);
  filterColor.end();
}

function noiseThresholdShaderCallback() {
  filterColor.begin();
  let result = getTexture(filterColor.canvasContent, filterColor.texCoord);
  let coord = filterColor.texCoord;
  let fineGrain = fract(sin(dot(coord * 16000, [12.9898, 78.233])) * 43758.5453) - 0.5;
  let roughGrain = fract(sin(dot(coord * 2200 + [37, 91], [39.3468, 11.135])) * 24634.6345) - 0.5;
  let grain = fineGrain * 0.9 + roughGrain * 0.55;
  result.r = clamp(result.r + grain * 1.15, 0, 1);
  result.g = clamp(result.g + grain * 1.15, 0, 1);
  result.b = clamp(result.b + grain * 1.15, 0, 1);
  if (fract(coord.y * 8) < 0.18) {
    result.r = 0;
    result.g = 0;
    result.b = 0;
  }
  filterColor.set(result);
  filterColor.end();
}

function disableCustomPhotoFilter(key, error) {
  if (!disabledCustomPhotoFilters.has(key)) {
    console.warn(`[labelmaker2] ${key} shader failed; ignoring that filter`, error);
  }
  disabledCustomPhotoFilters.add(key);
}

function logPhotoFilterHit(key) {
  if (loggedPhotoFilterHits.has(key)) return;
  console.log(`[labelmaker2] photo filter active: ${key}`);
  loggedPhotoFilterHits.add(key);
}

function applyChromaticAberration(target) {
  if (
    !chromaticAberrationShader ||
    disabledCustomPhotoFilters.has("chromatic") ||
    typeof target?.filter !== "function"
  ) {
    return false;
  }
  try {
    target.filter(chromaticAberrationShader);
    return true;
  } catch (error) {
    disableCustomPhotoFilter("chromatic", error);
    return false;
  }
}

function applyNoiseFilter(target, variant = "soft") {
  const key = variant === "threshold" ? "noise threshold" : "noise";
  const shader = variant === "threshold" ? noiseThresholdShader : noiseShader;
  if (!shader || disabledCustomPhotoFilters.has(key) || typeof target?.filter !== "function") return false;
  try {
    target.filter(shader);
    return true;
  } catch (error) {
    disableCustomPhotoFilter(key, error);
    return false;
  }
}

function disposeGraphic(graphic) {
  if (!graphic || typeof graphic.remove !== "function") return;
  try {
    graphic.remove();
  } catch {}
}

function applyTextChromaticAberration(target) {
  const key = "text chromatic";
  if (
    !textChromaticAberrationShader ||
    disabledCustomPhotoFilters.has(key) ||
    typeof target?.filter !== "function"
  ) {
    return false;
  }
  try {
    target.filter(textChromaticAberrationShader);
    return true;
  } catch (error) {
    disableCustomPhotoFilter(key, error);
    return false;
  }
}

function applyTextNoiseFilter(target, variant = "soft") {
  const key = variant === "threshold" ? "text noise threshold" : "text noise";
  const shader = variant === "threshold" ? textNoiseThresholdShader : textNoiseShader;
  if (!shader || disabledCustomPhotoFilters.has(key) || typeof target?.filter !== "function") return false;
  try {
    target.filter(shader);
    return true;
  } catch (error) {
    disableCustomPhotoFilter(key, error);
    return false;
  }
}

function ensurePhotoGraphic() {
  if (
    labelPhotoGraphic &&
    labelPhotoGraphic.width === labelGraphic.width &&
    labelPhotoGraphic.height === labelGraphic.height
  ) {
    if (photoFilterShaderTarget !== labelPhotoGraphic) {
      initPhotoFilterShaders();
    }
    return;
  }
  disposeGraphic(labelPhotoGraphic);
  chromaticAberrationShader = null;
  noiseShader = null;
  noiseThresholdShader = null;
  photoFilterShaderTarget = null;
  labelPhotoGraphic = createGraphics(labelGraphic.width, labelGraphic.height);
  labelPhotoGraphic.pixelDensity(1);
  initPhotoFilterShaders();
}

function drawPhotoCoverForMode(target, source, dx, dy, dw, dh) {
  drawImageCover(target, source, dx, dy, dw, dh, {
    offsetX: photoOffsetX,
    offsetY: photoOffsetY,
  });
  if (photoMergeMode === "chromatic" || photoMergeMode === "chromaticblur") {
    applyColorPhotoFilterMode(target);
    if (photoGrayscaleEnabled) {
      applyP5Filter(target, globalThis.GRAY);
    }
    applyGrayscalePhotoFilterMode(target);
    return;
  }
  if (photoGrayscaleEnabled) {
    applyP5Filter(target, globalThis.GRAY);
  }
  applyColorPhotoFilterMode(target);
  applyGrayscalePhotoFilterMode(target);
}

function applyPrintGrayscaleConversion(target) {
  target.loadPixels();
  for (let index = 0; index < target.pixels.length; index += 4) {
    const alpha = target.pixels[index + 3];
    const luminance = alpha <= 20
      ? 255
      : 0.2126 * target.pixels[index] + 0.7152 * target.pixels[index + 1] + 0.0722 * target.pixels[index + 2];
    target.pixels[index] = luminance;
    target.pixels[index + 1] = luminance;
    target.pixels[index + 2] = luminance;
    target.pixels[index + 3] = 255;
  }
  target.updatePixels();
}

function drawImageCover(target, source, dx, dy, dw, dh, options = {}) {
  const sourceSize = getSourceSize(source);
  if (!sourceSize) return;
  const { width: sw, height: sh } = sourceSize;
  if (sw <= 0 || sh <= 0) return;

  const scale = Math.max(dw / sw, dh / sh);
  const fittedW = sw * scale;
  const fittedH = sh * scale;
  const fittedX = dx + (dw - fittedW) * 0.5 + (Number(options.offsetX) || 0);
  const fittedY = dy + (dh - fittedH) * 0.5 + (Number(options.offsetY) || 0);

  target.image(
    source,
    fittedX,
    fittedY,
    fittedW,
    fittedH
  );
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

function isCameraReady() {
  return !!(cam && getSourceSize(cam));
}

function hasStoredPhoto() {
  return !!droppedPhotoImage;
}

function hasPhotoSource() {
  return !!((photoEnabled && isCameraReady()) || droppedPhotoImage);
}

function getPhotoSource() {
  return (photoEnabled && isCameraReady()) ? cam : droppedPhotoImage;
}

function capturePhotoSourceGraphic(source = getPhotoSource(), maxDimension = null, options = {}) {
  if (!source || !labelGraphic) return null;
  const scale = maxDimension
    ? Math.min(1, maxDimension / Math.max(labelGraphic.width, labelGraphic.height))
    : 1;
  const target = createGraphics(
    Math.max(1, Math.round(labelGraphic.width * scale)),
    Math.max(1, Math.round(labelGraphic.height * scale))
  );
  target.pixelDensity(1);
  drawImageCover(target, source, 0, 0, target.width, target.height, {
    offsetX: options.includeOffset ? photoOffsetX * scale : 0,
    offsetY: options.includeOffset ? photoOffsetY * scale : 0,
  });
  return target;
}

function resizePhotoImageToLabelLimit(source) {
  const size = getSourceSize(source);
  if (!source || !size || !labelGraphic) return source;

  const maxWidth = Math.max(1, labelGraphic.width * 2);
  const maxHeight = Math.max(1, labelGraphic.height * 2);
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
  if (scale >= 1) return source;

  const targetWidth = Math.max(1, Math.round(size.width * scale));
  const targetHeight = Math.max(1, Math.round(size.height * scale));
  const target = createGraphics(targetWidth, targetHeight);
  target.pixelDensity(1);
  target.image(source, 0, 0, targetWidth, targetHeight);
  return target.get();
}

function capturePhotoSourceDataUrl(source = getPhotoSource()) {
  const resized = resizePhotoImageToLabelLimit(source);
  const size = getSourceSize(resized);
  if (!resized || !size) return "";
  const target = createGraphics(size.width, size.height);
  target.pixelDensity(1);
  target.image(resized, 0, 0, size.width, size.height);
  const dataUrl = target.canvas.toDataURL("image/jpeg", storedPhotoJpegQuality);
  disposeGraphic(target);
  return dataUrl;
}

function getStoredPhotoDataUrl() {
  if (storedPhotoDataUrl && storedPhotoDataUrl.length < 5000000) return storedPhotoDataUrl;
  try {
    storedPhotoDataUrl = capturePhotoSourceDataUrl(droppedPhotoImage);
  } catch (error) {
    console.warn("[labelmaker2] photo snapshot save failed", error);
    storedPhotoDataUrl = "";
  }
  return storedPhotoDataUrl;
}

function freezeLiveCameraPhoto() {
  if (!photoEnabled || !isCameraReady()) return;
  const target = capturePhotoSourceGraphic(cam, null, { includeOffset: true });
  if (!target) return;
  droppedPhotoImage = resizePhotoImageToLabelLimit(target.get());
  droppedPhotoName = "Camera snapshot";
  storedPhotoDataUrl = capturePhotoSourceDataUrl(droppedPhotoImage);
  photoOffsetX = 0;
  photoOffsetY = 0;
  photoRevision += 1;
  stopPhotoCamera();
  photoEnabled = false;
  markLabelDirty();
  saveEditorState();
}

function removeStoredPhoto() {
  photoLoadToken += 1;
  droppedPhotoImage = null;
  droppedPhotoName = "";
  storedPhotoDataUrl = "";
  deleteEditorPhotoDataUrl();
  photoOffsetX = 0;
  photoOffsetY = 0;
  photoRevision += 1;
  markLabelDirty();
  detailText = "Removed photo.";
  saveEditorState();
}

function fitTextLayout(textValue, maxWidth, maxHeight) {
  return autoSizingEnabled
    ? buildDynamicLayout(String(textValue || ""), maxWidth, maxHeight)
    : buildManualLayout(String(textValue || ""), maxWidth, maxHeight);
}

function getLabelPadding() {
  return labelPaddingPresets[labelPaddingMode] || labelPaddingPresets.minimal;
}

function getLabelContentRect() {
  const padding = getLabelPadding();
  return {
    x: padding.left,
    y: padding.top,
    width: Math.max(1, labelGraphic.width - padding.left - padding.right),
    height: Math.max(1, labelGraphic.height - padding.top - padding.bottom),
  };
}

function getLabelContentWidth() {
  return getLabelContentRect().width;
}

function getLabelContentHeight() {
  return getLabelContentRect().height;
}

function getLabelLayout() {
  const content = getLabelContentRect();
  if (!labelQrCode) {
    return {
      content,
      qrBox: null,
      textArea: content,
    };
  }

  const baseGap = Math.max(42, Math.round(Math.min(labelGraphic.width, labelGraphic.height) * 0.04));
  const stackedGap = Math.max(56, Math.round(Math.min(labelGraphic.width, labelGraphic.height) * 0.055));
  const isSquare = labelFormat === "10x10";

  if (isSquare) {
    const textAreaHeight = content.height * 0.32;
    const size = Math.max(1, Math.min(
      content.width * 0.78,
      content.height * 0.66,
      content.height - stackedGap - textAreaHeight
    ));
    const groupHeight = size + stackedGap + textAreaHeight;
    const groupY = content.y + Math.max(0, (content.height - groupHeight) * 0.5);
    const qrBox = {
      x: content.x + (content.width - size) * 0.5,
      y: groupY,
      size,
      placement: "top",
      gap: stackedGap,
    };
    const textArea = {
      x: content.x,
      y: qrBox.y + qrBox.size + qrBox.gap,
      width: content.width,
      height: Math.max(1, textAreaHeight),
    };
    const blockWidth = Math.max(1, Math.min(content.width, Math.max(qrBox.size, content.width * 0.78)));
    const blockHeight = textArea.height;
    return {
      content,
      qrBox,
      textArea,
    };
  }

  if (orientation === "landscape") {
    const size = Math.max(1, Math.min(content.height, content.width * 0.38));
    const qrBox = {
      x: content.x + content.width - size,
      y: content.y + (content.height - size) * 0.5,
      size,
      placement: "right",
      gap: baseGap,
    };
    const textArea = {
      x: content.x,
      y: content.y,
      width: Math.max(1, qrBox.x - qrBox.gap - content.x),
      height: content.height,
    };
    return {
      content,
      qrBox,
      textArea,
    };
  }

  const textAreaHeight = content.height * 0.38;
  const size = Math.max(1, Math.min(
    content.width * 0.78,
    content.height * 0.48,
    content.height - stackedGap - textAreaHeight
  ));
  const groupHeight = size + stackedGap + textAreaHeight;
  const groupY = content.y + Math.max(0, (content.height - groupHeight) * 0.5);
  const qrBox = {
    x: content.x + (content.width - size) * 0.5,
    y: groupY,
    size,
    placement: "top",
    gap: stackedGap,
  };
  const textArea = {
    x: content.x,
    y: qrBox.y + qrBox.size + qrBox.gap,
    width: content.width,
    height: Math.max(1, textAreaHeight),
  };
  const blockWidth = Math.max(1, Math.min(content.width, Math.max(qrBox.size, content.width * 0.82)));
  return {
    content,
    qrBox,
    textArea,
  };
}

function getLabelQrBox() {
  return getLabelLayout().qrBox;
}

function getLabelTextRect() {
  return getLabelLayout().textArea;
}

function getLabelTextBlockRect() {
  return getLabelLayout().textArea;
}

function getTextRenderMetrics(layout) {
  const lines = layout?.lines || [];
  const widthValue = lines.reduce((maxWidth, line) => (
    Math.max(maxWidth, getRenderedLineWidth(line))
  ), 0);
  return {
    width: Math.max(1, widthValue),
    height: Math.max(1, layout?.height || 1),
  };
}

function getTextRenderOrigin(layout, labelLayout = getLabelLayout()) {
  const area = labelLayout.textArea;
  const qrBox = labelLayout.qrBox;
  if (!qrBox) return { x: area.x, y: area.y };

  const metrics = getTextRenderMetrics(layout);
  const blockWidth = Math.min(area.width, metrics.width);
  const blockHeight = Math.min(area.height, metrics.height);
  let x = area.x;
  let y = area.y + Math.max(0, (area.height - blockHeight) * 0.5);

  if (qrBox.placement === "top") {
    const centerX = qrBox.x + qrBox.size * 0.5;
    x = constrain(centerX - blockWidth * 0.5, area.x, area.x + Math.max(0, area.width - blockWidth));
  }

  return { x, y };
}

function drawLabelQrCode(qrBox = getLabelQrBox(), target = labelGraphic, options = {}) {
  if (!qrBox) return;
  drawQrCodeToGraphics(target, labelQrCode, qrBox.x, qrBox.y, qrBox.size, options);
}

function drawQrCodeToGraphics(target, qr, x, y, size, { drawPaper = true, inkColor = getInkColor() } = {}) {
  if (!qr || !Number.isFinite(Number(qr.size)) || typeof qr.getModule !== "function") return;
  const moduleCount = Number(qr.size);
  const moduleSize = size / moduleCount;
  target.push();
  target.noStroke();
  if (drawPaper) {
    target.fill(getPaperColor());
    target.rect(x, y, size, size);
  }
  target.fill(inkColor);
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.getModule(col, row)) continue;
      target.rect(
        x + col * moduleSize,
        y + row * moduleSize,
        Math.ceil(moduleSize) + 0.5,
        Math.ceil(moduleSize) + 0.5
      );
    }
  }
  target.pop();
}

function getInkColor() {
  return labelInverted ? 255 : 0;
}

function getPaperColor() {
  return labelInverted ? 0 : 255;
}

function getOppositeTextFillColor() {
  return getPaperColor();
}

function getOppositeTextStrokeColor() {
  return getInkColor();
}

function buildManualLayout(textValue, maxWidth, maxHeight) {
  const lines = wrapTextToLines(String(textValue || ""), maxWidth);
  applyNaturalLineHeights(lines);
  return {
    lines,
    height: lines.reduce((sum, line) => sum + line.lineHeight, 0),
  };
}

function buildDynamicLayout(textValue, maxWidth, maxHeight) {
  const text = String(textValue || "");
  const fontSize = findDynamicBaseFontSize(text, maxWidth, maxHeight);
  const layout = buildExplicitLineLayout(text, fontSize);
  scaleDynamicShortLines(layout, maxWidth, maxHeight);
  return layout;
}

function findDynamicBaseFontSize(textValue, maxWidth, maxHeight) {
  let low = minFontSize;
  let high = maxFontSize;
  let best = minFontSize;

  for (let step = 0; step < 18; step += 1) {
    const candidate = (low + high) * 0.5;
    const layout = buildExplicitLineLayout(textValue, candidate);
    const fitsWidth = layout.lines.every((line) => getRenderedLineWidth(line) <= maxWidth + 0.5);
    const fitsHeight = layout.height <= maxHeight + 0.5;
    if (fitsWidth && fitsHeight) {
      best = candidate;
      low = candidate;
    } else {
      high = candidate;
    }
  }

  return constrain(best, minFontSize, maxFontSize);
}

function scaleDynamicShortLines(layout, maxWidth, maxHeight) {
  const lines = layout?.lines || [];
  if (!lines.length) return;

  const currentWidths = lines.map((line) => getRenderedLineWidth(line));
  const targetWidth = Math.min(maxWidth, currentWidths.reduce((maxValue, widthValue) => Math.max(maxValue, widthValue), 0));
  if (targetWidth <= 0) return;

  const baseSizes = lines.map((line) => line.fontSize);
  const desiredSizes = lines.map((line, index) => {
    if (!String(line.text || "").trim()) return line.fontSize;
    if (currentWidths[index] >= targetWidth - 0.5) return line.fontSize;
    return fitLineFontSizeToRenderedWidth(line, targetWidth);
  });

  const factor = getLineHeightFactorForCurrentFont();
  const baseHeight = baseSizes.reduce((sum, size) => sum + size * factor, 0);
  const desiredHeight = desiredSizes.reduce((sum, size) => sum + size * factor, 0);
  const extraHeight = Math.max(0, desiredHeight - baseHeight);
  const availableExtraHeight = Math.max(0, maxHeight - baseHeight);
  const growth = extraHeight > 0 ? Math.min(1, availableExtraHeight / extraHeight) : 0;

  for (let index = 0; index < lines.length; index += 1) {
    const baseSize = baseSizes[index];
    const desiredSize = desiredSizes[index];
    lines[index].fontSize = constrain(baseSize + (desiredSize - baseSize) * growth, minFontSize, maxFontSize);
  }
  applyNaturalLineHeights(lines);
  layout.height = lines.reduce((sum, line) => sum + line.lineHeight, 0);
}

function fitLineFontSizeToRenderedWidth(line, targetWidth) {
  let low = line.fontSize;
  let high = maxFontSize;
  let best = line.fontSize;

  for (let step = 0; step < 18; step += 1) {
    const candidate = (low + high) * 0.5;
    const testLine = {
      ...line,
      fontSize: candidate,
    };
    const widthValue = getRenderedLineWidth(testLine);
    if (widthValue <= targetWidth + 0.5) {
      best = candidate;
      low = candidate;
    } else {
      high = candidate;
    }
  }

  return constrain(best, line.fontSize, maxFontSize);
}

function buildExplicitLineLayout(textValue, fontSize) {
  const text = String(textValue || "");
  const lines = [];
  let lineStart = 0;
  let logicalLineIndex = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue;
    lines.push(makeLine(text.slice(lineStart, index), lineStart, index, logicalLineIndex, fontSize));
    lineStart = index + 1;
    logicalLineIndex += 1;
  }

  lines.push(makeLine(text.slice(lineStart), lineStart, text.length, logicalLineIndex, fontSize));
  applyNaturalLineHeights(lines);
  return {
    lines,
    height: lines.reduce((sum, line) => sum + line.lineHeight, 0),
  };
}

function buildFixedFontLayout(textValue, maxWidth, fontSize) {
  const lines = wrapTextToLines(String(textValue || ""), maxWidth, {
    fixedFontSize: fontSize,
  });
  applyNaturalLineHeights(lines);
  return {
    lines,
    height: lines.reduce((sum, line) => sum + line.lineHeight, 0),
  };
}

function applyNaturalLineHeights(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const factor = getLineHeightFactorForCurrentFont();
    line.lineHeight = Math.max(1, line.fontSize * factor);
  }
}

function getLineHeightFactorForCurrentFont() {
  if (editorFontMode === "rubikmonoone") return 0.78;
  if (editorFontMode === "bebas") return 0.86;
  return 0.96;
}

function getCaretPosition(layout, textOrigin = getTextRenderOrigin(layout)) {
  const info = findCursorLocation(layout);
  const boundaryOffset = clampCursorIndex(cursorIndex) - info.line.start;
  const x = getCharacterBoundaryX(info.line, boundaryOffset, getRenderedLineStartX(info.line, textOrigin.x));
  let y = textOrigin.y;
  for (let index = 0; index < info.lineIndex; index += 1) {
    y += layout.lines[index].lineHeight;
  }
  const visualOffset = getCaretVisualOffset(info.line.fontSize);
  const visualHeight = getCaretVisualHeight(info.line.fontSize);
  return {
    x,
    y: y + visualOffset,
    height: visualHeight,
    fontSize: info.line.fontSize,
  };
}

function getCharacterBoundaryOffsets(line) {
  const textValue = String(line?.text || "");
  const boundaries = [];
  for (let offset = 0; offset <= textValue.length; offset += 1) {
    boundaries.push({
      offset,
      x: measureStyledRangeWidth(line.start, line.start + offset, line.fontSize, line.text),
    });
  }
  return boundaries;
}

function getCharacterBoundaryX(line, offset, startX = 0) {
  const maxOffset = String(line?.text || "").length;
  const clampedOffset = constrain(offset, 0, maxOffset);
  const boundary = getCharacterBoundaryOffsets(line).find((entry) => entry.offset === clampedOffset);
  return startX + (boundary?.x || 0);
}

function findNearestCharacterOffset(line, localX) {
  let best = { offset: 0, distance: Infinity };
  for (const boundary of getCharacterBoundaryOffsets(line)) {
    const distance = Math.abs(boundary.x - localX);
    if (distance < best.distance) {
      best = { offset: boundary.offset, distance };
    }
  }
  return best.offset;
}

function getCaretVisualOffset(fontSize) {
  if (editorFontMode === "rubikmonoone") return fontSize * 0.04;
  if (editorFontMode === "bebas") return -fontSize * 0.06;
  if (editorFontMode === "oswald") return -fontSize * 0.03;
  return -fontSize * 0.02;
}

function getCaretVisualHeight(fontSize) {
  if (editorFontMode === "rubikmonoone") return fontSize * 0.68;
  if (editorFontMode === "bebas") return fontSize * 0.72;
  return fontSize * 0.78;
}

function drawPreviewCard(preview = getPreviewRect()) {
  image(labelGraphic, preview.x, preview.y, preview.width, preview.height);
  drawCaretOverlay(preview);
  noFill();
  stroke(255);
  strokeWeight(1);
  rect(preview.x, preview.y, preview.width, preview.height);
}

function drawCaretOverlay(preview) {
  if (busy || !cachedLabelLayout || !cachedTextOrigin) return;
  const caret = getCaretPosition(cachedLabelLayout, cachedTextOrigin);
  const scaleX = preview.width / labelGraphic.width;
  const scaleY = preview.height / labelGraphic.height;
  push();
  stroke(caretWhite ? 255 : 0);
  strokeWeight(Math.max(1, Math.max(2, caret.fontSize * 0.04) * scaleX));
  line(
    preview.x + caret.x * scaleX,
    preview.y + caret.y * scaleY,
    preview.x + caret.x * scaleX,
    preview.y + (caret.y + caret.height) * scaleY
  );
  pop();
}

function getPreviewRect() {
  const viewportLandscape = width > height;
  const topMargin = viewportLandscape ? 8 : 28;
  const controlsGap = toolbarPreviewGap;
  const toolbarRows = getToolbarRowCount();
  const controlsHeight = toolbarButtonHeight * toolbarRows + toolbarRowGap * (toolbarRows - 1);
  const bottomMargin = 6;
  const sideMargin = getViewportSideMargin();
  const availableWidth = width - sideMargin * 2;
  const availableHeight = height - topMargin - controlsGap - controlsHeight - bottomMargin;
  const scale = Math.min(availableWidth / labelGraphic.width, availableHeight / labelGraphic.height);
  const previewWidth = labelGraphic.width * scale;
  const previewHeight = labelGraphic.height * scale;
  return {
    x: (width - previewWidth) * 0.5,
    y: topMargin,
    width: previewWidth,
    height: previewHeight,
  };
}

function getToolbarRect(preview = getPreviewRect()) {
  const sideMargin = getViewportSideMargin();
  return {
    x: sideMargin,
    y: preview.y + preview.height + toolbarPreviewGap,
    width: Math.max(1, width - sideMargin * 2),
    height: toolbarButtonHeight * getToolbarRowCount() + toolbarRowGap * (getToolbarRowCount() - 1),
  };
}

function getToolbarRowCount() {
  const sideMargin = getViewportSideMargin();
  const toolbar = {
    x: sideMargin,
    y: 0,
    width: Math.max(1, width - sideMargin * 2),
  };
  const square = toolbarButtonHeight;
  const connectionState = printer?.getConnectionState?.() || {};
  const isConnected = !!connectionState.connected;
  const isConnecting = connectingPrinter || !!connectionState.connecting;
  const printButtonWidth = busy ? square * 3 + toolbarGap * 2 : (isConnected ? square * 2 + toolbarGap : 0);
  return createToolbarLayout(toolbar, { isConnected, isConnecting, printButtonWidth }).rows.length || 1;
}

function getViewportSideMargin() {
  return width < 700 ? 8 : 24;
}

function mousePressed() {
  return handlePreviewPointerPress(mouseX, mouseY);
}

function mouseDragged() {
  return handlePreviewPointerDrag(mouseX, mouseY);
}

function mouseReleased() {
  return handlePreviewPointerRelease(mouseX, mouseY);
}

function touchStarted() {
  return handlePreviewPointerPress(mouseX, mouseY);
}

function touchMoved() {
  return handlePreviewPointerDrag(mouseX, mouseY);
}

function touchEnded() {
  return handlePreviewPointerRelease(mouseX, mouseY);
}

function handlePreviewPointerPress(pointerX, pointerY) {
  if (busy || !labelGraphic) return;
  const preview = getPreviewRect();
  if (!isPointInsidePreview(pointerX, pointerY, preview)) return;

  previewPointerPress = {
    x: pointerX,
    y: pointerY,
    startPhotoOffsetX: photoOffsetX,
    startPhotoOffsetY: photoOffsetY,
    dragged: false,
    preview,
  };
  return false;
}

function handlePreviewPointerDrag(pointerX, pointerY) {
  if (busy || !previewPointerPress || !hasPhotoSource()) return;

  const preview = previewPointerPress.preview || getPreviewRect();
  const deltaX = ((pointerX - previewPointerPress.x) / preview.width) * labelGraphic.width;
  const deltaY = ((pointerY - previewPointerPress.y) / preview.height) * labelGraphic.height;
  const movedEnough = Math.hypot(pointerX - previewPointerPress.x, pointerY - previewPointerPress.y) > 3;
  if (!movedEnough && !previewPointerPress.dragged) return false;

  previewPointerPress.dragged = true;
  photoOffsetX = previewPointerPress.startPhotoOffsetX + deltaX;
  photoOffsetY = previewPointerPress.startPhotoOffsetY + deltaY;
  markLabelDirty();
  detailText = "Moved photo.";
  return false;
}

function handlePreviewPointerRelease(pointerX, pointerY) {
  if (busy || !previewPointerPress || !labelGraphic) return;

  const press = previewPointerPress;
  previewPointerPress = null;
  if (press.dragged) {
    saveEditorState();
    return false;
  }

  const preview = press.preview || getPreviewRect();
  if (!isPointInsidePreview(pointerX, pointerY, preview)) return false;

  placeCursorFromPreviewPoint(pointerX, pointerY, preview);
  if (useSoftKeyboardInput) {
    if (useP5SoftKeyboardInput) {
      positionEditorInputNearPointer(pointerX, pointerY);
      if (isSoftKeyboardLikelyOpen()) {
        syncEditorInputFromModel();
        return false;
      }
    }
    focusEditorInput();
  }
  return false;
}

function isPointInsidePreview(pointerX, pointerY, preview = getPreviewRect()) {
  return (
    pointerX >= preview.x &&
    pointerX <= preview.x + preview.width &&
    pointerY >= preview.y &&
    pointerY <= preview.y + preview.height
  );
}

function placeCursorFromPreviewPoint(pointerX, pointerY, preview) {
  const localX = ((pointerX - preview.x) / preview.width) * labelGraphic.width;
  const localY = ((pointerY - preview.y) / preview.height) * labelGraphic.height;
  const draftBlock = getLabelTextBlockRect();
  const layout = fitTextLayout(labelText, draftBlock.width, draftBlock.height);
  const textOrigin = getTextRenderOrigin(layout);
  const lineIndex = findNearestLineIndex(layout, localY);
  const line = layout.lines[lineIndex];
  const renderedStartX = getRenderedLineStartX(line, textOrigin.x);
  const textX = constrain(localX - renderedStartX, 0, draftBlock.width);
  const bestOffset = findNearestCharacterOffset(line, textX);

  cursorIndex = line.start + bestOffset;
  caretWhite = false;
  lastCaretToggleMs = millis();
  detailText = "Moved cursor.";
  saveEditorState();
}

function findNearestLineIndex(layout, localY) {
  const textOrigin = getTextRenderOrigin(layout);
  const contentY = localY - textOrigin.y;
  let y = 0;

  for (let index = 0; index < layout.lines.length; index += 1) {
    const line = layout.lines[index];
    const top = y;
    const bottom = y + line.lineHeight;
    if (contentY >= top && contentY <= bottom) return index;
    y = bottom;
  }

  if (contentY <= 0) return 0;
  return layout.lines.length - 1;
}

function keyTyped() {
  if (busy) return false;
  if (useSoftKeyboardInput && document.activeElement === textInputEl && !useP5SoftKeyboardInput) return false;
  if (key.length === 1 && !keyIsDown(CONTROL) && !keyIsDown(ALT)) {
    if (useP5SoftKeyboardInput && isRecentBridgeInput("insert", key)) return false;
    insertTextAtCursor(key);
    detailText = "Typing into the label.";
    return false;
  }
}

function keyPressed() {
  if (busy) return false;
  if (useSoftKeyboardInput && document.activeElement === textInputEl && !useP5SoftKeyboardInput) return false;
  if (
    keyCode === BACKSPACE ||
    keyCode === DELETE ||
    keyCode === ENTER ||
    keyCode === RETURN ||
    keyCode === TAB ||
    keyCode === LEFT_ARROW ||
    keyCode === RIGHT_ARROW ||
    keyCode === UP_ARROW ||
    keyCode === DOWN_ARROW
) {
    if (
      useP5SoftKeyboardInput &&
      ((keyCode === BACKSPACE && isRecentBridgeInput("delete")) ||
        ((keyCode === ENTER || keyCode === RETURN) && isRecentBridgeInput("newline")))
    ) {
      return false;
    }
    return false;
  }
}

function installTextInputBridge() {
  textInputEl = document.createElement("textarea");
  textInputEl.className = "labelmaker-text-input";
  textInputEl.setAttribute("autocapitalize", "off");
  textInputEl.setAttribute("autocomplete", "off");
  textInputEl.setAttribute("autocorrect", "off");
  textInputEl.setAttribute("spellcheck", "false");
  textInputEl.setAttribute("inputmode", "text");
  textInputEl.setAttribute("aria-label", "Label text input");
  document.body.appendChild(textInputEl);

  textInputEl.addEventListener("beforeinput", handleTextInputBeforeInput, { passive: false });
  textInputEl.addEventListener("keydown", handleTextInputKeydown, { passive: false });
  textInputEl.addEventListener("paste", handleEditorPaste, { passive: false });
  textInputEl.addEventListener("compositionstart", () => {
    textInputComposing = true;
  });
  textInputEl.addEventListener("compositionend", (event) => {
    textInputComposing = false;
    applyTextInputValue(textInputEl.value || event.data || "");
  });
  textInputEl.addEventListener("input", () => {
    if (textInputComposing && useP5SoftKeyboardInput) return;
    applyTextInputValue(textInputEl.value);
  });
}

function focusEditorInput() {
  if (!textInputEl) return;
  textInputEl.focus({ preventScroll: true });
  syncEditorInputFromModel();
}

function positionEditorInputNearPointer(pointerX, pointerY) {
  if (!textInputEl) return;
  const viewport = window.visualViewport;
  const viewportWidth = Number(viewport?.width || window.innerWidth || width || 320);
  const viewportHeight = Number(viewport?.height || window.innerHeight || height || 480);
  const left = Math.max(8, Math.min(viewportWidth - 32, Number(pointerX) + 18));
  const top = Math.max(8, Math.min(viewportHeight - 80, Number(pointerY) - 18));
  textInputEl.style.left = `${left}px`;
  textInputEl.style.top = `${top}px`;
}

function isSoftKeyboardLikelyOpen() {
  try {
    const viewport = window.visualViewport;
    if (!viewport) return false;
    const layoutHeight = Number(window.innerHeight || height || 0);
    const viewportHeight = Number(viewport.height || 0);
    return layoutHeight - viewportHeight > 80;
  } catch {
    return false;
  }
}

function detectSoftKeyboardMode() {
  try {
    const coarsePointer = typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
    const touchPoints = Number(window.navigator?.maxTouchPoints || 0);
    return coarsePointer || touchPoints > 0;
  } catch {
    return false;
  }
}

function detectIOSLikeBrowser() {
  try {
    const ua = String(navigator.userAgent || "");
    const platform = String(navigator.platform || "");
    const touchPoints = Number(navigator.maxTouchPoints || 0);
    return /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && touchPoints > 1);
  } catch {
    return false;
  }
}

function handleTextInputBeforeInput(event) {
  if (busy) {
    event.preventDefault();
    return;
  }

  if (useP5SoftKeyboardInput || event.target !== textInputEl) return;

  const inputType = String(event.inputType || "");
  if (inputType === "insertParagraph" || inputType === "insertLineBreak") {
    event.preventDefault();
    insertTextAtCursor("\n");
    syncEditorInputFromModel();
    return;
  }
  if (inputType === "deleteContentBackward") {
    event.preventDefault();
    deleteBackward();
    syncEditorInputFromModel();
    return;
  }
  if (inputType === "deleteContentForward") {
    event.preventDefault();
    deleteForward();
    syncEditorInputFromModel();
  }
}

function handleTextInputKeydown(event) {
  if (busy) {
    event.preventDefault();
    return;
  }

  if (useP5SoftKeyboardInput || event.target !== textInputEl) return;

  if (event.key === "Enter") {
    event.preventDefault();
    insertTextAtCursor("\n");
    syncEditorInputFromModel();
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    deleteBackward();
    syncEditorInputFromModel();
    return;
  }
  if (event.key === "Delete") {
    event.preventDefault();
    deleteForward();
    syncEditorInputFromModel();
  }
}

function syncEditorInputFromModel() {
  if (!textInputEl) return;
  const selection = clampCursorIndex(cursorIndex);
  if (textInputEl.value !== labelText) {
    textInputEl.value = labelText;
  }
  try {
    textInputEl.setSelectionRange(selection, selection);
  } catch {}
}

function applyTextInputValue(nextValue) {
  const next = String(nextValue || "");
  const previous = labelText;
  if (next === previous) {
    cursorIndex = clampCursorIndex(Number(textInputEl?.selectionStart ?? cursorIndex));
    return;
  }

  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) {
    start++;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd--;
    nextEnd--;
  }

  const inserted = next.slice(start, nextEnd);
  let inputKind = "";
  if (previousEnd > start) {
    shiftStyleRangesForDelete(start, previousEnd);
    inputKind = "delete";
  }
  labelText = previous.slice(0, start) + inserted + previous.slice(previousEnd);
  if (inserted.length > 0) {
    shiftStyleRangesForInsert(start, inserted.length);
    applyPendingStyleToInsertedText(start, inserted.length);
    inputKind = inserted === "\n" ? "newline" : "insert";
  }
  cursorIndex = clampCursorIndex(Number(textInputEl?.selectionStart ?? (start + inserted.length)));
  detailText = inserted === "\n" ? "Inserted a new line." : "Typing into the label.";
  lastBridgeInput = { time: performance.now(), text: inserted, kind: inputKind };
  saveEditorState();
}

function isRecentBridgeInput(kind, text = "") {
  if (!lastBridgeInput.kind || lastBridgeInput.kind !== kind) return false;
  if (text && lastBridgeInput.text !== text) return false;
  return performance.now() - lastBridgeInput.time < 160;
}

function installKeyCapture() {
  window.addEventListener("keydown", (event) => {
    if (event.target === textInputEl) return;
    handleEditorKeydown(event);
  }, { passive: false });
  window.addEventListener("paste", handleEditorPaste, { passive: false });
}

function handleEditorPaste(event) {
  if (busy) {
    event.preventDefault();
    return;
  }
  const pastedImage = getClipboardImageFile(event.clipboardData);
  if (pastedImage) {
    event.preventDefault();
    event.stopPropagation();
    loadPhotoFile(pastedImage, pastedImage.name || "Pasted photo");
    if (textInputEl) textInputEl.value = "";
    return;
  }

  const pastedText = event.clipboardData?.getData("text/plain") || "";
  if (!pastedText) return;
  event.preventDefault();
  event.stopPropagation();
  insertTextAtCursor(pastedText.replace(/\r\n?/g, "\n"));
  if (textInputEl) textInputEl.value = "";
  detailText = "Pasted text into the label.";
}

function getClipboardImageFile(clipboardData) {
  const items = Array.from(clipboardData?.items || []);
  for (const item of items) {
    if (String(item.type || "").toLowerCase().startsWith("image/")) {
      const file = item.getAsFile?.();
      if (file) return file;
    }
  }

  const files = Array.from(clipboardData?.files || []);
  return files.find((file) => String(file.type || "").toLowerCase().startsWith("image/")) || null;
}

function handleEditorKeydown(event) {
  const altMod = !!(
    event.altKey ||
    (typeof event.getModifierState === "function" && (
      event.getModifierState("Alt") ||
      event.getModifierState("AltGraph")
    ))
  );
  const mod = !!(event.ctrlKey || event.metaKey);
  const keyStr = String(event.key || "");
  const isAltIncrease = altMod && (
    event.code === "NumpadAdd" ||
    event.code === "Equal" ||
    keyStr === "±" ||
    keyStr === "+"
  );
  const isAltDecrease = altMod && (
    event.code === "NumpadSubtract" ||
    event.code === "Minus" ||
    keyStr === "–" ||
    keyStr === "—" ||
    keyStr === "-"
  );
  const isAltReset = altMod && event.code === "Digit0";
  const isModIncrease = mod && (
    event.code === "NumpadAdd" ||
    event.code === "Equal" ||
    keyStr === "+" ||
    keyStr === "="
  );
  const isModDecrease = mod && (
    event.code === "NumpadSubtract" ||
    event.code === "Minus" ||
    keyStr === "-"
  );
  const isIncrease = isAltIncrease || isModIncrease;
  const isDecrease = isAltDecrease || isModDecrease;
  const isReset = isAltReset || (mod && (event.code === "Digit0" || event.key === "0"));

  if (isIncrease) {
    event.preventDefault();
    if (busy) return;
    adjustCurrentLineFontSize(+1);
    return;
  }
  if (isDecrease) {
    event.preventDefault();
    if (busy) return;
    adjustCurrentLineFontSize(-1);
    return;
  }
  if (isReset) {
    event.preventDefault();
    if (busy) return;
    resetCurrentLineFontSize();
    return;
  }
  if (mod && (keyStr === "b" || keyStr === "B")) {
    event.preventDefault();
    if (busy) return;
    toggleCurrentLineStyle("bold");
    return;
  }
  if (mod && (keyStr === "i" || keyStr === "I")) {
    event.preventDefault();
    if (busy) return;
    toggleCurrentLineStyle("italic");
    return;
  }
  if (mod && (keyStr === "u" || keyStr === "U")) {
    event.preventDefault();
    if (busy) return;
    toggleCurrentLineStyle("underline");
    return;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    if (busy) return;
    deleteBackward();
    return;
  }
  if (event.key === "Delete") {
    event.preventDefault();
    if (busy) return;
    deleteForward();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    if (busy) return;
    insertTextAtCursor("    ");
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (busy) return;
    insertTextAtCursor("\n");
    return;
  }
  if (event.key === " " && event.target !== textInputEl) {
    event.preventDefault();
    if (busy) return;
    insertTextAtCursor(" ");
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (busy) return;
    moveCursorHorizontal(-1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (busy) return;
    moveCursorHorizontal(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (busy) return;
    moveCursorVertical(-1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (busy) return;
    moveCursorVertical(1);
  }
}

function wrapTextToLines(textValue, maxWidth, options = {}) {
  const text = String(textValue || "");
  const lines = [];
  let currentText = "";
  let lineStart = 0;
  let index = 0;
  let logicalLineIndex = 0;
  const fixedFontSize = Number.isFinite(options.fixedFontSize) ? options.fixedFontSize : null;
  let currentFontSize = fixedFontSize || resolveLineFontSize(logicalLineIndex, "");
  applyLabelFontSize(currentFontSize);

  while (index < text.length) {
    const character = text[index];
    if (character === "\n") {
      lines.push(makeLine(currentText, lineStart, index, logicalLineIndex, currentFontSize));
      currentText = "";
      lineStart = index + 1;
      index += 1;
      logicalLineIndex += 1;
      currentFontSize = fixedFontSize || resolveLineFontSize(logicalLineIndex, "");
      applyLabelFontSize(currentFontSize);
      continue;
    }

    const candidate = currentText + character;
    const candidateFontSize = fixedFontSize || resolveLineFontSize(logicalLineIndex, candidate, maxWidth);
    const candidateWidth = measureStyledRangeWidth(lineStart, index + 1, candidateFontSize, candidate);
    const candidateRenderWidth = getRenderedLineWidth({
      text: candidate,
      start: lineStart,
      end: index + 1,
      fontSize: candidateFontSize,
    }, candidateWidth);
    if (currentText.length > 0 && candidateRenderWidth > maxWidth) {
      const breakAt = findBreakIndex(currentText);
      if (breakAt < currentText.length) {
        const lineText = currentText.slice(0, breakAt);
        lines.push(makeLine(lineText, lineStart, lineStart + breakAt, logicalLineIndex, currentFontSize));
        const remainder = currentText.slice(breakAt);
        const trimmed = currentText.length - remainder.length;
        currentText = remainder;
        lineStart += trimmed;
        continue;
      }

      lines.push(makeLine(currentText, lineStart, index, logicalLineIndex, currentFontSize));
      currentText = "";
      lineStart = index;
      continue;
    }

    currentText = candidate;
    currentFontSize = candidateFontSize;
    index += 1;
  }

  lines.push(makeLine(currentText, lineStart, text.length, logicalLineIndex, currentFontSize));
  return lines.length ? lines : [makeLine("", 0, 0, 0, getLineFontSize(0))];
}

function resolveLineFontSize(logicalLineIndex, textValue, maxWidth = null) {
  const baseSize = getLineFontSize(logicalLineIndex);
  if (!autoSizingEnabled || !Number.isFinite(maxWidth) || maxWidth <= 0) return baseSize;
  const hasManualSize = Object.prototype.hasOwnProperty.call(lineFontSizes, logicalLineIndex);
  const preferredSize = hasManualSize ? baseSize : maxFontSize;
  const autoStyle = isAutoLineBold(textValue) ? { bold: true, italic: false, underline: false } : null;
  return fitFontSizeToWidth(textValue, maxWidth, preferredSize, autoStyle);
}

function fitFontSizeToWidth(textValue, maxWidth, preferredSize, style = null) {
  const text = String(textValue || "");
  const size = constrain(preferredSize, minFontSize, maxFontSize);
  if (!text.length) return size;

  let low = 0;
  let high = 0;
  for (let i = 0; i < fontSizeScale.length; i += 1) {
    if (fontSizeScale[i] <= size) high = i;
  }
  let best = fontSizeScale[0];
  while (low <= high) {
    const mid = Math.floor((low + high) * 0.5);
    const candidateSize = fontSizeScale[mid];
    const widthValue = measureTextWidth(text, candidateSize, style);
    if (widthValue <= maxWidth) {
      best = candidateSize;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function findBreakIndex(text) {
  for (let index = text.length - 1; index > 0; index -= 1) {
    if (/\s/.test(text[index])) return index + 1;
  }
  return text.length;
}

function findCursorLocation(layout) {
  const index = clampCursorIndex(cursorIndex);
  for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex += 1) {
    const line = layout.lines[lineIndex];
    if (index >= line.start && index <= line.end) {
      return {
        lineIndex,
        line,
        prefix: line.text.slice(0, index - line.start),
      };
    }
  }
  const lastLine = layout.lines[layout.lines.length - 1];
  return {
    lineIndex: layout.lines.length - 1,
    line: lastLine,
    prefix: lastLine.text,
  };
}

function insertTextAtCursor(value) {
  const next = String(value || "");
  const index = clampCursorIndex(cursorIndex);
  labelText = labelText.slice(0, index) + next + labelText.slice(index);
  shiftStyleRangesForInsert(index, next.length);
  applyPendingStyleToInsertedText(index, next.length);
  cursorIndex = index + next.length;
  detailText = next === "\n" ? "Inserted a new line." : "Typing into the label.";
  saveEditorState();
}

function deleteBackward() {
  const index = clampCursorIndex(cursorIndex);
  if (index <= 0) return;
  shiftStyleRangesForDelete(index - 1, index);
  labelText = labelText.slice(0, index - 1) + labelText.slice(index);
  cursorIndex = index - 1;
  detailText = "Deleted one character.";
  saveEditorState();
}

function deleteForward() {
  const index = clampCursorIndex(cursorIndex);
  if (index >= labelText.length) return;
  shiftStyleRangesForDelete(index, index + 1);
  labelText = labelText.slice(0, index) + labelText.slice(index + 1);
  detailText = "Deleted one character.";
  saveEditorState();
}

function moveCursorHorizontal(delta) {
  cursorIndex = clampCursorIndex(cursorIndex + delta);
  detailText = "Moved cursor.";
  saveEditorState();
}

function moveCursorVertical(direction) {
  const draftBlock = getLabelTextBlockRect();
  const layout = fitTextLayout(labelText, draftBlock.width, draftBlock.height);
  const current = findCursorLocation(layout);
  const targetLineIndex = constrain(current.lineIndex + direction, 0, layout.lines.length - 1);
  if (targetLineIndex === current.lineIndex) return;

  const currentX = measureStyledRangeWidth(
    current.line.start,
    clampCursorIndex(cursorIndex),
    current.line.fontSize,
    current.line.text
  ) - getLineLeadingInkOffset(current.line);
  const targetLine = layout.lines[targetLineIndex];
  let bestOffset = 0;
  let bestDistance = Infinity;
  for (let offset = 0; offset <= targetLine.text.length; offset += 1) {
    const distance = Math.abs(
      measureStyledRangeWidth(
        targetLine.start,
        targetLine.start + offset,
        targetLine.fontSize,
        targetLine.text
      ) - getLineLeadingInkOffset(targetLine) - currentX
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOffset = offset;
    }
  }

  cursorIndex = targetLine.start + bestOffset;
  detailText = "Moved cursor.";
  saveEditorState();
}

function adjustCurrentLineFontSize(direction) {
  const logicalLineIndex = getLogicalLineIndexAtCursor();
  const next = getSteppedFontSize(getLineFontSize(logicalLineIndex), direction);
  autoSizingEnabled = false;
  lineFontSizes[logicalLineIndex] = next;
  detailText = `Line ${logicalLineIndex + 1} size: ${next}`;
  saveEditorState();
}

function resetCurrentLineFontSize() {
  const logicalLineIndex = getLogicalLineIndexAtCursor();
  autoSizingEnabled = false;
  delete lineFontSizes[logicalLineIndex];
  detailText = `Line ${logicalLineIndex + 1} size reset`;
  saveEditorState();
}

function toggleCurrentLineStyle(styleKey) {
  const target = getStyleToggleTarget();
  if (!target) return;

  const styleLabel = styleKey === "underline" ? "underline" : styleKey;
  if (target.mode === "pending") {
    pendingTextStyle[styleKey] = !pendingTextStyle[styleKey];
    detailText = `${pendingTextStyle[styleKey] ? "Armed" : "Stopped"} ${styleLabel}.`;
    saveEditorState();
    return;
  }

  const active = isRangeFullyStyled(styleKey, target.start, target.end);
  setStyleForRange(styleKey, target.start, target.end, !active);
  detailText = `${active ? "Removed" : "Applied"} ${styleLabel}.`;
  saveEditorState();
}

function getLogicalLineIndexAtCursor() {
  const prefix = labelText.slice(0, clampCursorIndex(cursorIndex));
  return prefix.split("\n").length - 1;
}

function clampCursorIndex(index) {
  return constrain(index, 0, labelText.length);
}

function getLineFontSize(logicalLineIndex) {
  return constrain(lineFontSizes[logicalLineIndex] || defaultFontSize, minFontSize, maxFontSize);
}

function getLineTextStyle(logicalLineIndex) {
  return {
    bold: false,
    italic: false,
    underline: false,
  };
}

function getEditorFontOption() {
  return fontOptions.find((option) => option.key === editorFontMode) || fontOptions[0];
}

function getEditorFontLabel() {
  return getEditorFontOption().label;
}

function getEditorFontResource() {
  const option = getEditorFontOption();
  if (option.key === "helvetica") return "Helvetica";
  if (option.key === "terminus") return terminusFont || fallbackFontFamily;
  if (option.key === "perfectdos") return perfectDosFont || fallbackFontFamily;
  return option.family || fallbackFontFamily;
}

function applyEditorFont(target = window, fontSize = null) {
  const resource = getEditorFontResource();
  if (typeof target?.textFont === "function" && resource) {
    target.textFont(resource);
  }
  if (fontSize != null && typeof target?.textSize === "function") {
    target.textSize(fontSize);
  }
  if (target?.drawingContext) {
    target.drawingContext.fontKerning = "none";
  }
}

function toggleEditorFont() {
  const currentIndex = fontOptions.findIndex((option) => option.key === editorFontMode);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % fontOptions.length : 0;
  const wasAutoSizing = autoSizingEnabled;
  editorFontMode = fontOptions[nextIndex].key;
  if (wasAutoSizing) {
    lineFontSizes = {};
  }
  applyEditorFont();
  rebuildLabelGraphic();
  detailText = `Font: ${getEditorFontLabel()}`;
  saveEditorState();
}

function getSteppedFontSize(currentSize, direction) {
  const size = constrain(currentSize, minFontSize, maxFontSize);
  if (direction > 0) {
    return fontSizeScale.find((entry) => entry > size) || fontSizeScale[fontSizeScale.length - 1];
  }
  if (direction < 0) {
    for (let index = fontSizeScale.length - 1; index >= 0; index -= 1) {
      if (fontSizeScale[index] < size) return fontSizeScale[index];
    }
    return fontSizeScale[0];
  }
  return size;
}

function applyLabelFontSize(fontSize) {
  applyEditorFont(labelGraphic, fontSize);
}

function applyLineTextStyle(style) {
  labelGraphic.textStyle(NORMAL);
}

function isAutoLineBold(textValue) {
  if (!autoSizingEnabled) return false;
  const normalized = String(textValue || "").trim();
  return normalized.length > 0 && normalized.length <= 14;
}

function drawStyledLine(line, y, startX = getLabelTextRect().x, target = labelGraphic) {
  const segments = getLineSegments(line.start, line.end, line.text);
  const autoLineBold = isAutoLineBold(line.text);
  let x = startX - getLineLeadingInkOffset(line);
  
  for (const segment of segments) {
    const textValue = segment.text || " ";
    const style = segment.style || {};
    const mergedStyle = {
      bold: !!(style.bold || autoLineBold),
      italic: !!style.italic,
      underline: !!style.underline,
    };
    const whitespaceOnly = isWhitespaceOnly(textValue);
    const renderStyle = whitespaceOnly
      ? { bold: false, italic: false, underline: false }
      : mergedStyle;
    const widthValue = whitespaceOnly
      ? measureWhitespaceWidth(textValue, line.fontSize)
      : measureTextWidth(textValue, line.fontSize, renderStyle);

    target.push();
    applyEditorFont(target, line.fontSize);
    target.textLeading(line.lineHeight);
    applySegmentTextStyle(renderStyle, target);
    if (!whitespaceOnly) {
      drawTextWithOutlineMode(textValue, x, y, line.fontSize, target);
      
    }
    target.pop();

    if (mergedStyle.underline) {
      const underlineY = y + line.fontSize * 0.9;
      target.stroke(0);
      target.strokeWeight(Math.max(1, line.fontSize * 0.03));
      target.line(x, underlineY, x + widthValue, underlineY);
      target.noStroke();
    }

    x += widthValue;
  }
}

function drawTextWithOutlineMode(text, x, y, fontSize, target = labelGraphic) {
  
  const outlineWeight = getTextOutlineWeight(fontSize);
  if (textOutlineMode === "outline") {
    target.noFill();
    target.stroke(getInkColor());
    target.strokeWeight(outlineWeight);
    target.text(text, x, y);
    return;
  }
  if (textOutlineMode === "opposite") {
    const fillColor = getOppositeTextFillColor();
    const strokeColor = getOppositeTextStrokeColor();
    target.fill(fillColor);
    target.noStroke();
    target.text(text, x, y);
    if (fillColor === strokeColor) return;
    target.noFill();
    target.stroke(strokeColor);
    target.strokeWeight(outlineWeight);
    target.text(text, x, y);
    return;
  }
  target.fill(getInkColor());
  target.noStroke();
  target.text(text, x, y);
}

function getTextOutlineWeight(fontSize) {
  return 14 / 850 * fontSize;
}

function drawCharacterBoundaryDebug(line, y, startX = getLabelTextRect().x, target = labelGraphic) {
  const textValue = String(line?.text || "");
  if (!textValue.length) return;

  target.push();
  target.stroke(0, 92, 255);
  target.strokeWeight(Math.max(1, line.fontSize * 0.012));
  target.noFill();

  const renderedStartX = getRenderedLineStartX(line, startX);
  const top = y + getCaretVisualOffset(line.fontSize);
  const bottom = top + getCaretVisualHeight(line.fontSize);
  for (const boundary of getCharacterBoundaryOffsets(line)) {
    const x = renderedStartX + boundary.x;
    target.line(x, top, x, bottom);
  }
  target.pop();
}

function getRenderedLineStartX(line, startX = 0) {
  return startX - getLineLeadingInkOffset(line);
}

function applySegmentTextStyle(style, target = labelGraphic) {
  let textStyleValue = NORMAL;
  if (style?.bold && style?.italic) {
    textStyleValue = BOLDITALIC;
  } else if (style?.bold) {
    textStyleValue = BOLD;
  } else if (style?.italic) {
    textStyleValue = ITALIC;
  }
 // target.textStyle(textStyleValue);
  applyCanvasMaxBoldWeight(style, target);
}

function applyCanvasMaxBoldWeight(style, target = labelGraphic) {
  const context = target?.drawingContext;
  if (!context || !style?.bold || typeof context.font !== "string") return;
  const previous = context.font;
  const weighted = previous.replace(/\b(normal|bold|bolder|lighter|[1-9]00)\b(?=\s)/, "900");
  context.font = weighted === previous ? `900 ${previous}` : weighted;
}

function measureTextWidth(text, fontSize = defaultFontSize, style = null) {
  applyLabelFontSize(fontSize);
  applySegmentTextStyle(style);
  const safeText = String(text ?? "").replace(/ /g, "\u00A0");
  const metric = labelGraphic.drawingContext?.measureText?.(safeText);
  const widthValue = Number.isFinite(metric?.width) ? metric.width : labelGraphic.textWidth(safeText);
  return widthValue;
}

function getLineLeadingInkOffset(line) {
  const textValue = String(line?.text || "");
  if (!textValue.length) return 0;

  const autoLineBold = isAutoLineBold(textValue);
  for (let offset = 0; offset < textValue.length; offset += 1) {
    const char = textValue[offset];
    if (isWhitespaceOnly(char)) continue;

    const style = getStyleAtIndex(line.start + offset);
    const mergedStyle = {
      bold: !!(style.bold || autoLineBold),
      italic: !!style.italic,
      underline: !!style.underline,
    };
    return measureGlyphInkLeftOffset(char, line.fontSize, mergedStyle);
  }

  return 0;
}

function getRenderedLineWidth(line, measuredWidth = null) {
  const widthValue = Number.isFinite(measuredWidth)
    ? measuredWidth
    : measureStyledRangeWidth(line.start, line.end, line.fontSize, line.text);
  return Math.max(0, widthValue - getLineLeadingInkOffset(line));
}

function measureGlyphInkLeftOffset(char, fontSize, style = null) {
  applyLabelFontSize(fontSize);
  applySegmentTextStyle(style);
  const metric = labelGraphic.drawingContext?.measureText?.(String(char ?? ""));
  if (Number.isFinite(metric?.actualBoundingBoxLeft)) {
    return constrain(Math.max(0, -metric.actualBoundingBoxLeft), 0, fontSize * 0.25);
  }
  if (editorFontMode === "perfectdos") return fontSize * 0.05;
  return 0;
}

function makeLine(text, start, end, logicalLineIndex, fontSize) {
  return {
    text,
    start,
    end,
    logicalLineIndex,
    fontSize,
    lineHeight: fontSize * lineHeightFactor,
  };
}

function describeLineStyle(style) {
  const parts = [];
  if (style.bold) parts.push("bold");
  if (style.italic) parts.push("italic");
  if (style.underline) parts.push("underline");
  if (parts.length) return parts.join(" ");
  return "regular";
}

function updateCaretBlink() {
  const now = millis();
  if (now - lastCaretToggleMs < 500) return;
  caretWhite = !caretWhite;
  lastCaretToggleMs = now;
}

function getEditorSnapshot() {
  return {
    text: labelText,
    cursorIndex,
    lineFontSizes: cloneJson(lineFontSizes, {}),
    textStyleRanges: cloneJson(textStyleRanges, { bold: [], italic: [], underline: [] }),
    pendingTextStyle: cloneJson(pendingTextStyle, { bold: false, italic: false, underline: false }),
    labelFormat,
    orientation,
    editorFontMode,
    autoSizingEnabled,
    peerHostnames,
    labelPaddingMode,
    labelQrText,
    photoMergeMode,
    photoGrayscaleEnabled,
    labelInverted,
    textOutlineMode,
    textEffectMode,
    photoOffsetX,
    photoOffsetY,
    photoEnabled: !!photoEnabled,
    photoDataUrl: hasStoredPhoto() ? getStoredPhotoDataUrl() : "",
    photoDataRef: hasStoredPhoto() ? editorPhotoStorageId : "",
    photoName: droppedPhotoName,
  };
}

function applyEditorSnapshot(data = {}, options = {}) {
  photoLoadToken += 1;
  const snapshotToken = photoLoadToken;
  stopPhotoCamera();
  photoEnabled = false;
  photoCameraStarting = false;
  labelText = typeof data.text === "string" ? data.text : "";
  cursorIndex = clampCursorIndex(Number.isFinite(data.cursorIndex) ? data.cursorIndex : labelText.length);
  lineFontSizes = data.lineFontSizes && typeof data.lineFontSizes === "object" ? cloneJson(data.lineFontSizes, {}) : {};
  textStyleRanges = sanitizeTextStyleRanges(data.textStyleRanges);
  pendingTextStyle = sanitizePendingTextStyle(data.pendingTextStyle);
  labelFormat = labelFormats[data.labelFormat] ? data.labelFormat : "10x15";
  orientation = data.orientation === "portrait" ? "portrait" : "landscape";
  editorFontMode = fontOptions.some((option) => option.key === data.editorFontMode)
    ? data.editorFontMode
    : "helvetica";
  autoSizingEnabled = data.autoSizingEnabled !== false;
  labelPaddingMode = labelPaddingModes.includes(data.labelPaddingMode) ? data.labelPaddingMode : "minimal";
  labelQrText = typeof data.labelQrText === "string" ? data.labelQrText : "";
  labelQrCode = labelQrText ? createQRCode(labelQrText) : null;
  photoMergeMode = normalizePhotoMergeMode(data.photoMergeMode);
  photoGrayscaleEnabled = data.photoGrayscaleEnabled !== false;
  labelInverted = !!data.labelInverted || data.photoMergeMode === "black" || data.photoMergeMode === "white" || data.photoMergeMode === "noditherwhite";
  textOutlineMode = textOutlineModes.includes(data.textOutlineMode) ? data.textOutlineMode : "none";
  textEffectMode = normalizeTextEffectMode(data.textEffectMode);
  photoOffsetX = Number.isFinite(data.photoOffsetX) ? data.photoOffsetX : 0;
  photoOffsetY = Number.isFinite(data.photoOffsetY) ? data.photoOffsetY : 0;
  droppedPhotoImage = null;
  droppedPhotoName = "";
  storedPhotoDataUrl = "";
  applyEditorFont();
  rebuildLabelGraphic();

  if (options.preloadedPhoto?.image) {
    applyLoadedPhotoImage(
      options.preloadedPhoto.image,
      options.preloadedPhoto.name || data.photoName || "Print history photo",
      {
        saveAfterLoad: !!options.saveAfterLoad,
      }
    );
  } else if (data.photoDataUrl) {
    restorePhotoDataUrl(data.photoDataUrl, data.photoName || "Print history photo", "history photo", { saveAfterLoad: true });
  } else if (data.photoDataRef) {
    pendingPhotoRestore = true;
    loadEditorPhotoDataUrl(data.photoDataRef)
      .then((dataUrl) => {
        if (snapshotToken !== photoLoadToken) return;
        if (dataUrl) {
          restorePhotoDataUrl(dataUrl, data.photoName || "Print history photo", "history photo", { saveAfterLoad: true });
        } else {
          pendingPhotoRestore = false;
        }
      })
      .catch((error) => {
        if (snapshotToken === photoLoadToken) pendingPhotoRestore = false;
        console.warn(`[labelmaker2] history photo sidecar failed: ${formatErrorMessage(error)}`);
      });
  } else {
    pendingPhotoRestore = false;
  }
}

function recordPrintHistory() {
  const state = getEditorSnapshot();
  const lastState = printHistory.length ? printHistory[printHistory.length - 1]?.state : null;
  if (lastState && areHistoryStatesEqual(lastState, state)) {
    printHistoryIndex = printHistory.length - 1;
    syncPrintHistorySlider();
    return false;
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    printedAt: new Date().toISOString(),
    state,
  };
  if (entry.state.photoDataUrl) {
    const photoRef = `history:${entry.id}`;
    storeEditorPhotoDataUrl(entry.state.photoDataUrl, photoRef);
    entry.state = {
      ...entry.state,
      photoDataUrl: "",
      photoDataRef: photoRef,
    };
  }
  printHistory.push(entry);
  printHistoryIndex = printHistory.length - 1;
  savePrintHistory();
  syncPrintHistorySlider();
  return true;
}

function areHistoryStatesEqual(a, b) {
  return JSON.stringify(getComparableHistoryState(a)) === JSON.stringify(getComparableHistoryState(b));
}

function getComparableHistoryState(state = {}) {
  const comparable = cloneJson(state, {});
  delete comparable.cursorIndex;
  delete comparable.pendingTextStyle;
  delete comparable.photoName;
  return comparable;
}

function restorePrintHistoryIndex(index) {
  if (!printHistory.length) return;
  const nextIndex = constrain(index, 0, printHistory.length - 1);
  const entry = printHistory[nextIndex];
  if (!entry?.state) return;
  const state = entry.state;
  if (state.photoDataUrl || state.photoDataRef) {
    const restoreToken = ++historyRestoreToken;
    detailText = `Loading print ${nextIndex + 1}/${printHistory.length}...`;
    loadHistoryPhotoDataUrl(state)
      .then((dataUrl) => loadPhotoImageFromDataUrl(dataUrl, "history photo"))
      .then((imageValue) => {
        if (restoreToken !== historyRestoreToken) return;
        applyEditorSnapshot(state, {
          preloadedPhoto: {
            image: imageValue,
            name: state.photoName || "Print history photo",
          },
          saveAfterLoad: true,
        });
        printHistoryIndex = nextIndex;
        syncPrintHistorySlider();
        detailText = `Loaded print ${nextIndex + 1}/${printHistory.length}.`;
      })
      .catch((error) => {
        if (restoreToken !== historyRestoreToken) return;
        detailText = `Could not load print ${nextIndex + 1}/${printHistory.length}.`;
        console.warn(`[labelmaker2] history photo load failed: ${formatErrorMessage(error)}`);
      });
    return;
  }
  printHistoryIndex = nextIndex;
  historyRestoreToken += 1;
  applyEditorSnapshot(state);
  saveEditorState();
  syncPrintHistorySlider();
  detailText = `Loaded print ${nextIndex + 1}/${printHistory.length}.`;
}

function syncPrintHistorySlider() {
  if (typeof uiSetState !== "function") return;
  uiSetState(printHistorySliderKey, Math.max(0, printHistoryIndex), { persist: false });
}

function confirmAndClearPrintHistory() {
  if (!printHistory.length) return;
  const ok = window.confirm(`Clear ${printHistory.length} saved print${printHistory.length === 1 ? "" : "s"}?`);
  if (!ok) return;
  for (const entry of printHistory) {
    if (entry?.state?.photoDataRef && entry.state.photoDataRef !== editorPhotoStorageId) {
      deleteEditorPhotoDataUrl(entry.state.photoDataRef);
    }
  }
  printHistory = [];
  printHistoryIndex = -1;
  syncPrintHistorySlider();
  savePrintHistory();
  detailText = "Cleared print history.";
}

function savePrintHistory() {
  try {
    localStorage.setItem(printHistoryStorageKey, JSON.stringify(printHistory));
    prunePrintHistoryIfStoragePressure();
  } catch {
    prunePrintHistoryUntilWritable();
  }
}

function prunePrintHistoryUntilWritable() {
  while (printHistory.length > 1) {
    const removeCount = Math.max(1, Math.ceil(printHistory.length * 0.1));
    const removed = printHistory.slice(0, removeCount);
    for (const entry of removed) {
      if (entry?.state?.photoDataRef && entry.state.photoDataRef !== editorPhotoStorageId) {
        deleteEditorPhotoDataUrl(entry.state.photoDataRef);
      }
    }
    printHistory = printHistory.slice(removeCount);
    printHistoryIndex = printHistory.length ? printHistory.length - 1 : -1;
    syncPrintHistorySlider();
    try {
      localStorage.setItem(printHistoryStorageKey, JSON.stringify(printHistory));
      detailText = `History trimmed to ${printHistory.length} items because storage was full.`;
      return;
    } catch {}
  }
}

function prunePrintHistoryIfStoragePressure() {
  if (!navigator?.storage?.estimate) return;
  navigator.storage.estimate().then((estimate) => {
    const usage = Number(estimate?.usage || 0);
    const quota = Number(estimate?.quota || 0);
    if (!quota || usage / quota < printHistoryStoragePressureLimit) return;
    const removeCount = Math.max(1, Math.ceil(printHistory.length * 0.1));
    const removed = printHistory.slice(0, removeCount);
    for (const entry of removed) {
      if (entry?.state?.photoDataRef && entry.state.photoDataRef !== editorPhotoStorageId) {
        deleteEditorPhotoDataUrl(entry.state.photoDataRef);
      }
    }
    printHistory = printHistory.slice(removeCount);
    printHistoryIndex = printHistory.length ? Math.min(printHistoryIndex, printHistory.length - 1) : -1;
    syncPrintHistorySlider();
    try {
      localStorage.setItem(printHistoryStorageKey, JSON.stringify(printHistory));
    } catch {
      prunePrintHistoryUntilWritable();
    }
  }).catch(() => {});
}

function loadPrintHistory() {
  try {
    const raw = localStorage.getItem(printHistoryStorageKey);
    if (!raw) return;
    const data = JSON.parse(raw);
    printHistory = Array.isArray(data)
      ? data.filter((entry) => entry?.state)
      : [];
    printHistoryIndex = printHistory.length ? printHistory.length - 1 : -1;
    syncPrintHistorySlider();
  } catch {
    printHistory = [];
    printHistoryIndex = -1;
  }
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function formatErrorMessage(error) {
  return error?.message || String(error || "");
}

function openEditorPhotoDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(editorPhotoDbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(editorPhotoStoreName)) {
        request.result.createObjectStore(editorPhotoStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open photo store"));
  });
}

async function withEditorPhotoStore(mode, callback) {
  const db = await openEditorPhotoDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(editorPhotoStoreName, mode);
      const store = transaction.objectStore(editorPhotoStoreName);
      const request = callback(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || transaction.error || new Error("Photo store request failed"));
    });
  } finally {
    db.close();
  }
}

function storeEditorPhotoDataUrl(dataUrl, id = editorPhotoStorageId) {
  if (!dataUrl) return deleteEditorPhotoDataUrl(id);
  return withEditorPhotoStore("readwrite", (store) => store.put(dataUrl, id))
    .catch((error) => console.warn(`[labelmaker2] photo sidecar save failed: ${formatErrorMessage(error)}`));
}

function loadEditorPhotoDataUrl(id = editorPhotoStorageId) {
  return withEditorPhotoStore("readonly", (store) => store.get(id));
}

function deleteEditorPhotoDataUrl(id = editorPhotoStorageId) {
  return withEditorPhotoStore("readwrite", (store) => store.delete(id))
    .catch(() => {});
}

async function loadHistoryPhotoDataUrl(state = {}) {
  if (state.photoDataUrl) return state.photoDataUrl;
  if (!state.photoDataRef) throw new Error("History entry has no photo reference");
  const dataUrl = await loadEditorPhotoDataUrl(state.photoDataRef);
  if (!dataUrl) throw new Error("History photo sidecar is missing");
  return dataUrl;
}

function loadPhotoImageFromDataUrl(dataUrl, errorLabel = "photo") {
  return new Promise((resolve, reject) => {
    if (!dataUrl) {
      reject(new Error(`Missing ${errorLabel} data`));
      return;
    }
    loadImage(
      dataUrl,
      (imageValue) => resolve(imageValue),
      (error) => reject(error || new Error(`Could not load ${errorLabel}`))
    );
  });
}

function saveEditorState() {
  markLabelDirty();
  syncEditorInputFromModel();
  const photoDataUrl = hasStoredPhoto() ? getStoredPhotoDataUrl() : "";
  const state = {
    text: labelText,
    cursorIndex,
    lineFontSizes,
    textStyleRanges,
    pendingTextStyle,
    labelFormat,
    orientation,
    editorFontMode,
    autoSizingEnabled,
    peerHostnames,
    labelPaddingMode,
    labelQrText,
    photoMergeMode,
    photoGrayscaleEnabled,
    labelInverted,
    textOutlineMode,
    textEffectMode,
    photoOffsetX,
    photoOffsetY,
    photoEnabled: !!photoEnabled,
    photoDataUrl,
    photoDataRef: photoDataUrl ? editorPhotoStorageId : "",
    photoName: droppedPhotoName,
  };
  if (photoDataUrl) {
    storeEditorPhotoDataUrl(photoDataUrl);
  } else if (!pendingPhotoRestore) {
    deleteEditorPhotoDataUrl();
  }

  const localState = {
    ...state,
    photoDataUrl: photoDataUrl && photoDataUrl.length <= 350000 ? photoDataUrl : "",
  };

  try {
    localStorage.setItem(storageKey, JSON.stringify(localState));
    editorStatePhotoStorageDropped = false;
  } catch (error) {
    if (photoDataUrl) {
      const compactState = {
        ...state,
        photoDataUrl: "",
        photoDataRef: editorPhotoStorageId,
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(compactState));
        if (!editorStatePhotoStorageDropped) {
          console.warn("[labelmaker2] editor state photo saved in IndexedDB sidecar");
        }
        editorStatePhotoStorageDropped = true;
        return;
      } catch (retryError) {
        console.warn(`[labelmaker2] compact editor state save failed: ${formatErrorMessage(retryError)}`);
        return;
      }
    }
    console.warn(`[labelmaker2] editor state save failed: ${formatErrorMessage(error)}`);
  }
}

function loadEditorState() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const data = JSON.parse(raw);
    labelText = typeof data.text === "string" ? data.text : "";
    cursorIndex = clampCursorIndex(Number.isFinite(data.cursorIndex) ? data.cursorIndex : labelText.length);
    lineFontSizes = data.lineFontSizes && typeof data.lineFontSizes === "object" ? data.lineFontSizes : {};
    textStyleRanges = sanitizeTextStyleRanges(data.textStyleRanges);
    pendingTextStyle = sanitizePendingTextStyle(data.pendingTextStyle);
    labelFormat = labelFormats[data.labelFormat] ? data.labelFormat : "10x15";
    orientation = data.orientation === "portrait" ? "portrait" : "landscape";
    editorFontMode = fontOptions.some((option) => option.key === data.editorFontMode)
      ? data.editorFontMode
      : "helvetica";
    autoSizingEnabled = data.autoSizingEnabled !== false;
    peerHostnames = sanitizePeerHostnames(data.peerHostnames);
    labelPaddingMode = labelPaddingModes.includes(data.labelPaddingMode) ? data.labelPaddingMode : "minimal";
    labelQrText = typeof data.labelQrText === "string" ? data.labelQrText : "";
    labelQrCode = labelQrText ? createQRCode(labelQrText) : null;
    photoMergeMode = normalizePhotoMergeMode(data.photoMergeMode);
    photoGrayscaleEnabled = data.photoGrayscaleEnabled !== false;
    labelInverted = !!data.labelInverted || data.photoMergeMode === "black" || data.photoMergeMode === "white" || data.photoMergeMode === "noditherwhite";
    textOutlineMode = textOutlineModes.includes(data.textOutlineMode) ? data.textOutlineMode : "none";
    textEffectMode = normalizeTextEffectMode(data.textEffectMode);
    photoOffsetX = Number.isFinite(data.photoOffsetX) ? data.photoOffsetX : 0;
    photoOffsetY = Number.isFinite(data.photoOffsetY) ? data.photoOffsetY : 0;
    photoEnabled = false;
    photoCameraStarting = false;
    droppedPhotoImage = null;
    droppedPhotoName = "";
    storedPhotoDataUrl = "";
    restoreLiveCameraOnSetup = data.photoEnabled === true && !data.photoDataUrl && !data.photoDataRef;
    if (data.photoDataUrl) {
      restorePhotoDataUrl(data.photoDataUrl, data.photoName || "Stored photo", "stored photo");
    } else if (data.photoDataRef) {
      photoLoadToken += 1;
      const restoreToken = photoLoadToken;
      pendingPhotoRestore = true;
      loadEditorPhotoDataUrl(data.photoDataRef)
        .then((dataUrl) => {
          if (restoreToken !== photoLoadToken) return;
          if (dataUrl) {
            restorePhotoDataUrl(dataUrl, data.photoName || "Stored photo", "stored photo");
          } else {
            pendingPhotoRestore = false;
          }
        })
        .catch((error) => {
          if (restoreToken === photoLoadToken) pendingPhotoRestore = false;
          console.warn(`[labelmaker2] stored photo sidecar failed: ${formatErrorMessage(error)}`);
        });
    } else {
      pendingPhotoRestore = false;
    }
  } catch {}
}

function restorePhotoDataUrl(dataUrl, photoName = "Stored photo", errorLabel = "stored photo", options = {}) {
  const loadToken = ++photoLoadToken;
  pendingPhotoRestore = true;
  loadImage(
    dataUrl,
    (imageValue) => {
      if (loadToken !== photoLoadToken) {
        return;
      }
      applyLoadedPhotoImage(imageValue, photoName, options);
    },
    (error) => {
      if (loadToken === photoLoadToken) pendingPhotoRestore = false;
      console.error(`[labelmaker2] ${errorLabel} failed`, error);
    }
  );
}

function applyLoadedPhotoImage(imageValue, photoName = "Stored photo", options = {}) {
  pendingPhotoRestore = false;
  droppedPhotoImage = resizePhotoImageToLabelLimit(imageValue);
  droppedPhotoName = photoName;
  storedPhotoDataUrl = capturePhotoSourceDataUrl(droppedPhotoImage);
  photoRevision += 1;
  markLabelDirty();
  if (options.saveAfterLoad) {
    saveEditorState();
  }
}

function clearEditor() {
  recordPrintHistory();
  photoLoadToken += 1;
  pendingPhotoRestore = false;
  labelText = "";
  cursorIndex = labelText.length;
  lineFontSizes = {};
  textStyleRanges = {
    bold: [],
    italic: [],
    underline: [],
  };
  pendingTextStyle = {
    bold: false,
    italic: false,
    underline: false,
  };
  labelQrText = "";
  labelQrCode = null;
  stopPhotoCamera();
  photoEnabled = false;
  photoCameraStarting = false;
  droppedPhotoImage = null;
  droppedPhotoName = "";
  storedPhotoDataUrl = "";
  deleteEditorPhotoDataUrl();
  photoOffsetX = 0;
  photoOffsetY = 0;
  photoRevision += 1;
  autoSizingEnabled = true;
  photoGrayscaleEnabled = true;
  textOutlineMode = "none";
  textEffectMode = "none";
  markLabelDirty();
  detailText = "Cleared label.";
  saveEditorState();
}

function toggleLabelFormat() {
  labelFormat = labelFormat === "10x15" ? "10x10" : "10x15";
  rebuildLabelGraphic();
  saveEditorState();
}

function toggleOrientation() {
  orientation = orientation === "portrait" ? "landscape" : "portrait";
  rebuildLabelGraphic();
  saveEditorState();
}

function toggleOutputMode() {
  outputModeAuto = false;
  outputMode = outputMode === "receipt" ? "label" : "receipt";
  detailText = outputMode === "receipt"
    ? "Manual receipt mode. Press Print to send ESC/POS raster."
    : "Manual label mode. Press Print to send TSPL bitmap.";
}

function toggleLabelPadding() {
  const currentIndex = Math.max(0, labelPaddingModes.indexOf(labelPaddingMode));
  labelPaddingMode = labelPaddingModes[(currentIndex + 1) % labelPaddingModes.length];
  detailText = `Padding: ${labelPaddingMode}.`;
  saveEditorState();
}

function promptForQrCode() {
  if (labelQrText) {
    labelQrText = "";
    labelQrCode = null;
    detailText = "Removed QR code.";
    saveEditorState();
    return;
  }

  const value = window.prompt("QR code text or URL", "");
  if (value === null) return;
  const trimmed = String(value).trim();
  if (!trimmed) return;
  try {
    labelQrCode = createQRCode(trimmed);
    labelQrText = trimmed;
    detailText = "Added QR code.";
    saveEditorState();
  } catch (error) {
    console.error("[labelmaker2] QR code failed", error);
    detailText = error?.message || "Could not create QR code.";
  }
}

function handlePhotoDrop(file) {
  if (!file?.data || !isDroppedImageFile(file)) {
    detailText = "Drop an image file to use it as the photo.";
    return;
  }

  loadPhotoDataUrl(file.data, file.name || "Dropped photo");
}

function loadPhotoFile(file, fallbackName = "Pasted photo") {
  if (!file || !String(file.type || "").toLowerCase().startsWith("image/")) {
    detailText = "Paste an image to use it as the photo.";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    loadPhotoDataUrl(String(reader.result || ""), file.name || fallbackName);
  };
  reader.onerror = () => {
    detailText = "Could not read pasted photo.";
  };
  reader.readAsDataURL(file);
}

function loadPhotoDataUrl(dataUrl, photoName = "Photo") {
  if (!dataUrl) {
    detailText = "Could not load photo.";
    return;
  }

  const loadToken = ++photoLoadToken;
  pendingPhotoRestore = true;
  loadImage(
    dataUrl,
    (imageValue) => {
      if (loadToken !== photoLoadToken) {
        return;
      }
      pendingPhotoRestore = false;
      stopPhotoCamera();
      photoEnabled = false;
      droppedPhotoImage = resizePhotoImageToLabelLimit(imageValue);
      droppedPhotoName = photoName;
      storedPhotoDataUrl = capturePhotoSourceDataUrl(droppedPhotoImage);
      photoOffsetX = 0;
      photoOffsetY = 0;
      photoRevision += 1;
      markLabelDirty();
      detailText = `Photo loaded: ${droppedPhotoName}.`;
      saveEditorState();
    },
    (error) => {
      if (loadToken === photoLoadToken) pendingPhotoRestore = false;
      console.error("[labelmaker2] dropped photo failed", error);
      detailText = "Could not load photo.";
    }
  );
}

function isDroppedImageFile(file) {
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  return type.startsWith("image") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
}

async function togglePhotoCamera() {
  if (photoEnabled) {
    stopPhotoCamera();
    photoEnabled = false;
    markLabelDirty();
    detailText = "Photo mode off.";
    saveEditorState();
    return;
  }

  await startPhotoCamera({ clearStoredPhoto: true, detail: "Starting camera..." });
}

async function startPhotoCamera({ clearStoredPhoto = true, detail = "Starting camera..." } = {}) {
  photoCameraStarting = true;
  detailText = detail;
  try {
    cam = await setupWebcamera(false, 1280, 720, false, false);
    if (clearStoredPhoto) {
      droppedPhotoImage = null;
      droppedPhotoName = "";
      storedPhotoDataUrl = "";
      photoOffsetX = 0;
      photoOffsetY = 0;
      photoRevision += 1;
    }
    photoEnabled = true;
    markLabelDirty();
    detailText = "Photo mode on. Press Print to capture the live view.";
    saveEditorState();
  } catch (error) {
    console.error("[labelmaker2] camera failed", error);
    detailText = error?.message || "Could not start camera.";
    photoEnabled = false;
  } finally {
    photoCameraStarting = false;
  }
}

function stopPhotoCamera() {
  try {
    const stream = cam?.elt?.srcObject;
    if (stream && typeof stream.getTracks === "function") {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    if (typeof cam?.remove === "function") {
      cam.remove();
    }
  } catch {}
  cam = null;
}

function togglePhotoMergeMode() {
  const currentIndex = Math.max(0, photoMergeModes.indexOf(photoMergeMode));
  photoMergeMode = photoMergeModes[(currentIndex + 1) % photoMergeModes.length];
  detailText = `Photo: ${getPhotoMergeModeLabel()}.`;
  markLabelDirty();
  saveEditorState();
}

function togglePhotoGrayscale() {
  photoGrayscaleEnabled = !photoGrayscaleEnabled;
  detailText = photoGrayscaleEnabled ? "Photo grayscale on." : "Photo grayscale off.";
  markLabelDirty();
  saveEditorState();
}

function toggleInvertMode() {
  labelInverted = !labelInverted;
  detailText = labelInverted ? "Inverted label." : "Normal label.";
  markLabelDirty();
  saveEditorState();
}

function toggleTextOutlineMode() {
  const currentIndex = Math.max(0, textOutlineModes.indexOf(textOutlineMode));
  textOutlineMode = textOutlineModes[(currentIndex + 1) % textOutlineModes.length];
  detailText = `Text: ${getTextOutlineModeLabel()}.`;
  markLabelDirty();
  saveEditorState();
}

function getTextOutlineModeIcon() {
  if (textOutlineMode === "outline") return "format_color_text";
  if (textOutlineMode === "opposite") return "format_color_fill";
  return "title";
}

function getTextOutlineModeLabel() {
  if (textOutlineMode === "outline") return "outline";
  if (textOutlineMode === "opposite") return "opposite outline";
  return "filled";
}

function toggleTextEffectMode() {
  const currentIndex = Math.max(0, textEffectModes.indexOf(textEffectMode));
  textEffectMode = textEffectModes[(currentIndex + 1) % textEffectModes.length];
  detailText = `Text FX: ${getTextEffectModeLabel()}.`;
  markLabelDirty();
  saveEditorState();
}

function normalizeTextEffectMode(mode) {
  return textEffectModes.includes(mode) ? mode : "none";
}

function getTextEffectModeIcon() {
  if (textEffectMode === "chromatic") return "hdr_strong";
  if (textEffectMode === "noise") return "graphic_eq";
  if (textEffectMode === "noisethreshold") return "gradient";
  if (textEffectMode === "blur") return "blur_on";
  if (textEffectMode === "chromaticblur") return "vibration";
  return "auto_awesome";
}

function getTextEffectModeLabel() {
  if (textEffectMode === "chromatic") return "chromatic";
  if (textEffectMode === "noise") return "noise";
  if (textEffectMode === "noisethreshold") return "noise + threshold";
  if (textEffectMode === "blur") return "blur";
  if (textEffectMode === "chromaticblur") return "chromatic blur";
  return "none";
}

function getBlendModeIcon() {
  if (photoMergeMode === "blur") return "blur_on";
  if (photoMergeMode === "erode") return "grain";
  if (photoMergeMode === "invert") return "invert_colors";
  if (photoMergeMode === "invertblur") return "blur_circular";
  if (photoMergeMode === "chromatic") return "hdr_strong";
  if (photoMergeMode === "noise") return "graphic_eq";
  if (photoMergeMode === "noisethreshold") return "gradient";
  if (photoMergeMode === "chromaticblur") return "vibration";
  if (photoMergeMode === "stencil") return "texture";
  if (photoMergeMode === "hardblack") return "filter_b_and_w";
  return "vertical_align_bottom";
}

function getPhotoMergeModeLabel() {
  if (photoMergeMode === "blur") return "blur";
  if (photoMergeMode === "erode") return "erode";
  if (photoMergeMode === "invert") return "invert photo";
  if (photoMergeMode === "invertblur") return "invert + blur";
  if (photoMergeMode === "chromatic") return "chromatic";
  if (photoMergeMode === "noise") return "noise";
  if (photoMergeMode === "noisethreshold") return "noise + threshold";
  if (photoMergeMode === "chromaticblur") return "chromatic + blur";
  if (photoMergeMode === "stencil") return "stencil";
  if (photoMergeMode === "hardblack") return "hard black";
  return "under";
}

function normalizePhotoMergeMode(value) {
  if (photoMergeModes.includes(value)) return value;
  if (value === "nodither" || value === "noditherwhite") return "hardblack";
  if (value === "white") return "below";
  if (value === "black") return "stencil";
  return "below";
}

function rebuildLabelGraphic() {
  const format = getCurrentLabelFormat();
  const widthCm = orientation === "landscape" ? format.heightCm : format.widthCm;
  const heightCm = orientation === "landscape" ? format.widthCm : format.heightCm;
  const labelPixelWidth = Math.round(widthCm * 10 * dotsPerMm);
  const labelPixelHeight = Math.round(heightCm * 10 * dotsPerMm);
  disposeGraphic(labelGraphic);
  disposeGraphic(labelTextGraphic);
  disposeGraphic(labelPhotoGraphic);
  labelGraphic = createGraphics(labelPixelWidth, labelPixelHeight);
  labelGraphic.pixelDensity(1);
  labelTextGraphic = null;
  labelPhotoGraphic = null;
  chromaticAberrationShader = null;
  noiseShader = null;
  noiseThresholdShader = null;
  textChromaticAberrationShader = null;
  textNoiseShader = null;
  textNoiseThresholdShader = null;
  photoFilterShaderTarget = null;
  textFilterShaderTarget = null;
  cachedLabelLayout = null;
  cachedTextOrigin = null;
  applyEditorFont(labelGraphic);
  markLabelDirty();
}

function markLabelDirty() {
  labelRenderDirty = true;
}

function getCurrentLabelFormat() {
  return labelFormats[labelFormat] || labelFormats["10x15"];
}

function sanitizeTextStyleRanges(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    bold: normalizeStyleRanges(Array.isArray(source.bold) ? source.bold : []),
    italic: normalizeStyleRanges(Array.isArray(source.italic) ? source.italic : []),
    underline: normalizeStyleRanges(Array.isArray(source.underline) ? source.underline : []),
  };
}

function sanitizePendingTextStyle(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    bold: !!source.bold,
    italic: !!source.italic,
    underline: !!source.underline,
  };
}

function normalizeStyleRanges(ranges) {
  const cleaned = ranges
    .map((range) => ({
      start: clampCursorIndex(Math.round(Number(range?.start) || 0)),
      end: clampCursorIndex(Math.round(Number(range?.end) || 0)),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const range of cleaned) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

function getStyleAtIndex(index) {
  return {
    bold: isStyleActiveAt("bold", index),
    italic: isStyleActiveAt("italic", index),
    underline: isStyleActiveAt("underline", index),
  };
}

function isStyleActiveAt(styleKey, index) {
  const ranges = textStyleRanges[styleKey] || [];
  return ranges.some((range) => index >= range.start && index < range.end);
}

function getLineSegments(start, end, text) {
  if (start >= end) {
    return [{ text: text || "", style: getStyleAtIndex(start) }];
  }

  const breakpoints = new Set([start, end]);
  for (const styleKey of ["bold", "italic", "underline"]) {
    for (const range of textStyleRanges[styleKey] || []) {
      if (range.end <= start || range.start >= end) continue;
      breakpoints.add(Math.max(start, range.start));
      breakpoints.add(Math.min(end, range.end));
    }
  }

  const points = Array.from(breakpoints).sort((a, b) => a - b);
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const segStart = points[index];
    const segEnd = points[index + 1];
    if (segEnd <= segStart) continue;
    segments.push({
      text: labelText.slice(segStart, segEnd),
      style: getStyleAtIndex(segStart),
    });
  }
  return segments.length ? segments : [{ text: text || "", style: getStyleAtIndex(start) }];
}

function isWhitespaceOnly(text) {
  return /^\s+$/.test(String(text || ""));
}

function measureWhitespaceWidth(text, fontSize) {
  const raw = String(text || "");
  const measured = measureTextWidth(raw, fontSize, null);
  const spaceCount = raw.length;
  const minimumPerChar = Math.max(6, fontSize * 0.24);
  return Math.max(measured, minimumPerChar * spaceCount);
}

function measureStyledRangeWidth(start, end, fontSize, lineText = "") {
  if (end <= start) return 0;
  const autoLineBold = isAutoLineBold(lineText || labelText.slice(start, end));
  const segments = getLineSegments(start, end, labelText.slice(start, end));
  let widthValue = 0;
  for (const segment of segments) {
    const whitespaceOnly = isWhitespaceOnly(segment.text);
    const mergedStyle = {
      bold: !!(segment.style?.bold || autoLineBold),
      italic: !!segment.style?.italic,
      underline: !!segment.style?.underline,
    };
    widthValue += whitespaceOnly
      ? measureWhitespaceWidth(segment.text, fontSize)
      : measureTextWidth(segment.text, fontSize, mergedStyle);
  }
  return widthValue;
}

function shiftStyleRangesForInsert(index, amount) {
  if (!amount) return;
  for (const styleKey of ["bold", "italic", "underline"]) {
    const ranges = textStyleRanges[styleKey] || [];
    for (const range of ranges) {
      if (index < range.start) {
        range.start += amount;
        range.end += amount;
        continue;
      }
      if (index >= range.start && index <= range.end) {
        range.end += amount;
      }
    }
    textStyleRanges[styleKey] = normalizeStyleRanges(ranges);
  }
}

function shiftStyleRangesForDelete(start, end) {
  if (end <= start) return;
  const delta = end - start;
  const mapIndex = (value) => {
    if (value <= start) return value;
    if (value >= end) return value - delta;
    return start;
  };

  for (const styleKey of ["bold", "italic", "underline"]) {
    const ranges = textStyleRanges[styleKey] || [];
    textStyleRanges[styleKey] = normalizeStyleRanges(
      ranges.map((range) => ({
        start: mapIndex(range.start),
        end: mapIndex(range.end),
      }))
    );
  }
}

function applyPendingStyleToInsertedText(start, length) {
  if (length <= 0) return;
  const end = start + length;
  for (const styleKey of ["bold", "italic", "underline"]) {
    if (!pendingTextStyle[styleKey]) continue;
    setStyleForRange(styleKey, start, end, true);
  }
}

function getStyleToggleTarget() {
  const index = clampCursorIndex(cursorIndex);
  const prevChar = labelText[index - 1] || "";
  const nextChar = labelText[index] || "";
  const prevIsWord = isWordChar(prevChar);
  const nextIsWord = isWordChar(nextChar);

  if (prevIsWord || nextIsWord) {
    const anchor = prevIsWord ? index - 1 : index;
    return {
      mode: "word",
      ...getWordRangeAroundCursor(anchor),
    };
  }

  return {
    mode: "pending",
    start: index,
    end: index,
  };
}

function isRangeFullyStyled(styleKey, start, end) {
  const ranges = textStyleRanges[styleKey] || [];
  return ranges.some((range) => start >= range.start && end <= range.end);
}

function setStyleForRange(styleKey, start, end, enabled) {
  if (end <= start) return;
  const ranges = textStyleRanges[styleKey] || [];
  if (enabled) {
    ranges.push({ start, end });
    textStyleRanges[styleKey] = normalizeStyleRanges(ranges);
    return;
  }

  const next = [];
  for (const range of ranges) {
    if (range.end <= start || range.start >= end) {
      next.push(range);
      continue;
    }
    if (range.start < start) {
      next.push({ start: range.start, end: start });
    }
    if (range.end > end) {
      next.push({ start: end, end: range.end });
    }
  }
  textStyleRanges[styleKey] = normalizeStyleRanges(next);
}

function getWordRangeAroundCursor(index) {
  let start = index;
  let end = index;

  while (start > 0 && isWordChar(labelText[start - 1])) start -= 1;
  while (end < labelText.length && isWordChar(labelText[end])) end += 1;
  return { start, end };
}

function isWordChar(char) {
  return !!char && !/\s/.test(char);
}

function windowResized() {
  if (typeof _portalApplyResolvedCanvasResize === "function") {
    _portalApplyResolvedCanvasResize();
    return;
  }
  const w = Math.round(window.visualViewport?.width || window.innerWidth || windowWidth);
  const h = Math.round(window.visualViewport?.height || window.innerHeight || windowHeight);
  resizeCanvas(w, h);
}
