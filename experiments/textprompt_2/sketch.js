const TAB_WIDTH = 4;
const showOverlay = false;

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
const PARTICIPANT_COLORS = [
  "#ffffff",
  "#5ad1ff",
  "#ff8c42",
  "#9cff57",
  "#ff5db1",
  "#ffd84d",
  "#b58cff",
  "#3df2c2"
];

let textBuf = "";
let viewTopY = 0;

let escCount = 0;
let escFirstMs = 0;

let lastEditMs = 0;
let lastSaveMs = 0;

let editorFontSize = DEFAULT_FONT_SIZE;
let leftPad = 16;
let topPad = 32;
let blinkOn = true;
let lastBlinkMs = 0;

let layoutRows = [];
let innerWidth = 0;
let viewportHeight = 0;
let totalContentHeight = 0;

let lineFontSizes = {}; // key: logical line index (0-based), value: font size
let participants = [];
let participantById = new Map();
let activeParticipantId = "";

function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();
  loadGoogleFont("Roboto Mono");
  textFont("Roboto Mono");

  loadTextAndStyle();
  ensureParticipant("shared", { label: "shared", color: PARTICIPANT_COLORS[0] });
  setParticipantCaret("shared", textBuf.length);
  activeParticipantId = "shared";

  // Use window-level capture so key handling survives focus quirks after Esc/fullscreen changes.
  window.addEventListener("keydown", onDomKeyDown, { passive: false, capture: true });
  window.addEventListener("portal-keydown", onPortalDeviceKeyDown, { passive: false });
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

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function updateMetrics() {
  innerWidth = max(40, width - leftPad * 2);
  viewportHeight = max(1, height - topPad - 8);
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

function getParticipant(id) {
  return participantById.get(String(id)) || null;
}

function ensureParticipant(id, opts = {}) {
  const key = String(id || "shared");
  let participant = getParticipant(key);
  if (participant) return participant;

  const index = participants.length;
  participant = {
    id: key,
    label: String(opts.label || `kb${index + 1}`),
    color: opts.color || PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length],
    caretIndex: clampi(textBuf.length, 0, textBuf.length),
    preferredX: -1,
  };
  participants.push(participant);
  participantById.set(key, participant);
  return participant;
}

function setParticipantCaret(id, rawIndex) {
  const participant = ensureParticipant(id);
  participant.caretIndex = clampi(rawIndex, 0, textBuf.length);
}

function getActiveParticipant() {
  return ensureParticipant(activeParticipantId || "shared");
}

function transformIndexAfterEdit(index, start, removedCount, insertedCount) {
  const end = start + removedCount;
  if (index < start) return index;
  if (index <= end) return start + insertedCount;
  return index + insertedCount - removedCount;
}

function applyTextEdit(participant, start, removedCount, insertedText, caretAfter) {
  const safeStart = clampi(start, 0, textBuf.length);
  const safeRemoved = clampi(removedCount, 0, textBuf.length - safeStart);
  const insertText = String(insertedText || "");

  textBuf = textBuf.slice(0, safeStart) + insertText + textBuf.slice(safeStart + safeRemoved);

  for (const p of participants) {
    if (p.id === participant.id) continue;
    p.caretIndex = clampi(
      transformIndexAfterEdit(p.caretIndex, safeStart, safeRemoved, insertText.length),
      0,
      textBuf.length
    );
  }

  participant.caretIndex = clampi(caretAfter, 0, textBuf.length);
  participant.preferredX = -1;
  markEdited();
}

function firstVisibleRowIndex() {
  for (let i = 0; i < layoutRows.length; i++) {
    const row = layoutRows[i];
    if (row.yTop + row.rowHeight > viewTopY) return i;
  }
  return 0;
}

function lastVisibleRowIndex() {
  const viewBottom = viewTopY + viewportHeight;
  for (let i = layoutRows.length - 1; i >= 0; i--) {
    const row = layoutRows[i];
    if (row.yTop < viewBottom) return i;
  }
  return max(0, layoutRows.length - 1);
}

function ensureActiveCaretVisible() {
  const participant = getActiveParticipant();
  const cur = rawToVisual(participant.caretIndex);
  const row = layoutRows[cur.rowIdx];
  const y0 = row.yTop;
  const y1 = row.yTop + row.rowHeight;

  if (y0 < viewTopY) viewTopY = y0;
  if (y1 > viewTopY + viewportHeight) viewTopY = y1 - viewportHeight;

  const maxTopY = max(0, totalContentHeight - viewportHeight);
  viewTopY = clampi(round(viewTopY), 0, round(maxTopY));
}

