const CONFIG_URL = "./config.json";
const MAX_CONVERSATION_ITEMS = 24;
const MAX_DEBUG_ITEMS = 40;

const COLORS = {
  background: "#171512",
  panel: "#24211d",
  panelLine: "#39342d",
  cream: "#f4ead6",
  muted: "#aaa08f",
  orange: "#ff8a3d",
  orangeSoft: "#5e3825",
  green: "#94d9a2",
  yellow: "#f2ca72",
  red: "#ef806f",
};

let config;
let speech;
let mappingByKey = new Map();

let conversationLog = [];
let debugLog = [];
let pressedKeys = new Set();
let strikeCandidates = [];
let strikeOpen = false;
let strikeLocked = false;
let strikeTimer = null;
let unlockTimer = null;
let safetyUnlockTimer = null;

let appState = "LOADING";
let lastPhysicalKey = "—";
let lastChosenKey = null;
let lastChosenAt = 0;
let speechError = "";
let speechQueue = Promise.resolve();
let queuedSpeechCount = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  textFont("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");

  try {
    config = await getData(CONFIG_URL);
    validateConfig(config);
    buildMappingIndex();

    await loadScript("portal/speech.js");
    speech = await new PortalSpeech({
      language: config.language || "en-US",
      voice: config.voice || null,
      rate: config.speech?.rate ?? 1,
      pitch: config.speech?.pitch ?? 1,
      volume: config.speech?.volume ?? 1,
    }).init();
    const selectedVoice = selectPreferredVoice();

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", resetInputState);

    appState = "READY";
    addDebug("system", `${mappingByKey.size} words loaded — keyboard ready`);
    addDebug("system", `Voice — ${selectedVoice}`);
  } catch (error) {
    appState = "ERROR";
    speechError = String(error?.message || error);
    console.error(error);
  }
}

function selectPreferredVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return "browser default";

  const preferredNames = Array.isArray(config.voiceCandidates)
    ? config.voiceCandidates
    : [];
  let selected = null;

  if (config.voice) {
    selected = voices.find(
      (voice) => voice.name.toLowerCase() === String(config.voice).toLowerCase()
    );
  }

  for (const preferredName of preferredNames) {
    if (selected) break;
    selected = voices.find(
      (voice) => voice.name.toLowerCase() === String(preferredName).toLowerCase()
    );
  }

  const wantedLanguage = String(config.language || "en-US").toLowerCase();
  if (!selected) {
    const exactLanguageVoices = voices.filter(
      (voice) => String(voice.lang || "").toLowerCase() === wantedLanguage
    );
    selected =
      exactLanguageVoices.find((voice) => voice.default) ||
      exactLanguageVoices.find((voice) => voice.localService) ||
      exactLanguageVoices[0];
  }

  if (!selected) {
    const languageRoot = wantedLanguage.split("-")[0];
    selected = voices.find((voice) =>
      String(voice.lang || "").toLowerCase().startsWith(languageRoot)
    );
  }

  if (!selected) return "browser default";
  speech.setVoice(selected.name);
  return `${selected.name} (${selected.lang})`;
}

function draw() {
  background(COLORS.background);
  drawHeader();

  const layout = getLayout();
  drawConversationPanel(layout.conversation);
  drawDebugPanel(layout.debug);
  drawMappingPanel(layout.mapping);
}

function validateConfig(value) {
  if (!value || !Array.isArray(value.mappings)) {
    throw new Error("config.json must contain a mappings array");
  }

  const seen = new Set();
  for (const item of value.mappings) {
    const keyName = normalizeConfigKey(item?.key);
    if (!keyName || !item?.word) {
      throw new Error("Every mapping needs a key and word");
    }
    if (seen.has(keyName)) throw new Error(`Duplicate key mapping: ${keyName}`);
    seen.add(keyName);
  }
}

function buildMappingIndex() {
  mappingByKey = new Map();
  for (let index = 0; index < config.mappings.length; index++) {
    const item = config.mappings[index];
    const keyName = normalizeConfigKey(item.key);
    mappingByKey.set(keyName, {
      ...item,
      key: keyName,
      priority: Number(item.priority) || 0,
      configOrder: index,
    });
  }
}

function normalizeConfigKey(value) {
  const keyName = String(value ?? "").trim();
  if (!keyName) return "";
  return keyName.length === 1 ? keyName.toUpperCase() : keyName;
}

