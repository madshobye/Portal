window.showOverlay = false;

let apiKeyEncryptedGpt222 ="U2FsdGVkX1/p9uf1wlE+/3dCyCS4rAqGptmHuLBLHho2qru9AlVgzkisqsfwUFT7AMAfoMzStNzJWmKuuzW2Tnh77Z7EeCl9eBPaBr0dwVlfEoOVXLmAo1tWJgx+PPR9YeScgTJbnUiUiGECMNkA75gA1VIg1qvv8MlbcqWB5brnBC5ScsXMHiHxxJcT6k7y8cT3hS2KzKAD2AJWlL43kTX3MwIx+nh+QadZNxGnKPEd3WJowq+qDdHEH6FvE7tM"

const DOC_MD_URL =
  "https://docs.google.com/document/d/1STeaNBuavGIx1TkRN86tqxEmbuVepys5Y5lBRhs4KyM/export?format=md&tab=t.0";
const MODEL_OPTIONS = [
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3",
  "gpt-5.2",
  "gpt-5",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "gpt-4o",
];
const DEFAULT_MODEL = "gpt-5.4-mini";
const STORAGE_PREFIX = "grumpynurse_v3";
const MODEL_KEY = `${STORAGE_PREFIX}.model`;
const SESSION_LANGUAGE_KEY = `${STORAGE_PREFIX}.sessionLanguage`;
const VOICE_KEY = `${STORAGE_PREFIX}.voice`;
const LISTENING_WANTED_KEY = `${STORAGE_PREFIX}.listeningWanted`;
const DEBUG_EXPORTS_KEY = `${STORAGE_PREFIX}.debugExports`;
const ADMIN_PANEL_HIDDEN_KEY = `${STORAGE_PREFIX}.adminHidden`; 
const CHAT_HISTORY_LIMIT = 30;
const ADMIN_LOG_LIMIT = 120;
const SILENCE_PROMPT_DELAYS_MS = [8000, 15000, 24000];
const SILENCE_PROMPT_RETRY_MS = 1200;
const VOICE_RECOGNITION_RESTART_DELAY_MS = 450;
const VOICE_ECHO_SUPPRESSION_MS = 900;
const SILENCE_READY_MS = 900;
const NO_RESPONSE_TIMEOUT_MS = 90 * 1000;
const FINAL_SPEECH_STABILIZE_MS = 280;
const SPEECH_SETTLE_MAX_WAIT_MS = 22000;
const SPEECH_SETTLE_QUIET_MS = 220;
const LISTENING_BRIDGE_MS = 700;
const GPT_TEMPERATURE = 0.8;
const GPT_MAX_TOKENS = 500;
const STAGE_BUBBLE_LIMIT = 14;
const START_VOICE_PATTERNS = [
  /\bi am ready\b/,
  /\bim ready\b/,
  /\bready\b/,
  /\blets go\b/,
  /\blet us go\b/,
  /\bhelp\b/,
  /\bjeg er klar\b/,
  /\bklar\b/,
  /\bhjaelp\b/,
  /\blad os gaa\b/,
  /\blos gehts\b/,
  /\bich bin bereit\b/,
  /\bbereit\b/,
  /\bhilfe\b/,
];
const DEFAULT_MOOD = {
  label: "grumpy",
  valence: -0.22,
  arousal: 0.2,
  dominance: 0.46,
  tension: 0.58,
};
const SESSION_LANGUAGE_OPTIONS = [
  { id: "en-GB", label: "English", promptLabel: "English" },
  { id: "da-DK", label: "Danish", promptLabel: "Danish" },
  { id: "de-DE", label: "German", promptLabel: "German" },
];
const CURATED_VOICE_PROFILES = [
  {
    id: "auto",
    label: "Auto",
    candidates: [],
  },
  {
    id: "en_female_flo",
    label: "English Female: Flo",
    candidates: [
      "Google UK English Female",
      "Google US English",
      "Flo (English (United Kingdom))",
      "Flo (English (United States))",
      "Flo",
    ],
  },
  {
    id: "en_male_eddy",
    label: "English Male: Eddy",
    candidates: [
      "Google UK English Male",
      "Eddy (English (United Kingdom))",
      "Eddy (English (United States))",
      "Eddy",
    ],
  },
  {
    id: "de_female_flo",
    label: "German Female: Flo",
    candidates: [
      "Google Deutsch",
      "Flo (German (Germany))",
      "Anna",
      "Helena",
    ],
  },
  {
    id: "de_male_eddy",
    label: "German Male: Eddy",
    candidates: [
      "Google Deutsch",
      "Eddy (German (Germany))",
      "Grandpa (German (Germany))",
    ],
  },
  {
    id: "da_female_flo",
    label: "Danish Female: Flo",
    candidates: [
      "Google dansk",
      "Flo (Danish (Denmark))",
      "Sara",
      "Alva",
    ],
  },
  {
    id: "da_male_eddy",
    label: "Danish Male: Eddy",
    candidates: [
      "Google dansk",
      "Eddy (Danish (Denmark))",
      "Magnus",
      "Grandpa (Danish (Denmark))",
    ],
  },
  {
    id: "chrome_en_female",
    label: "Chrome English Female",
    candidates: [
      "Google UK English Female",
      "Google US English",
      "Flo (English (United Kingdom))",
      "Samantha",
    ],
  },
  {
    id: "chrome_en_male",
    label: "Chrome English Male",
    candidates: [
      "Google UK English Male",
      "Daniel (English (United Kingdom))",
      "Arthur",
      "Eddy (English (United Kingdom))",
    ],
  },
  {
    id: "chrome_de",
    label: "Chrome German",
    candidates: [
      "Google Deutsch",
      "Flo (German (Germany))",
      "Eddy (German (Germany))",
      "Anna",
    ],
  },
  {
    id: "chrome_da",
    label: "Chrome Danish",
    candidates: [
      "Google dansk",
      "Flo (Danish (Denmark))",
      "Eddy (Danish (Denmark))",
      "Sara",
    ],
  },
  {
    id: "en_male_daniel",
    label: "English Male: Daniel",
    candidates: ["Daniel (English (United Kingdom))", "Arthur"],
  },
  {
    id: "en_female_samantha",
    label: "English Female: Samantha",
    candidates: ["Samantha", "Flo (English (United States))"],
  },
  {
    id: "de_female_anna",
    label: "German Female: Anna",
    candidates: ["Anna", "Helena", "Flo (German (Germany))"],
  },
  {
    id: "de_female_helena",
    label: "German Female: Helena",
    candidates: ["Helena", "Anna"],
  },
  {
    id: "older_female_grandma_en",
    label: "Interesting: Grandma EN",
    candidates: ["Grandma (English (United Kingdom))", "Grandma (English (United States))"],
  },
  {
    id: "older_male_grandpa_en",
    label: "Interesting: Grandpa EN",
    candidates: ["Grandpa (English (United Kingdom))", "Grandpa (English (United States))"],
  },
  {
    id: "interesting_arthur",
    label: "Interesting: Arthur",
    candidates: ["Arthur", "Daniel (English (United Kingdom))"],
  },
  {
    id: "interesting_fred",
    label: "Interesting: Fred",
    candidates: ["Fred", "Eddy (English (United States))"],
  },
  {
    id: "interesting_kathy",
    label: "Interesting: Kathy",
    candidates: ["Kathy", "Samantha"],
  },
];

let apiKey = "";
let gpt;
let promptDocMd = "";
let appRoot;
let shellEl;
let adminEl;
let canvasColumnEl;
let canvasHostEl;
let mainEl;
let conversationEl;
let introEl;
let taskEl;
let chatEl;
let optionsEl;
let inputEl;
let startConversationButton;
let listeningIndicatorBubble = null;
let debugButton;
let adminToggleButton;
let statusEl;
let modelSelectEl;
let languageSelectEl;
let voiceSelectEl;
let listenButton;
let adminConsoleEl;
let askInFlight = false;
let selectedModel = DEFAULT_MODEL;
let selectedSessionLanguage = "en-GB";
let selectedVoice = "";
let debugExportsEnabled = false;
let adminPanelHidden = false;
let chatHistory = [];
let currentTask = "";
let currentOptions = [];
let currentTipText = "";
let pendingTipText = "";
let currentSilencePrompts = [];
let silencePromptTimeouts = [];
let lastAssistantTurnEndedAt = 0;
let currentMood = { ...DEFAULT_MOOD };
let speech;
let heardSentence = "";
let pendingRecognizedSentence = "";
let pendingRecognizedAt = 0;
let voicesChangedHandler = null;
let suppressRecognitionUntil = 0;
let listeningWanted = true;
let listeningRestartTimeout = null;
let noResponseTimeoutId = null;
let noResponseDeadlineAt = 0;
let prestartVoiceReady = false;
let hasSessionInteraction = false;
let conversationStarted = false;
let listeningBridgeUntil = 0;
let faceAnimation = null;
let faceView = null;
let stageBubbleList = [];
let stageUiHitTargets = {
  startButton: null,
  voiceInitButton: null,
  adminToggle: null,
};
let stageTaskTopY = 0;

function debugInit(label, detail = null) {
  if (detail === null) {
    console.log(`[grumpynurse_v3:init] ${label}`);
    return;
  }
  console.log(`[grumpynurse_v3:init] ${label}`, detail);
}

