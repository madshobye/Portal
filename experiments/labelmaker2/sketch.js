let printer;
let statusText = "loading";
let detailText = "Type on the keyboard. Return inserts a new line.";
let busy = false;
let activePrintId = 0;
let printCancelRequested = false;
let activePrintJob = null;
let labelGraphic;
let labelTextGraphic;
let labelPhotoGraphic;
let cam = null;
let photoCameraStarting = false;
let droppedPhotoImage = null;
let droppedPhotoName = "";
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
let labelFormat = "10x15";
let orientation = "landscape";
let editorFontMode = "helvetica";
let autoSizingEnabled = true;
let useSoftKeyboardInput = false;
let outputMode = "label";
let outputModeAuto = true;
let labelPaddingMode = "minimal";
let labelQrText = "";
let labelQrCode = null;
let photoEnabled = false;
let photoMergeMode = "below";
let labelInverted = false;
let textOutlineMode = "none";
const debugCharacterBounds = false;
let tooltipKey = "";
let tooltipLabel = "";
let tooltipX = 0;
let tooltipY = 0;
let tooltipStartedAt = 0;
let tooltipActiveThisFrame = false;
let printHistory = [];
let printHistoryIndex = -1;
let restoreLiveCameraOnSetup = false;
let labelRenderDirty = true;
let labelRenderKey = "";
let cachedLabelLayout = null;
let cachedTextOrigin = null;
let photoRevision = 0;

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
const photoMergeModes = ["below", "stencil", "hardblack"];
const textOutlineModes = ["none", "outline", "opposite"];
const minFontSize = 24;
const maxFontSize = 2560;
const defaultFontSize = 96;
const fontSizeScale = [24, 28, 32, 36, 40, 46, 52, 60, 68, 78, 88, 100, 112, 128, 144, 164, 184, 208, 232, 256, 280, 300, 320, 360, 400, 448, 512, 576, 640, 720, 800, 896, 1024, 1152, 1280, 1440, 1600, 1792, 2048, 2304, 2560];
const lineHeightFactor = 1.16;
const toolbarButtonHeight = 38;
const toolbarGap = 6;
const toolbarRowGap = 8;
const tooltipDelayMs = 450;
const historySliderHeight = 22;
const historySliderTop = 12;
const printHistoryStoragePressureLimit = 0.9;
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
  canvas.drop(handlePhotoDrop);
  useSoftKeyboardInput = detectSoftKeyboardMode();
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
  await loadScript("portal/qrCodeGen.js");

  printer = await new BleLabelPrinter({
    protocol: "tspl",
    chunkSize: 488,
    chunkDelayMs: 0,
    preferWriteWithResponse: true,
    waitForAutoReconnect: true,
    autoReconnectAttempts: 2,
    reconnectDelayMs: 700,
    onState: (state) => {
      statusText = state.state;
      if (state.connected) {
        outputMode = state.suggestedOutputMode || "label";
      }
      detailText = state.connected
        ? `Connected. Press Print for ${outputMode}.`
        : "Type on the keyboard. Return inserts a new line.";
    },
    onError: (error) => {
      console.error("[labelmaker2] printer error", error);
      statusText = "error";
      detailText = error?.message || String(error);
    },
  }).init();

  loadEditorState();
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
  const connectionState = printer?.getConnectionState?.() || {};
  const isConnected = !!connectionState.connected;
  const buttonLabel = busy
    ? "cancel"
    : (isConnected ? "print" : "bluetooth");
  const hasPhotoControls = hasPhotoSource() || photoEnabled || photoCameraStarting;
  const controlsY = preview.y + preview.height + 16;
  const squareButtonWidth = toolbarButtonHeight;
  const buttonWidth = squareButtonWidth;
  const clearButtonWidth = squareButtonWidth;
  const downloadButtonWidth = squareButtonWidth;
  const modeButtonWidth = squareButtonWidth;
  const rightControlsWidth = buttonWidth + toolbarGap + clearButtonWidth + toolbarGap + downloadButtonWidth;
  const showRemovePhotoButton = hasStoredPhoto();
  const leftMainButtons = showRemovePhotoButton ? 11 : 10;
  const leftMainWidth = leftMainButtons * squareButtonWidth + (leftMainButtons - 1) * toolbarGap;
  const styleButtonWidth = toolbarButtonHeight;
  const styleButtonGap = toolbarGap;
  const styleControlsWidth = styleButtonWidth * 6 + styleButtonGap * 5;
  const showStyleControls = !autoSizingEnabled;
  const activeStyleControlsWidth = showStyleControls ? styleControlsWidth : 0;
  const fontButtonWidth = 104;
  const oneRowControlsWidth = leftMainWidth + toolbarGap + activeStyleControlsWidth + (showStyleControls ? toolbarGap : 0) + fontButtonWidth + toolbarGap + rightControlsWidth;
  const useTwoToolbarRows = oneRowControlsWidth > preview.width;
  const mainRowNeedsRightWrap = leftMainWidth + toolbarGap + rightControlsWidth > preview.width;
  const secondRowRightWidth = (useTwoToolbarRows || mainRowNeedsRightWrap) ? rightControlsWidth + toolbarGap : 0;
  const secondRowAvailableWidth = Math.max(fontButtonWidth, preview.width - secondRowRightWidth);
  const styleControlsX = useTwoToolbarRows ? preview.x : preview.x + leftMainWidth + toolbarGap;
  const styleControlsY = useTwoToolbarRows ? controlsY + toolbarButtonHeight + toolbarRowGap : controlsY;
  const fontButtonX = showStyleControls
    ? Math.min(
      styleControlsX + styleControlsWidth + toolbarGap,
      preview.x + secondRowAvailableWidth - fontButtonWidth
    )
    : (useTwoToolbarRows ? preview.x : preview.x + leftMainWidth + toolbarGap);
  const fontButtonY = useTwoToolbarRows ? styleControlsY : controlsY;
  const rightButtonY = (useTwoToolbarRows || mainRowNeedsRightWrap) ? controlsY + toolbarButtonHeight + toolbarRowGap : controlsY;
  drawPrintHistorySlider(preview);
  const modeButton = drawIconButton(outputMode === "receipt" ? "receipt_long" : "label", {
    x: preview.x,
    y: controlsY,
    width: modeButtonWidth,
    height: toolbarButtonHeight,
    active: !outputModeAuto,
    disabled: true,
    marker: outputModeAuto ? "autorenew" : "",
    tooltip: `Auto output: ${outputMode}`,
  });
  if (!busy && modeButton.clicked) {
    toggleOutputMode();
  }

  const button = drawIconButton(buttonLabel, {
    x: preview.x + preview.width - buttonWidth,
    y: rightButtonY,
    width: buttonWidth,
    height: toolbarButtonHeight,
    primary: true,
    disabled: false,
    spin: false,
    tooltip: busy ? "Cancel print" : (isConnected ? "Print" : "Connect printer"),
  });
  if (button.clicked && busy) {
    cancelActivePrint();
  } else if (!busy && button.clicked) {
    handlePrimaryButton();
  }

  const clearButton = drawIconButton("delete", {
    x: preview.x + preview.width - buttonWidth - toolbarGap - clearButtonWidth,
    y: rightButtonY,
    width: clearButtonWidth,
    height: toolbarButtonHeight,
    disabled: busy,
    tooltip: "Clear",
  });
  if (!busy && clearButton.clicked) {
    clearEditor();
  }

  const downloadButton = drawIconButton("download", {
    x: preview.x + preview.width - buttonWidth - toolbarGap - clearButtonWidth - toolbarGap - downloadButtonWidth,
    y: rightButtonY,
    width: downloadButtonWidth,
    height: toolbarButtonHeight,
    disabled: busy,
    tooltip: "Save and download",
  });
  if (!busy && downloadButton.clicked) {
    downloadCurrentLabel();
  }

  const autoButtonWidth = squareButtonWidth;
  const formatX = preview.x + modeButtonWidth + toolbarGap;
  const orientationX = formatX + squareButtonWidth + toolbarGap;
  const autoButtonX = orientationX + squareButtonWidth + toolbarGap;
  const paddingButtonX = autoButtonX + autoButtonWidth + toolbarGap;
  const qrButtonX = paddingButtonX + squareButtonWidth + toolbarGap;
  const photoButtonX = qrButtonX + squareButtonWidth + toolbarGap;
  const blendButtonX = hasPhotoControls ? photoButtonX + squareButtonWidth + toolbarGap : null;
  const invertButtonX = (hasPhotoControls ? blendButtonX : photoButtonX) + squareButtonWidth + toolbarGap;
  const outlineButtonX = invertButtonX + squareButtonWidth + toolbarGap;
  const removePhotoButtonX = outlineButtonX + squareButtonWidth + toolbarGap;

  const toggleButton = drawIconButton(labelFormat === "10x10" ? "crop_square" : "aspect_ratio", {
    x: formatX,
    y: controlsY,
    width: squareButtonWidth,
    height: toolbarButtonHeight,
    disabled: busy,
    tooltip: labelFormat === "10x10" ? "Use 10 x 15" : "Use square",
  });
  if (!busy && toggleButton.clicked) {
    toggleLabelFormat();
  }

  const orientationButton = drawIconButton(orientation === "portrait" ? "stay_current_portrait" : "stay_current_landscape", {
    x: orientationX,
    y: controlsY,
    width: squareButtonWidth,
    height: toolbarButtonHeight,
    disabled: busy,
    tooltip: orientation === "portrait" ? "Portrait" : "Landscape",
  });
  if (!busy && orientationButton.clicked) {
    toggleOrientation();
  }

  const autoButton = drawIconButton(autoSizingEnabled ? "autorenew" : "sync_disabled", {
    x: autoButtonX,
    y: controlsY,
    width: autoButtonWidth,
    height: toolbarButtonHeight,
    active: autoSizingEnabled,
    disabled: busy,
    tooltip: autoSizingEnabled ? "Auto size on" : "Auto size off",
  });
  if (!busy && autoButton.clicked) {
    autoSizingEnabled = !autoSizingEnabled;
    detailText = autoSizingEnabled ? "Auto sizing on." : "Auto sizing off.";
    saveEditorState();
  }

  const paddingButton = drawIconButton("padding", {
    x: paddingButtonX,
    y: controlsY,
    width: squareButtonWidth,
    height: toolbarButtonHeight,
    active: labelPaddingMode !== "minimal",
    disabled: busy,
    markerText: labelPaddingMode === "minimal" ? "min" : (labelPaddingMode === "some" ? "mid" : "max"),
    tooltip: `Padding: ${labelPaddingMode}`,
  });
  if (!busy && paddingButton.clicked) {
    toggleLabelPadding();
  }

  const qrButton = drawIconButton(labelQrText ? "qr_code_2" : "qr_code", {
    x: qrButtonX,
    y: controlsY,
    width: squareButtonWidth,
    height: toolbarButtonHeight,
    active: !!labelQrText,
    disabled: busy,
    tooltip: labelQrText ? "Remove QR" : "Add QR",
  });
  if (!busy && qrButton.clicked) {
    promptForQrCode();
  }

  const photoButton = drawIconButton(photoEnabled ? "videocam" : "photo_camera", {
    x: photoButtonX,
    y: controlsY,
    width: squareButtonWidth,
    height: toolbarButtonHeight,
    active: photoEnabled,
    disabled: busy || photoCameraStarting,
    tooltip: photoEnabled ? "Camera on" : "Camera off",
  });
  if (!busy && !photoCameraStarting && photoButton.clicked) {
    togglePhotoCamera();
  }

  if (hasPhotoControls) {
    const blendButton = drawIconButton(getBlendModeIcon(), {
      x: blendButtonX,
      y: controlsY,
      width: squareButtonWidth,
      height: toolbarButtonHeight,
      active: photoMergeMode !== "below",
      disabled: busy,
      iconSize: 22,
      tooltip: `Photo: ${getPhotoMergeModeLabel()}`,
    });
    if (!busy && blendButton.clicked) {
      togglePhotoMergeMode();
    }
  }

  const invertButton = drawIconButton(labelInverted ? "invert_colors_off" : "invert_colors", {
    x: invertButtonX,
    y: controlsY,
    width: squareButtonWidth,
    height: toolbarButtonHeight,
    active: labelInverted,
    disabled: busy,
    iconSize: 22,
    tooltip: labelInverted ? "Invert off" : "Invert",
  });
  if (!busy && invertButton.clicked) {
    toggleInvertMode();
  }

  const outlineButton = drawIconButton(getTextOutlineModeIcon(), {
    x: outlineButtonX,
    y: controlsY,
    width: squareButtonWidth,
    height: toolbarButtonHeight,
    active: textOutlineMode !== "none",
    disabled: busy,
    tooltip: `Text: ${getTextOutlineModeLabel()}`,
  });
  if (!busy && outlineButton.clicked) {
    toggleTextOutlineMode();
  }

  if (showRemovePhotoButton) {
    const removePhotoButton = drawIconButton("hide_image", {
      x: removePhotoButtonX,
      y: controlsY,
      width: squareButtonWidth,
      height: toolbarButtonHeight,
      disabled: busy,
      tooltip: "Remove photo",
    });
    if (!busy && removePhotoButton.clicked) {
      removeStoredPhoto();
    }
  }

  if (showStyleControls) {
    drawTextStyleControls(styleControlsX, styleControlsY, busy, {
      buttonWidth: styleButtonWidth,
      buttonHeight: toolbarButtonHeight,
      gap: styleButtonGap,
    });
  }

  const fontButton = uiButton(getEditorFontLabel(), {
    x: fontButtonX,
    y: fontButtonY,
    width: fontButtonWidth,
    height: toolbarButtonHeight,
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
  registerTooltip("font", `Font: ${getEditorFontLabel()}`, fontButtonX, fontButtonY, fontButtonWidth, toolbarButtonHeight);
  if (!busy && fontButton.clicked) {
    toggleEditorFont();
  }

  drawPreviewCard(preview);
  drawPendingTooltip();
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
      iconSize: 22,
      tooltip: item.tooltip,
    });
    if (!disabled && result.clicked) {
      item.action();
    }
  }
}

