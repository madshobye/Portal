window.showOverlay = false;

let apiKeyEncryptedGpt22 =
  "U2FsdGVkX18009lW4clpttBLCMAsuBYgQZRiEWcsqhqoPwnEL0ka5JbJOwVlkKco88ToU9L42cPy5j++dtaCm1KgO8vV/dMe6bpMDrWs0IXjElBPml1tj8jUIj+oeLXzZuMTtYgGQfyPW+PxU+VtINE4kAvccUD2vXYgym3SYYUm0rD2RNguEmSzU+660DXYPix5qEnRFAHRUSnDdISYulwc8WNBF3gUQl1VEpUg7Ku9G2gCG6dTZ/JoJ6ZELr8W";

const DOC_MD_URL =
  "https://docs.google.com/document/d/1STeaNBuavGIx1TkRN86tqxEmbuVepys5Y5lBRhs4KyM/export?format=md&tab=t.0";
const MODEL_OPTIONS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"];
const DEFAULT_MODEL = "gpt-4o-mini";
const STORAGE_PREFIX = "grumpynurse";
const MODEL_KEY = `${STORAGE_PREFIX}.model`;
const VOICE_KEY = `${STORAGE_PREFIX}.voice`;
const DEBUG_EXPORTS_KEY = `${STORAGE_PREFIX}.debugExports`;
const ADMIN_PANEL_HIDDEN_KEY = `${STORAGE_PREFIX}.adminHidden`;
const DOC_CACHE_KEY = `${STORAGE_PREFIX}.promptDoc`;
const DOC_CACHE_TS_KEY = `${STORAGE_PREFIX}.promptDoc.cachedAt`;
const DOC_CACHE_TTL_MS = 20 * 60 * 1000;
const CHAT_HISTORY_LIMIT = 16;
const ADMIN_LOG_LIMIT = 120;
const GPT_TEMPERATURE = 0.8;
const GPT_MAX_TOKENS = 500;
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
let mainEl;
let chatEl;
let inputEl;
let reloadPromptButton;
let debugButton;
let adminToggleButton;
let statusEl;
let modelSelectEl;
let voiceSelectEl;
let listenButton;
let adminConsoleEl;
let askInFlight = false;
let selectedModel = DEFAULT_MODEL;
let selectedVoice = "";
let debugExportsEnabled = false;
let adminPanelHidden = false;
let chatHistory = [];
let speech;
let heardSentence = "";
let voicesChangedHandler = null;

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
      },
      required: ["reply", "trainee_assessment", "next_focus", "cleaned_trainee_message"],
    },
  },
];