const structuredSchemas = [
  {
    name: "nurse_reply",
    description: "Return the nurse roleplay answer and training metadata.",
    parameters: {
      type: "object",
      properties: {
        reply: { type: "string" },
        trainee_assessment: { type: "string" },
        next_focus: { type: "string" },
        cleaned_trainee_message: { type: "string" },
        task: { type: "string" },
        options: {
          type: "array",
          items: { type: "string" },
        },
        mood: {
          type: "object",
          properties: {
            label: { type: "string" },
            valence: { type: "number" },
            arousal: { type: "number" },
            dominance: { type: "number" },
            tension: { type: "number" },
          },
          required: ["label", "valence", "arousal", "dominance", "tension"],
        },
        silence_prompts: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "reply",
        "trainee_assessment",
        "next_focus",
        "cleaned_trainee_message",
        "task",
        "options",
        "mood",
        "silence_prompts",
      ],
    },
  },
];

async function setup() {
  debugInit("setup:start");
  await loadScript("portal/GptClient.js");
  debugInit("setup:loaded GptClient");
  await loadScript("portal/speech2.js");
  debugInit("setup:loaded speech2");
  await loadScript("portal/faceAnimation.js");
  debugInit("setup:loaded faceAnimation", {
    hasPortalFaceAnimation: !!window.PortalFaceAnimation,
  });

  apiKey = storedDecrypt({ apiKeyEncryptedGpt222 });
  selectedModel = loadSelectedModel();
  selectedSessionLanguage = loadSelectedSessionLanguage();
  selectedVoice = loadSelectedVoice();
  listeningWanted = loadListeningWanted();
  debugExportsEnabled = loadDebugExportsEnabled();
  adminPanelHidden = loadAdminPanelHidden();
  debugInit("setup:state loaded", {
    selectedModel,
    selectedSessionLanguage,
    selectedVoice,
    listeningWanted,
    debugExportsEnabled,
    adminPanelHidden,
  });

  buildUi();
  debugInit("setup:ui built", {
    hasShell: !!shellEl?.elt,
    hasAdmin: !!adminEl?.elt,
    hasCanvasHost: !!canvasHostEl?.elt,
    hasConversation: !!conversationEl?.elt,
  });
  createMiddleCanvas();
  createFaceAnimation();
  debugInit("setup:face animation created", {
    hasFaceView: !!faceView,
    hasFaceAnimation: !!faceAnimation,
  });
  refreshVoiceOptions();
  setStatus("Loading prompt doc...");

  try {
    const initialVoiceName = pickVoiceNameForProfile(selectedVoice) || null;
    speech = await new PortalSpeech2({
      language: selectedSessionLanguage,
      voice: initialVoiceName,
      rate: 1,
      pitch: 1,
      volume: 1,
    }).init();
    applySelectedVoice();
    debugInit("setup:speech ready", {
      hasSpeech: !!speech,
      selectedVoice,
    });
    appendAdminLog("Voice setup: ready");
  } catch (err) {
    speech = null;
    debugInit("setup:speech error", {
      error: err?.message || String(err),
    });
    appendAdminLog(`Voice setup error: ${err?.message || String(err)}`);
  }

  setupVoiceRefresh();
  debugInit("setup:voice refresh configured");

  promptDocMd = await fetchPromptMarkdown();
  debugInit("setup:prompt fetched", {
    length: promptDocMd?.length || 0,
  });
  gpt = createClient();
  debugInit("setup:gpt client created", {
    hasGpt: !!gpt,
    model: selectedModel,
  });

  if (!promptDocMd) {
    appendSystemMessage("Prompt doc is empty or unavailable.");
  }
  setStatus(apiKey ? "Ready" : "Missing API key");
  debugInit("setup:done", {
    status: apiKey ? "Ready" : "Missing API key",
  });
}

function draw() {
  drawMiddleCanvas();
  if (listenButton) {
    listenButton.html(
      listeningWanted || speech?.isListening() || isSpeechOutputActive()
        ? "Stop Listening"
        : "Start Listening"
    );
  }
  syncListeningIndicator();
  if (!speech) return;
  if (speech.hasNewResult()) {
    const { text } = speech.consumeNew();
    if (Date.now() < suppressRecognitionUntil) {
      appendAdminLog("Recognition: ignored self-echo during cooldown");
      return;
    }
    heardSentence = String(text || "").trim();
    if (heardSentence) {
      currentTipText = "";
      pendingRecognizedSentence = heardSentence;
      pendingRecognizedAt = Date.now();
      listeningBridgeUntil = Date.now() + LISTENING_BRIDGE_MS;
    }
  }
  maybeFlushRecognizedSentence();
}

function drawMiddleCanvas() {
  background(216, 31, 38);
  updateFaceAnimation();
  if (faceView) {
    const nurseXOffset = -width * 0.2;
    const nurseYOffset = -height * 0.08;
    faceView.render({
      deltaSeconds: deltaTime / 1000,
      x: nurseXOffset,
      y: nurseYOffset,
      w: width,
      h: height,
    });
    faceView.drawDebugOverlay();
  }
  drawStageUi();
}

function buildUi() {
  debugInit("buildUi:start");
  const refs = window.GrumpyNurseV3UI.buildUi({
    onStartConversation: () => startConversation(true),
    onToggleAdmin: toggleAdminPanel,
    onToggleDebug: toggleDebugExports,
    onToggleListening: toggleListening,
  });

  appRoot = refs.appRoot;
  shellEl = refs.shellEl;
  adminEl = refs.adminEl;
  adminToggleButton = refs.adminToggleButton;
  statusEl = refs.statusEl;
  modelSelectEl = refs.modelSelectEl;
  languageSelectEl = refs.languageSelectEl;
  voiceSelectEl = refs.voiceSelectEl;
  debugButton = refs.debugButton;
  listenButton = refs.listenButton;
  canvasColumnEl = refs.canvasColumnEl;
  canvasHostEl = refs.canvasHostEl;
  mainEl = refs.mainEl;
  introEl = refs.introEl;
  startConversationButton = refs.startConversationButton;
  adminConsoleEl = refs.adminConsoleEl;
  taskEl = refs.taskEl;
  conversationEl = refs.conversationEl;
  chatEl = refs.chatEl;
  optionsEl = refs.optionsEl;
  inputEl = null;

  for (const model of MODEL_OPTIONS) {
    modelSelectEl.option(model, model);
  }
  modelSelectEl.selected(selectedModel);
  modelSelectEl.changed(() => {
    selectedModel = modelSelectEl.value();
    persistSelectedModel();
    gpt = createClient();
    appendSystemMessage(`Model changed to ${selectedModel}.`);
  });

  for (const option of SESSION_LANGUAGE_OPTIONS) {
    languageSelectEl.option(`Language: ${option.label}`, option.id);
  }
  languageSelectEl.selected(selectedSessionLanguage);
  languageSelectEl.changed(() => {
    selectedSessionLanguage = languageSelectEl.value();
    persistSelectedSessionLanguage();
    applySessionLanguage();
    applySelectedVoice();
    appendSystemMessage(`Session language changed to ${getSessionLanguageLabel()}.`);
  });

  populateVoiceSelect();
  voiceSelectEl.changed(() => {
    selectedVoice = voiceSelectEl.value();
    persistSelectedVoice();
    applySelectedVoice();
    appendSystemMessage(`Voice changed to ${selectedVoice || "auto"}.`);
  });

  debugButton.html(debugExportsEnabled ? "Debug: ON" : "Debug: OFF");
  renderTask();
  renderOptions();

  applyAdminPanelVisibility();
  applyConversationVisibility();
  debugInit("buildUi:done", {
    hasCanvasHost: !!canvasHostEl?.elt,
    shellClasses: shellEl?.elt?.className || "",
  });
}

function createMiddleCanvas() {
  if (!canvasHostEl) return;
  const rect = canvasHostEl.elt.getBoundingClientRect();
  const canvasWidth = Math.max(220, Math.floor(rect.width || 320));
  const canvasHeight = Math.max(240, Math.floor(rect.height || windowHeight || 240));
  debugInit("createMiddleCanvas:host rect", {
    width: rect.width,
    height: rect.height,
    canvasWidth,
    canvasHeight,
  });
  const c = createCanvas(canvasWidth, canvasHeight);
  if (canvasHostEl?.elt && c?.elt) {
    canvasHostEl.elt.appendChild(c.elt);
    debugInit("createMiddleCanvas:canvas appended", {
      parentTag: canvasHostEl.elt.tagName,
      canvasParentTag: c.elt.parentElement?.tagName || null,
      className: c.elt.className || "",
    });
  }
  if (c?.elt) c.elt.className = "gn-p5-canvas";
  debugInit("createMiddleCanvas:done", {
    width,
    height,
  });
}

function resizeMiddleCanvas() {
  if (!canvasHostEl?.elt || typeof resizeCanvas !== "function") return;
  const rect = canvasHostEl.elt.getBoundingClientRect();
  const nextWidth = Math.max(220, Math.floor(rect.width || windowWidth || width || 320));
  const nextHeight = Math.max(240, Math.floor(rect.height || windowHeight || height || 240));
  if (nextWidth === width && nextHeight === height) return;
  debugInit("resizeMiddleCanvas", {
    from: { width, height },
    to: { width: nextWidth, height: nextHeight },
  });
  resizeCanvas(nextWidth, nextHeight);
}

function createFaceAnimation() {
  faceView = window.GrumpyNurseV3FaceView || null;
  faceAnimation = faceView?.create() || null;
  debugInit("createFaceAnimation", {
    hasFaceView: !!faceView,
    hasFaceAnimation: !!faceAnimation,
  });
}

