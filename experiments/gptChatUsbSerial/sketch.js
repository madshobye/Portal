let apiKeyEncryptedGpt22 =
  "U2FsdGVkX1/vWCUi3KJOdFwx2mGqYdI8zHaQR1bPCl2xUitGDcBf5u16tlObCO8Lz63CeArLuHrhWsQCghUor7kbwsmJ5XiWWInMjRFP3pcahN5Zp5KmiJ8TihkfVMFw6vEw8FHO9fq3Awi0slBj+ZEzmBeGOo063WlktkG3H+cnxIFEW6EfUWNMM8j9irNVCGnmKjYQGyQ0jeEssRVUX0BBS02MNeEwj6Tqe5WUusBEKUK/PpQQbKPO/1h9wNcu";

const SKETCH_TITLE = "GPT Chat USB Serial";
const GPT_MODEL = "gpt-5.4-mini";
const GPT_TEMPERATURE = 0.5;
const GPT_MAX_TOKENS = 220;
const GPT_INSTRUCTIONS =
  "You are a helpful conversational assistant in a voice chat. Keep replies short, natural, and easy to say out loud. Ask at most one follow-up question at a time.";
const OPENING_ASSISTANT_MESSAGE = "Hello. I am ready to talk when you are.";
const SPEECH_LANGUAGE = "en-GB";
const SPEECH_RATE = 1;
const SPEECH_PITCH = 1;
const SPEECH_VOLUME = 1;
const DEFAULT_VOICE_PROFILE_ID = "en_female_flo";
const CHAT_HISTORY_LIMIT = 12;
const VISIBLE_BUBBLE_LIMIT = 10;
const AUTO_SPEAK_REPLY = true;
const USB_SERIAL_BAUD_RATE = 115200;
const CURATED_VOICE_PROFILES = [
  {
    id: "en_female_flo",
    candidates: [
      "Google UK English Female",
      "Google US English",
      "Flo (English (United Kingdom))",
      "Flo (English (United States))",
      "Flo",
    ],
  },
];

let apiKey = "";
let gpt = null;
let speech = null;
let usbSerial = null;

let statusText = "Loading...";
let errorText = "";
let serialStatusText = "unavailable";
let askInFlight = false;
let listeningWanted = false;
let conversationStarted = false;
let bubbles = [];
let chatHistory = [];
let interimText = "";
let lastHeardText = "";
let animState = "boot";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");

  try {
    await loadScript("portal/GptClient.js");
    await loadScript("portal/speech2.js");
    await loadScript("portal/usbSerial.js");

    speech = await new PortalSpeech2({
      language: SPEECH_LANGUAGE,
      rate: SPEECH_RATE,
      pitch: SPEECH_PITCH,
      volume: SPEECH_VOLUME,
    }).init();

    speech.onInterimResult((text) => {
      interimText = String(text || "").trim();
    });

    speech.onListeningChange((isListening) => {
      if (!isListening) interimText = "";
      updateStatus();
    });

    speech.onSpeakingChange(() => {
      updateStatus();
    });

    setupDefaultVoiceRefresh();
    setupUsbSerial();

    apiKey = resolveApiKey();
    gpt = new GptClient({
      apiKey,
      model: GPT_MODEL,
      instructions: GPT_INSTRUCTIONS,
      temperature: GPT_TEMPERATURE,
      max_tokens: GPT_MAX_TOKENS,
    });

    if (!apiKey) {
      errorText = "API key could not be decrypted for apiKeyEncryptedGpt22";
    }

    updateStatus();
    setAnimState("ready");
  } catch (error) {
    errorText = String(error?.message || error);
    statusText = "Setup failed";
    setAnimState("error");
  }
}

async function setupUsbSerial() {
  try {
    usbSerial = await new PortalUsbSerial({
      baudRate: USB_SERIAL_BAUD_RATE,
      autoReconnect: true,
      autoReconnectOnRefresh: true,
      storageKey: "portal.gptChatUsbSerial.deviceHint",
      onState: (state) => {
        serialStatusText = String(state || "idle");
      },
      onError: (error) => {
        console.warn("[gptChatUsbSerial] usb serial", error);
        serialStatusText = "error";
      },
    }).init();
    serialStatusText = usbSerial?.state || "ready";
  } catch (error) {
    usbSerial = null;
    serialStatusText = "unsupported";
  }
}