function drawPrintHistorySlider(preview) {
  if (!printHistory.length) return;
  const clearButtonSize = historySliderHeight;
  const historyGap = 8;
  const historyWidth = Math.min(preview.width, Math.max(80, width - 120));
  const sliderWidth = Math.max(60, historyWidth - clearButtonSize - historyGap);
  const sliderX = (width - historyWidth) * 0.5;
  const sliderY = historySliderTop;
  const clearButtonX = sliderX + sliderWidth + historyGap;
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

  const clearButton = drawIconButton("delete_sweep", {
    x: clearButtonX,
    y: sliderY,
    width: clearButtonSize,
    height: historySliderHeight,
    disabled: busy,
    iconSize: 18,
    textOffsetY: 3,
    tooltip: "Clear history",
  });
  if (!busy && clearButton.clicked) {
    confirmAndClearPrintHistory();
  }

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
    fontSize: options.iconSize || 25,
    textOffsetY: options.textOffsetY ?? 4,
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
    textSize(12);
    fill(primary ? "#000000" : (active ? "#ffffff" : "#000000"));
    text(options.marker, options.x + options.width - 12, options.y + 13);
  }

  if (options.markerText) {
    textFont(fallbackFontFamily);
    textSize(10);
    fill(textColor);
    text(options.markerText, options.x + options.width / 2, options.y + options.height - 8);
  }
  pop();

  if (disabled) {
    result.clicked = false;
    result.pressedDown = false;
    result.pressedUp = false;
  }
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