function updateFaceAnimation() {
  if (!faceView) return;
  const waitingForUser =
    conversationStarted &&
    !askInFlight &&
    !isSpeechOutputActive() &&
    !!chatHistory.length &&
    chatHistory[chatHistory.length - 1]?.role === "assistant";

  faceView.update({
    currentMood,
    conversationStarted,
    askInFlight,
    speaking: isSpeechOutputActive(),
    listening: !!speech?.isListening?.() || waitingForUser,
  });
}

function toggleCanvasDebugOverlay() {
  return;
}

function mousePressed() {
  hasSessionInteraction = true;
  const pointer = { x: mouseX, y: mouseY };
  if (hitRect(pointer, stageUiHitTargets.adminToggle)) {
    toggleAdminPanel();
    return false;
  }
  if (!conversationStarted && hitRect(pointer, stageUiHitTargets.voiceInitButton)) {
    initPrestartVoiceMode();
    return false;
  }
  if (!conversationStarted && hitRect(pointer, stageUiHitTargets.startButton)) {
    startConversation(true);
    return false;
  }
  return true;
}

function hitRect(pointer, rect) {
  if (!rect) return false;
  return (
    pointer.x >= rect.x &&
    pointer.x <= rect.x + rect.w &&
    pointer.y >= rect.y &&
    pointer.y <= rect.y + rect.h
  );
}

function drawStageUi() {
  stageUiHitTargets.startButton = null;
  stageUiHitTargets.voiceInitButton = null;
  stageTaskTopY = height;
  drawTaskBanner();
  drawBubbleOverlay();
  drawAdminToggle();
  if (!conversationStarted) {
    drawStageStartOverlay();
  }
}

function drawTaskBanner() {
  const tipText = String(currentTipText || "").trim();
  if (!tipText) return;

  const labelY = 12;
  const textY = 30;
  const contentWidth = width - 48;
  textFont("Helvetica Neue");
  textStyle(NORMAL);
  textSize(Math.max(14, Math.min(20, width * 0.017)));
  textLeading(Math.max(16, Math.min(24, width * 0.02)));
  const tipTextHeight = textBoundsHeight(tipText, contentWidth);
  const contentBottom = textY + tipTextHeight;

  const bannerH = Math.max(72, Math.min(240, contentBottom + 14));
  const bannerY = height - bannerH;
  stageTaskTopY = bannerY;
  noStroke();
  fill(17, 17, 17, 244);
  rect(0, bannerY, width, bannerH);

  fill(247, 245, 239, 160);
  textAlign(LEFT, TOP);
  textFont("Helvetica Neue");
  textStyle(BOLD);
  textSize(11);
  text("TIP", 24, bannerY + labelY);

  fill(247, 245, 239, 230);
  textStyle(NORMAL);
  textSize(Math.max(14, Math.min(20, width * 0.017)));
  textLeading(Math.max(16, Math.min(24, width * 0.02)));
  text(tipText, 24, bannerY + textY, contentWidth, tipTextHeight + 8);
}

function drawBubbleOverlay() {
  if (!conversationStarted) return;
  const entries = getStageBubbleEntriesForRender();
  if (!entries.length) return;

  const gap = 12;
  const topY = 26;
  const bottomLimit = Math.max(topY + 80, stageTaskTopY - 14);
  const columnWidth = Math.min(560, width * 0.44);
  const columnX = width - columnWidth - 24;
  const mouth = getNurseMouthAnchor();
  const bottomAnchorY = constrain(mouth.y + 14, topY + 80, bottomLimit);
  const availableHeight = Math.max(0, bottomAnchorY - topY);

  let layouts = entries.map((entry) => measureStageBubbleLayout(entry, columnX, columnWidth));
  let totalHeight = getTotalBubbleLayoutsHeight(layouts, gap);
  while (layouts.length > 1 && totalHeight > availableHeight) {
    layouts.shift();
    totalHeight = getTotalBubbleLayoutsHeight(layouts, gap);
  }

  let latestNurseIndex = -1;
  for (let i = layouts.length - 1; i >= 0; i -= 1) {
    if (layouts[i].isNurse) {
      latestNurseIndex = i;
      break;
    }
  }

  let y = Math.max(topY, bottomAnchorY - totalHeight);
  for (let i = 0; i < layouts.length; i += 1) {
    const layout = layouts[i];
    const showTail = layout.isUser || i === latestNurseIndex;
    drawStageBubbleLayout(layout, y, { showTail, mouth });
    y += layout.bubbleH + gap;
    if (y > bottomLimit) break;
  }
}

function getStageBubbleEntriesForRender() {
  const entries = stageBubbleList.slice(-STAGE_BUBBLE_LIMIT);
  if (listeningIndicatorBubble?.kind === "recording" || listeningIndicatorBubble?.kind === "processing") {
    entries.push({ kind: listeningIndicatorBubble.kind, text: "", meta: null });
  }
  return entries;
}

function getTotalBubbleLayoutsHeight(layouts, gap = 12) {
  if (!layouts.length) return 0;
  return layouts.reduce((sum, layout) => sum + layout.bubbleH, 0) + gap * (layouts.length - 1);
}

function measureStageBubbleLayout(entry, columnX, columnWidth) {
  const isNurse = entry.kind === "nurse";
  const isUser = entry.kind === "user" || entry.kind === "recording" || entry.kind === "processing";
  const isRecording = entry.kind === "recording";
  const bubbleText = getBubbleTextForEntry(entry);

  push();
  textFont("Helvetica Neue");
  textStyle(NORMAL);
  const fontSize = isNurse
    ? Math.max(16, Math.min(26, width * 0.019))
    : Math.max(15, Math.min(24, width * 0.017));
  const leading = isNurse
    ? Math.max(20, Math.min(30, width * 0.023))
    : Math.max(19, Math.min(28, width * 0.021));
  textSize(fontSize);
  textLeading(leading);

  const bubbleW = Math.min(columnWidth, isNurse ? columnWidth * 0.91 : columnWidth * 0.88);
  const baseBubbleX = isNurse ? columnX : columnX + (columnWidth - bubbleW);
  const roleOffsetX = isNurse ? -10 : 6;
  const bubbleX = constrain(baseBubbleX + roleOffsetX, 12, width - bubbleW - 12);
  const paddingX = isNurse ? 22 : 20;
  const paddingY = isNurse ? 18 : 16;
  const iconOffset = isRecording ? 24 : 0;
  const lineH = textLeading();
  const textW = bubbleW - paddingX * 2 - iconOffset;
  const textH = Math.max(lineH, textBoundsHeight(bubbleText, textW));
  const bubbleH = textH + paddingY * 2;
  pop();

  return {
    entry,
    bubbleText,
    bubbleX,
    bubbleW,
    bubbleH,
    paddingX,
    paddingY,
    textH,
    fontSize,
    leading,
    isNurse,
    isUser,
    isRecording,
  };
}

function drawStageBubbleLayout(layout, y, options = {}) {
  const showTail = !!options.showTail;
  const mouth = options.mouth || getNurseMouthAnchor();

  push();
  blendMode(BLEND);
  drawingContext.globalAlpha = 1;
  noStroke();
  fill(0, 0, 0, layout.isNurse ? 208 : 196);
  rect(layout.bubbleX, y, layout.bubbleW, layout.bubbleH, layout.isNurse ? 14 : 12);
  if (showTail) {
    if (layout.isUser) {
      drawUserBubbleTail(layout, y);
    } else {
      drawNurseBubbleTail(layout, y, mouth);
    }
  }

  textFont("Helvetica Neue");
  textStyle(NORMAL);
  textSize(layout.fontSize);
  textLeading(layout.leading);
  textAlign(LEFT, TOP);
  fill(247, 245, 239, 255);

  let textX = layout.bubbleX + layout.paddingX;
  if (layout.isRecording) {
    drawRecordingDot(textX + 8, y + layout.bubbleH * 0.5);
    textX += 24;
  }

  text(
    layout.bubbleText,
    textX,
    y + layout.paddingY,
    layout.bubbleW - (textX - layout.bubbleX) - layout.paddingX,
    layout.textH + 6
  );
  pop();
}

function drawUserBubbleTail(layout, y) {
  const cornerRadius = 12;
  const usableMinY = y + cornerRadius + 2;
  const usableMaxY = y + layout.bubbleH - cornerRadius - 2;
  const baseY = constrain(y + layout.bubbleH * 0.58, usableMinY, usableMaxY);
  const availableHalfSpan = Math.max(14, (usableMaxY - usableMinY) * 0.5);
  const halfSpan = Math.min(32, availableHalfSpan);
  const edgeX = layout.bubbleX + layout.bubbleW - 1;
  const tipX = Math.min(width - 4, edgeX + 74);
  const tipY = baseY + 3;
  noStroke();
  fill(0, 0, 0, 196);
  beginShape();
  vertex(edgeX, baseY - halfSpan);
  vertex(tipX, tipY);
  vertex(edgeX, baseY + halfSpan);
  endShape(CLOSE);
}

