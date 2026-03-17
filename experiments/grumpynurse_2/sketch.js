window.showOverlay = false;

let apiKeyEncryptedGpt222 ="U2FsdGVkX1/p9uf1wlE+/3dCyCS4rAqGptmHuLBLHho2qru9AlVgzkisqsfwUFT7AMAfoMzStNzJWmKuuzW2Tnh77Z7EeCl9eBPaBr0dwVlfEoOVXLmAo1tWJgx+PPR9YeScgTJbnUiUiGECMNkA75gA1VIg1qvv8MlbcqWB5brnBC5ScsXMHiHxxJcT6k7y8cT3hS2KzKAD2AJWlL43kTX3MwIx+nh+QadZNxGnKPEd3WJowq+qDdHEH6FvE7tM"

const DOC_MD_URL =
  "https://docs.google.com/document/d/1STeaNBuavGIx1TkRN86tqxEmbuVepys5Y5lBRhs4KyM/export?format=md&tab=t.0";
const MODEL_OPTIONS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"];
const DEFAULT_MODEL = "gpt-4o-mini";
const STORAGE_PREFIX = "grumpynurse";
const MODEL_KEY = `${STORAGE_PREFIX}.model`;
const SESSION_LANGUAGE_KEY = `${STORAGE_PREFIX}.sessionLanguage`;
const VOICE_KEY = `${STORAGE_PREFIX}.voice`;
const LISTENING_WANTED_KEY = `${STORAGE_PREFIX}.listeningWanted`;
const DEBUG_EXPORTS_KEY = `${STORAGE_PREFIX}.debugExports`;
const ADMIN_PANEL_HIDDEN_KEY = `${STORAGE_PREFIX}.adminHidden`; 
const CHAT_HISTORY_LIMIT = 16;
const ADMIN_LOG_LIMIT = 120;
const SILENCE_PROMPT_DELAYS_MS = [8000, 15000, 24000];
const SILENCE_PROMPT_RETRY_MS = 1200;
const VOICE_RECOGNITION_RESTART_DELAY_MS = 450;
const VOICE_ECHO_SUPPRESSION_MS = 900;
const SILENCE_READY_MS = 900;
const GPT_TEMPERATURE = 0.8;
const GPT_MAX_TOKENS = 500;
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
let currentSilencePrompts = [];
let silencePromptTimeouts = [];
let lastAssistantTurnEndedAt = 0;
let currentMood = { ...DEFAULT_MOOD };
let speech;
let heardSentence = "";
let voicesChangedHandler = null;
let suppressRecognitionUntil = 0;
let listeningWanted = true;
let listeningRestartTimeout = null;
let conversationStarted = false;
let faceAnimation = null;
let canvasDebugVisible = false;
let faceDebugState = null;

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
  await loadScript("portal/GptClient.js");
  await loadScript("portal/speech.js");
  await loadScript("portal/faceAnimation.js");

  apiKey = storedDecrypt({ apiKeyEncryptedGpt222 });
  selectedModel = loadSelectedModel();
  selectedSessionLanguage = loadSelectedSessionLanguage();
  selectedVoice = loadSelectedVoice();
  listeningWanted = loadListeningWanted();
  debugExportsEnabled = loadDebugExportsEnabled();
  adminPanelHidden = loadAdminPanelHidden();

  buildUi();
  createMiddleCanvas();
  createFaceAnimation();
  refreshVoiceOptions();
  setStatus("Loading prompt doc...");

  try {
    const initialVoiceName = pickVoiceNameForProfile(selectedVoice) || null;
    speech = await new PortalSpeech({
      language: selectedSessionLanguage,
      voice: initialVoiceName,
      rate: 1,
      pitch: 1,
      volume: 1,
    }).init();
    applySelectedVoice();
    appendAdminLog("Voice setup: ready");
  } catch (err) {
    speech = null;
    appendAdminLog(`Voice setup error: ${err?.message || String(err)}`);
  }

  setupVoiceRefresh();

  promptDocMd = await fetchPromptMarkdown();
  gpt = createClient();

  appendSystemMessage(
    promptDocMd
      ? "Prompt doc loaded."
      : "Prompt doc is empty or unavailable. Using the built-in fallback prompt."
  );
  setStatus(apiKey ? "Ready" : "Missing API key");
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
    if (!conversationStarted) {
      appendAdminLog("Recognition: ignored before conversation start");
      return;
    }
    heardSentence = String(text || "").trim();
    if (heardSentence) {
      askFromText(heardSentence, false);
    }
    return;
  }
}

