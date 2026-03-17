window.showOverlay = false;

let apiKeyEncryptedGpt22 =
  "U2FsdGVkX18009lW4clpttBLCMAsuBYgQZRiEWcsqhqoPwnEL0ka5JbJOwVlkKco88ToU9L42cPy5j++dtaCm1KgO8vV/dMe6bpMDrWs0IXjElBPml1tj8jUIj+oeLXzZuMTtYgGQfyPW+PxU+VtINE4kAvccUD2vXYgym3SYYUm0rD2RNguEmSzU+660DXYPix5qEnRFAHRUSnDdISYulwc8WNBF3gUQl1VEpUg7Ku9G2gCG6dTZ/JoJ6ZELr8W";

const DOC_MD_URL =
  "https://docs.google.com/document/d/1STeaNBuavGIx1TkRN86tqxEmbuVepys5Y5lBRhs4KyM/export?format=md&tab=t.0";
const MODEL_OPTIONS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"];
const DEFAULT_MODEL = "gpt-4o-mini";
const STORAGE_PREFIX = "grumpynurse";
const MODEL_KEY = `${STORAGE_PREFIX}.model`;
const DEBUG_EXPORTS_KEY = `${STORAGE_PREFIX}.debugExports`;
const DOC_CACHE_KEY = `${STORAGE_PREFIX}.promptDoc`;
const DOC_CACHE_TS_KEY = `${STORAGE_PREFIX}.promptDoc.cachedAt`;
const DOC_CACHE_TTL_MS = 20 * 60 * 1000;
const CHAT_HISTORY_LIMIT = 16;
const GPT_TEMPERATURE = 0.8;
const GPT_MAX_TOKENS = 500;

let apiKey = "";
let gpt;
let promptDocMd = "";
let appRoot;
let chatEl;
let inputEl;
let sendButton;
let clearButton;
let reloadPromptButton;
let debugButton;
let statusEl;
let modelSelectEl;
let voiceBarEl;
let heardEl;
let listenButton;
let askHeardButton;
let askInFlight = false;
let selectedModel = DEFAULT_MODEL;
let debugExportsEnabled = false;
let chatHistory = [];
let speech;
let heardSentence = "";

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
  debugExportsEnabled = loadDebugExportsEnabled();
  speech = await new PortalSpeech({
    language: "en-GB",
    rate: 1,
    pitch: 1,
    volume: 1,
  }).init();

  buildUi();
  setStatus("Loading prompt doc...");

  promptDocMd = await fetchPromptMarkdown();
  gpt = createClient();

  appendSystemMessage(
    promptDocMd
      ? "Prompt doc loaded."
      : "Prompt doc is empty or unavailable. Using the built-in fallback prompt."
  );
  appendNurseGreeting();
  setStatus(apiKey ? "Ready" : "Missing API key");
}

function draw() {
  if (!speech) return;
  if (speech.hasNewResult()) {
    const { text } = speech.consumeNew();
    heardSentence = String(text || "").trim();
    syncVoiceUi();
    if (heardSentence) {
      askFromText(heardSentence, false);
    }
    return;
  }
  syncVoiceUi();
}

function buildUi() {
  appRoot = createDiv("");
  appRoot.id("grumpy-nurse-app");

  const header = createDiv("");
  header.class("gn-header");
  header.parent(appRoot);

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

  reloadPromptButton = createButton("Reload Prompt");
  reloadPromptButton.parent(toolbar);
  reloadPromptButton.class("gn-btn gn-btn-secondary");
  reloadPromptButton.mousePressed(reloadPromptDoc);

  debugButton = createButton(debugExportsEnabled ? "Debug: ON" : "Debug: OFF");
  debugButton.parent(toolbar);
  debugButton.class("gn-btn gn-btn-secondary");
  debugButton.mousePressed(toggleDebugExports);

  voiceBarEl = createDiv("");
  voiceBarEl.class("gn-voicebar");
  voiceBarEl.parent(appRoot);

  heardEl = createDiv("Heard: -");
  heardEl.class("gn-heard");
  heardEl.parent(voiceBarEl);

  listenButton = createButton("Start Listening");
  listenButton.parent(voiceBarEl);
  listenButton.class("gn-btn gn-btn-secondary");
  listenButton.mousePressed(toggleListening);

  askHeardButton = createButton("Ask Heard");
  askHeardButton.parent(voiceBarEl);
  askHeardButton.class("gn-btn gn-btn-secondary");
  askHeardButton.mousePressed(() => askFromText(heardSentence, false));

  chatEl = createDiv("");
  chatEl.class("gn-chat");
  chatEl.parent(appRoot);

  const compose = createDiv("");
  compose.class("gn-compose");
  compose.parent(appRoot);

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

  const actions = createDiv("");
  actions.class("gn-actions");
  actions.parent(compose);

  sendButton = createButton("Send");
  sendButton.parent(actions);
  sendButton.class("gn-btn");
  sendButton.mousePressed(sendCurrentInput);

  clearButton = createButton("Clear");
  clearButton.parent(actions);
  clearButton.class("gn-btn gn-btn-secondary");
  clearButton.mousePressed(clearConversation);
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

function appendNurseGreeting() {
  const greeting =
    "Right. You're on with me now. Don't waffle. Tell me what you'd do first when you enter a patient's room and something feels off.";
  appendMessage("nurse", greeting, {
    trainee_assessment: "Session start",
    next_focus: "Initial assessment and prioritization",
  });
  chatHistory.push({ role: "assistant", text: greeting });
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
      updateUserBubbleCleanedMessage(
        chatHistory[userHistoryIndex].bubble,
        chatHistory[userHistoryIndex].rawText || input,
        cleanedTraineeMessage
      );
    }

    appendMessage("nurse", reply, {
      trainee_assessment: traineeAssessment,
      next_focus: nextFocus,
    });
    chatHistory.push({ role: "assistant", text: reply });
    trimChatHistory();
    setStatus("Speaking...");
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
  } else {
    speech.listenRecurring();
  }
  syncVoiceUi();
}

