let apiKeyEncryptedGpt12 =
  "U2FsdGVkX18ufo+Jv5eV1uiVVu23Jjvr8SaHfqG2rnsUq75hmr1av/B4KStyhTJtJwMgyyM6CP9gKXuUEu8F2m52Ey+wyLSiuI34pcMYOnPOVrngAAE3EMJg1Sx52sdns3JzqQHJgma6chold+TcfgeYqG/4O8wdRiKLz64Ic+v9uB+xDrzxJ2Cazu4En9yWPTKskgvccEn3ls0+zVGacW1zLaNyJXmzm+yHE0mkro+a/5lWzZFRT6UX6+HVEgqi";

let apiKey = "";
let gpt;
let speech;

let statusText = "Loading...";
let heardSentence = "";
let answerText = "-";
let askInFlight = false;
let chatHistory = [];
const MEMORY_TURNS = 4; // number of user+assistant pairs to keep

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");

  await loadScript("portal/GptClient.js");
  await loadScript("portal/speech.js");

  speech = await new PortalSpeech({
    language: "en-GB",
    rate: 1,
    pitch: 1,
    volume: 1,
  }).init();

  apiKey = storedDecrypt({ apiKeyEncryptedGpt12 });
  gpt = new GptClient({
    apiKey,
    model: "gpt-4o-mini",
    instructions:
      "You answer questions clearly and as simple as possible. Keep it short.",
  });

  statusText = "Ready";
}

function draw() {
  background(20);
  fill(255);

  textSize(24);
  text("GPT Voice Chat", 30, 50);

  textSize(16);
  text("Status: " + statusText, 30, 85);
  text("Listening: " + (speech?.isListening() ? "yes" : "no"), 30, 110);
  text("Heard: " + (heardSentence || "-"), 30, 145, width - 60, 90);
  text("Assistant: " + answerText, 30, 230, width - 60, 140);
  const memoryPreview = chatHistory
    .slice(-MEMORY_TURNS * 2)
    .map((m) => `${m.role}: ${m.text}`)
    .join(" | ");
  text("Memory: " + (memoryPreview || "-"), 30, 380, width - 60, 90);

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
    askFromText(heardSentence);
  }

  if (speech?.hasNewResult()) {
    const { text } = speech.consumeNew();
    heardSentence = String(text || "").trim();
    if (heardSentence) askFromText(heardSentence);
  }
}

async function askFromText(userText) {
  if (!gpt || askInFlight) return;
  const input = String(userText || "").trim();
  if (!input) return;

  askInFlight = true;
  statusText = "Asking...";
  try {
    const historyText = chatHistory
      .slice(-MEMORY_TURNS * 2)
      .map((m) => `${m.role}: ${m.text}`)
      .join("\n");
    const prompt =
      `Conversation so far:\n${historyText || "(none)"}\n` +
      `User: ${input}\n` +
      "Assistant:";

    const res = await gpt.ask(prompt);

    let reply = "";
    if (gpt.error || res?.error) {
      statusText = "Error: " + (gpt.error || res?.error);
      answerText = "-";
      return;
    }

    if (res?.text) reply = String(res.text).trim();
    else if (gpt.latestObject?.text) reply = String(gpt.latestObject.text).trim();

    answerText = sanitizeAssistantReply(reply) || "-";

    if (answerText !== "-") {
      chatHistory.push({ role: "user", text: input });
      chatHistory.push({ role: "assistant", text: answerText });
      const keep = MEMORY_TURNS * 2;
      if (chatHistory.length > keep) {
        chatHistory = chatHistory.slice(-keep);
      }
      statusText = "Speaking...";
      speech?.speak(answerText);
    } else {
      statusText = "No text returned";
    }
  } catch (e) {
    statusText = "Error: " + (e?.message || e);
    answerText = "-";
  } finally {
    askInFlight = false;
  }
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
