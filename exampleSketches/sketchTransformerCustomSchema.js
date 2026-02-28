let transformer;
let statusText = "Loading model...";
let askInFlight = false;

let sentenceText = "Sorry I am late";
let answer = "-";
let rawText = "";
let chatHistory = [];

const MODEL = {
  label: "SmolLM2 360M",
  task: "text-generation",
  model: "onnx-community/SmolLM2-360M-ONNX",
  quantized: true,
  dtype: "q8",
};
// const MODEL = {
//   label: "Qwen2.5 0.5B Instruct",
//   task: "text-generation",
//   model: "onnx-community/Qwen2.5-0.5B-Instruct",
//   quantized: true,
//   dtype: "q8",
// };

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");

  await loadScript("portal/transformer.js");

  transformer = await new PortalTransformer({
    task: MODEL.task,
    model: MODEL.model,
    quantized: MODEL.quantized,
    dtype: MODEL.dtype,
    maxNewTokens: 32,
    temperature: 0,
    topK: 1,
  }).init();

  statusText = "Model ready";
}

function draw() {
  background(20);
  fill(255);
  textSize(24);
  text("Custom Schema Demo", 30, 50);

  textSize(16);
  text("Status: " + statusText, 30, 85);
  text("User: " + sentenceText, 30, 120, width - 60, 90);
  text("Assistant: " + answer, 30, 220, width - 60, 120);
  text("Raw model output:", 30, 365);
  text(rawText || "-", 30, 390, width - 60, 160);

  if (askInFlight) return;

  const setBtn = uiButton("Set Message", {
    x: 30,
    y: height - 90,
    width: 220,
    height: 58,
    fontSize: 24,
  });
  if (setBtn.clicked) {
    const next = prompt("Enter your message:", sentenceText);
    if (typeof next === "string" && next.trim()) sentenceText = next.trim();
  }

  const btn = uiButton("Ask", {
    x: 270,
    y: height - 90,
    width: 260,
    height: 58,
    fontSize: 24,
  });
  if (btn.clicked) askChat();
}

async function askChat() {
  if (!transformer || askInFlight) return;
  if (!String(sentenceText || "").trim()) {
    statusText = "Enter a message first";
    return;
  }
  askInFlight = true;
  statusText = "Asking...";
  try {
    const historyText = chatHistory
      .slice(-4)
      .map((m) => `${m.role}: ${m.text}`)
      .join("\n");

    const obj = await transformer.askJSON({
      instructions:
        "You are chatting with a good friend. Give a supportive natural response in 1-3 sentences.",
      prompt:
        `Conversation so far:\n${historyText || "(none)"}\n` +
        `Friend says: ${sentenceText}\n` +
        "You say:",
      schema: { response: "string" },
      maxAttempts: 1,
    });
    rawText = JSON.stringify(obj);
    answer = String(obj?.response || "-");
    if (answer !== "-") {
      chatHistory.push({ role: "friend", text: sentenceText });
      chatHistory.push({ role: "assistant", text: answer });
    }
    statusText = obj?.response ? "Done" : "Done (no answer)";
  } catch (e) {
    statusText = "Error: " + (e?.message || e);
    answer = "-";
  } finally {
    askInFlight = false;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
