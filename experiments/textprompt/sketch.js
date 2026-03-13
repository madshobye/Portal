const TAB_WIDTH = 4;
// const showOverlay = false;

const SURFACE_W = 1920;
const SURFACE_H = 1080;
const MIN_PLANES = 1;
const MAX_PLANES = 8;
const PLANE_COUNT_STORAGE_KEY = "textprompt:planeCount";

// Resize behavior switch:
// false = Ctrl/Cmd +/- changes all lines globally
// true  = Ctrl/Cmd +/- changes only the logical line where the caret is
const RESIZE_APPLIES_TO_CURRENT_LINE = true;

const PREF_NS = "vgaedit";
const PREF_KEY = "text";
const STORAGE_KEY = `${PREF_NS}:${PREF_KEY}`;
const STORAGE_KEY_FONT_SIZE = `${PREF_NS}:fontSize`;
const STORAGE_KEY_LINE_FONTS = `${PREF_NS}:lineFontSizes`;

const SAVE_DEBOUNCE_MS = 700;
const SAVE_MIN_GAP_MS = 1500;
const ESC_WINDOW_MS = 1200;

const DEFAULT_FONT_SIZE = 20;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 288;
const TYPO_SCALE_STEPS = [
  10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 84, 96, 112, 128, 160, 192, 224, 256, 288
];

let textBuf = "";
let caretIndex = 0;
let preferredX = -1;
let viewTopY = 0;

let escCount = 0;
let escFirstMs = 0;

let lastEditMs = 0;
let lastSaveMs = 0;

let editorFontSize = DEFAULT_FONT_SIZE;
let leftPad = 16;
let topPad = 16;
let blinkOn = true;
let lastBlinkMs = 0;

let layoutRows = [];
let innerWidth = 0;
let viewportHeight = 0;
let totalContentHeight = 0;

let lineFontSizes = {}; // key: logical line index (0-based), value: font size
let mapper;
let planes = [];
let editorSurface;

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  noStroke();
  loadGoogleFont("Roboto Mono");
  textFont("Roboto Mono");
  imageMode(CENTER);

  await loadScript("portal/uiSlim2.js");
  await loadScript("portal/mapper.js");

  loadTextAndStyle();
  caretIndex = textBuf.length;

  editorSurface = createGraphics(SURFACE_W, SURFACE_H);
  editorSurface.pixelDensity(1);
  editorSurface.noStroke();

  mapper = new ProjectionMapper();
  mapper.followDebugOverlayVisibility(true);
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    mapper.setFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    mapper.setFont(baseFont);
  }

  const storedPlaneCount = getStoredPlaneCount();
  for (let i = 0; i < storedPlaneCount; i++) addPlane(false);
  mapper.loadAll();

  // Use window-level capture so key handling survives focus quirks after Esc/fullscreen changes.
  window.addEventListener("keydown", onDomKeyDown, { passive: false, capture: true });
}

function draw() {
  background(0);

  textFont("Roboto Mono");
  textSize(editorFontSize);
  updateMetrics();

  handleAutosave();
  rebuildLayout();
  redrawEditor(editorSurface);
  renderPlanes();
  mapper?.render();

  uiDrawOnDebugOverlay((overlay) => {
    uiUseGraphics(overlay);
    renderMapperUi();
    uiEndUseGraphics();
  });

  if (millis() - lastBlinkMs > 530) {
    blinkOn = !blinkOn;
    lastBlinkMs = millis();
  }
}

function updateMetrics() {
  const targetW = editorSurface?.width || width;
  const targetH = editorSurface?.height || height;
  innerWidth = max(40, targetW - leftPad * 2);
  viewportHeight = max(1, targetH - topPad);
}

function loadTextAndStyle() {
  const saved = localStorage.getItem(STORAGE_KEY);
  textBuf = saved == null ? "" : saved;

  const savedFontSize = Number(localStorage.getItem(STORAGE_KEY_FONT_SIZE));
  if (Number.isFinite(savedFontSize)) {
    editorFontSize = clampi(round(savedFontSize), MIN_FONT_SIZE, MAX_FONT_SIZE);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY_LINE_FONTS);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") {
      lineFontSizes = parsed;
    }
  } catch {
    lineFontSizes = {};
  }

  caretIndex = textBuf.length;
  preferredX = -1;
  viewTopY = 0;
}

function saveTextNow() {
  localStorage.setItem(STORAGE_KEY, textBuf);
  lastSaveMs = millis();
}