function resolveApiKey() {
  const encryptedKey = String(apiKeyEncryptedGpt22 || "").trim();
  if (!encryptedKey) return "";

  let decrypted = "";
  try {
    decrypted = String(storedDecrypt({ apiKeyEncryptedGpt22 }) || "").trim();
  } catch {}
  if (decrypted) return decrypted;

  try {
    window.localStorage.removeItem("apiKeyEncryptedGpt22");
  } catch {}

  try {
    const password = getStoredKey("apiKeyEncryptedGpt22", "password");
    decrypted = String(decryptKey(encryptedKey, password) || "").trim();
  } catch {}

  return decrypted;
}

function setupDefaultVoiceRefresh() {
  applyDefaultVoiceProfile();
  window.setTimeout(applyDefaultVoiceProfile, 150);
  window.setTimeout(applyDefaultVoiceProfile, 800);

  const synth = window.speechSynthesis;
  if (!synth) return;

  const handler = () => applyDefaultVoiceProfile();
  synth.addEventListener?.("voiceschanged", handler);
  synth.onvoiceschanged = handler;
}

function applyDefaultVoiceProfile() {
  if (!speech) return;
  speech.setLanguage(SPEECH_LANGUAGE);
  const voiceName = pickVoiceNameForProfile(DEFAULT_VOICE_PROFILE_ID);
  speech.setVoice(voiceName || null);
}

function pickVoiceNameForProfile(profileId) {
  if (!profileId) return "";
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

  const languagePrefix = String(SPEECH_LANGUAGE || "").split("-")[0].toLowerCase();
  const sameLanguage = voices.find((voice) =>
    String(voice.lang || "").toLowerCase().startsWith(languagePrefix)
  );
  return sameLanguage?.name || "";
}

function getAvailableSpeechVoices() {
  const synth = window.speechSynthesis;
  const voices = synth?.getVoices ? synth.getVoices() || [] : [];
  return voices.map((voice) => ({
    name: voice?.name || "",
    lang: voice?.lang || "",
  }));
}

function draw() {
  background(11, 13, 16);
  drawHeader();
  drawChatBubbles();
  drawListeningNotice();
  drawControls();
}

function drawHeader() {
  const padX = 28;
  const topY = 26;

  noStroke();
  fill(245);
  textAlign(LEFT, TOP);
  textSize(30);
  text(SKETCH_TITLE, padX, topY);

  textSize(14);
  fill(170);
  text(`Model: ${GPT_MODEL}`, padX, topY + 38);
  text(`Status: ${statusText}`, padX, topY + 58);
  text(`Serial: ${serialStatusText}`, padX, topY + 78);

  if (errorText) {
    fill(255, 120, 120);
    text(errorText, padX, topY + 100, width - padX * 2, 100);
  }
}

function drawChatBubbles() {
  const sidePad = 28;
  const top = 120;
  const bottom = height - 180;
  const maxBubbleWidth = min(width * 0.68, 760);
  const visible = bubbles.slice(-VISIBLE_BUBBLE_LIMIT);

  let y = top;
  for (const entry of visible) {
    const layout = getBubbleLayout(entry.text, maxBubbleWidth);
    if (y + layout.height > bottom) break;
    drawBubble(entry, sidePad, y, layout, maxBubbleWidth);
    y += layout.height + 14;
  }

  if (!visible.length) {
    fill(120);
    textAlign(CENTER, CENTER);
    textSize(22);
    text("Tap Start Conversation to begin.", width * 0.5, (top + bottom) * 0.5);
  }
}

function drawBubble(entry, sidePad, y, layout, maxBubbleWidth) {
  const isUser = entry.role === "user";
  const bubbleX = isUser ? width - sidePad - layout.width : sidePad;
  const textX = bubbleX + 18;
  const textY = y + 14;

  noStroke();
  if (entry.role === "assistant") fill(34, 38, 44);
  else fill(43, 88, 123);
  rect(bubbleX, y, layout.width, layout.height, 18);

  fill(255);
  textAlign(LEFT, TOP);
  textSize(22);
  textLeading(28);

  let lineY = textY;
  for (const line of layout.lines) {
    text(line, textX, lineY);
    lineY += 28;
  }
}