function normalizeEventKey(event) {
  const value = String(event.key ?? "");
  if (!value) return "UNKNOWN";
  if (value === " ") return "SPACE";
  return value.length === 1 ? value.toUpperCase() : value.toUpperCase();
}

function handleKeyDown(event) {
  const keyName = normalizeEventKey(event);
  const mapping = mappingByKey.get(keyName) || null;
  lastPhysicalKey = keyName;

  if (mapping) event.preventDefault();

  if (event.repeat || pressedKeys.has(keyName)) {
    addDebug("ignored", `${keyName} ignored — key repeat`);
    return;
  }

  pressedKeys.add(keyName);

  if (strikeLocked) {
    addDebug(
      "ignored",
      `${keyName} ignored — same paw strike${mapping ? ` (${mapping.word})` : ""}`
    );
    return;
  }

  if (!strikeOpen) openStrike();

  strikeCandidates.push({
    key: keyName,
    mapping,
    time: performance.now(),
  });

  addDebug(
    mapping ? "candidate" : "ignored",
    mapping ? `${keyName} candidate — ${mapping.word}` : `${keyName} unmapped`
  );
}

function handleKeyUp(event) {
  pressedKeys.delete(normalizeEventKey(event));
  if (strikeLocked && pressedKeys.size === 0) scheduleUnlock();
}

function openStrike() {
  strikeOpen = true;
  strikeCandidates = [];
  clearTimeout(strikeTimer);

  strikeTimer = setTimeout(
    resolveStrike,
    Number(config.input?.collectionWindowMs) || 55
  );
}

function resolveStrike() {
  strikeOpen = false;
  strikeLocked = true;

  const mappedCandidates = strikeCandidates
    .filter((candidate) => candidate.mapping)
    .sort((a, b) => {
      const priorityDifference = b.mapping.priority - a.mapping.priority;
      if (priorityDifference !== 0) return priorityDifference;
      if (a.time !== b.time) return a.time - b.time;
      return a.mapping.configOrder - b.mapping.configOrder;
    });

  const chosen = mappedCandidates[0] || null;
  if (chosen) {
    chooseWord(chosen);

    for (const candidate of strikeCandidates) {
      if (candidate === chosen) continue;
      addDebug(
        "ignored",
        candidate.mapping
          ? `${candidate.key} lost arbitration to ${chosen.key}`
          : `${candidate.key} ignored — unmapped`
      );
    }
  } else {
    const names = strikeCandidates.map((candidate) => candidate.key).join(" + ");
    addDebug("ignored", `${names || "No key"} — no mapped key in strike`);
  }

  clearTimeout(safetyUnlockTimer);
  safetyUnlockTimer = setTimeout(
    unlockStrike,
    Number(config.input?.maximumLockMs) || 1500
  );

  if (pressedKeys.size === 0) scheduleUnlock();
}

function chooseWord(candidate) {
  const entry = {
    key: candidate.key,
    word: candidate.mapping.word,
    time: new Date(),
  };

  conversationLog.unshift(entry);
  conversationLog = conversationLog.slice(0, MAX_CONVERSATION_ITEMS);
  lastChosenKey = candidate.key;
  lastChosenAt = millis();
  addDebug("chosen", `${candidate.key} selected — saying “${candidate.mapping.word}”`);
  speakMapping(candidate.mapping);
}

function speakMapping(mapping) {
  if (!speech) return;
  queuedSpeechCount += 1;
  appState = "SPEAKING";

  speechQueue = speechQueue
    .catch(() => {})
    .then(async () => {
      speechError = "";
      await speech.speak(mapping.say || mapping.word, config.language || "en-US");
    })
    .catch((error) => {
      speechError = String(error?.message || error);
      addDebug("error", `Speech error — ${speechError}`);
    })
    .finally(() => {
      queuedSpeechCount = max(0, queuedSpeechCount - 1);
      appState = queuedSpeechCount > 0 ? "SPEAKING" : speechError ? "ERROR" : "READY";
    });
}

function scheduleUnlock() {
  clearTimeout(unlockTimer);
  const configuredDelay = Number(config.input?.releaseCooldownMs);
  const delay = Number.isFinite(configuredDelay) ? max(0, configuredDelay) : 180;
  unlockTimer = setTimeout(unlockStrike, delay);
}