function drawMiddleCanvas() {
  background(216, 31, 38);
  updateFaceAnimation();
  if (faceAnimation) {
    faceAnimation.update(deltaTime / 1000);
    faceAnimation.render({
      x: 0,
      y: 0,
      w: width,
      h: height,
    });
  }
  drawCanvasDebugOverlay();
}

function buildUi() {
  appRoot = createDiv("");
  appRoot.id("grumpy-nurse-app");

  shellEl = createDiv("");
  shellEl.class("gn-shell");
  shellEl.parent(appRoot);

  adminEl = createDiv("");
  adminEl.class("gn-admin");
  adminEl.parent(shellEl);

  adminToggleButton = createButton("");
  adminToggleButton.parent(adminEl);
  adminToggleButton.class("gn-admin-toggle");
  adminToggleButton.mousePressed(toggleAdminPanel);

  const header = createDiv("");
  header.class("gn-header");
  header.parent(adminEl);

  const titleWrap = createDiv("");
  titleWrap.parent(header);

  const title = createDiv("Grumpy Nurse");
  title.class("gn-title");
  title.parent(titleWrap);

  const subtitle = createDiv("Training chat for a nurse trainee.");
  subtitle.class("gn-subtitle");
  subtitle.parent(titleWrap);

  const headerRight = createDiv("");
  headerRight.class("gn-header-right");
  headerRight.parent(header);

  statusEl = createDiv("Loading...");
  statusEl.class("gn-status");
  statusEl.parent(headerRight);

  const toolbar = createDiv("");
  toolbar.class("gn-toolbar");
  toolbar.parent(headerRight);

  modelSelectEl = createSelect();
  modelSelectEl.parent(toolbar);
  modelSelectEl.class("gn-btn gn-btn-secondary");
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

  languageSelectEl = createSelect();
  languageSelectEl.parent(toolbar);
  languageSelectEl.class("gn-btn gn-btn-secondary");
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

  voiceSelectEl = createSelect();
  voiceSelectEl.parent(toolbar);
  voiceSelectEl.class("gn-btn gn-btn-secondary");
  populateVoiceSelect();
  voiceSelectEl.changed(() => {
    selectedVoice = voiceSelectEl.value();
    persistSelectedVoice();
    applySelectedVoice();
    appendSystemMessage(`Voice changed to ${selectedVoice || "auto"}.`);
  });

  debugButton = createButton(debugExportsEnabled ? "Debug: ON" : "Debug: OFF");
  debugButton.parent(toolbar);
  debugButton.class("gn-btn gn-btn-secondary");
  debugButton.mousePressed(toggleDebugExports);

  listenButton = createButton("Start Listening");
  listenButton.parent(toolbar);
  listenButton.class("gn-btn gn-btn-secondary");
  listenButton.mousePressed(toggleListening);

  canvasColumnEl = createDiv("");
  canvasColumnEl.class("gn-canvas-column");
  canvasColumnEl.parent(shellEl);

  canvasHostEl = createDiv("");
  canvasHostEl.class("gn-canvas-host");
  canvasHostEl.parent(canvasColumnEl);

  mainEl = createDiv("");
  mainEl.class("gn-main");
  mainEl.parent(shellEl);

  introEl = createDiv("");
  introEl.class("gn-intro");
  introEl.parent(mainEl);

  const introTitle = createDiv("Ready when you are.");
  introTitle.class("gn-intro-title");
  introTitle.parent(introEl);

  const introText = createDiv("Start a new scenario when you want the nurse to begin.");
  introText.class("gn-intro-text");
  introText.parent(introEl);

  startConversationButton = createButton("Start Conversation");
  startConversationButton.parent(introEl);
  startConversationButton.class("gn-btn gn-btn-primary gn-start-btn");
  startConversationButton.mousePressed(() => {
    startConversation(true);
  });

  const consoleTitle = createDiv("Console");
  consoleTitle.class("gn-console-title");
  consoleTitle.parent(adminEl);

  adminConsoleEl = createDiv("");
  adminConsoleEl.class("gn-console");
  adminConsoleEl.parent(adminEl);

  taskEl = createDiv("");
  taskEl.class("gn-task");
  taskEl.parent(mainEl);
  renderTask();

  conversationEl = createDiv("");
  conversationEl.class("gn-conversation");
  conversationEl.parent(mainEl);

  chatEl = createDiv("");
  chatEl.class("gn-chat");
  chatEl.parent(conversationEl);

  optionsEl = createDiv("");
  optionsEl.class("gn-options-tray");
  optionsEl.parent(conversationEl);
  renderOptions();

  const compose = createDiv("");
  compose.class("gn-compose");
  compose.parent(conversationEl);

  inputEl = createElement("textarea");
  inputEl.class("gn-input");
  inputEl.attribute("placeholder", "Type your answer to the nurse...");
  inputEl.parent(compose);
  inputEl.elt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrentInput();
    }
  });

  applyAdminPanelVisibility();
  applyConversationVisibility();
}