function drawNurseBubbleTail(layout, y, mouth) {
  const cornerRadius = 14;
  const usableMinY = y + cornerRadius + 2;
  const usableMaxY = y + layout.bubbleH - cornerRadius - 2;
  if (usableMaxY <= usableMinY) return;
  const baseY = constrain(y + layout.bubbleH * 0.64, usableMinY, usableMaxY);
  const availableHalfSpan = Math.max(8, (usableMaxY - usableMinY) * 0.5);
  const halfSpan = Math.min(22, availableHalfSpan);
  const edgeX = layout.bubbleX + 1;
  const tipX = constrain(mouth.x + 12, layout.bubbleX - 68, layout.bubbleX + 30);
  const tipY = constrain(mouth.y - 4, baseY + 8, baseY + 78);
  noStroke();
  fill(0, 0, 0, 208);
  beginShape();
  vertex(edgeX, baseY - halfSpan);
  vertex(tipX, tipY);
  vertex(edgeX, baseY + halfSpan);
  endShape(CLOSE);
}

function getBubbleTextForEntry(entry) {
  if (entry.kind === "recording" && typeof speech?.getInterimText === "function") {
    const interimText = String(speech.getInterimText() || "").trim();
    return interimText || "";
  }
  if (entry.kind === "processing") {
    return "";
  }
  return String(entry?.text || "");
}

function getNurseRenderFrame() {
  const x = -width * 0.2;
  const y = -height * 0.08;
  const w = width;
  const h = height;
  const portraitW = 108;
  const portraitH = 140;
  const scale = Math.min(w / portraitW, h / portraitH) * 1.02;
  const drawW = portraitW * scale;
  const drawH = portraitH * scale;
  const originX = x + (w - drawW) * 0.5;
  const originY = y + (h - drawH) * 0.02;
  const centerX = originX + drawW * 0.5;
  const centerY = originY + drawH * 0.5 - 50;
  return {
    scale,
    centerX,
    centerY,
  };
}

function getNurseMouthAnchor() {
  const frame = getNurseRenderFrame();
  return {
    x: frame.centerX,
    y: frame.centerY + 56 * frame.scale,
  };
}

function drawRecordingDot(cx, cy) {
  const pulse = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(millis() * 0.009));
  noStroke();
  fill(216, 31, 38, 48);
  circle(cx, cy, 20 * pulse);
  fill(216, 31, 38);
  circle(cx, cy, 12);
}

function drawAdminToggle() {
  const rectInfo = {
    x: -6,
    y: 10,
    w: 14,
    h: 46,
  };
  stageUiHitTargets.adminToggle = rectInfo;
  noStroke();
  fill(17, 17, 17, 88);
  rect(rectInfo.x, rectInfo.y, rectInfo.w, rectInfo.h, 999);
}

function drawStageStartOverlay() {
  noStroke();
  fill(17, 17, 17, 52);
  rect(0, 0, width, height);

  const buttonW = 260;
  const buttonH = 62;
  const buttonX = width * 0.5 - buttonW * 0.5;
  const buttonY = height - buttonH - 34;
  stageUiHitTargets.startButton = {
    x: buttonX,
    y: buttonY,
    w: buttonW,
    h: buttonH,
  };

  if (listeningWanted && !prestartVoiceReady && !hasSessionInteraction) {
    const initButtonW = 220;
    const initButtonH = 48;
    const initButtonX = width * 0.5 - initButtonW * 0.5;
    const initButtonY = buttonY - initButtonH - 52;
    stageUiHitTargets.voiceInitButton = {
      x: initButtonX,
      y: initButtonY,
      w: initButtonW,
      h: initButtonH,
    };

    fill(0, 0, 0, 188);
    rect(initButtonX, initButtonY, initButtonW, initButtonH, 14);
    fill(255, 253, 248);
    textStyle(BOLD);
    textSize(14);
    text("Enable Voice Start", width * 0.5, initButtonY + initButtonH * 0.5);
  }

  fill(17, 17, 17);
  rect(buttonX, buttonY, buttonW, buttonH, 16);
  fill(255, 253, 248);
  textAlign(CENTER, CENTER);
  textFont("Helvetica Neue");
  textStyle(BOLD);
  textSize(14);
  text('Say "I am ready" to start', buttonX + 16, buttonY + 10, buttonW - 32, buttonH - 20);
}

function matchesVoiceStartCommand(value) {
  const normalized = normalizeVoiceCommandText(value);
  if (!normalized) return false;
  return START_VOICE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeVoiceCommandText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "oe")
    .replace(/[å]/g, "aa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function maybeFlushRecognizedSentence() {
  const pending = String(pendingRecognizedSentence || "").trim();
  if (!pending) return;

  const hasInterimSpeech =
    hasInterimSpeechFlag() ||
    (typeof speech?.isReceivingSpeech === "function" && speech.isReceivingSpeech(850));
  if (hasInterimSpeech) return;
  if (Date.now() - Number(pendingRecognizedAt || 0) < FINAL_SPEECH_STABILIZE_MS) return;

  pendingRecognizedSentence = "";
  pendingRecognizedAt = 0;
  heardSentence = pending;

  if (!conversationStarted) {
    if (listeningWanted && prestartVoiceReady && matchesVoiceStartCommand(pending)) {
      appendAdminLog(`Voice start trigger: ${pending}`);
      startConversation(true);
    } else {
      appendAdminLog("Recognition: ignored before conversation start");
    }
    return;
  }

  askFromText(pending, false);
}

function textBoundsHeight(value, maxWidth) {
  const safe = String(value || "");
  if (!safe) return textLeading();
  const words = safe.split(/\s+/);
  let line = "";
  let lines = 1;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next) > maxWidth && line) {
      line = word;
      lines += 1;
    } else {
      line = next;
    }
  }
  return lines * textLeading();
}

function describeFaceState() {
  return currentMood?.label || "grumpy";
}

function createClient() {
  return new GptClient({
    apiKey,
    model: selectedModel,
    instructions:
      "You are a senior nurse roleplay trainer. Always respond through the nurse_reply function.",
    functionSchemas: structuredSchemas,
    functionName: "nurse_reply",
    temperature: GPT_TEMPERATURE,
    max_tokens: GPT_MAX_TOKENS,
  });
}

async function appendNurseGreeting() {
  const opening = await generateOpeningNurseMessage();
  const greeting = opening.reply;
  updateTask(opening.task);
  updateOptions(opening.options);
  updateMood(opening.mood);
  updateSilencePrompts(opening.silencePrompts, false);
  appendMessage("nurse", greeting);
  chatHistory.push({ role: "assistant", text: greeting });
  if (listeningWanted && speech) {
    setStatus("Speaking...");
    appendAdminLog("Voice: speaking opening prompt");
    cancelListeningRestart();
    speech.stopListening();
    suppressRecognitionUntil = Date.now() + VOICE_ECHO_SUPPRESSION_MS;
    try {
      await speech.speak(greeting, selectedSessionLanguage);
    } catch (err) {
      appendAdminLog(`Voice opening prompt error: ${err?.message || String(err)}`);
    }
    await waitForSpeechOutputToSettle();
    suppressRecognitionUntil = Date.now() + VOICE_ECHO_SUPPRESSION_MS;
    if (listeningWanted) {
      scheduleListeningRestart(VOICE_RECOGNITION_RESTART_DELAY_MS);
    }
    lastAssistantTurnEndedAt = Date.now();
    setStatus("Ready");
  } else {
    if (speech && !listeningWanted) {
      appendAdminLog("Voice: opening output skipped because listening is off");
    }
    lastAssistantTurnEndedAt = Date.now();
  }
  scheduleSilencePrompts();
  appendAdminLog("Assessment: Session start");
  appendAdminLog("Next focus: Initial assessment and prioritization");
}

async function generateOpeningNurseMessage() {
  if (!gpt || !apiKey) {
    throw new Error("Missing API key.");
  }

  try {
    const prompt = buildOpeningPrompt();
    const res = await gpt.ask(prompt);
    exportDebugTurn({
      latestUserMessage: "",
      prompt,
      result: res,
      phase: "opening_turn",
    });
    const reply = String(res?.reply || "").trim();
    const task = String(res?.task || "").trim();
    const options = sanitizeResponseOptions(res?.options);
    const mood = sanitizeMood(res?.mood, currentMood);
    const silencePrompts = sanitizeSilencePrompts(res?.silence_prompts, []);
    if (reply) {
      appendAdminLog("Opening line generated from prompt doc");
      return {
        reply,
        task,
        options,
        mood,
        silencePrompts,
      };
    }
  } catch (err) {
    appendAdminLog(`Opening line error: ${err?.message || String(err)}`);
    throw err;
  }
  throw new Error("No structured opening reply returned.");
}

async function sendCurrentInput() {
  if (!inputEl) return;
  await askFromText(String(inputEl.value() || "").trim(), true);
}

async function startConversation(resetExisting = false) {
  if (askInFlight) return;

  clearSilencePromptTimers();
  cancelListeningRestart();
  clearNoResponseTimer();

  if (speech) {
    speech.stopSpeaking();
    speech.stopListening();
  }

  suppressRecognitionUntil = 0;
  heardSentence = "";
  pendingRecognizedSentence = "";
  pendingRecognizedAt = 0;

  if (resetExisting) {
    resetScenarioState();
    appendAdminLog("Conversation restarted");
  }

  conversationStarted = true;
  applyConversationVisibility();
  try {
    await appendNurseGreeting();
  } catch (err) {
    conversationStarted = false;
    clearNoResponseTimer();
    noResponseDeadlineAt = 0;
    applyConversationVisibility();
    appendSystemMessage(err?.message || String(err));
    setStatus("Missing API key");
  }
}

