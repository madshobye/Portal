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
const MEMORY_TURNS = 4; // user+assistant pairs to keep

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
  const memoryPreview = chatHistory
    .slice(-MEMORY_TURNS * 2)
    .map((m) => `${m.role}: ${m.text}`)
    .join(" | ");
  text("Memory: " + (memoryPreview || "-"), 30, 370, width - 60, 55);
  text("Raw model output:", 30, 440);
  text(rawText || "-", 30, 465, width - 60, 95);

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
      .slice(-MEMORY_TURNS * 2)
      .map((m) => `${m.role}: ${m.text}`)
      .join("\n");

    const prompt =
      "Reply with one short factual sentence. " +
      "Do not repeat the user's words. Do not use labels. Do not use examples. " +
      "Avoid phrases like 'I know' or 'as an AI'. If unsure, say 'I am not sure.'\n" +
      (historyText ? `Previous chat: ${historyText}\n` : "") +
      `Question: ${input}\n` +
      "Answer:";

    const raw = await transformer.pipeline(prompt, {
      max_new_tokens: 32,
      temperature: 0,
      top_k: 1,
      do_sample: false,
    });

    const generated = extractGeneratedText(raw, prompt);
    rawText = generated;
    assistantText = enforceConversationalEnding(sanitizeAssistantReply(generated)) || "-";

    if (assistantText !== "-") {
      chatHistory.push({ role: "user", text: input });
      chatHistory.push({ role: "assistant", text: assistantText });
      const keep = MEMORY_TURNS * 2;
      if (chatHistory.length > keep) {
        chatHistory = chatHistory.slice(-keep);
      }
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
  // Drop common prompt echoes from tiny models.
  s = s.replace(/^\s*(Instruction|History|Previous chat|Question)\s*:[\s\S]*?\bAnswer:\s*/i, "");
  s = s.replace(/^\s*(Answer|Assistant)\s*:\s*/i, "");
  const stopAtRole = s.search(/\n\s*(User|Assistant|Question|Answer)\s*:/i);
  if (stopAtRole >= 0) s = s.slice(0, stopAtRole);
  const inlineUser = s.search(/\b(User|Question)\s*:/i);
  if (inlineUser >= 0) s = s.slice(0, inlineUser);
  const stopMarkers = [
    /\bquestion\s*:/i,
    /\banswer\s*:/i,
    /\bhistory\b/i,
    /\bexample\b/i,
    /\bthe user asks\b/i,
    /\bthe user replies\b/i,
    /\braw model output\b/i,
    /\b##\b/,
  ];
  for (const rx of stopMarkers) {
    const idx = s.search(rx);
    if (idx > 0) s = s.slice(0, idx);
  }

  s = s.replace(/\s+/g, " ").trim();
  s = collapseRepeatedTail(s);
  s = removeLowQualityBoilerplate(s);
  s = keepFirstSentence(s);

  // Final guard for TTS/UI brevity on tiny models.
  if (s.length > 140) s = s.slice(0, 137).trim() + "...";
  return s;
}

function keepFirstSentence(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  const m = s.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : s).trim();
}

function collapseRepeatedTail(text) {
  const src = String(text || "").trim();
  if (!src) return "";
  const words = src.split(/\s+/);
  if (words.length < 8) return src;

  // If a 3-word phrase appears again later, trim at the first repeated occurrence.
  for (let i = 0; i <= words.length - 3; i++) {
    const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`.toLowerCase();
    for (let j = i + 3; j <= words.length - 3; j++) {
      const phrase2 = `${words[j]} ${words[j + 1]} ${words[j + 2]}`.toLowerCase();
      if (phrase === phrase2) {
        return words.slice(0, j).join(" ");
      }
    }
  }
  return src;
}

function removeLowQualityBoilerplate(text) {
  let s = String(text || "").trim();
  if (!s) return "";
  const badStarts = [
    /^yes,\s*i\s+know[^,.!?]*[,.\s]*/i,
    /^i\s+know[^,.!?]*[,.\s]*/i,
    /^hi,\s*i'?m\s+a\s+student[^,.!?]*[,.\s]*/i,
    /^as an ai[^,.!?]*[,.\s]*/i,
    /^i'?m not sure if i'?m answering the question correctly[,.\s]*/i,
    /^i'?m not sure[,.\s]*/i,
  ];
  for (const rx of badStarts) {
    s = s.replace(rx, "");
  }
  return s.trim();
}

function enforceConversationalEnding(text) {
  let s = String(text || "").trim();
  if (!s) return "";

  // Keep it concise for TTS.
  if (s.length > 160) s = s.slice(0, 157).trim() + "...";
  return s;
}