function saveFontSettings() {
  localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(editorFontSize));
  localStorage.setItem(STORAGE_KEY_LINE_FONTS, JSON.stringify(lineFontSizes));
}

function markEdited() {
  lastEditMs = millis();
  blinkOn = true;
}

function handleAutosave() {
  const now = millis();
  if (lastEditMs !== 0 && now - lastEditMs > SAVE_DEBOUNCE_MS && now - lastSaveMs > SAVE_MIN_GAP_MS) {
    saveTextNow();
    lastEditMs = 0;
  }
}

function clampi(v, lo, hi) {
  return min(hi, max(lo, v));
}

function clampCaret() {
  caretIndex = clampi(caretIndex, 0, textBuf.length);
}

function isPrintableChar(ch) {
  return typeof ch === "string" && ch.length === 1 && ch >= " ";
}

function measureRunWidth(str) {
  const ctx = drawingContext;
  if (ctx && typeof ctx.measureText === "function") {
    return ctx.measureText(str).width;
  }
  return textWidth(str);
}

function lineHeightForFontSize(fs) {
  textSize(fs);
  return max(12, (textAscent() + textDescent()) * 1.02);
}

function getLineIndexAtRaw(raw) {
  const idx = clampi(raw, 0, textBuf.length);
  let n = 0;
  for (let i = 0; i < idx; i++) {
    if (textBuf[i] === "\n") n++;
  }
  return n;
}

function getLineFontSize(lineIndex) {
  const v = Number(lineFontSizes[lineIndex]);
  if (Number.isFinite(v)) return clampi(round(v), MIN_FONT_SIZE, MAX_FONT_SIZE);
  return editorFontSize;
}

function setLineFontSize(lineIndex, fs) {
  lineFontSizes[lineIndex] = clampi(round(fs), MIN_FONT_SIZE, MAX_FONT_SIZE);
}

function shiftLineFontIndices(startIndex, delta) {
  if (delta === 0) return;
  const out = {};
  const keys = Object.keys(lineFontSizes)
    .map((k) => Number(k))
    .filter((k) => Number.isInteger(k) && k >= 0)
    .sort((a, b) => a - b);

  for (const k of keys) {
    const v = lineFontSizes[k];
    if (k >= startIndex) out[k + delta] = v;
    else out[k] = v;
  }
  lineFontSizes = out;
}

function removeLineFontAndShiftDown(removedIndex) {
  const out = {};
  const keys = Object.keys(lineFontSizes)
    .map((k) => Number(k))
    .filter((k) => Number.isInteger(k) && k >= 0)
    .sort((a, b) => a - b);

  for (const k of keys) {
    if (k === removedIndex) continue;
    if (k > removedIndex) out[k - 1] = lineFontSizes[k];
    else out[k] = lineFontSizes[k];
  }
  lineFontSizes = out;
}

function makeRow(rawStart, text, fs, lineIndex) {
  textSize(fs);
  const prefix = [0];
  for (let i = 1; i <= text.length; i++) {
    prefix.push(measureRunWidth(text.slice(0, i)));
  }

  return {
    rawStart,
    rawEnd: rawStart + text.length,
    text,
    prefix,
    fontSize: fs,
    rowHeight: lineHeightForFontSize(fs),
    lineIndex,
    yTop: 0,
  };
}

function pushWrappedRowsForLine(rows, lineText, lineRawStart, lineIndex, fs) {
  textSize(fs);

  if (lineText.length === 0) {
    rows.push(makeRow(lineRawStart, "", fs, lineIndex));
    return;
  }

  let segStart = 0;
  let seg = "";

  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    const candidate = seg + ch;

    if (seg.length > 0 && measureRunWidth(candidate) > innerWidth) {
      rows.push(makeRow(lineRawStart + segStart, seg, fs, lineIndex));
      segStart = i;
      seg = ch;
    } else {
      seg = candidate;
    }
  }

  rows.push(makeRow(lineRawStart + segStart, seg, fs, lineIndex));
}

function rebuildLayout() {
  const rows = [];

  if (textBuf.length === 0) {
    rows.push(makeRow(0, "", getLineFontSize(0), 0));
  } else {
    let lineStart = 0;
    let lineIndex = 0;

    while (lineStart <= textBuf.length) {
      const nl = textBuf.indexOf("\n", lineStart);
      const lineEnd = nl === -1 ? textBuf.length : nl;
      const lineText = textBuf.slice(lineStart, lineEnd);
      const fs = getLineFontSize(lineIndex);

      pushWrappedRowsForLine(rows, lineText, lineStart, lineIndex, fs);

      if (nl === -1) break;
      lineStart = nl + 1;
      lineIndex++;
    }
  }

  let y = 0;
  for (const r of rows) {
    r.yTop = y;
    y += r.rowHeight;
  }

  layoutRows = rows;
  totalContentHeight = y;

  textSize(editorFontSize);
}

