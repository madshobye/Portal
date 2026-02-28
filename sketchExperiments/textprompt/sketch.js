const TAB_WIDTH = 4;

const PREF_NS = "vgaedit";
const PREF_KEY = "text";
const STORAGE_KEY = `${PREF_NS}:${PREF_KEY}`;
const STORAGE_KEY_FONT_SIZE = `${PREF_NS}:fontSize`;

const SAVE_DEBOUNCE_MS = 700;
const SAVE_MIN_GAP_MS = 1500;
const ESC_WINDOW_MS = 1200;

let textBuf = "";
let caretIndex = 0;
let preferredX = -1;
let viewTopLine = 0;

let escCount = 0;
let escFirstMs = 0;

let lastEditMs = 0;
let lastSaveMs = 0;

let editorFontSize = 20;
let lineHeight = 26;
let leftPad = 16;
let topPad = 16;
let blinkOn = true;
let lastBlinkMs = 0;

let layoutRows = [];
let innerWidth = 0;
let visibleRows = 0;

function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();
  loadGoogleFont("Roboto Mono");
  textFont("Roboto Mono");

  loadText();
  caretIndex = textBuf.length;

  document.addEventListener("keydown", onDomKeyDown, { passive: false });
}

function draw() {
  background(0);
  fill(255);

  textFont("Roboto Mono");
  textSize(editorFontSize);
  updateMetrics();

  handleAutosave();
  rebuildLayout();
  redrawEditor();

  if (millis() - lastBlinkMs > 530) {
    blinkOn = !blinkOn;
    lastBlinkMs = millis();
  }
}

function adjustFontSize(delta) {
  editorFontSize = clampi(editorFontSize + delta, 10, 72);
  localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(editorFontSize));
  preferredX = -1;
}

function updateMetrics() {
  lineHeight = max(18, (textAscent() + textDescent()) * 1.35);
  textLeading(lineHeight);
  innerWidth = max(40, width - leftPad * 2);
  visibleRows = max(1, floor((height - topPad) / lineHeight));
}

function loadText() {
  const saved = localStorage.getItem(STORAGE_KEY);
  textBuf = saved == null ? "" : saved;
  const savedFontSize = Number(localStorage.getItem(STORAGE_KEY_FONT_SIZE));
  if (Number.isFinite(savedFontSize)) {
    editorFontSize = clampi(round(savedFontSize), 10, 72);
  }
  caretIndex = textBuf.length;
  preferredX = -1;
  viewTopLine = 0;
}

function saveTextNow() {
  localStorage.setItem(STORAGE_KEY, textBuf);
  lastSaveMs = millis();
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

function makeRow(rawStart, text) {
  const prefix = [0];
  for (let i = 1; i <= text.length; i++) {
    prefix.push(measureRunWidth(text.slice(0, i)));
  }
  return {
    rawStart,
    rawEnd: rawStart + text.length,
    text,
    prefix,
  };
}

function rebuildLayout() {
  const rows = [];

  if (textBuf.length === 0) {
    rows.push(makeRow(0, ""));
    layoutRows = rows;
    return;
  }

  let rowStart = 0;
  let rowText = "";

  for (let i = 0; i < textBuf.length; i++) {
    const ch = textBuf[i];

    if (ch === "\n") {
      rows.push(makeRow(rowStart, rowText));
      rowStart = i + 1;
      rowText = "";
      continue;
    }

    const candidate = rowText + ch;
    if (rowText.length > 0 && textWidth(candidate) > innerWidth) {
      rows.push(makeRow(rowStart, rowText));
      rowStart = i;
      rowText = ch;
    } else {
      rowText = candidate;
    }
  }

  rows.push(makeRow(rowStart, rowText));
  layoutRows = rows;
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

  if (cur.rowIdx < viewTopLine) viewTopLine = cur.rowIdx;
  if (cur.rowIdx >= viewTopLine + visibleRows) viewTopLine = cur.rowIdx - visibleRows + 1;

  const maxTop = max(0, layoutRows.length - visibleRows);
  viewTopLine = clampi(viewTopLine, 0, maxTop);
}

function redrawEditor() {
  clampCaret();
  ensureCaretVisible();

  fill(255);
  noStroke();
  textAlign(LEFT, TOP);

  for (let vr = 0; vr < visibleRows; vr++) {
    const idx = viewTopLine + vr;
    if (idx >= layoutRows.length) break;
    text(layoutRows[idx].text, leftPad, topPad + vr * lineHeight);
  }

  const cur = rawToVisual(caretIndex);
  const visRow = cur.rowIdx - viewTopLine;
  if (visRow >= 0 && visRow < visibleRows && blinkOn) {
    const cx = leftPad + cur.x;
    const cy = topPad + visRow * lineHeight;
    const desc = textDescent();
    const glyphH = textAscent() + desc;
    const overscan = max(1, round(editorFontSize * 0.06));
    const balanceUp = desc * 0.2;
    const caretY = cy - overscan - balanceUp;
    const caretH = max(2, glyphH + overscan * 2);
    const caretW = max(2, floor(editorFontSize * 0.12));
    noStroke();
    fill(255, 255, 255, 220);
    rect(cx, caretY, caretW, caretH);
    stroke(255);
    line(cx + caretW + 1, caretY, cx + caretW + 1, caretY + caretH);
    noStroke();
  }
}

function clearAll(alsoPersist = true) {
  textBuf = "";
  caretIndex = 0;
  preferredX = -1;
  viewTopLine = 0;
  if (alsoPersist) saveTextNow();
}

function insertAtCaret(ch) {
  clampCaret();
  textBuf = textBuf.slice(0, caretIndex) + ch + textBuf.slice(caretIndex);
  caretIndex += ch.length;
  preferredX = -1;
  markEdited();
}

function insertNewlineAtCaret() {
  insertAtCaret("\n");
}

function backspaceAtCaret() {
  clampCaret();
  if (caretIndex === 0) return;
  textBuf = textBuf.slice(0, caretIndex - 1) + textBuf.slice(caretIndex);
  caretIndex--;
  preferredX = -1;
  markEdited();
}

function deleteAtCaret() {
  clampCaret();
  if (caretIndex >= textBuf.length) return;
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
  if (mod && (ev.key === "+" || ev.key === "=" || ev.code === "NumpadAdd")) {
    adjustFontSize(+1);
    ev.preventDefault();
    return;
  }
  if (mod && (ev.key === "-" || ev.code === "NumpadSubtract")) {
    adjustFontSize(-1);
    ev.preventDefault();
    return;
  }
  if (mod && ev.key === "0") {
    editorFontSize = 20;
    localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(editorFontSize));
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