async function setup() {
  noCanvas();

  await loadScript("portal/GptClient.js");
  await loadScript("portal/speech.js");

  apiKey = storedDecrypt({ apiKeyEncryptedGpt22 });
  selectedModel = loadSelectedModel();
  selectedVoice = loadSelectedVoice();
  debugExportsEnabled = loadDebugExportsEnabled();
  adminPanelHidden = loadAdminPanelHidden();

  buildUi();
  refreshVoiceOptions();
  setStatus("Loading prompt doc...");

  try {
    speech = await new PortalSpeech({
      language: "en-GB",
      voice: selectedVoice || null,
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
  await appendNurseGreeting();
  setStatus(apiKey ? "Ready" : "Missing API key");
}

function draw() {
  if (!speech) return;
  if (speech.hasNewResult()) {
    const { text } = speech.consumeNew();
    heardSentence = String(text || "").trim();
    if (heardSentence) {
      askFromText(heardSentence, false);
    }
    return;
  }
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

  reloadPromptButton = createButton("Reload Prompt");
  reloadPromptButton.parent(toolbar);
  reloadPromptButton.class("gn-btn gn-btn-secondary");
  reloadPromptButton.mousePressed(reloadPromptDoc);

  debugButton = createButton(debugExportsEnabled ? "Debug: ON" : "Debug: OFF");
  debugButton.parent(toolbar);
  debugButton.class("gn-btn gn-btn-secondary");
  debugButton.mousePressed(toggleDebugExports);

  listenButton = createButton("Start Listening");
  listenButton.parent(toolbar);
  listenButton.class("gn-btn gn-btn-secondary");
  listenButton.mousePressed(toggleListening);

  mainEl = createDiv("");
  mainEl.class("gn-main");
  mainEl.parent(shellEl);

  const consoleTitle = createDiv("Console");
  consoleTitle.class("gn-console-title");
  consoleTitle.parent(adminEl);

  adminConsoleEl = createDiv("");
  adminConsoleEl.class("gn-console");
  adminConsoleEl.parent(adminEl);

  chatEl = createDiv("");
  chatEl.class("gn-chat");
  chatEl.parent(mainEl);

  const compose = createDiv("");
  compose.class("gn-compose");
  compose.parent(mainEl);

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
  const greeting = await generateOpeningNurseMessage();
  appendMessage("nurse", greeting);
  chatHistory.push({ role: "assistant", text: greeting });
  appendAdminLog("Assessment: Session start");
  appendAdminLog("Next focus: Initial assessment and prioritization");
}

async function generateOpeningNurseMessage() {
  const fallbackGreeting =
    "Right. You're on with me now. Don't waffle. Tell me what you'd do first when you enter a patient's room and something feels off.";
  if (!gpt || !apiKey) return fallbackGreeting;

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
    if (reply) {
      appendAdminLog("Opening line generated from prompt doc");
      return reply;
    }
  } catch (err) {
    appendAdminLog(`Opening line fallback: ${err?.message || String(err)}`);
  }
  return fallbackGreeting;
}

async function sendCurrentInput() {
  await askFromText(String(inputEl.value() || "").trim(), true);
}

async function askFromText(text, clearInput = false) {
  if (askInFlight) return;
  const input = String(text || "").trim();
  if (!input) return;

  if (clearInput && inputEl) {
    inputEl.value("");
  }

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
    appendAdminLog(`Assessment: ${traineeAssessment || "-"}`);
    appendAdminLog(`Next focus: ${nextFocus || "-"}`);

    appendMessage("nurse", reply);
    chatHistory.push({ role: "assistant", text: reply });
    trimChatHistory();
    setStatus("Speaking...");
    appendAdminLog("Voice: speaking reply");
    speech?.speak(reply);
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
  if (speech.isListening()) {
    speech.stopListening();
    appendAdminLog("Voice: listening stopped");
  } else {
    speech.listenRecurring();
    appendAdminLog("Voice: listening started");
  }
  if (listenButton) {
    listenButton.html(speech?.isListening() ? "Stop Listening" : "Start Listening");
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
    latest_user_message: latestUserMessage || "(none)",
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
    "## Conversation so far",
    "(none)",
    "",
    "## Latest trainee message",
    "(none)",
  ].join("\n");

  const baseDocText = String(promptDocMd || "").trim() || fallbackPrompt;
  const docText = injectPromptPlaceholders(baseDocText, {
    conversation_history: "(none)",
    latest_user_message: "(none)",
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

async function fetchPromptMarkdown(force = false) {
  const cached = force ? "" : loadCachedPromptDoc();
  if (cached) return cached;

  try {
    const res = await fetch(DOC_MD_URL, { method: "GET" });
    if (!res.ok) throw new Error(`Prompt doc fetch failed: HTTP ${res.status}`);
    const md = await res.text();
    cachePromptDoc(md);
    return md;
  } catch (err) {
    appendSystemMessage(err?.message || "Could not load prompt doc.");
    return "";
  }
}

async function reloadPromptDoc() {
  if (askInFlight) return;
  setStatus("Reloading prompt...");
  const md = await fetchPromptMarkdown(true);
  promptDocMd = md;
  appendSystemMessage(
    md
      ? "Prompt doc reloaded."
      : "Prompt doc still empty or unavailable. Using fallback prompt."
  );
  setStatus("Ready");
}

function cachePromptDoc(md) {
  try {
    window.localStorage.setItem(DOC_CACHE_KEY, String(md || ""));
    window.localStorage.setItem(DOC_CACHE_TS_KEY, String(Date.now()));
  } catch {}
}

function loadCachedPromptDoc() {
  try {
    const md = window.localStorage.getItem(DOC_CACHE_KEY) || "";
    const ts = Number(window.localStorage.getItem(DOC_CACHE_TS_KEY) || 0);
    if (!md || !Number.isFinite(ts)) return "";
    if (Date.now() - ts > DOC_CACHE_TTL_MS) return "";
    return md;
  } catch {
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
}

function appendMessage(kind, text, meta = null) {
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
  if (reloadPromptButton) reloadPromptButton.attribute(busy ? "disabled" : "data-enabled", busy ? "" : "1");
  if (reloadPromptButton && !busy) reloadPromptButton.removeAttribute("disabled");
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

function loadSelectedVoice() {
  try {
    return window.localStorage.getItem(VOICE_KEY) || "";
  } catch {}
  return "";
}

function persistSelectedVoice() {
  try {
    window.localStorage.setItem(VOICE_KEY, selectedVoice || "");
  } catch {}
}

function loadAdminPanelHidden() {
  try {
    return window.localStorage.getItem(ADMIN_PANEL_HIDDEN_KEY) === "1";
  } catch {}
  return false;
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

function populateVoiceSelect() {
  if (!voiceSelectEl?.elt) return;
  voiceSelectEl.elt.innerHTML = "";
  const availableProfileIds = getAvailableVoiceProfileIds();
  for (const profile of CURATED_VOICE_PROFILES) {
    if (profile.id !== "auto" && !availableProfileIds.has(profile.id)) continue;
    voiceSelectEl.option(profile.label, profile.id);
  }

  const hasSelected = availableProfileIds.has(selectedVoice) || selectedVoice === "auto";
  voiceSelectEl.selected(hasSelected ? selectedVoice || "auto" : "auto");
}

function refreshVoiceOptions() {
  populateVoiceSelect();
  const optionCount = voiceSelectEl?.elt?.options?.length || 0;
  if (optionCount <= 1) {
    appendAdminLog("Voice list: only auto available so far");
  } else {
    appendAdminLog(`Voice list: ${optionCount - 1} voices loaded`);
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

function applySelectedVoice() {
  if (!speech) return;
  const voiceName = pickVoiceNameForProfile(selectedVoice);
  if (voiceName) {
    speech.setVoice(voiceName);
    appendAdminLog(`Voice setup: ${selectedVoice} -> ${voiceName}`);
  } else {
    speech.setLanguage("en-GB");
    appendAdminLog("Voice setup: auto en-GB");
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
  const match = profile.candidates.find((candidate) =>
    voices.some((voice) => voice.name === candidate)
  );
  return match || "";
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