function syncVoiceUi() {
  if (heardEl) {
    heardEl.html(`Heard: ${heardSentence || "-"}`);
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

function clearConversation() {
  chatHistory = [];
  chatEl.html("");
  appendSystemMessage("Conversation cleared.");
  appendNurseGreeting();
}

function appendSystemMessage(text) {
  appendMessage("system", text);
}

function appendMessage(kind, text, meta = null) {
  const bubble = createDiv("");
  bubble.parent(chatEl);
  bubble.class(`gn-bubble gn-bubble-${kind}`);
  bubble.elt.textContent = String(text || "");

  if (meta && (meta.trainee_assessment || meta.next_focus)) {
    const metaEl = createDiv(
      [
        meta.trainee_assessment ? `Assessment: ${meta.trainee_assessment}` : "",
        meta.next_focus ? `Next: ${meta.next_focus}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    );
    metaEl.parent(bubble);
    metaEl.class("gn-meta");
  }

  if (meta && meta.raw_trainee_message) {
    const metaEl = createDiv(`Raw: ${meta.raw_trainee_message}`);
    metaEl.parent(bubble);
    metaEl.class("gn-meta");
  }

  requestAnimationFrame(() => {
    chatEl.elt.scrollTop = chatEl.elt.scrollHeight;
  });

  return bubble;
}

function updateBusyState() {
  const busy = !!askInFlight;
  if (sendButton) sendButton.attribute(busy ? "disabled" : "data-enabled", busy ? "" : "1");
  if (sendButton && !busy) sendButton.removeAttribute("disabled");
  if (clearButton) clearButton.attribute(busy ? "disabled" : "data-enabled", busy ? "" : "1");
  if (clearButton && !busy) clearButton.removeAttribute("disabled");
  if (reloadPromptButton) reloadPromptButton.attribute(busy ? "disabled" : "data-enabled", busy ? "" : "1");
  if (reloadPromptButton && !busy) reloadPromptButton.removeAttribute("disabled");
  if (debugButton) debugButton.attribute(busy ? "disabled" : "data-enabled", busy ? "" : "1");
  if (debugButton && !busy) debugButton.removeAttribute("disabled");
  if (askHeardButton) askHeardButton.attribute(busy ? "disabled" : "data-enabled", busy ? "" : "1");
  if (askHeardButton && !busy) askHeardButton.removeAttribute("disabled");
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
  appendSystemMessage(
    debugExportsEnabled
      ? "Debug exports enabled. Each GPT pass will download a JSON trace."
      : "Debug exports disabled."
  );
}

function sanitizeCleanedTraineeMessage(value, fallback) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (cleaned) return cleaned;
  return String(fallback || "").replace(/\s+/g, " ").trim();
}

function updateUserBubbleCleanedMessage(bubble, rawText, cleanedText) {
  if (!bubble?.elt) return;
  const raw = String(rawText || "").trim();
  const cleaned = String(cleanedText || "").trim();
  if (!cleaned) return;

  let cleanedEl = bubble.elt.querySelector(".gn-meta-cleaned");
  if (!cleanedEl) {
    const div = document.createElement("div");
    div.className = "gn-meta gn-meta-cleaned";
    bubble.elt.appendChild(div);
    cleanedEl = div;
  }

  cleanedEl.textContent =
    cleaned === raw ? `Cleaned: ${cleaned} (unchanged)` : `Cleaned: ${cleaned}`;

  requestAnimationFrame(() => {
    chatEl.elt.scrollTop = chatEl.elt.scrollHeight;
  });
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