async function askFromText(text, clearInput = false) {
  if (askInFlight) return;
  const input = String(text || "").trim();
  if (!input) return;
  clearNoResponseTimeoutState();

  if (clearInput && inputEl) {
    inputEl.value("");
  }

  clearSilencePromptTimers();

  const userBubble = appendMessage("user", input, {
    raw_trainee_message: input,
  });
  const userHistoryIndex =
    chatHistory.push({
      role: "user",
      text: input,
      rawText: input,
      bubble: userBubble,
    }) - 1;
  trimChatHistory();

  if (!gpt) {
    appendSystemMessage("GPT client is not ready.");
    return;
  }
  if (!apiKey) {
    appendSystemMessage("Missing API key.");
    return;
  }

  askInFlight = true;
  updateBusyState();
  setStatus("Thinking...");

  try {
    const prompt = buildConversationPrompt(input);
    const res = await gpt.ask(prompt);
    exportDebugTurn({
      latestUserMessage: input,
      prompt,
      result: res,
      phase: "chat_turn",
    });

    if (res?.error || gpt?.error) {
      appendSystemMessage(res?.error || gpt.error || "Unknown GPT error");
      setStatus("Error");
      return;
    }

    const reply = String(res?.reply || "").trim();
    const traineeAssessment = String(res?.trainee_assessment || "").trim();
    const nextFocus = String(res?.next_focus || "").trim();
    const cleanedTraineeMessage = sanitizeCleanedTraineeMessage(
      res?.cleaned_trainee_message,
      input
    );
    const task = String(res?.task || "").trim();
    const options = sanitizeResponseOptions(res?.options);
    const mood = sanitizeMood(res?.mood, currentMood);
    const silencePrompts = sanitizeSilencePrompts(res?.silence_prompts);

    if (!reply) {
      appendSystemMessage("No structured reply returned.");
      setStatus("No reply");
      return;
    }

    if (chatHistory[userHistoryIndex]) {
      chatHistory[userHistoryIndex].text = cleanedTraineeMessage;
      chatHistory[userHistoryIndex].cleanedText = cleanedTraineeMessage;
    }
    if (cleanedTraineeMessage !== input) {
      appendAdminLog(`Raw trainee: ${input}`);
      appendAdminLog(`Cleaned trainee: ${cleanedTraineeMessage}`);
    }
    updateTask(task);
    updateOptions(options);
    updateMood(mood);
    appendAdminLog(`Assessment: ${traineeAssessment || "-"}`);
    appendAdminLog(`Next focus: ${nextFocus || "-"}`);

    appendMessage("nurse", reply);
    chatHistory.push({ role: "assistant", text: reply });
    trimChatHistory();
    if (listeningWanted && speech) {
      setStatus("Speaking...");
      appendAdminLog("Voice: speaking reply");
      cancelListeningRestart();
      speech.stopListening();
      suppressRecognitionUntil = Date.now() + VOICE_ECHO_SUPPRESSION_MS;
      try {
        await speech.speak(reply, selectedSessionLanguage);
      } catch (err) {
        appendAdminLog(`Voice reply error: ${err?.message || String(err)}`);
      }
      await waitForSpeechOutputToSettle();
      suppressRecognitionUntil = Date.now() + VOICE_ECHO_SUPPRESSION_MS;
      scheduleListeningRestart(VOICE_RECOGNITION_RESTART_DELAY_MS);
      setStatus("Ready");
      lastAssistantTurnEndedAt = Date.now();
    } else {
      setStatus("Ready");
      appendAdminLog("Voice: output skipped because listening is off");
      lastAssistantTurnEndedAt = Date.now();
    }
    updateSilencePrompts(silencePrompts, false);
    scheduleSilencePrompts();
  } catch (err) {
    appendSystemMessage(err?.message || String(err));
    setStatus("Error");
  } finally {
    askInFlight = false;
    updateBusyState();
  }
}

function toggleListening() {
  if (!speech) return;
  if (listeningWanted || speech.isListening() || isSpeechOutputActive()) {
    listeningWanted = false;
    persistListeningWanted();
    cancelListeningRestart();
    speech.stopSpeaking();
    speech.stopListening();
    prestartVoiceReady = false;
    setStatus("Ready");
    appendAdminLog("Voice: listening/speaking stopped");
  } else {
    listeningWanted = true;
    persistListeningWanted();
    cancelListeningRestart();
    if (!conversationStarted) {
      initPrestartVoiceMode();
    } else {
      speech.listenRecurring(null, {
        language: selectedSessionLanguage,
        interimResults: true,
      });
      appendAdminLog("Voice: listening started");
    }
  }
  if (listenButton) {
    listenButton.html(
      listeningWanted || speech?.isListening() || isSpeechOutputActive()
        ? "Stop Listening"
        : "Start Listening"
    );
  }
}

function initPrestartVoiceMode() {
  if (!speech || !listeningWanted || conversationStarted) return;
  try {
    cancelListeningRestart();
    speech.stopSpeaking();
    speech.stopListening();
    speech.listenRecurring(null, {
      language: selectedSessionLanguage,
      interimResults: true,
    });
    hasSessionInteraction = true;
    prestartVoiceReady = true;
    setStatus("Voice start ready");
    appendAdminLog("Voice start: armed for keyword trigger");
  } catch (err) {
    prestartVoiceReady = false;
    appendAdminLog(`Voice start setup error: ${err?.message || String(err)}`);
  }
}

function buildConversationPrompt(latestUserMessage) {
  const fallbackPrompt = [
    "# Grumpy Nurse 3",
    "",
    "You are an experienced senior nurse training a nurse trainee in realistic hospital situations.",
    "You are blunt, demanding, practical, and a bit grumpy, but focused on safety and learning.",
    "Keep responses fairly short. Stay in character.",
    "Correct unsafe or vague thinking clearly.",
    "Ask one practical follow-up question at a time.",
    "The user is a nurse trainee.",
    "This is a training simulation, not real patient-specific medical advice.",
    "",
    "## Session summary",
    "[session_summary]",
    "",
    "## Current task",
    "[current_task]",
    "",
    "## Conversation so far",
    "[conversation_history]",
    "",
    "## Latest trainee message",
    "[latest_user_message]",
  ].join("\n");

  const baseDocText = String(promptDocMd || "").trim() || fallbackPrompt;
  const historyText = buildConversationHistoryText();
  const sessionSummary = buildSessionSummary();
  const docText = injectPromptPlaceholders(baseDocText, {
    conversation_history: historyText || "(none)",
    current_task: currentTask || "(not set yet)",
    current_mood: `${currentMood.label} | valence ${currentMood.valence.toFixed(2)} | arousal ${currentMood.arousal.toFixed(2)} | dominance ${currentMood.dominance.toFixed(2)} | tension ${currentMood.tension.toFixed(2)}`,
    latest_user_message: latestUserMessage || "(none)",
    session_language: getSessionLanguageLabel(),
    session_summary: sessionSummary || "No clear pattern yet. Keep assessing the trainee.",
  });

  return [
    "Use the following markdown as the authoritative roleplay prompt.",
    "Follow it closely and stay in character.",
    "",
    "PROMPT DOC:",
    "```md",
    docText,
    "```",
    "",
    "The latest trainee message may come from imperfect speech recognition.",
    "Before answering, infer the intended meaning conservatively and correct only obvious transcription mistakes.",
    "Do not invent missing clinical details or change the trainee's intent.",
    "",
    "Respond as the nurse using the nurse_reply function.",
    "reply: the nurse's in-character reply only.",
    "trainee_assessment: a short judgment of the trainee response.",
    "next_focus: one short phrase describing what the trainee should focus on next.",
    "cleaned_trainee_message: rewrite the trainee's latest message into a short, clean version that preserves intent and fixes obvious speech-to-text mistakes, dropped words, and garbled phrasing. If the message is already clear, return it with only light cleanup.",
    "task: a short mission for the trainee to solve in this scenario. Keep updating it if the situation develops or the trainee solves part of it.",
    "options: optional short trainee reply choices as a list of 0 to 4 strings. Use them when the trainee is at a decision point.",
    "mood: assess the nurse avatar mood and return label, valence (-1 to 1), arousal (-1 to 1), dominance (-1 to 1), and tension (0 to 1). Keep the nurse generally stern, but let the mood evolve with the trainee.",
    "silence_prompts: exactly 3 short nurse follow-up lines that become more pressing if the trainee stays silent. Keep them brief, in character, and suitable for pacing delays.",
  ].join("\n");
}