function findRowIndexByRaw(rawIdx) {
  if (layoutRows.length === 0) return 0;
  for (let i = 0; i < layoutRows.length; i++) {
    const row = layoutRows[i];
    if (rawIdx >= row.rawStart && rawIdx <= row.rawEnd) return i;
  }
  return layoutRows.length - 1;
}

function rawToVisual(rawIdx) {
  const safeRaw = clampi(rawIdx, 0, textBuf.length);
  const rowIdx = findRowIndexByRaw(safeRaw);
  const row = layoutRows[rowIdx];
  const offset = clampi(safeRaw - row.rawStart, 0, row.text.length);
  const x = row.prefix[offset] || 0;
  return { rowIdx, offset, x };
}

function rawAtXInRow(row, x) {
  const widths = row.prefix;
  if (x <= 0) return row.rawStart;
  const last = widths[widths.length - 1];
  if (x >= last) return row.rawEnd;

  for (let i = 1; i < widths.length; i++) {
    if (widths[i] >= x) {
      const prev = widths[i - 1];
      const pick = x - prev <= widths[i] - x ? i - 1 : i;
      return row.rawStart + pick;
    }
  }
  return row.rawEnd;
}

function ensureCaretVisible() {
  const cur = rawToVisual(caretIndex);
  const row = layoutRows[cur.rowIdx];
  const y0 = row.yTop;
  const y1 = row.yTop + row.rowHeight;

  if (y0 < viewTopY) viewTopY = y0;
  if (y1 > viewTopY + viewportHeight) viewTopY = y1 - viewportHeight;

  const maxTopY = max(0, totalContentHeight - viewportHeight);
  viewTopY = clampi(round(viewTopY), 0, round(maxTopY));
}

function redrawEditor(target) {
  if (!target) return;
  clampCaret();
  ensureCaretVisible();

  target.push();
  target.background(0);
  target.noStroke();
  target.textAlign(LEFT, TOP);
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    target.textFont(baseMonoFont);
  }

  const viewBottom = viewTopY + viewportHeight;
  for (let i = 0; i < layoutRows.length; i++) {
    const row = layoutRows[i];
    const rowBottom = row.yTop + row.rowHeight;
    if (rowBottom < viewTopY) continue;
    if (row.yTop > viewBottom) break;

    target.textSize(row.fontSize);
    target.textLeading(row.rowHeight);
    target.fill(255);
    const y = topPad + (row.yTop - viewTopY);
    target.text(row.text, leftPad, y);
  }

  const cur = rawToVisual(caretIndex);
  const row = layoutRows[cur.rowIdx];
  const cy = topPad + (row.yTop - viewTopY);
  const caretVisible = cy + row.rowHeight >= topPad && cy <= height;

  if (caretVisible && blinkOn) {
    textSize(row.fontSize);
    const desc = textDescent();
    const glyphH = textAscent() + desc;
    const overscan = max(1, round(row.fontSize * 0.06));
    const balanceUp = desc * 0.2;
    const caretY = cy - overscan - balanceUp;
    const caretH = max(2, glyphH + overscan * 2);
    const caretW = max(2, floor(row.fontSize * 0.12));
    const cx = leftPad + cur.x;

    target.noStroke();
    target.fill(255);
    target.rect(cx, caretY, caretW, caretH);
  }

  textSize(editorFontSize);
  target.pop();
}

function clearAll(alsoPersist = true) {
  textBuf = "";
  caretIndex = 0;
  preferredX = -1;
  viewTopY = 0;
  blinkOn = true;
  lastBlinkMs = millis();
  escCount = 0;
  lineFontSizes = {};
  saveFontSettings();
  if (alsoPersist) saveTextNow();
}

function mousePressed() {
  // Recover keyboard input quickly if browser focus shifted.
  try { window.focus(); } catch {}
  blinkOn = true;
  lastBlinkMs = millis();
}

function insertAtCaret(ch) {
  clampCaret();
  textBuf = textBuf.slice(0, caretIndex) + ch + textBuf.slice(caretIndex);
  caretIndex += ch.length;
  preferredX = -1;
  markEdited();
}

