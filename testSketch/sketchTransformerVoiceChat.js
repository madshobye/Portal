// Voice + LLM chat demo:
// - Speech-to-text via PortalSpeech.listenRecurring()
// - LLM response via PortalTransformer
// - Text-to-speech response via PortalSpeech.speak()

let transformer;
let speech;

let statusText = "Loading...";
let heardSentence = "";
let assistantText = "-";
let rawText = "";
let askInFlight = false;
let chatHistory = [];

const MODEL = {
  label: "SmolLM2 360M",
  task: "text-generation",
  model: "onnx-community/SmolLM2-360M-ONNX",
  quantized: true,
  dtype: "q8",
};

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");

  await loadScript("portal/transformer.js");
  await loadScript("portal/speech.js");

  speech = await new PortalSpeech({
    language: "en-GB",
    rate: 1,
    pitch: 1,
    volume: 1,
  }).init();

  transformer = await new PortalTransformer({
    task: MODEL.task,
    model: MODEL.model,
    quantized: MODEL.quantized,
    dtype: MODEL.dtype,
    maxNewTokens: 32,
    temperature: 0,
    topK: 1,
  }).init();

  statusText = "Ready";
}

function draw() {
  background(20);
  fill(255);

  textSize(24);
  text("Voice Chat Demo", 30, 50);

  textSize(16);
  text("Status: " + statusText, 30, 85);
  text("Listening: " + (speech?.isListening() ? "yes" : "no"), 30, 110);
  text("Heard: " + (heardSentence || "-"), 30, 145, width - 60, 90);
  text("Assistant: " + assistantText, 30, 230, width - 60, 130);
  text("Raw model output:", 30, 390);
  text(rawText || "-", 30, 415, width - 60, 145);

  const listenLabel = speech?.isListening() ? "Stop Listening" : "Start Listening";
  if (
    uiButton(listenLabel, {
      x: 30,
      y: height - 90,
      width: 240,
      height: 58,
      fontSize: 24,
      rounding: 12,
    }).clicked
  ) {
    if (!speech?.isListening()) speech.listenRecurring();
    else speech.stopListening();
  }

  if (
    uiButton("Ask Last Heard", {
      x: 290,
      y: height - 90,
      width: 230,
      height: 58,
      fontSize: 24,
      rounding: 12,
    }).clicked
  ) {
    askChatFromText(heardSentence);
  }

  if (speech?.hasNewResult()) {
    const { text } = speech.consumeNew();
    heardSentence = String(text || "").trim();
    if (heardSentence) {
      askChatFromText(heardSentence);
    }
  }
}

async function askChatFromText(userText) {
  if (!transformer || askInFlight) return;
  const input = String(userText || "").trim();
  if (!input) return;

  askInFlight = true;
  statusText = "Thinking...";
  try {
    const historyText = chatHistory
      .slice(-4)
      .map((m) => `${m.role}: ${m.text}`)
      .join("\n");

    const prompt =
      "You are a friendly assistant. Reply naturally in 1-2 short sentences.\n" +
      `Conversation so far:\n${historyText || "(none)"}\n` +
      `User: ${input}\n` +
      "Assistant:";

    const raw = await transformer.pipeline(prompt, {
      max_new_tokens: 32,
      temperature: 0,
      top_k: 1,
      do_sample: false,
    });

    const generated = extractGeneratedText(raw, prompt);
    rawText = generated;
    assistantText = sanitizeAssistantReply(generated) || "-";

    if (assistantText !== "-") {
      chatHistory.push({ role: "user", text: input });
      chatHistory.push({ role: "assistant", text: assistantText });
      statusText = "Speaking...";
      speech?.speak(assistantText);
    } else {
      statusText = "No response";
    }
  } catch (e) {
    statusText = "Error: " + (e?.message || e);
    assistantText = "-";
  } finally {
    askInFlight = false;
  }
}

function extractGeneratedText(raw, prompt = "") {
  const promptText = String(prompt || "");
  const stripPromptPrefix = (txt) => {
    const src = String(txt || "");
    if (!src) return "";
    if (promptText && src.startsWith(promptText)) {
      return src.slice(promptText.length).trimStart();
    }
    return src.trim();
  };

  if (Array.isArray(raw) && raw.length > 0) {
    const item = raw[0];
    if (typeof item?.generated_text === "string")
      return stripPromptPrefix(item.generated_text);
    if (typeof item?.text === "string")
      return stripPromptPrefix(item.text);
  }
  if (typeof raw === "string") return stripPromptPrefix(raw);
  return stripPromptPrefix(JSON.stringify(raw || ""));
}

function sanitizeAssistantReply(text) {
  let s = String(text || "").trim();
  if (!s) return "";
  s = s.replace(/^\s*Assistant:\s*/i, "");
  const stopAtRole = s.search(/\n\s*(User|Assistant)\s*:/i);
  if (stopAtRole >= 0) s = s.slice(0, stopAtRole);
  const inlineUser = s.search(/\bUser\s*:/i);
  if (inlineUser >= 0) s = s.slice(0, inlineUser);
  return s.replace(/\s+/g, " ").trim();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