function buildOpeningPrompt() {
  const fallbackPrompt = [
    "# Grumpy Nurse 3",
    "",
    "You are an experienced senior nurse training a nurse trainee in realistic hospital situations.",
    "Start the session with one short in-character opening line and one concrete first question.",
    "Do not wait for a trainee message before starting.",
    "",
    "## Session summary",
    "Session start.",
    "",
    "## Current task",
    "(not set yet)",
    "",
    "## Conversation so far",
    "(none)",
    "",
    "## Latest trainee message",
    "(none)",
  ].join("\n");

  const baseDocText = String(promptDocMd || "").trim() || fallbackPrompt;
  const docText = injectPromptPlaceholders(baseDocText, {
    conversation_history: "(none)",
    current_task: "(not set yet)",
    current_mood: `${currentMood.label} | valence ${currentMood.valence.toFixed(2)} | arousal ${currentMood.arousal.toFixed(2)} | dominance ${currentMood.dominance.toFixed(2)} | tension ${currentMood.tension.toFixed(2)}`,
    latest_user_message: "(none)",
    session_language: getSessionLanguageLabel(),
    session_summary: "Session start. Begin with a concrete, realistic opening situation.",
  });

  return [
    "Use the following markdown as the authoritative roleplay prompt.",
    "Follow it closely and stay in character.",
    "",
    "PROMPT DOC:",
    "```md",
    docText,
    "```",
    "",
    "Start the roleplay now.",
    "Introduce one concrete scenario immediately and ask the trainee one direct first question.",
    "Do not mention metadata or explain the rules.",
    "",
    "Respond as the nurse using the nurse_reply function.",
    "reply: the nurse's in-character opening line only.",
    "trainee_assessment: use 'Session start'.",
    "next_focus: use a short phrase for the first thing the trainee should focus on.",
    "cleaned_trainee_message: return '(none)' because there is no trainee message yet.",
    "task: define the trainee's mission for this scenario in one or two short sentences.",
    "options: provide 2 to 4 short possible trainee responses or actions to choose from.",
    "mood: set the initial nurse avatar mood with label, valence (-1 to 1), arousal (-1 to 1), dominance (-1 to 1), and tension (0 to 1).",
    "silence_prompts: provide exactly 3 escalating short lines to push the trainee if they stay silent.",
  ].join("\n");
}

function buildConversationHistoryText() {
  return chatHistory
    .slice(-CHAT_HISTORY_LIMIT)
    .map((item, index) => `${index + 1}. ${item.role === "assistant" ? "Nurse" : "Trainee"}: ${item.text}`)
    .join("\n");
}

function buildSessionSummary() {
  const recent = chatHistory.slice(-8);
  if (!recent.length) return "";

  const traineeTurns = recent.filter((item) => item.role === "user").map((item) => item.text);
  const nurseTurns = recent.filter((item) => item.role === "assistant").map((item) => item.text);

  const summary = [];

  if (traineeTurns.length) {
    summary.push(`Recent trainee focus: ${traineeTurns.slice(-2).join(" | ")}`);
  }

  const lastNurseMeta = nurseTurns.slice(-2).join(" | ");
  if (lastNurseMeta) {
    summary.push(`Recent nurse direction: ${lastNurseMeta}`);
  }

  return summary.join("\n");
}

function injectPromptPlaceholders(docText, replacements = {}) {
  let out = String(docText || "");
  for (const [key, value] of Object.entries(replacements)) {
    const escapedKey = String(key).replace(/_/g, "\\\\?_");
    const pattern = new RegExp(`\\\\?\\[${escapedKey}\\\\?\\]`, "gi");
    out = out.replace(pattern, String(value || ""));
  }
  return out;
}