function snapParticipantIntoView(participant) {
  const cur = rawToVisual(participant.caretIndex);
  const row = layoutRows[cur.rowIdx];
  const viewBottom = viewTopY + viewportHeight;
  const isVisible = row.yTop + row.rowHeight > viewTopY && row.yTop < viewBottom;
  if (isVisible) return;

  const targetRowIndex = row.yTop < viewTopY ? firstVisibleRowIndex() : lastVisibleRowIndex();
  const targetRow = layoutRows[targetRowIndex];
  const targetX = participant.preferredX >= 0 ? participant.preferredX : cur.x;
  participant.caretIndex = rawAtXInRow(targetRow, targetX);
  participant.preferredX = targetX;
}

function keepAllCaretsVisible() {
  ensureActiveCaretVisible();
  for (const participant of participants) {
    if (participant.id === activeParticipantId) continue;
    snapParticipantIntoView(participant);
  }
}

function redrawEditor() {
  ensureActiveCaretVisible();
  keepAllCaretsVisible();

  noStroke();
  textAlign(LEFT, TOP);

  const viewBottom = viewTopY + viewportHeight;
  for (let i = 0; i < layoutRows.length; i++) {
    const row = layoutRows[i];
    const rowBottom = row.yTop + row.rowHeight;
    if (rowBottom < viewTopY) continue;
    if (row.yTop > viewBottom) break;

    textSize(row.fontSize);
    textLeading(row.rowHeight);
    fill(255);
    const y = topPad + (row.yTop - viewTopY);
    text(row.text, leftPad, y);
  }

  drawParticipantCarets();
  drawParticipantHud();

  textSize(editorFontSize);
}

function drawParticipantCarets() {
  for (const participant of participants) {
    const cur = rawToVisual(participant.caretIndex);
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

      noStroke();
      fill(participant.color);
      rect(cx, caretY, caretW, caretH);

      textSize(11);
      fill(participant.color);
      text(participant.label, cx + 4, max(2, caretY - 13));
    }
  }
}

function drawParticipantHud() {
  const boxPad = 8;
  let y = 6;
  textSize(12);
  for (const participant of participants) {
    const activeMark = participant.id === activeParticipantId ? "*" : " ";
    const label = `${activeMark}${participant.label}`;
    const w = textWidth(label) + boxPad * 2;
    noStroke();
    fill(0, 180);
    rect(6, y, w, 18, 4);
    fill(participant.color);
    text(label, 6 + boxPad, y + 3);
    y += 22;
  }

  const info = participantById.size > 1
    ? "Device-tagged input active. Chrome still needs an external bridge to identify physical keyboards."
    : "Chrome fallback: one shared keyboard stream. Per-keyboard IDs need a native or custom bridge.";
  fill(180);
  text(info, 6, y + 2);
}

function clearAll(alsoPersist = true) {
  textBuf = "";
  viewTopY = 0;
  blinkOn = true;
  lastBlinkMs = millis();
  escCount = 0;
  lineFontSizes = {};
  for (const participant of participants) {
    participant.caretIndex = 0;
    participant.preferredX = -1;
  }
  saveFontSettings();
  if (alsoPersist) saveTextNow();
}

function mousePressed() {
  // Recover keyboard input quickly if browser focus shifted.
  try { window.focus(); } catch {}
  blinkOn = true;
  lastBlinkMs = millis();
}

function insertAtCaret(participant, ch) {
  applyTextEdit(participant, participant.caretIndex, 0, ch, participant.caretIndex + ch.length);
}

function insertNewlineAtCaret(participant) {
  const lineIndex = getLineIndexAtRaw(participant.caretIndex);
  const inheritSize = getLineFontSize(lineIndex);

  shiftLineFontIndices(lineIndex + 1, +1);
  setLineFontSize(lineIndex + 1, inheritSize);
  saveFontSettings();

  insertAtCaret(participant, "\n");
}

function backspaceAtCaret(participant) {
  if (participant.caretIndex === 0) return;

  const removed = textBuf[participant.caretIndex - 1];
  if (removed === "\n") {
    const currentLine = getLineIndexAtRaw(participant.caretIndex);
    removeLineFontAndShiftDown(currentLine);
    saveFontSettings();
  }

  applyTextEdit(participant, participant.caretIndex - 1, 1, "", participant.caretIndex - 1);
}

function deleteAtCaret(participant) {
  if (participant.caretIndex >= textBuf.length) return;

  const removed = textBuf[participant.caretIndex];
  if (removed === "\n") {
    const lineIndex = getLineIndexAtRaw(participant.caretIndex);
    removeLineFontAndShiftDown(lineIndex + 1);
    saveFontSettings();
  }

  applyTextEdit(participant, participant.caretIndex, 1, "", participant.caretIndex);
}

function moveLeft(participant) {
  if (participant.caretIndex > 0) participant.caretIndex--;
  participant.preferredX = -1;
}

function moveRight(participant) {
  if (participant.caretIndex < textBuf.length) participant.caretIndex++;
  participant.preferredX = -1;
}

