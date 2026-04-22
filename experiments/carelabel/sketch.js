let printer;
let statusText = "loading";
let detailText = "Type on the keyboard. Return inserts a new line.";
let busy = false;
let labelGraphic;
let labelText = "";
let cursorIndex = 0;
let caretVisible = true;
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
const storageKey = "portal.carelabel.state";
let labelFormat = "10x15";
let orientation = "landscape";
let editorFontMode = "helvetica";

const labelFormats = {
  "10x10": { widthCm: 10, heightCm: 10 },
  "10x15": { widthCm: 10, heightCm: 15 },
};
const labelDpi = 203;
const dotsPerMm = labelDpi / 25.4;
const pagePadding = 72;
const minFontSize = 24;
const maxFontSize = 320;
const defaultFontSize = 96;
const fontSizeScale = [24, 28, 32, 36, 40, 46, 52, 60, 68, 78, 88, 100, 112, 128, 144, 164, 184, 208, 232, 256, 280, 300, 320];
const lineHeightFactor = 1.16;
const fallbackFontFamily = "Helvetica";
const googleFontFamilies = [
  "Bebas Neue",
  "Oswald",
  "Space Mono",
  "Special Elite",
  "IBM Plex Sans Condensed",
];
const fontOptions = [
  { key: "helvetica", label: "Helv", kind: "system", family: "Helvetica" },
  { key: "terminus", label: "Term", kind: "local" },
  { key: "perfectdos", label: "DOS", kind: "local" },
  { key: "bebas", label: "Bebas", kind: "google", family: "Bebas Neue" },
  { key: "oswald", label: "Oswald", kind: "google", family: "Oswald" },
  { key: "spacemono", label: "Mono", kind: "google", family: "Space Mono" },
  { key: "specialelite", label: "Elite", kind: "google", family: "Special Elite" },
  { key: "ibmplexcondensed", label: "Plex", kind: "google", family: "IBM Plex Sans Condensed" },
];

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  installTextInputBridge();
  installKeyCapture();
  terminusFont = await loadFont("../textprompt/Terminus.ttf");
  perfectDosFont = await loadFont("../textprompt/PerfectDOSVGA437.ttf");
  if (typeof loadGoogleFont === "function") {
    try {
      await loadGoogleFont(googleFontFamilies);
    } catch (error) {
      console.warn("[carelabel] Google font load failed", error);
    }
  }
  await loadScript("portal/labelPrinterProtocol.js");
  await loadScript("portal/bleLabelPrinter.js");

  printer = await new BleLabelPrinter({
    protocol: "tspl",
    waitForAutoReconnect: true,
    autoReconnectAttempts: 2,
    reconnectDelayMs: 700,
    onState: (state) => {
      statusText = state.state;
      detailText = state.connected
        ? "Connected. Press Print to send the preview."
        : "Type on the keyboard. Return inserts a new line.";
    },
    onError: (error) => {
      console.error("[tspl-text-label] printer error", error);
      statusText = "error";
      detailText = error?.message || String(error);
    },
  }).init();

  loadEditorState();
  applyEditorFont();
  rebuildLabelGraphic();
}