async function handlePrimaryButton() {
  if (busy) return;
  const printId = activePrintId + 1;
  activePrintId = printId;
  printCancelRequested = false;
  busy = true;
  let backgroundPrintStarted = false;
  try {
    const state = printer.getConnectionState();
    if (!state.connected) {
      statusText = "connecting";
      await printer.connectWithPicker({ acceptAllDevices: false });
      outputMode = printer.getSuggestedOutputMode?.() || "label";
      if (printId !== activePrintId) return;
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

    const format = getCurrentLabelFormat();
    const printJob = printer.printTsplBitmapAsync(imageData, {
      labelWidthMm: format.widthCm * 10,
      labelHeightMm: format.heightCm * 10,
      gapMm: 2,
      threshold: 210,
      density: 12,
      invert: true,
      dither: photoMergeMode !== "hardblack",
    });
    backgroundPrintStarted = true;
    activePrintJob = printJob;
    printJob.promise
      .then(() => {
        if (printId !== activePrintId) return;
        statusText = "printed";
        detailText = "Printed the current label preview.";
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

function downloadCurrentLabel() {
  renderLabelGraphic();
  recordPrintHistory();
  const canvas = labelGraphic?.canvas || labelGraphic?.elt;
  if (!canvas) {
    detailText = "No label image to download.";
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `labelmaker2-${timestamp}.png`;

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
    detailText = `Saved and downloaded label ${printHistoryIndex + 1}/${printHistory.length}.`;
  };

  if (typeof canvas.toBlob === "function") {
    canvas.toBlob(downloadBlob, "image/png");
    return;
  }

  const dataUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  detailText = `Saved and downloaded label ${printHistoryIndex + 1}/${printHistory.length}.`;
}

function cancelActivePrint() {
  if (!busy) return;
  printCancelRequested = true;
  activePrintJob?.cancel?.();
  activePrintJob = null;
  activePrintId += 1;
  busy = false;
  statusText = "cancelled";
  detailText = "Cancelled print.";
}

function getPrintableImageData() {
  const source = labelGraphic.drawingContext.getImageData(0, 0, labelGraphic.width, labelGraphic.height);
  if (orientation !== "landscape") return source;
  return rotateImageDataClockwise(source);
}

async function printReceiptPreview(imageData) {
  await printer.withWriteSettings({
    chunkSize: 300,
    chunkDelayMs: 0,
  }, async () => {
    await printer.printEscposBitmap(imageData, {
      widthDots: 384,
      threshold: 190,
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
}

function ensureTextGraphic() {
  if (
    labelTextGraphic &&
    labelTextGraphic.width === labelGraphic.width &&
    labelTextGraphic.height === labelGraphic.height
  ) {
    return;
  }
  labelTextGraphic = createGraphics(labelGraphic.width, labelGraphic.height);
  labelTextGraphic.pixelDensity(1);
  applyEditorFont(labelTextGraphic);
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
    labelInverted,
    textOutlineMode,
    photoSource: hasPhotoSource() ? (photoEnabled && isCameraReady() ? "camera" : "stored") : "none",
    photoRevision,
    width: labelGraphic?.width || 0,
    height: labelGraphic?.height || 0,
  });
}

function renderPhotoBelowText(source) {
  labelGraphic.background(getPaperColor());
  drawGrayscaleCover(labelGraphic, source, 0, 0, labelGraphic.width, labelGraphic.height);
  labelGraphic.image(labelTextGraphic, 0, 0);
  if (photoMergeMode === "hardblack") {
    applyMonochromeThresholdPreview(labelGraphic, outputMode === "receipt" ? 190 : 150);
  }
}

function isPhotoMaskMergeMode() {
  return photoMergeMode === "stencil";
}

function composePhotoWithCurrentLabelMask() {
  const source = getPhotoSource();
  if (!source) return;
  ensurePhotoGraphic();

  drawGrayscaleCover(labelGraphic, source, 0, 0, labelGraphic.width, labelGraphic.height);

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

function applyMonochromeThresholdPreview(target, threshold = 210) {
  target.loadPixels();
  for (let index = 0; index < target.pixels.length; index += 4) {
    const alpha = target.pixels[index + 3];
    const luminance = alpha <= 20
      ? 255
      : 0.2126 * target.pixels[index] + 0.7152 * target.pixels[index + 1] + 0.0722 * target.pixels[index + 2];
    const value = luminance < threshold ? 0 : 255;
    target.pixels[index] = value;
    target.pixels[index + 1] = value;
    target.pixels[index + 2] = value;
    target.pixels[index + 3] = 255;
  }
  target.updatePixels();
}

function ensurePhotoGraphic() {
  if (
    labelPhotoGraphic &&
    labelPhotoGraphic.width === labelGraphic.width &&
    labelPhotoGraphic.height === labelGraphic.height
  ) {
    return;
  }
  labelPhotoGraphic = createGraphics(labelGraphic.width, labelGraphic.height);
  labelPhotoGraphic.pixelDensity(1);
}

function drawGrayscaleCover(target, source, dx, dy, dw, dh) {
  const ctx = target.drawingContext;
  const previousFilter = ctx.filter || "none";
  ctx.filter = "grayscale(100%)";
  drawImageCover(target, source, dx, dy, dw, dh);
  ctx.filter = previousFilter;
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

function capturePhotoSourceGraphic(source = getPhotoSource(), maxDimension = null) {
  if (!source || !labelGraphic) return null;
  const scale = maxDimension
    ? Math.min(1, maxDimension / Math.max(labelGraphic.width, labelGraphic.height))
    : 1;
  const target = createGraphics(
    Math.max(1, Math.round(labelGraphic.width * scale)),
    Math.max(1, Math.round(labelGraphic.height * scale))
  );
  target.pixelDensity(1);
  drawImageCover(target, source, 0, 0, target.width, target.height);
  return target;
}

function capturePhotoSourceDataUrl(source = getPhotoSource()) {
  const target = capturePhotoSourceGraphic(source, 720);
  if (!target?.canvas) return "";
  return target.canvas.toDataURL("image/jpeg", 0.86);
}

function freezeLiveCameraPhoto() {
  if (!photoEnabled || !isCameraReady()) return;
  const target = capturePhotoSourceGraphic(cam);
  if (!target) return;
  droppedPhotoImage = target.get();
  droppedPhotoName = "Camera snapshot";
  photoRevision += 1;
  stopPhotoCamera();
  photoEnabled = false;
  markLabelDirty();
  saveEditorState();
}

function removeStoredPhoto() {
  droppedPhotoImage = null;
  droppedPhotoName = "";
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
  const topMargin = printHistory.length ? 52 : 28;
  const controlsGap = 16;
  const controlsHeight = toolbarButtonHeight * 2 + toolbarRowGap;
  const bottomMargin = 6;
  const availableWidth = width - 120;
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

function mousePressed() {
  return handlePointerPlacement(mouseX, mouseY);
}

function touchStarted() {
  return handlePointerPlacement(mouseX, mouseY);
}

function handlePointerPlacement(pointerX, pointerY) {
  if (busy || !labelGraphic) return;

  const preview = getPreviewRect();
  const insidePreview = (
    pointerX >= preview.x &&
    pointerX <= preview.x + preview.width &&
    pointerY >= preview.y &&
    pointerY <= preview.y + preview.height
  );
  if (!insidePreview) return;

  placeCursorFromPreviewPoint(pointerX, pointerY, preview);
  if (useSoftKeyboardInput) {
    focusEditorInput();
  }
  return false;
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
  if (useSoftKeyboardInput && document.activeElement === textInputEl) return false;
  if (key.length === 1 && !keyIsDown(CONTROL) && !keyIsDown(ALT)) {
    insertTextAtCursor(key);
    detailText = "Typing into the label.";
    return false;
  }
}

function keyPressed() {
  if (busy) return false;
  if (useSoftKeyboardInput && document.activeElement === textInputEl) return false;
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
  textInputEl.addEventListener("keydown", handleEditorKeydown, { passive: false });
  textInputEl.addEventListener("input", () => {
    if (textInputEl.value) {
      insertTextAtCursor(textInputEl.value);
      textInputEl.value = "";
    }
  });
}

function focusEditorInput() {
  if (!textInputEl) return;
  textInputEl.focus({ preventScroll: true });
  textInputEl.value = "";
  textInputEl.setSelectionRange(0, 0);
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

function handleTextInputBeforeInput(event) {
  if (busy) {
    event.preventDefault();
    return;
  }

  if (event.isComposing) return;

  if (event.inputType === "insertText" && event.data) {
    event.preventDefault();
    insertTextAtCursor(event.data);
    textInputEl.value = "";
    return;
  }
  if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
    event.preventDefault();
    insertTextAtCursor("\n");
    textInputEl.value = "";
    return;
  }
  if (event.inputType === "deleteContentBackward") {
    event.preventDefault();
    deleteBackward();
    textInputEl.value = "";
    return;
  }
  if (event.inputType === "deleteContentForward") {
    event.preventDefault();
    deleteForward();
    textInputEl.value = "";
  }
}

function installKeyCapture() {
  window.addEventListener("keydown", (event) => {
    if (event.target === textInputEl) return;
    handleEditorKeydown(event);
  }, { passive: false });
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
    labelPaddingMode,
    labelQrText,
    photoMergeMode,
    labelInverted,
    textOutlineMode,
    photoEnabled: !!photoEnabled,
    photoDataUrl: hasStoredPhoto() ? capturePhotoSourceDataUrl(droppedPhotoImage) : "",
    photoName: droppedPhotoName,
  };
}

function applyEditorSnapshot(data = {}) {
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
  labelInverted = !!data.labelInverted || data.photoMergeMode === "black" || data.photoMergeMode === "white" || data.photoMergeMode === "noditherwhite";
  textOutlineMode = textOutlineModes.includes(data.textOutlineMode) ? data.textOutlineMode : "none";
  droppedPhotoImage = null;
  droppedPhotoName = "";
  applyEditorFont();
  rebuildLabelGraphic();

  if (data.photoDataUrl) {
    loadImage(
      data.photoDataUrl,
      (imageValue) => {
        droppedPhotoImage = imageValue;
        droppedPhotoName = data.photoName || "Print history photo";
        photoRevision += 1;
        markLabelDirty();
      },
      (error) => {
        console.error("[labelmaker2] history photo failed", error);
      }
    );
  }
}

function recordPrintHistory() {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    printedAt: new Date().toISOString(),
    state: getEditorSnapshot(),
  };
  printHistory.push(entry);
  printHistoryIndex = printHistory.length - 1;
  savePrintHistory();
  syncPrintHistorySlider();
}

function restorePrintHistoryIndex(index) {
  if (!printHistory.length) return;
  const nextIndex = constrain(index, 0, printHistory.length - 1);
  const entry = printHistory[nextIndex];
  if (!entry?.state) return;
  printHistoryIndex = nextIndex;
  applyEditorSnapshot(entry.state);
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

function saveEditorState() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      text: labelText,
      cursorIndex,
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
      labelInverted,
      textOutlineMode,
      photoEnabled: !!photoEnabled,
      photoDataUrl: hasStoredPhoto() ? capturePhotoSourceDataUrl(droppedPhotoImage) : "",
      photoName: droppedPhotoName,
    }));
  } catch {}
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
    labelPaddingMode = labelPaddingModes.includes(data.labelPaddingMode) ? data.labelPaddingMode : "minimal";
    labelQrText = typeof data.labelQrText === "string" ? data.labelQrText : "";
    labelQrCode = labelQrText ? createQRCode(labelQrText) : null;
    photoMergeMode = normalizePhotoMergeMode(data.photoMergeMode);
    labelInverted = !!data.labelInverted || data.photoMergeMode === "black" || data.photoMergeMode === "white" || data.photoMergeMode === "noditherwhite";
    textOutlineMode = textOutlineModes.includes(data.textOutlineMode) ? data.textOutlineMode : "none";
    photoEnabled = false;
    photoCameraStarting = false;
    droppedPhotoImage = null;
    droppedPhotoName = "";
    restoreLiveCameraOnSetup = data.photoEnabled === true && !data.photoDataUrl;
    if (data.photoDataUrl) {
      loadImage(
        data.photoDataUrl,
        (imageValue) => {
          droppedPhotoImage = imageValue;
          droppedPhotoName = data.photoName || "Stored photo";
          photoRevision += 1;
          markLabelDirty();
        },
        (error) => {
          console.error("[labelmaker2] stored photo failed", error);
        }
      );
    }
  } catch {}
}

function clearEditor() {
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
  photoRevision += 1;
  autoSizingEnabled = true;
  textOutlineMode = "none";
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

  loadImage(
    file.data,
    (imageValue) => {
      stopPhotoCamera();
      photoEnabled = false;
      droppedPhotoImage = imageValue;
      droppedPhotoName = file.name || "Dropped photo";
      photoRevision += 1;
      markLabelDirty();
      detailText = `Photo loaded: ${droppedPhotoName}.`;
      saveEditorState();
    },
    (error) => {
      console.error("[labelmaker2] dropped photo failed", error);
      detailText = "Could not load dropped photo.";
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

function getBlendModeIcon() {
  if (photoMergeMode === "stencil") return "texture";
  if (photoMergeMode === "hardblack") return "filter_b_and_w";
  return "vertical_align_bottom";
}

function getPhotoMergeModeLabel() {
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
  labelGraphic = createGraphics(labelPixelWidth, labelPixelHeight);
  labelGraphic.pixelDensity(1);
  labelTextGraphic = null;
  labelPhotoGraphic = null;
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
  resizeCanvas(windowWidth, windowHeight);
}