function createMiddleCanvas() {
  if (!canvasHostEl) return;
  const rect = canvasHostEl.elt.getBoundingClientRect();
  const canvasWidth = Math.max(220, Math.floor(rect.width || 320));
  const canvasHeight = Math.max(240, Math.floor(rect.height || windowHeight || 240));
  const c = createCanvas(canvasWidth, canvasHeight);
  if (canvasHostEl?.elt && c?.elt) {
    canvasHostEl.elt.appendChild(c.elt);
    c.elt.addEventListener("click", toggleCanvasDebugOverlay);
  }
  if (c?.elt) c.elt.className = "gn-p5-canvas";
}

function createFaceAnimation() {
  if (!window.PortalFaceAnimation) return;
  faceAnimation = new PortalFaceAnimation({
    skinTone: [240, 228, 214],
    paperTone: [236, 233, 225],
    inkTone: [17, 17, 17],
    accentTone: [216, 31, 38],
    hairTone: [18, 20, 24],
  });
}

function updateFaceAnimation() {
  if (!faceAnimation) return;

  const speaking = isSpeechOutputActive() ? 1 : 0;
  const listening = speech?.isListening?.() ? 1 : 0;
  const thinking = askInFlight ? 1 : 0;
  const waitingForUser =
    conversationStarted &&
    !thinking &&
    !speaking &&
    !!chatHistory.length &&
    chatHistory[chatHistory.length - 1]?.role === "assistant";

  let valence = currentMood.valence;
  let arousal = currentMood.arousal;
  let dominance = currentMood.dominance;
  let tension = currentMood.tension;
  let gazeX = 0;
  let gazeY = -0.05;
  let headTurn = 0;
  let headTilt = 0;
  let headPitch = 0;

  if (!conversationStarted) {
    valence = currentMood.valence * 0.5;
    arousal = Math.min(0.05, currentMood.arousal * 0.3);
    dominance = currentMood.dominance * 0.35;
    tension = currentMood.tension * 0.45;
    gazeY = -0.15;
  } else if (thinking) {
    arousal += 0.08;
    tension += 0.12;
    gazeX = -0.38;
    gazeY = -0.18;
    headTurn = -0.18;
  } else if (speaking) {
    arousal += 0.14;
    dominance += 0.12;
    tension += 0.12;
    gazeY = -0.02;
    headPitch = 0.06;
  } else if (waitingForUser || listening) {
    gazeX = 0.06 * Math.sin(frameCount * 0.02);
    gazeY = 0.02;
    headTilt = 0.04 * Math.sin(frameCount * 0.018);
  }

  valence = constrain(valence, -1, 1);
  arousal = constrain(arousal, -1, 1);
  dominance = constrain(dominance, -1, 1);
  tension = constrain(tension, 0, 1);

  faceAnimation.setTarget({
    valence,
    arousal,
    dominance,
    tension,
    speaking,
    listening: listening ? 1 : waitingForUser ? 0.5 : 0,
    thinking,
    gazeX,
    gazeY,
    headTurn,
    headTilt,
    headPitch,
  });

  faceDebugState = {
    currentMood: { ...currentMood },
    applied: {
      valence,
      arousal,
      dominance,
      tension,
      speaking,
      listening: listening ? 1 : waitingForUser ? 0.5 : 0,
      thinking,
      gazeX,
      gazeY,
      headTurn,
      headTilt,
      headPitch,
    },
    status: {
      conversationStarted,
      waitingForUser,
      speechListening: !!listening,
      speechOutput: !!speaking,
      askInFlight,
    },
  };
}

function toggleCanvasDebugOverlay() {
  canvasDebugVisible = !canvasDebugVisible;
}