function drawListeningNotice() {
  const showListening = speech?.isListening?.() || !!interimText || askInFlight || speech?.isSpeaking?.();
  if (!showListening) return;

  const x = 28;
  const y = height - 150;
  const w = width - 56;
  const h = 78;
  const centerY = y + h * 0.5;

  noStroke();
  fill(22, 25, 30);
  rect(x, y, w, h, 18);

  const pulse = millis() * 0.0024;
  const pulseScale = 1 + sin(pulse) * 0.12;
  fill(255, 84, 84, 210);
  circle(x + 30, centerY, 18 * pulseScale);

  fill(255);
  textAlign(LEFT, CENTER);
  textSize(22);

  let notice = "Listening";
  if (askInFlight) notice = "Thinking...";
  else if (speech?.isSpeaking?.()) notice = "Speaking...";
  else if (interimText) notice = interimText;

  text(notice, x + 52, centerY);
}

function drawControls() {
  const top = height - 60;
  const primaryLabel = listeningWanted
    ? speech?.isListening?.()
      ? "Stop Listening"
      : "Listening Enabled"
    : conversationStarted
      ? "Resume Listening"
      : "Start Conversation";

  if (
    uiButton(primaryLabel, {
      x: 28,
      y: top,
      width: 280,
      height: 42,
      fontSize: 20,
      rounding: 12,
    }).clicked
  ) {
    handlePrimaryButton();
  }

  if (
    uiButton("Reset", {
      x: 322,
      y: top,
      width: 140,
      height: 42,
      fontSize: 20,
      rounding: 12,
    }).clicked
  ) {
    resetConversation();
  }

  if (
    uiButton(usbSerial?.connected ? "Serial Connected" : "Connect Serial", {
      x: 476,
      y: top,
      width: 210,
      height: 42,
      fontSize: 20,
      rounding: 12,
    }).clicked
  ) {
    connectUsbSerial();
  }
}

async function handlePrimaryButton() {
  if (!speech) return;
  errorText = "";

  if (listeningWanted) {
    stopListeningMode();
    return;
  }

  listeningWanted = true;

  if (!conversationStarted) {
    conversationStarted = true;
    if (OPENING_ASSISTANT_MESSAGE) {
      appendBubble("assistant", OPENING_ASSISTANT_MESSAGE);
      pushHistory("assistant", OPENING_ASSISTANT_MESSAGE);
      if (AUTO_SPEAK_REPLY) {
        try {
          updateStatus();
          setAnimState("speaking");
          await speech.speak(OPENING_ASSISTANT_MESSAGE, SPEECH_LANGUAGE);
        } catch (error) {
          errorText = String(error?.message || error);
          setAnimState("error");
        }
      }
    }
  }

  startListeningMode();
}

function startListeningMode() {
  if (!speech) return;
  errorText = "";
  listeningWanted = true;
  try {
    speech.listenRecurring(handleUserSentence, {
      language: SPEECH_LANGUAGE,
      interimResults: true,
    });
  } catch (error) {
    errorText = String(error?.message || error);
    listeningWanted = false;
    setAnimState("error");
  }
  updateStatus();
}

function stopListeningMode() {
  listeningWanted = false;
  interimText = "";
  try {
    speech?.stopListening?.();
    speech?.stopSpeaking?.();
  } catch {}
  updateStatus();
}

async function handleUserSentence(sentence) {
  const input = String(sentence || "").trim();
  if (!input || askInFlight) return;

  interimText = "";
  lastHeardText = input;
  appendBubble("user", input);
  pushHistory("user", input);

  try {
    speech?.stopListening?.();
  } catch {}

  await askAssistant(input);
}

async function askAssistant(userText) {
  if (!gpt || askInFlight) return;

  askInFlight = true;
  updateStatus();
  setAnimState("processing");

  try {
    const prompt = buildConversationPrompt(userText);
    const res = await gpt.ask(prompt);

    if (gpt.error || res?.error) {
      errorText = String(gpt.error || res?.error || "Unknown error");
      setAnimState("error");
      return;
    }

    let reply = "";
    if (typeof res?.text === "string") reply = res.text;
    else if (typeof gpt?.latestObject?.text === "string") reply = gpt.latestObject.text;

    reply = sanitizeAssistantReply(reply);
    if (!reply) {
      errorText = "No text returned from GPT";
      setAnimState("error");
      return;
    }

    appendBubble("assistant", reply);
    pushHistory("assistant", reply);

    if (AUTO_SPEAK_REPLY && speech) {
      setAnimState("speaking");
      await speech.speak(reply, SPEECH_LANGUAGE);
    }
  } catch (error) {
    errorText = String(error?.message || error);
    setAnimState("error");
  } finally {
    askInFlight = false;
    if (listeningWanted) startListeningMode();
    updateStatus();
  }
}