function unlockStrike() {
  clearTimeout(unlockTimer);
  clearTimeout(safetyUnlockTimer);
  strikeCandidates = [];
  strikeOpen = false;
  strikeLocked = false;
}

function resetInputState() {
  clearTimeout(strikeTimer);
  pressedKeys.clear();
  unlockStrike();
  addDebug("system", "Input reset — window lost focus");
}

function addDebug(kind, message) {
  debugLog.unshift({ kind, message, time: new Date() });
  debugLog = debugLog.slice(0, MAX_DEBUG_ITEMS);
}

function getLayout() {
  const margin = 22;
  const gap = 14;
  const top = 104;
  const bottom = 22;
  const contentHeight = max(100, height - top - bottom);

  if (width >= 900) {
    const available = width - margin * 2 - gap * 2;
    const conversationWidth = available * 0.42;
    const debugWidth = available * 0.25;
    return {
      conversation: { x: margin, y: top, w: conversationWidth, h: contentHeight },
      debug: {
        x: margin + conversationWidth + gap,
        y: top,
        w: debugWidth,
        h: contentHeight,
      },
      mapping: {
        x: margin + conversationWidth + debugWidth + gap * 2,
        y: top,
        w: available - conversationWidth - debugWidth,
        h: contentHeight,
      },
    };
  }

  const sectionGap = 10;
  const sectionHeight = (contentHeight - sectionGap * 2) / 3;
  return {
    conversation: { x: margin, y: top, w: width - margin * 2, h: sectionHeight },
    debug: {
      x: margin,
      y: top + sectionHeight + sectionGap,
      w: width - margin * 2,
      h: sectionHeight,
    },
    mapping: {
      x: margin,
      y: top + (sectionHeight + sectionGap) * 2,
      w: width - margin * 2,
      h: sectionHeight,
    },
  };
}

function drawHeader() {
  const stateColor =
    appState === "ERROR"
      ? COLORS.red
      : appState === "SPEAKING"
        ? COLORS.orange
        : COLORS.green;

  noStroke();
  fill(COLORS.cream);
  textStyle(BOLD);
  textSize(28);
  text("CAT TALK", 22, 42);

  fill(COLORS.muted);
  textStyle(NORMAL);
  textSize(12);
  text("USB KEYBOARD → ONE PAW STRIKE → ONE SPOKEN WORD", 22, 67);

  const statusX = width - 22;
  fill(stateColor);
  circle(statusX - 78, 36, 9);
  textAlign(RIGHT, CENTER);
  textStyle(BOLD);
  textSize(12);
  text(appState, statusX, 36);
  textAlign(LEFT, BASELINE);
}

function drawPanelFrame(rectangle, title, countText) {
  noStroke();
  fill(COLORS.panel);
  rect(rectangle.x, rectangle.y, rectangle.w, rectangle.h, 12);

  stroke(COLORS.panelLine);
  strokeWeight(1);
  line(
    rectangle.x + 14,
    rectangle.y + 48,
    rectangle.x + rectangle.w - 14,
    rectangle.y + 48
  );

  noStroke();
  fill(COLORS.cream);
  textStyle(BOLD);
  textSize(13);
  text(title, rectangle.x + 16, rectangle.y + 29);

  fill(COLORS.muted);
  textAlign(RIGHT, BASELINE);
  textStyle(NORMAL);
  textSize(10);
  text(countText, rectangle.x + rectangle.w - 16, rectangle.y + 29);
  textAlign(LEFT, BASELINE);
}

function drawConversationPanel(rectangle) {
  drawPanelFrame(rectangle, "CONVERSATION", `${conversationLog.length} WORDS`);

  if (!conversationLog.length) {
    fill(COLORS.muted);
    textStyle(NORMAL);
    textSize(12);
    text("Waiting for the first paw press…", rectangle.x + 16, rectangle.y + 78);
    return;
  }

  const rowHeight = 54;
  const maxRows = floor((rectangle.h - 60) / rowHeight);
  for (let index = 0; index < min(maxRows, conversationLog.length); index++) {
    const entry = conversationLog[index];
    const y = rectangle.y + 62 + index * rowHeight;
    const isFresh = index === 0 && millis() - lastChosenAt < 700;

    noStroke();
    fill(isFresh ? COLORS.orangeSoft : COLORS.background);
    rect(rectangle.x + 12, y, rectangle.w - 24, rowHeight - 7, 8);

    drawKeyBadge(entry.key, rectangle.x + 22, y + 10, 28);

    fill(COLORS.cream);
    textStyle(BOLD);
    textSize(rectangle.w < 340 ? 15 : 18);
    text(entry.word, rectangle.x + 62, y + 28);

    fill(COLORS.muted);
    textAlign(RIGHT, BASELINE);
    textStyle(NORMAL);
    textSize(10);
    text(formatTime(entry.time), rectangle.x + rectangle.w - 22, y + 27);
    textAlign(LEFT, BASELINE);
  }
}