function draw() {
  updateCaretBlink();
  renderLabelGraphic({ includeCaret: true });

  background(0);

  const preview = getPreviewRect();
  push();
  textAlign(LEFT, BOTTOM);
  textStyle(BOLD);
  textSize(44);
  fill(255);
  noStroke();
  text("WHY CARE?", preview.x, preview.y - 14);
  pop();

  const connectionState = printer?.getConnectionState?.() || {};
  const isConnected = !!connectionState.connected;
  const buttonLabel = busy
    ? "..."
    : (isConnected ? "Print" : "+");
  const buttonWidth = isConnected ? 92 : 56;
  const clearButtonWidth = 72;
  const controlsY = preview.y + preview.height + 16;
  const button = uiButton(buttonLabel, {
    x: preview.x + preview.width - buttonWidth,
    y: controlsY,
    width: buttonWidth,
    height: 46,
    fontSize: buttonLabel === "+" ? 28 : 18,
    fillBg: busy ? "#3a3a3a" : "#ff9f1a",
    fillBgHover: busy ? "#3a3a3a" : "#ffb347",
    stroke: busy ? "#4a4a4a" : "#ff9f1a",
    textFill: busy ? "#9a9a9a" : "#000000",
  });
  if (!busy && button.clicked) {
    handlePrimaryButton();
  }

  const clearButton = uiButton("Clear", {
    x: preview.x + preview.width - buttonWidth - 12 - clearButtonWidth,
    y: controlsY,
    width: clearButtonWidth,
    height: 46,
    fontSize: 16,
    fillBg: busy ? "#1f1f1f" : "#ffffff",
    fillBgHover: busy ? "#1f1f1f" : "#f1f1f1",
    stroke: busy ? "#2c2c2c" : "#ffffff",
    textFill: busy ? "#5a5a5a" : "#000000",
  });
  if (!busy && clearButton.clicked) {
    clearEditor();
  }

  if (!isConnected) {
    const leftControlsEndX = preview.x + 164;
    const rightControlsStartX = preview.x + preview.width - buttonWidth - 12 - clearButtonWidth - 12;
    const fontButtonX = leftControlsEndX;
    const fontButtonWidth = Math.max(64, rightControlsStartX - fontButtonX);

    const toggleButton = uiButton(labelFormat, {
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
    if (!busy && toggleButton.clicked) {
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

    const fontButton = uiButton(getEditorFontLabel(), {
      x: fontButtonX,
      y: controlsY,
      width: fontButtonWidth,
      height: 46,
      fontSize: 15,
      fillBg: busy ? "#1f1f1f" : "#ffffff",
      fillBgHover: busy ? "#1f1f1f" : "#f1f1f1",
      stroke: busy ? "#2c2c2c" : "#ffffff",
      textFill: busy ? "#5a5a5a" : "#000000",
    });
    if (!busy && fontButton.clicked) {
      toggleEditorFont();
    }
  }

  drawPreviewCard(preview);
}

async function handlePrimaryButton() {
  if (busy) return;
  busy = true;
  try {
    const state = printer.getConnectionState();
    if (!state.connected) {
      statusText = "connecting";
      await printer.connectWithPicker({ acceptAllDevices: false });
      return;
    }

    statusText = "printing";
    renderLabelGraphic({ includeCaret: false });
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
    detailText = "Printed the current label preview.";
  } catch (error) {
    console.error("[tspl-text-label] action failed", error);
    statusText = "action failed";
    detailText = error?.message || String(error);
  } finally {
    busy = false;
  }
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

function renderLabelGraphic({ includeCaret = true } = {}) {
  labelGraphic.background(255);
  labelGraphic.fill(0);
  labelGraphic.noStroke();
  labelGraphic.rectMode(CORNER);

  const layout = fitTextLayout(labelText, labelGraphic.width - pagePadding * 2, labelGraphic.height - pagePadding * 2);
  applyEditorFont(labelGraphic);
  labelGraphic.textAlign(LEFT, TOP);

  let y = pagePadding;
  for (const line of layout.lines) {
    drawStyledLine(line, y);
    y += line.lineHeight;
  }
  labelGraphic.noStroke();
  labelGraphic.textStyle(NORMAL);

  if (includeCaret && caretVisible) {
    const caret = getCaretPosition(layout);
    labelGraphic.stroke(0);
    labelGraphic.strokeWeight(Math.max(2, caret.fontSize * 0.04));
    labelGraphic.line(caret.x, caret.y, caret.x, caret.y + caret.fontSize);
  }
}

function fitTextLayout(textValue, maxWidth, maxHeight) {
  return buildLayout(String(textValue || ""), maxWidth, maxHeight);
}

function buildLayout(textValue, maxWidth, maxHeight) {
  const lines = wrapTextToLines(String(textValue || ""), maxWidth);
  applyNaturalLineHeights(lines);
  let totalHeight = lines.reduce((sum, line) => sum + line.lineHeight, 0);

  if (totalHeight > maxHeight) {
    const scale = maxHeight / Math.max(1, totalHeight);
    for (const line of lines) {
      const nextFontSize = constrain(Math.floor(line.fontSize * scale), minFontSize, maxFontSize);
      line.fontSize = nextFontSize;
    }
    applyNaturalLineHeights(lines);
    totalHeight = lines.reduce((sum, line) => sum + line.lineHeight, 0);
  }

  return {
    lines,
    height: totalHeight,
  };
}

function applyNaturalLineHeights(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] || null;
    if (!nextLine) {
      line.lineHeight = Math.max(line.fontSize * 1.002, line.fontSize + 1);
      continue;
    }

    const smaller = Math.min(line.fontSize, nextLine.fontSize);
    const gap = Math.max(1, smaller * 0.08);
    line.lineHeight = line.fontSize + gap;
  }
}

function getCaretPosition(layout) {
  const info = findCursorLocation(layout);
  const previousChar = info.prefix.length > 0 ? info.prefix.slice(-1) : "";
  const nextChar = info.line.text.slice(info.prefix.length, info.prefix.length + 1);
  const previousIsSpace = previousChar === " " || previousChar === "\u00A0";
  const nextIsSpace = nextChar === " " || nextChar === "\u00A0";
  const pairIsSpaced = previousIsSpace || nextIsSpace;
  const caretOffset = pairIsSpaced ? 0 : Math.max(1.5, info.line.fontSize * 0.018);
  const x = pagePadding + measureStyledRangeWidth(info.line.start, clampCursorIndex(cursorIndex), info.line.fontSize) - caretOffset;
  let y = pagePadding;
  for (let index = 0; index < info.lineIndex; index += 1) {
    y += layout.lines[index].lineHeight;
  }
  return {
    x,
    y,
    fontSize: info.line.fontSize,
  };
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
  const availableHeight = height - 180;
  const scale = Math.min(availableWidth / labelGraphic.width, availableHeight / labelGraphic.height);
  const previewWidth = labelGraphic.width * scale;
  const previewHeight = labelGraphic.height * scale;
  return {
    x: (width - previewWidth) * 0.5,
    y: 100,
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
  focusEditorInput();
  return false;
}

function placeCursorFromPreviewPoint(pointerX, pointerY, preview) {
  const localX = ((pointerX - preview.x) / preview.width) * labelGraphic.width;
  const localY = ((pointerY - preview.y) / preview.height) * labelGraphic.height;
  const layout = fitTextLayout(labelText, labelGraphic.width - pagePadding * 2, labelGraphic.height - pagePadding * 2);
  const lineIndex = findNearestLineIndex(layout, localY);
  const line = layout.lines[lineIndex];
  const textX = constrain(localX - pagePadding, 0, Math.max(0, labelGraphic.width - pagePadding * 2));

  let bestOffset = 0;
  let bestDistance = Infinity;
  for (let offset = 0; offset <= line.text.length; offset += 1) {
    const distance = Math.abs(
      measureStyledRangeWidth(line.start, line.start + offset, line.fontSize) - textX
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOffset = offset;
    }
  }

  cursorIndex = line.start + bestOffset;
  caretVisible = true;
  lastCaretToggleMs = millis();
  detailText = "Moved cursor.";
  saveEditorState();
}

function findNearestLineIndex(layout, localY) {
  const contentY = localY - pagePadding;
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
  if (document.activeElement === textInputEl) return false;
  if (key.length === 1 && !keyIsDown(CONTROL) && !keyIsDown(ALT)) {
    insertTextAtCursor(key);
    detailText = "Typing into the label.";
    return false;
  }
}

function keyPressed() {
  if (busy) return false;
  if (document.activeElement === textInputEl) return false;
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
  textInputEl.className = "carelabel-text-input";
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

function wrapTextToLines(textValue, maxWidth) {
  const text = String(textValue || "");
  const lines = [];
  let currentText = "";
  let lineStart = 0;
  let index = 0;
  let logicalLineIndex = 0;
  let currentFontSize = getLineFontSize(logicalLineIndex);
  applyLabelFontSize(currentFontSize);

  while (index < text.length) {
    const character = text[index];
    if (character === "\n") {
      lines.push(makeLine(currentText, lineStart, index, logicalLineIndex, currentFontSize));
      currentText = "";
      lineStart = index + 1;
      index += 1;
      logicalLineIndex += 1;
      currentFontSize = getLineFontSize(logicalLineIndex);
      applyLabelFontSize(currentFontSize);
      continue;
    }

    const candidate = currentText + character;
    if (currentText.length > 0 && measureTextWidth(candidate, currentFontSize) > maxWidth) {
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
    index += 1;
  }

  lines.push(makeLine(currentText, lineStart, text.length, logicalLineIndex, currentFontSize));
  return lines.length ? lines : [makeLine("", 0, 0, 0, getLineFontSize(0))];
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
  const layout = fitTextLayout(labelText, labelGraphic.width - pagePadding * 2, labelGraphic.height - pagePadding * 2);
  const current = findCursorLocation(layout);
  const targetLineIndex = constrain(current.lineIndex + direction, 0, layout.lines.length - 1);
  if (targetLineIndex === current.lineIndex) return;

  const currentX = measureStyledRangeWidth(current.line.start, clampCursorIndex(cursorIndex), current.line.fontSize);
  const targetLine = layout.lines[targetLineIndex];
  let bestOffset = 0;
  let bestDistance = Infinity;
  for (let offset = 0; offset <= targetLine.text.length; offset += 1) {
    const distance = Math.abs(
      measureStyledRangeWidth(targetLine.start, targetLine.start + offset, targetLine.fontSize) - currentX
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
  lineFontSizes[logicalLineIndex] = next;
  detailText = `Line ${logicalLineIndex + 1} size: ${next}`;
  saveEditorState();
}

function resetCurrentLineFontSize() {
  const logicalLineIndex = getLogicalLineIndexAtCursor();
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
  editorFontMode = fontOptions[nextIndex].key;
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

function drawStyledLine(line, y) {
  const segments = getLineSegments(line.start, line.end, line.text);
  let x = pagePadding;

  for (const segment of segments) {
    const textValue = segment.text || " ";
    const style = segment.style || {};
    const whitespaceOnly = isWhitespaceOnly(textValue);
    const renderStyle = whitespaceOnly
      ? { bold: false, italic: false, underline: false }
      : style;
    const widthValue = whitespaceOnly
      ? measureWhitespaceWidth(textValue, line.fontSize)
      : measureTextWidth(textValue, line.fontSize, renderStyle);

    labelGraphic.push();
    applyEditorFont(labelGraphic, line.fontSize);
    labelGraphic.textLeading(line.lineHeight);
    applySegmentTextStyle(renderStyle);
    labelGraphic.fill(0);
    labelGraphic.noStroke();
    if (!whitespaceOnly) {
      labelGraphic.text(textValue, x, y);
    }
    labelGraphic.pop();

    if (style.underline) {
      const underlineY = y + line.fontSize * 0.9;
      labelGraphic.stroke(0);
      labelGraphic.strokeWeight(Math.max(1, line.fontSize * 0.03));
      labelGraphic.line(x, underlineY, x + widthValue, underlineY);
      labelGraphic.noStroke();
    }

    x += widthValue;
  }
}

function applySegmentTextStyle(style) {
  if (style?.bold && style?.italic) {
    labelGraphic.textStyle(BOLDITALIC);
    return;
  }
  if (style?.bold) {
    labelGraphic.textStyle(BOLD);
    return;
  }
  if (style?.italic) {
    labelGraphic.textStyle(ITALIC);
    return;
  }
  labelGraphic.textStyle(NORMAL);
}

function measureTextWidth(text, fontSize = defaultFontSize, style = null) {
  applyLabelFontSize(fontSize);
  applySegmentTextStyle(style);
  const safeText = String(text ?? "").replace(/ /g, "\u00A0");
  const sentinel = "|";
  return labelGraphic.textWidth(safeText + sentinel) - labelGraphic.textWidth(sentinel);
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
  caretVisible = !caretVisible;
  lastCaretToggleMs = now;
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
  } catch {}
}

function clearEditor() {
  labelText = "";
  cursorIndex = 0;
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

function rebuildLabelGraphic() {
  const format = getCurrentLabelFormat();
  const widthCm = orientation === "landscape" ? format.heightCm : format.widthCm;
  const heightCm = orientation === "landscape" ? format.widthCm : format.heightCm;
  const labelPixelWidth = Math.round(widthCm * 10 * dotsPerMm);
  const labelPixelHeight = Math.round(heightCm * 10 * dotsPerMm);
  labelGraphic = createGraphics(labelPixelWidth, labelPixelHeight);
  labelGraphic.pixelDensity(1);
  applyEditorFont(labelGraphic);
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

function measureStyledRangeWidth(start, end, fontSize) {
  if (end <= start) return 0;
  const segments = getLineSegments(start, end, labelText.slice(start, end));
  let widthValue = 0;
  for (const segment of segments) {
    const whitespaceOnly = isWhitespaceOnly(segment.text);
    widthValue += whitespaceOnly
      ? measureWhitespaceWidth(segment.text, fontSize)
      : measureTextWidth(segment.text, fontSize, segment.style);
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

  if (prevIsWord && nextIsWord) {
    return {
      mode: "word",
      ...getWordRangeAroundCursor(index),
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