function buildConversationPrompt(userText) {
  const historyText = chatHistory
    .slice(-CHAT_HISTORY_LIMIT)
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.text}`)
    .join("\n");

  return [
    "Conversation so far:",
    historyText || "(none)",
    `User: ${String(userText || "").trim()}`,
    "Assistant:",
  ].join("\n");
}

function appendBubble(role, text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return;
  bubbles.push({ role, text: cleaned });
  if (bubbles.length > 40) {
    bubbles = bubbles.slice(-40);
  }
}

function pushHistory(role, text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return;
  chatHistory.push({ role, text: cleaned });
  if (chatHistory.length > CHAT_HISTORY_LIMIT) {
    chatHistory = chatHistory.slice(-CHAT_HISTORY_LIMIT);
  }
}

function resetConversation() {
  stopListeningMode();
  conversationStarted = false;
  askInFlight = false;
  errorText = "";
  statusText = "Ready";
  lastHeardText = "";
  bubbles = [];
  chatHistory = [];
  setAnimState("reset");
  setAnimState("ready");
}

function updateStatus() {
  if (errorText) {
    statusText = "Error";
    setAnimState("error");
    return;
  }
  if (askInFlight) {
    statusText = "Thinking";
    setAnimState("processing");
    return;
  }
  if (speech?.isSpeaking?.()) {
    statusText = "Speaking";
    setAnimState("speaking");
    return;
  }
  if (speech?.isListening?.()) {
    statusText = "Listening";
    setAnimState("listening");
    return;
  }
  if (listeningWanted) {
    statusText = "Ready to listen";
    setAnimState("waiting_for_reply");
    return;
  }
  statusText = "Ready";
  setAnimState(conversationStarted ? "ready" : "idle");
}

async function connectUsbSerial() {
  if (!usbSerial) {
    serialStatusText = "unsupported";
    return;
  }
  try {
    await usbSerial.connect();
    await sendSerialState(`STATE:${animState}`);
  } catch (error) {
    console.warn("[gptChatUsbSerial] connect serial failed", error);
    serialStatusText = "error";
  }
}

function setAnimState(nextState) {
  const value = String(nextState || "").trim();
  if (!value || value === animState) return;
  animState = value;
  sendSerialState(`STATE:${animState}`);
}

async function sendSerialState(line) {
  if (!usbSerial?.connected) return false;
  return await usbSerial.sendLine(line);
}

function sanitizeAssistantReply(text) {
  let value = String(text || "").trim();
  if (!value) return "";
  value = value.replace(/^\s*assistant:\s*/i, "");
  const stopAtRole = value.search(/\n\s*(user|assistant)\s*:/i);
  if (stopAtRole >= 0) value = value.slice(0, stopAtRole);
  return value.replace(/\s+/g, " ").trim();
}

function getBubbleLayout(textValue, maxBubbleWidth) {
  const contentWidth = maxBubbleWidth - 36;
  const lines = wrapTextToWidth(String(textValue || ""), contentWidth, 22);
  const longest = lines.reduce((best, line) => max(best, textWidth(line)), 0);
  const widthValue = constrain(longest + 36, 140, maxBubbleWidth);
  const heightValue = max(56, lines.length * 28 + 28);
  return {
    lines,
    width: widthValue,
    height: heightValue,
  };
}

function wrapTextToWidth(textValue, maxWidth, fontSize) {
  textSize(fontSize);
  textStyle(NORMAL);

  const raw = String(textValue || "").replace(/\s+/g, " ").trim();
  if (!raw) return [""];

  const words = raw.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (textWidth(word) <= maxWidth) {
      current = word;
      continue;
    }

    let chunk = "";
    for (const char of word) {
      const chunkCandidate = chunk + char;
      if (textWidth(chunkCandidate) <= maxWidth || !chunk) {
        chunk = chunkCandidate;
      } else {
        lines.push(chunk);
        chunk = char;
      }
    }
    current = chunk;
  }

  if (current) lines.push(current);
  return lines.length ? lines : [raw];
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function keyPressed() {
  if (key === "f") {
    fullScreenToggle();
  }
}