function drawDebugPanel(rectangle) {
  const lockLabel = strikeLocked ? "LOCKED" : strikeOpen ? "COLLECTING" : "OPEN";
  drawPanelFrame(rectangle, "INPUT DEBUG", lockLabel);

  const summaryY = rectangle.y + 65;
  fill(COLORS.muted);
  textStyle(NORMAL);
  textSize(10);
  text(`LAST KEY  ${lastPhysicalKey}`, rectangle.x + 16, summaryY);
  text(`HELD      ${pressedKeys.size ? [...pressedKeys].join(" + ") : "—"}`, rectangle.x + 16, summaryY + 17);

  const rowHeight = 35;
  const startY = summaryY + 32;
  const maxRows = floor((rectangle.y + rectangle.h - startY - 8) / rowHeight);

  for (let index = 0; index < min(maxRows, debugLog.length); index++) {
    const entry = debugLog[index];
    const y = startY + index * rowHeight;
    const dotColor =
      entry.kind === "chosen"
        ? COLORS.green
        : entry.kind === "error"
          ? COLORS.red
          : entry.kind === "candidate"
            ? COLORS.yellow
            : COLORS.muted;

    noStroke();
    fill(dotColor);
    circle(rectangle.x + 18, y + 7, 6);

    fill(entry.kind === "ignored" ? COLORS.muted : COLORS.cream);
    textStyle(NORMAL);
    textSize(10);
    const availableWidth = rectangle.w - 48;
    text(clipText(entry.message, availableWidth), rectangle.x + 29, y + 10);

    fill(COLORS.muted);
    textSize(8);
    text(formatTime(entry.time), rectangle.x + 29, y + 24);
  }
}

function drawMappingPanel(rectangle) {
  const mappings = config?.mappings || [];
  drawPanelFrame(rectangle, "KEY MAP", `${mappings.length} MAPPED`);

  if (!mappings.length) return;

  const usableHeight = rectangle.h - 64;
  const rowHeight = 39;
  const rowsPerColumn = max(1, floor(usableHeight / rowHeight));
  const columnCount = ceil(mappings.length / rowsPerColumn);
  const columnWidth = (rectangle.w - 24) / columnCount;

  for (let index = 0; index < mappings.length; index++) {
    const column = floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const item = mappings[index];
    const keyName = normalizeConfigKey(item.key);
    const x = rectangle.x + 12 + column * columnWidth;
    const y = rectangle.y + 61 + row * rowHeight;
    const isActive = keyName === lastChosenKey && millis() - lastChosenAt < 700;

    if (isActive) {
      noStroke();
      fill(COLORS.orangeSoft);
      rect(x, y - 5, columnWidth - 6, 33, 7);
    }

    drawKeyBadge(keyName, x + 5, y, 25);

    fill(isActive ? COLORS.orange : COLORS.cream);
    textStyle(BOLD);
    textSize(columnWidth < 125 ? 10 : 12);
    text(
      clipText(item.word, columnWidth - 47),
      x + 39,
      y + 17
    );
  }
}

function drawKeyBadge(keyName, x, y, size) {
  noStroke();
  fill(COLORS.orange);
  rect(x, y, size, size, 6);

  fill(COLORS.background);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(size * 0.48);
  text(keyName, x + size * 0.5, y + size * 0.5 + 1);
  textAlign(LEFT, BASELINE);
}

function clipText(value, maxWidth) {
  const source = String(value ?? "");
  if (textWidth(source) <= maxWidth) return source;

  let output = source;
  while (output.length > 1 && textWidth(`${output}…`) > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}…`;
}

function formatTime(date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