function drawCanvasDebugOverlay() {
  if (!canvasDebugVisible) return;
  const mood = faceDebugState?.currentMood || currentMood || DEFAULT_MOOD;
  const applied = faceDebugState?.applied || {};
  const status = faceDebugState?.status || {};
  const lines = [
    "Face Debug",
    `mood: ${String(mood.label || "grumpy")}`,
    `valence: ${Number(mood.valence || 0).toFixed(2)}`,
    `arousal: ${Number(mood.arousal || 0).toFixed(2)}`,
    `dominance: ${Number(mood.dominance || 0).toFixed(2)}`,
    `tension: ${Number(mood.tension || 0).toFixed(2)}`,
    "",
    `applied speaking: ${Number(applied.speaking || 0).toFixed(2)}`,
    `applied listening: ${Number(applied.listening || 0).toFixed(2)}`,
    `applied thinking: ${Number(applied.thinking || 0).toFixed(2)}`,
    `gaze: ${Number(applied.gazeX || 0).toFixed(2)}, ${Number(applied.gazeY || 0).toFixed(2)}`,
    `head: ${Number(applied.headTurn || 0).toFixed(2)}, ${Number(applied.headTilt || 0).toFixed(2)}, ${Number(applied.headPitch || 0).toFixed(2)}`,
    "",
    `started: ${status.conversationStarted ? "yes" : "no"}`,
    `waiting: ${status.waitingForUser ? "yes" : "no"}`,
    `listening: ${status.speechListening ? "yes" : "no"}`,
    `speaking: ${status.speechOutput ? "yes" : "no"}`,
    `thinking: ${status.askInFlight ? "yes" : "no"}`,
  ];

  push();
  noStroke();
  fill(17, 17, 17, 210);
  rect(18, 18, Math.min(280, width - 36), Math.min(288, height - 36), 12);
  fill(247, 245, 239);
  textAlign(LEFT, TOP);
  textFont("Helvetica Neue");
  textSize(12);
  textLeading(16);
  text(lines.join("\n"), 32, 32, Math.min(248, width - 64), Math.min(256, height - 64));
  pop();
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
  if (speech) {
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
    suppressRecognitionUntil = Date.now() + VOICE_ECHO_SUPPRESSION_MS;
    if (listeningWanted) {
      scheduleListeningRestart(VOICE_RECOGNITION_RESTART_DELAY_MS);
    }
    lastAssistantTurnEndedAt = Date.now();
    setStatus("Ready");
  } else {
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
  await askFromText(String(inputEl.value() || "").trim(), true);
}

async function startConversation(resetExisting = false) {
  if (askInFlight) return;

  clearSilencePromptTimers();
  cancelListeningRestart();

  if (speech) {
    speech.stopSpeaking();
    speech.stopListening();
  }

  suppressRecognitionUntil = 0;
  heardSentence = "";

  if (resetExisting) {
    chatHistory = [];
    currentTask = "";
    currentOptions = [];
    currentSilencePrompts = [];
    lastAssistantTurnEndedAt = 0;
    currentMood = { ...DEFAULT_MOOD };
    if (chatEl) chatEl.html("");
    if (inputEl) inputEl.value("");
    renderTask();
    renderOptions();
    appendAdminLog("Conversation restarted");
  }

  conversationStarted = true;
  applyConversationVisibility();
  try {
    await appendNurseGreeting();
  } catch (err) {
    conversationStarted = false;
    applyConversationVisibility();
    appendSystemMessage(err?.message || String(err));
    setStatus("Missing API key");
  }
}

async function askFromText(text, clearInput = false) {
  if (askInFlight) return;
  const input = String(text || "").trim();
  if (!input) return;

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
    setStatus("Ready");
    appendAdminLog("Voice: listening/speaking stopped");
  } else {
    listeningWanted = true;
    persistListeningWanted();
    cancelListeningRestart();
    speech.listenRecurring(null, { language: selectedSessionLanguage });
    appendAdminLog("Voice: listening started");
  }
  if (listenButton) {
    listenButton.html(
      listeningWanted || speech?.isListening() || isSpeechOutputActive()
        ? "Stop Listening"
        : "Start Listening"
    );
  }
}