function insertNewlineAtCaret() {
  const lineIndex = getLineIndexAtRaw(caretIndex);
  const inheritSize = getLineFontSize(lineIndex);

  shiftLineFontIndices(lineIndex + 1, +1);
  setLineFontSize(lineIndex + 1, inheritSize);
  saveFontSettings();

  insertAtCaret("\n");
}

function backspaceAtCaret() {
  clampCaret();
  if (caretIndex === 0) return;

  const removed = textBuf[caretIndex - 1];
  if (removed === "\n") {
    const currentLine = getLineIndexAtRaw(caretIndex);
    removeLineFontAndShiftDown(currentLine);
    saveFontSettings();
  }

  textBuf = textBuf.slice(0, caretIndex - 1) + textBuf.slice(caretIndex);
  caretIndex--;
  preferredX = -1;
  markEdited();
}

function deleteAtCaret() {
  clampCaret();
  if (caretIndex >= textBuf.length) return;

  const removed = textBuf[caretIndex];
  if (removed === "\n") {
    const lineIndex = getLineIndexAtRaw(caretIndex);
    removeLineFontAndShiftDown(lineIndex + 1);
    saveFontSettings();
  }

  textBuf = textBuf.slice(0, caretIndex) + textBuf.slice(caretIndex + 1);
  preferredX = -1;
  markEdited();
}

function moveLeft() {
  clampCaret();
  if (caretIndex > 0) caretIndex--;
  preferredX = -1;
}

function moveRight() {
  clampCaret();
  if (caretIndex < textBuf.length) caretIndex++;
  preferredX = -1;
}

function moveUp() {
  const cur = rawToVisual(caretIndex);
  if (preferredX < 0) preferredX = cur.x;
  if (cur.rowIdx <= 0) return;
  caretIndex = rawAtXInRow(layoutRows[cur.rowIdx - 1], preferredX);
}

function moveDown() {
  const cur = rawToVisual(caretIndex);
  if (preferredX < 0) preferredX = cur.x;
  if (cur.rowIdx >= layoutRows.length - 1) return;
  caretIndex = rawAtXInRow(layoutRows[cur.rowIdx + 1], preferredX);
}

function insertTabAtCaret() {
  const cur = rawToVisual(caretIndex);
  const col = cur.offset;
  const spaces = TAB_WIDTH - (col % TAB_WIDTH);
  insertAtCaret(" ".repeat(spaces));
}

function adjustFontSize(delta) {
  const dir = delta > 0 ? 1 : (delta < 0 ? -1 : 0);
  if (dir === 0) return;

  const nextTypoSize = (current, d) => {
    const cur = clampi(round(current), MIN_FONT_SIZE, MAX_FONT_SIZE);
    if (d > 0) {
      for (let i = 0; i < TYPO_SCALE_STEPS.length; i++) {
        if (TYPO_SCALE_STEPS[i] > cur) return TYPO_SCALE_STEPS[i];
      }
      return MAX_FONT_SIZE;
    }
    for (let i = TYPO_SCALE_STEPS.length - 1; i >= 0; i--) {
      if (TYPO_SCALE_STEPS[i] < cur) return TYPO_SCALE_STEPS[i];
    }
    return MIN_FONT_SIZE;
  };

  if (RESIZE_APPLIES_TO_CURRENT_LINE) {
    const lineIndex = getLineIndexAtRaw(caretIndex);
    const next = nextTypoSize(getLineFontSize(lineIndex), dir);
    setLineFontSize(lineIndex, next);
    saveFontSettings();
  } else {
    editorFontSize = nextTypoSize(editorFontSize, dir);
    saveFontSettings();
  }
  preferredX = -1;
}

function handleEscTripleClear(ev) {
  if (ev.key !== "Escape") {
    if (escCount > 0 && millis() - escFirstMs > ESC_WINDOW_MS) escCount = 0;
    return false;
  }

  const now = millis();
  if (escCount === 0) {
    escCount = 1;
    escFirstMs = now;
    return true;
  }
  if (now - escFirstMs > ESC_WINDOW_MS) {
    escCount = 1;
    escFirstMs = now;
    return true;
  }

  escCount++;
  if (escCount >= 3) {
    escCount = 0;
    clearAll(true);
    try { window.focus(); } catch {}
  }
  return true;
}