function moveUp(participant) {
  const cur = rawToVisual(participant.caretIndex);
  if (participant.preferredX < 0) participant.preferredX = cur.x;
  if (cur.rowIdx <= 0) return;
  participant.caretIndex = rawAtXInRow(layoutRows[cur.rowIdx - 1], participant.preferredX);
}

function moveDown(participant) {
  const cur = rawToVisual(participant.caretIndex);
  if (participant.preferredX < 0) participant.preferredX = cur.x;
  if (cur.rowIdx >= layoutRows.length - 1) return;
  participant.caretIndex = rawAtXInRow(layoutRows[cur.rowIdx + 1], participant.preferredX);
}

function insertTabAtCaret(participant) {
  const cur = rawToVisual(participant.caretIndex);
  const col = cur.offset;
  const spaces = TAB_WIDTH - (col % TAB_WIDTH);
  insertAtCaret(participant, " ".repeat(spaces));
}

function adjustFontSize(participant, delta) {
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
    const lineIndex = getLineIndexAtRaw(participant.caretIndex);
    const next = nextTypoSize(getLineFontSize(lineIndex), dir);
    setLineFontSize(lineIndex, next);
    saveFontSettings();
  } else {
    editorFontSize = nextTypoSize(editorFontSize, dir);
    saveFontSettings();
  }
  participant.preferredX = -1;
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

function getDeviceIdFromEvent(ev) {
  if (ev && ev.deviceId != null) return String(ev.deviceId);
  const detail = ev && ev.detail && typeof ev.detail === "object" ? ev.detail : null;
  if (detail?.deviceId != null) return String(detail.deviceId);
  if (detail?.participantId != null) return String(detail.participantId);
  return "shared";
}

function getLabelFromEvent(ev, id) {
  const detail = ev && ev.detail && typeof ev.detail === "object" ? ev.detail : null;
  if (detail?.label) return String(detail.label);
  if (detail?.deviceName) return String(detail.deviceName);
  return id === "shared" ? "shared" : `kb-${participants.length + 1}`;
}

function normalizeKeyEvent(ev) {
  const detail = ev && ev.detail && typeof ev.detail === "object" ? ev.detail : null;
  if (!detail) return ev;
  return {
    key: detail.key ?? "",
    code: detail.code ?? "",
    ctrlKey: !!detail.ctrlKey,
    metaKey: !!detail.metaKey,
    altKey: !!detail.altKey,
    shiftKey: !!detail.shiftKey,
    preventDefault() {
      if (typeof ev.preventDefault === "function") ev.preventDefault();
    }
  };
}

function handleKeyInput(rawEvent) {
  rebuildLayout();

  const id = getDeviceIdFromEvent(rawEvent);
  const participant = ensureParticipant(id, {
    label: getLabelFromEvent(rawEvent, id)
  });
  activeParticipantId = participant.id;

  const ev = normalizeKeyEvent(rawEvent);

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
    adjustFontSize(participant, +1);
    ev.preventDefault();
    return;
  }
  if (isDecrease) {
    adjustFontSize(participant, -1);
    ev.preventDefault();
    return;
  }
  if (mod && (ev.code === "Digit0" || ev.key === "0")) {
    if (RESIZE_APPLIES_TO_CURRENT_LINE) {
      setLineFontSize(getLineIndexAtRaw(participant.caretIndex), DEFAULT_FONT_SIZE);
    } else {
      editorFontSize = DEFAULT_FONT_SIZE;
    }
    saveFontSettings();
    participant.preferredX = -1;
    ev.preventDefault();
    return;
  }

  if (ev.key === "ArrowLeft") { moveLeft(participant); ev.preventDefault(); return; }
  if (ev.key === "ArrowRight") { moveRight(participant); ev.preventDefault(); return; }
  if (ev.key === "ArrowUp") { moveUp(participant); ev.preventDefault(); return; }
  if (ev.key === "ArrowDown") { moveDown(participant); ev.preventDefault(); return; }
  if (ev.key === "Backspace") { backspaceAtCaret(participant); ev.preventDefault(); return; }
  if (ev.key === "Delete") { deleteAtCaret(participant); ev.preventDefault(); return; }
  if (ev.key === "Enter") { insertNewlineAtCaret(participant); ev.preventDefault(); return; }
  if (ev.key === "Tab") { insertTabAtCaret(participant); ev.preventDefault(); return; }

  if (!ev.metaKey && !ev.ctrlKey && !ev.altKey && isPrintableChar(ev.key)) {
    insertAtCaret(participant, ev.key);
    ev.preventDefault();
  }
}

function onDomKeyDown(ev) {
  handleKeyInput(ev);
}

function onPortalDeviceKeyDown(ev) {
  handleKeyInput(ev);
}