function buildConversationPrompt(latestUserMessage) {
  const fallbackPrompt = [
    "# Grumpy Nurse",
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
    "# Grumpy Nurse",
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
    const res = await fetch(DOC_MD_URL, { method: "GET" });
    if (!res.ok) throw new Error(`Prompt doc fetch failed: HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
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
  if (introEl && !conversationStarted) {
    const introTextEl = introEl.elt.querySelector(".gn-intro-text");
    if (introTextEl) {
      introTextEl.textContent = String(text || "");
    }
  }
}

function appendMessage(kind, text, meta = null) {
  if (kind === "nurse" || kind === "user") {
    removeListeningIndicator();
  }
  const bubble = createDiv("");
  bubble.parent(chatEl);
  bubble.class(`gn-bubble gn-bubble-${kind}`);
  bubble.elt.textContent = String(text || "");

  requestAnimationFrame(() => {
    chatEl.elt.scrollTop = chatEl.elt.scrollHeight;
  });

  return bubble;
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
  if (introEl) introEl.style("display", conversationStarted ? "none" : "flex");
  if (taskEl) taskEl.style("display", conversationStarted ? "block" : "none");
  if (chatEl) chatEl.style("display", conversationStarted ? "flex" : "none");
  if (optionsEl) optionsEl.style("display", conversationStarted && currentOptions.length ? "flex" : "none");
  if (inputEl?.elt?.parentElement) {
    inputEl.elt.parentElement.style.display = conversationStarted ? "flex" : "none";
  }
  if (!conversationStarted) removeListeningIndicator();
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

function syncListeningIndicator() {
  if (!shouldShowListeningIndicator()) {
    removeListeningIndicator();
    return;
  }
  if (listeningIndicatorBubble?.elt?.isConnected) return;

  listeningIndicatorBubble = createDiv("");
  listeningIndicatorBubble.parent(chatEl);
  listeningIndicatorBubble.class("gn-bubble gn-bubble-user gn-bubble-listening");
  listeningIndicatorBubble.html(
    `<span class="gn-recording-dot" aria-hidden="true"></span><span>Listening...</span>`
  );

  requestAnimationFrame(() => {
    if (chatEl?.elt) chatEl.elt.scrollTop = chatEl.elt.scrollHeight;
  });
}

function removeListeningIndicator() {
  if (!listeningIndicatorBubble) return;
  try {
    listeningIndicatorBubble.remove();
  } catch {}
  listeningIndicatorBubble = null;
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
  if (!shellEl?.elt || !adminEl?.elt || !adminToggleButton) return;
  shellEl.elt.classList.toggle("is-admin-hidden", !!adminPanelHidden);
  adminEl.elt.classList.toggle("is-hidden", !!adminPanelHidden);
  adminToggleButton.html(adminPanelHidden ? ">" : "<");
  adminToggleButton.attribute(
    "title",
    adminPanelHidden ? "Show admin panel" : "Hide admin panel"
  );
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
        speech.listenRecurring(null, { language: selectedSessionLanguage });
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
  if (scheduleNow) scheduleSilencePrompts();
}

function clearSilencePromptTimers() {
  for (const timeoutId of silencePromptTimeouts) {
    clearTimeout(timeoutId);
  }
  silencePromptTimeouts = [];
}

function scheduleSilencePrompts() {
  clearSilencePromptTimers();
  if (!currentSilencePrompts.length) return;

  scheduleNextSilencePrompt(0);
}

function scheduleNextSilencePrompt(index) {
  if (index >= currentSilencePrompts.length) return;
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
  if (!silenceReady) {
    retrySilencePrompt(index, expectedAssistantCount);
    return;
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
      .then(() => {
        suppressRecognitionUntil = Date.now() + VOICE_ECHO_SUPPRESSION_MS;
        setStatus("Ready");
        lastAssistantTurnEndedAt = Date.now();
        scheduleListeningRestart(VOICE_RECOGNITION_RESTART_DELAY_MS);
        scheduleNextSilencePrompt(index + 1);
      })
      .catch((err) => {
        appendAdminLog(`Voice silence prompt error: ${err?.message || String(err)}`);
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
      speech.listenRecurring(null, { language: selectedSessionLanguage });
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
    `grumpynurse_voice_${debugTimestampSlug()}.json`,
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

function updateTask(nextTask) {
  const task = String(nextTask || "").trim();
  if (!task) return;
  if (task === currentTask) return;
  currentTask = task;
  renderTask();
  appendAdminLog(`Task updated: ${task}`);
}

function renderTask() {
  if (!taskEl) return;
  taskEl.html(
    currentTask
      ? `<div class="gn-task-label">Task</div><div class="gn-task-text">${escapeHtml(currentTask)}</div>`
      : `<div class="gn-task-label">Task</div><div class="gn-task-text gn-task-empty">Awaiting scenario...</div>`
  );
}

function updateOptions(nextOptions) {
  currentOptions = Array.isArray(nextOptions) ? nextOptions.slice(0, 4) : [];
  renderOptions();
  applyConversationVisibility();
}

function renderOptions() {
  if (!optionsEl) return;
  optionsEl.html("");
  if (!currentOptions.length) {
    optionsEl.elt.style.display = "none";
    return;
  }

  optionsEl.elt.style.display = "flex";
  for (const optionText of currentOptions) {
    const optionButton = createButton(optionText);
    optionButton.parent(optionsEl);
    optionButton.class("gn-option-btn");
    optionButton.mousePressed(() => {
      if (askInFlight) return;
      askFromText(optionText, false);
    });
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