async function fetchPromptMarkdown() {
  try {
    debugInit("fetchPromptMarkdown:start", { url: DOC_MD_URL });
    const res = await fetch(DOC_MD_URL, { method: "GET" });
    debugInit("fetchPromptMarkdown:response", {
      ok: res.ok,
      status: res.status,
      type: res.type,
    });
    if (!res.ok) throw new Error(`Prompt doc fetch failed: HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    debugInit("fetchPromptMarkdown:error", {
      error: err?.message || String(err),
    });
    appendSystemMessage(err?.message || "Could not load prompt doc.");
    return "";
  }
}

function trimChatHistory() {
  if (chatHistory.length > CHAT_HISTORY_LIMIT) {
    chatHistory = chatHistory.slice(-CHAT_HISTORY_LIMIT);
  }
}

function appendSystemMessage(text) {
  appendAdminLog(text);
  if (introEl && !conversationStarted && isSystemErrorMessage(text)) {
    const introTextEl = introEl.elt.querySelector(".gn-intro-text");
    if (introTextEl) {
      introTextEl.textContent = String(text || "");
    }
  }
}

function isSystemErrorMessage(text) {
  const value = String(text || "").toLowerCase();
  if (!value) return false;
  return (
    value.includes("error") ||
    value.includes("missing") ||
    value.includes("unavailable") ||
    value.includes("failed") ||
    value.includes("could not") ||
    value.includes("no structured")
  );
}

function appendMessage(kind, text, meta = null) {
  if (kind === "nurse" || kind === "user") {
    removeListeningIndicator();
  }
  const nextBubble = {
    kind,
    text: String(text || ""),
    meta,
  };
  stageBubbleList.push(nextBubble);
  if (stageBubbleList.length > STAGE_BUBBLE_LIMIT) {
    stageBubbleList = stageBubbleList.slice(-STAGE_BUBBLE_LIMIT);
  }
  return nextBubble;
}

function updateBusyState() {
  const busy = !!askInFlight;
  if (startConversationButton) startConversationButton.attribute(busy ? "disabled" : "data-enabled", busy ? "" : "1");
  if (startConversationButton && !busy) startConversationButton.removeAttribute("disabled");
  if (debugButton) debugButton.attribute(busy ? "disabled" : "data-enabled", busy ? "" : "1");
  if (debugButton && !busy) debugButton.removeAttribute("disabled");
  if (listenButton) listenButton.attribute(busy ? "disabled" : "data-enabled", busy ? "" : "1");
  if (listenButton && !busy) listenButton.removeAttribute("disabled");
  if (inputEl?.elt) inputEl.elt.disabled = busy;
  if (modelSelectEl?.elt) modelSelectEl.elt.disabled = busy;
}

function setStatus(text) {
  if (!statusEl) return;
  statusEl.html(String(text || ""));
}

function applyConversationVisibility() {
  if (!conversationStarted) {
    clearNoResponseTimer();
    noResponseDeadlineAt = 0;
    removeListeningIndicator();
    stageBubbleList = [];
  }
}

function resetScenarioState() {
  chatHistory = [];
  currentTask = "";
  currentOptions = [];
  currentTipText = "";
  pendingTipText = "";
  currentSilencePrompts = [];
  lastAssistantTurnEndedAt = 0;
  currentMood = { ...DEFAULT_MOOD };
  stageBubbleList = [];
  prestartVoiceReady = false;
  if (inputEl) inputEl.value("");
  renderTask();
  renderOptions();
}

function shouldShowListeningIndicator() {
  if (!conversationStarted) return false;
  if (!speech) return false;
  if (askInFlight) return false;
  if (isSpeechOutputActive()) return false;
  if (!speech.isListening()) return false;
  const lastRole = chatHistory[chatHistory.length - 1]?.role || "";
  return lastRole === "assistant";
}

function shouldKeepListeningBridge() {
  if (!conversationStarted) return false;
  if (askInFlight || isSpeechOutputActive()) return false;
  const lastRole = chatHistory[chatHistory.length - 1]?.role || "";
  if (lastRole !== "assistant") return false;
  if (String(pendingRecognizedSentence || "").trim()) return true;
  return Date.now() < listeningBridgeUntil;
}

function syncListeningIndicator() {
  if (shouldShowListeningIndicator()) {
    listeningIndicatorBubble = { kind: "recording" };
    listeningBridgeUntil = Date.now() + LISTENING_BRIDGE_MS;
    return;
  }
  if (shouldKeepListeningBridge()) {
    listeningIndicatorBubble = { kind: "processing" };
    return;
  }
  removeListeningIndicator();
}

function removeListeningIndicator() {
  listeningIndicatorBubble = null;
  listeningBridgeUntil = 0;
}

function loadSelectedModel() {
  try {
    const saved = window.localStorage.getItem(MODEL_KEY);
    if (saved && MODEL_OPTIONS.includes(saved)) return saved;
  } catch {}
  return DEFAULT_MODEL;
}

function persistSelectedModel() {
  try {
    window.localStorage.setItem(MODEL_KEY, selectedModel);
  } catch {}
}

function loadSelectedSessionLanguage() {
  try {
    const saved = window.localStorage.getItem(SESSION_LANGUAGE_KEY);
    if (SESSION_LANGUAGE_OPTIONS.some((option) => option.id === saved)) return saved;
  } catch {}
  return "en-GB";
}

function persistSelectedSessionLanguage() {
  try {
    window.localStorage.setItem(SESSION_LANGUAGE_KEY, selectedSessionLanguage);
  } catch {}
}

function loadSelectedVoice() {
  try {
    return window.localStorage.getItem(VOICE_KEY) || "en_female_flo";
  } catch {}
  return "en_female_flo";
}

function persistSelectedVoice() {
  try {
    window.localStorage.setItem(VOICE_KEY, selectedVoice || "");
  } catch {}
}

function loadListeningWanted() {
  try {
    const saved = window.localStorage.getItem(LISTENING_WANTED_KEY);
    if (saved === null) return true;
    return saved === "1";
  } catch {}
  return true;
}

function persistListeningWanted() {
  try {
    window.localStorage.setItem(LISTENING_WANTED_KEY, listeningWanted ? "1" : "0");
  } catch {}
}

function loadAdminPanelHidden() {
  try {
    const saved = window.localStorage.getItem(ADMIN_PANEL_HIDDEN_KEY);
    if (saved === null) return true;
    return saved === "1";
  } catch {}
  return true;
}

function persistAdminPanelHidden() {
  try {
    window.localStorage.setItem(ADMIN_PANEL_HIDDEN_KEY, adminPanelHidden ? "1" : "0");
  } catch {}
}

function loadDebugExportsEnabled() {
  try {
    return window.localStorage.getItem(DEBUG_EXPORTS_KEY) === "1";
  } catch {}
  return false;
}

function persistDebugExportsEnabled() {
  try {
    window.localStorage.setItem(DEBUG_EXPORTS_KEY, debugExportsEnabled ? "1" : "0");
  } catch {}
}

function toggleDebugExports() {
  debugExportsEnabled = !debugExportsEnabled;
  persistDebugExportsEnabled();
  if (debugButton) {
    debugButton.html(debugExportsEnabled ? "Debug: ON" : "Debug: OFF");
  }
  appendAdminLog(
    debugExportsEnabled
      ? "Debug exports enabled. Each GPT pass will download a JSON trace."
      : "Debug exports disabled."
  );
}

function toggleAdminPanel() {
  adminPanelHidden = !adminPanelHidden;
  persistAdminPanelHidden();
  applyAdminPanelVisibility();
}

function applyAdminPanelVisibility() {
  if (!shellEl?.elt || !adminEl?.elt) return;
  shellEl.elt.classList.toggle("is-admin-hidden", !!adminPanelHidden);
  adminEl.elt.classList.toggle("is-hidden", !!adminPanelHidden);
  debugInit("applyAdminPanelVisibility", {
    adminPanelHidden,
    shellClasses: shellEl.elt.className,
    adminClasses: adminEl.elt.className,
  });
  requestAnimationFrame(() => {
    resizeMiddleCanvas();
    window.setTimeout(resizeMiddleCanvas, 220);
  });
}

function windowResized() {
  resizeMiddleCanvas();
}

function getSessionLanguageLabel() {
  return (
    SESSION_LANGUAGE_OPTIONS.find((option) => option.id === selectedSessionLanguage)?.promptLabel ||
    "English"
  );
}

function populateVoiceSelect() {
  if (!voiceSelectEl?.elt) return;
  voiceSelectEl.elt.innerHTML = "";
  const availableProfileIds = getAvailableVoiceProfileIds();
  for (const profile of CURATED_VOICE_PROFILES) {
    if (profile.id !== "auto" && !availableProfileIds.has(profile.id)) continue;
    voiceSelectEl.option(profile.label, profile.id);
  }

  const hasSelected = availableProfileIds.has(selectedVoice) || selectedVoice === "auto";
  const nextValue = hasSelected ? selectedVoice || "auto" : "auto";
  voiceSelectEl.selected(nextValue);
}

function refreshVoiceOptions() {
  populateVoiceSelect();
  const optionCount = voiceSelectEl?.elt?.options?.length || 0;
  if (optionCount <= 1) {
    appendAdminLog("Voice list: only auto available so far");
  } else {
    appendAdminLog(`Voice list: ${optionCount - 1} voices loaded`);
  }
  if (speech) {
    applySelectedVoice(false);
  }
}

function setupVoiceRefresh() {
  const synth = window.speechSynthesis;
  if (!synth) return;

  refreshVoiceOptions();
  window.setTimeout(refreshVoiceOptions, 150);
  window.setTimeout(refreshVoiceOptions, 800);

  voicesChangedHandler = () => refreshVoiceOptions();
  synth.addEventListener?.("voiceschanged", voicesChangedHandler);
  synth.onvoiceschanged = voicesChangedHandler;
}

function applySelectedVoice(shouldLog = true) {
  if (!speech) return;
  speech.setLanguage(selectedSessionLanguage);
  const voiceName = pickVoiceNameForProfile(selectedVoice);
  speech.setVoice(voiceName || null);
  if (!shouldLog) return;
  if (voiceName) {
    appendAdminLog(`Voice setup: ${selectedVoice} -> ${voiceName} (${getSessionLanguageLabel()})`);
  } else {
    appendAdminLog(`Voice setup: auto ${getSessionLanguageLabel()}`);
  }
}

function applySessionLanguage() {
  if (!speech) return;
  speech.setLanguage(selectedSessionLanguage);
  refreshVoiceOptions();
  applySelectedVoice();
  appendAdminLog(`Recognition language: ${getSessionLanguageLabel()}`);
  if (listeningWanted || speech.isListening()) {
    try {
      cancelListeningRestart();
      speech.stopListening();
      if (listeningWanted) {
        speech.listenRecurring(null, {
          language: selectedSessionLanguage,
          interimResults: true,
        });
        appendAdminLog("Voice: listening restarted for new session language");
      }
    } catch (err) {
      appendAdminLog(`Voice restart error: ${err?.message || String(err)}`);
    }
  }
}

function getAvailableVoiceProfileIds() {
  const voices = getAvailableSpeechVoices();
  const ids = new Set(["auto"]);
  for (const profile of CURATED_VOICE_PROFILES) {
    if (profile.id === "auto") continue;
    if (profile.candidates.some((candidate) => voices.some((voice) => voice.name === candidate))) {
      ids.add(profile.id);
    }
  }
  return ids;
}

function pickVoiceNameForProfile(profileId) {
  if (!profileId || profileId === "auto") return "";
  const profile = CURATED_VOICE_PROFILES.find((item) => item.id === profileId);
  if (!profile) return "";
  const voices = getAvailableSpeechVoices();
  for (const candidate of profile.candidates) {
    const exact = voices.find((voice) => voice.name === candidate);
    if (exact) return exact.name;
  }

  for (const candidate of profile.candidates) {
    const lowerCandidate = String(candidate || "").toLowerCase();
    const partial = voices.find((voice) =>
      String(voice.name || "").toLowerCase().includes(lowerCandidate)
    );
    if (partial) return partial.name;
  }

  const languagePrefix = String(selectedSessionLanguage || "").split("-")[0].toLowerCase();
  const sameLanguage = voices.find((voice) =>
    String(voice.lang || "").toLowerCase().startsWith(languagePrefix)
  );
  return sameLanguage?.name || "";
}

function getAvailableSpeechVoices() {
  const synth = window.speechSynthesis;
  const voices = synth?.getVoices ? synth.getVoices() || [] : [];
  return voices
    .map((voice) => ({
      name: voice?.name || "",
      lang: voice?.lang || "",
    }))
    .filter((voice) => voice.name);
}

function sanitizeCleanedTraineeMessage(value, fallback) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (cleaned) return cleaned;
  return String(fallback || "").replace(/\s+/g, " ").trim();
}

function sanitizeResponseOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function sanitizeMood(value, fallback = currentMood) {
  const next = value && typeof value === "object" ? value : {};
  return {
    label: String(next.label || fallback?.label || "grumpy").trim() || "grumpy",
    valence: constrain(Number.isFinite(Number(next.valence)) ? Number(next.valence) : Number(fallback?.valence || -0.2), -1, 1),
    arousal: constrain(Number.isFinite(Number(next.arousal)) ? Number(next.arousal) : Number(fallback?.arousal || 0.2), -1, 1),
    dominance: constrain(Number.isFinite(Number(next.dominance)) ? Number(next.dominance) : Number(fallback?.dominance || 0.45), -1, 1),
    tension: constrain(Number.isFinite(Number(next.tension)) ? Number(next.tension) : Number(fallback?.tension || 0.55), 0, 1),
  };
}

function updateMood(nextMood) {
  currentMood = sanitizeMood(nextMood, currentMood);
  appendAdminLog(
    `Mood: ${currentMood.label} v:${currentMood.valence.toFixed(2)} a:${currentMood.arousal.toFixed(2)} d:${currentMood.dominance.toFixed(2)} t:${currentMood.tension.toFixed(2)}`
  );
}

function sanitizeSilencePrompts(value, fallback = []) {
  const prompts = Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  if (prompts.length === 3) return prompts;
  const normalizedFallback = Array.isArray(fallback)
    ? fallback.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  return normalizedFallback;
}

function updateSilencePrompts(nextPrompts, scheduleNow = true) {
  currentSilencePrompts = Array.isArray(nextPrompts) ? nextPrompts.slice(0, 3) : [];
  clearSilencePromptTimers();
  clearNoResponseTimeoutState();
  if (scheduleNow) scheduleSilencePrompts();
}

function clearSilencePromptTimers() {
  for (const timeoutId of silencePromptTimeouts) {
    clearTimeout(timeoutId);
  }
  silencePromptTimeouts = [];
}

function scheduleNoResponseTimeout() {
  clearNoResponseTimer();
  if (!conversationStarted) return;
  const fireIn = Math.max(120, noResponseDeadlineAt - Date.now());
  noResponseTimeoutId = window.setTimeout(() => {
    noResponseTimeoutId = null;
    maybeReturnToStartForNoResponse();
  }, fireIn);
}

function clearNoResponseTimer() {
  if (noResponseTimeoutId !== null) {
    clearTimeout(noResponseTimeoutId);
    noResponseTimeoutId = null;
  }
}

function clearNoResponseTimeoutState() {
  clearNoResponseTimer();
  noResponseDeadlineAt = 0;
}

function startNoResponseTimeoutAfterNurseResponses() {
  if (!conversationStarted) return;
  const waitingForTraineeReply =
    !!chatHistory.length && chatHistory[chatHistory.length - 1]?.role === "assistant";
  if (!waitingForTraineeReply) {
    clearNoResponseTimeoutState();
    return;
  }
  noResponseDeadlineAt = Date.now() + NO_RESPONSE_TIMEOUT_MS;
  scheduleNoResponseTimeout();
}

function maybeReturnToStartForNoResponse() {
  if (!conversationStarted) return;
  if (!noResponseDeadlineAt) return;
  const remaining = noResponseDeadlineAt - Date.now();
  if (remaining > 100) {
    scheduleNoResponseTimeout();
    return;
  }

  appendAdminLog("No trainee response for 1.5 minutes. Returning to start screen.");
  clearSilencePromptTimers();
  cancelListeningRestart();
  clearNoResponseTimeoutState();

  if (speech) {
    speech.stopSpeaking();
    speech.stopListening();
  }

  suppressRecognitionUntil = 0;
  heardSentence = "";
  pendingRecognizedSentence = "";
  pendingRecognizedAt = 0;
  conversationStarted = false;
  noResponseDeadlineAt = 0;
  resetScenarioState();
  applyConversationVisibility();
  if (listeningWanted && hasSessionInteraction) {
    initPrestartVoiceMode();
  }
  setStatus("Ready");
}

function scheduleSilencePrompts() {
  clearSilencePromptTimers();
  if (!currentSilencePrompts.length) {
    startNoResponseTimeoutAfterNurseResponses();
    return;
  }

  scheduleNextSilencePrompt(0);
}

function scheduleNextSilencePrompt(index) {
  if (index >= currentSilencePrompts.length) {
    startNoResponseTimeoutAfterNurseResponses();
    return;
  }
  const expectedAssistantCount = chatHistory.filter((item) => item.role === "assistant").length;
  const baseTime = Math.max(Date.now(), Number(lastAssistantTurnEndedAt) || 0);
  const delay =
    SILENCE_PROMPT_DELAYS_MS[index] ||
    SILENCE_PROMPT_DELAYS_MS[SILENCE_PROMPT_DELAYS_MS.length - 1];
  const fireIn = Math.max(0, baseTime + delay - Date.now());
  const timeoutId = window.setTimeout(() => {
    maybeFireSilencePrompt(currentSilencePrompts[index], expectedAssistantCount, index);
  }, fireIn);
  silencePromptTimeouts.push(timeoutId);
}

function retrySilencePrompt(index, expectedAssistantCount, delayMs = SILENCE_PROMPT_RETRY_MS) {
  const timeoutId = window.setTimeout(() => {
    maybeFireSilencePrompt(currentSilencePrompts[index], expectedAssistantCount, index);
  }, Math.max(250, Number(delayMs) || SILENCE_PROMPT_RETRY_MS));
  silencePromptTimeouts.push(timeoutId);
}

function maybeFireSilencePrompt(line, expectedAssistantCount, index) {
  const currentAssistantCount = chatHistory.filter((item) => item.role === "assistant").length;
  const hasPendingUserReply = chatHistory.length && chatHistory[chatHistory.length - 1]?.role === "assistant";
  const hasInterimSpeech =
    hasInterimSpeechFlag() ||
    (typeof speech?.isReceivingSpeech === "function" && speech.isReceivingSpeech(1200));
  const silenceReady =
    !speech ||
    (!speech.isListening() && !isSpeechOutputActive()) ||
    speech.isSilentFor(SILENCE_READY_MS);

  if (!hasPendingUserReply) return;
  if (currentAssistantCount !== expectedAssistantCount) return;
  if (askInFlight) return;
  if (isSpeechOutputActive()) {
    retrySilencePrompt(index, expectedAssistantCount, 900);
    return;
  }
  if (Date.now() < suppressRecognitionUntil) {
    retrySilencePrompt(index, expectedAssistantCount, suppressRecognitionUntil - Date.now() + 250);
    return;
  }
  if (hasInterimSpeech) {
    retrySilencePrompt(index, expectedAssistantCount, 1000);
    return;
  }
  if (!silenceReady) {
    retrySilencePrompt(index, expectedAssistantCount);
    return;
  }

  if (index === 0) {
    const tip = String(pendingTipText || "").trim();
    currentTipText = tip;
  }

  appendMessage("nurse", line);
  chatHistory.push({ role: "assistant", text: line });
  trimChatHistory();
  appendAdminLog(`Silence prompt: ${line}`);
  if (listeningWanted && speech) {
    cancelListeningRestart();
    speech.stopListening();
    suppressRecognitionUntil = Date.now() + VOICE_ECHO_SUPPRESSION_MS;
    setStatus("Speaking...");
    appendAdminLog("Voice: speaking silence prompt");
    speech
      .speak(line, selectedSessionLanguage)
      .then(async () => {
        await waitForSpeechOutputToSettle();
        suppressRecognitionUntil = Date.now() + VOICE_ECHO_SUPPRESSION_MS;
        setStatus("Ready");
        lastAssistantTurnEndedAt = Date.now();
        scheduleListeningRestart(VOICE_RECOGNITION_RESTART_DELAY_MS);
        scheduleNextSilencePrompt(index + 1);
      })
      .catch(async (err) => {
        appendAdminLog(`Voice silence prompt error: ${err?.message || String(err)}`);
        await waitForSpeechOutputToSettle();
        setStatus("Ready");
        lastAssistantTurnEndedAt = Date.now();
        scheduleListeningRestart(VOICE_RECOGNITION_RESTART_DELAY_MS);
        scheduleNextSilencePrompt(index + 1);
      });
  } else {
    lastAssistantTurnEndedAt = Date.now();
    scheduleNextSilencePrompt(index + 1);
  }
}

function scheduleListeningRestart(delayMs = VOICE_RECOGNITION_RESTART_DELAY_MS) {
  if (!speech || !listeningWanted) return;
  cancelListeningRestart();
  listeningRestartTimeout = window.setTimeout(() => {
    listeningRestartTimeout = null;
    if (!speech || !listeningWanted) return;
    if (isSpeechOutputActive()) {
      scheduleListeningRestart(delayMs);
      return;
    }
    try {
      speech.listenRecurring(null, {
        language: selectedSessionLanguage,
        interimResults: true,
      });
      appendAdminLog("Voice: listening resumed after speech");
    } catch (err) {
      appendAdminLog(`Voice resume error: ${err?.message || String(err)}`);
    }
  }, delayMs);
}

function cancelListeningRestart() {
  if (listeningRestartTimeout !== null) {
    clearTimeout(listeningRestartTimeout);
    listeningRestartTimeout = null;
  }
}

function exportDebugTurn({ latestUserMessage, prompt, result, phase }) {
  if (!debugExportsEnabled) return;

  const payload = {
    exported_at: new Date().toISOString(),
    phase: String(phase || "chat_turn"),
    latest_user_message: String(latestUserMessage || ""),
    prompt,
    prompt_doc_markdown: String(promptDocMd || ""),
    model: gpt?.model || selectedModel,
    temperature: gpt?.temperature ?? GPT_TEMPERATURE,
    max_tokens: gpt?.max_tokens ?? GPT_MAX_TOKENS,
    instructions: gpt?.instructions || "",
    function_name: gpt?.functionName || "nurse_reply",
    function_schemas: gpt?.functionSchemas || structuredSchemas,
    parsed_response: result || null,
    response_meta: result?._meta || result?.meta || null,
    raw_response: gpt?.lastRaw || null,
    error: result?.error || gpt?.error || null,
  };

  downloadBrowserFile(
    `grumpynurse_v3_voice_${debugTimestampSlug()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );
}

function downloadBrowserFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([String(content ?? "")], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function debugTimestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function appendAdminLog(text) {
  if (!adminConsoleEl) return;
  const current = adminConsoleEl.html();
  const lines = current ? current.split("\n") : [];
  const nextLine = `[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] ${String(text || "")}`;
  lines.push(nextLine);
  const trimmed = lines.slice(-ADMIN_LOG_LIMIT);
  adminConsoleEl.html(trimmed.join("\n"));
  adminConsoleEl.elt.scrollTop = adminConsoleEl.elt.scrollHeight;
}

function isSpeechOutputActive() {
  if (speech?.isSpeaking?.()) return true;
  const synth = window.speechSynthesis;
  return !!(synth && (synth.speaking || synth.pending));
}

function hasInterimSpeechFlag() {
  if (!speech) return false;
  if (typeof speech.isInterim === "function") return !!speech.isInterim();
  if (typeof speech.hasInterimResult === "function") return !!speech.hasInterimResult();
  return false;
}

async function waitForSpeechOutputToSettle(
  maxWaitMs = SPEECH_SETTLE_MAX_WAIT_MS,
  quietMs = SPEECH_SETTLE_QUIET_MS
) {
  const startedAt = Date.now();
  let quietSince = 0;

  while (Date.now() - startedAt < Math.max(500, Number(maxWaitMs) || SPEECH_SETTLE_MAX_WAIT_MS)) {
    if (!isSpeechOutputActive()) {
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince >= Math.max(80, Number(quietMs) || SPEECH_SETTLE_QUIET_MS)) {
        return;
      }
    } else {
      quietSince = 0;
    }
    await sleepMs(80);
  }
}

function sleepMs(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function updateTask(nextTask) {
  const task = String(nextTask || "").trim();
  if (!task) return;
  if (task === currentTask) return;
  currentTask = task;
  renderTask();
  appendAdminLog(`Task updated: ${task}`);
}

function renderTask() {
  return;
}

function updateOptions(nextOptions) {
  currentOptions = Array.isArray(nextOptions) ? nextOptions.slice(0, 4) : [];
  const nextTip = String(currentOptions?.[0] || "").trim();
  // Tip becomes visible only when first silence prompt is spoken.
  pendingTipText = nextTip;
  renderOptions();
  applyConversationVisibility();
}

function renderOptions() {
  return;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