function onDomKeyDown(ev) {
  rebuildLayout();

  if (handleEscTripleClear(ev)) {
    ev.preventDefault();
    return;
  }

  if (ev.ctrlKey && (ev.key === "l" || ev.key === "L")) {
    clearAll(true);
    ev.preventDefault();
    return;
  }

  const mod = !!(ev.ctrlKey || ev.metaKey);
  const keyStr = String(ev.key || "");
  const isIncrease = mod && (ev.code === "NumpadAdd" || keyStr === "+" || keyStr === "=");
  const isDecrease = mod && (ev.code === "NumpadSubtract" || keyStr === "-");

  if (isIncrease) {
    adjustFontSize(+1);
    ev.preventDefault();
    return;
  }
  if (isDecrease) {
    adjustFontSize(-1);
    ev.preventDefault();
    return;
  }
  if (mod && (ev.code === "Digit0" || ev.key === "0")) {
    if (RESIZE_APPLIES_TO_CURRENT_LINE) {
      setLineFontSize(getLineIndexAtRaw(caretIndex), DEFAULT_FONT_SIZE);
    } else {
      editorFontSize = DEFAULT_FONT_SIZE;
    }
    saveFontSettings();
    preferredX = -1;
    ev.preventDefault();
    return;
  }

  if (ev.key === "ArrowLeft") { moveLeft(); ev.preventDefault(); return; }
  if (ev.key === "ArrowRight") { moveRight(); ev.preventDefault(); return; }
  if (ev.key === "ArrowUp") { moveUp(); ev.preventDefault(); return; }
  if (ev.key === "ArrowDown") { moveDown(); ev.preventDefault(); return; }
  if (ev.key === "Backspace") { backspaceAtCaret(); ev.preventDefault(); return; }
  if (ev.key === "Delete") { deleteAtCaret(); ev.preventDefault(); return; }
  if (ev.key === "Enter") { insertNewlineAtCaret(); ev.preventDefault(); return; }
  if (ev.key === "Tab") { insertTabAtCaret(); ev.preventDefault(); return; }

  if (!ev.metaKey && !ev.ctrlKey && !ev.altKey && isPrintableChar(ev.key)) {
    insertAtCaret(ev.key);
    ev.preventDefault();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function getStoredPlaneCount() {
  try {
    const raw = Number(localStorage.getItem(PLANE_COUNT_STORAGE_KEY));
    if (Number.isFinite(raw)) return constrain(round(raw), MIN_PLANES, MAX_PLANES);
  } catch {}
  return MIN_PLANES;
}

function setStoredPlaneCount(count) {
  try {
    localStorage.setItem(
      PLANE_COUNT_STORAGE_KEY,
      String(constrain(round(count), MIN_PLANES, MAX_PLANES))
    );
  } catch {}
}

function planeName(index) {
  return `textprompt_surface_${index + 1}`;
}

function addPlane(persist = true) {
  if (!mapper || planes.length >= MAX_PLANES) return false;
  const name = planeName(planes.length);
  const surface = mapper.add(SURFACE_W, SURFACE_H, name);
  surface.imageMode(CORNER);
  planes.push({ name, surface });
  if (persist) setStoredPlaneCount(planes.length);
  return true;
}

function removePlane(persist = true) {
  if (!mapper || planes.length <= MIN_PLANES) return false;
  mapper.removeLastSurface({ clearStorage: true });
  planes.pop();
  if (persist) setStoredPlaneCount(planes.length);
  return true;
}

function renderPlanes() {
  for (const plane of planes) {
    plane.surface.push();
    plane.surface.background(0);
    plane.surface.image(editorSurface, 0, 0, plane.surface.width, plane.surface.height);
    plane.surface.pop();
  }
}

function renderMapperUi() {
  const compact = {
    width: 220,
    height: 22,
    fontSize: 11,
    padding: 5,
    margin: 3,
    rounding: 4,
    bgColor: "#d8d8d8",
  };

  uiListStart({ x: 24, y: 24, width: 220, dir: "vertical" });
  uiText("Text Prompt Mapper", {
    ...compact,
    height: 24,
    bgColor: "#ececec",
    hAlign: "center",
  });

  if (uiButton("Add Plane", compact).clicked) addPlane(true);
  if (uiButton("Remove Plane", compact).clicked) removePlane(true);
  if (uiButton("Clear Mapping", compact).clicked) mapper?.resetAll();

  uiText(`planes: ${planes.length}`, compact);
  uiText(`chars: ${textBuf.length}`, compact);
  uiText("same text on every plane", compact);

  uiListEnd();
}
