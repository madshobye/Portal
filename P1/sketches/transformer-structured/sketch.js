let transformer;
let questionText = "Suggest one healthy lunch for students.";
let contextText = "Audience: 14-year-old students. Keep cost low.";
let answerText = "-";
let confidenceText = "-";
let reasonText = "-";
let statusText = "Loading model...";
let askInFlight = false;
let modelReady = false;
let modelLoading = true;
let modelProgressPct = null;
let modelLoadStep = "";
let bootError = "";

// Pick ONE model by commenting/uncommenting.
const MODEL = {
  label: "Qwen2.5 0.5B Instruct",
  task: "text-generation",
  model: "onnx-community/Qwen2.5-0.5B-Instruct",
  quantized: true,
  dtype: "q8",
};
// const MODEL = {
//   label: "SmolLM2 360M",
//   task: "text-generation",
//   model: "onnx-community/SmolLM2-360M-ONNX",
//   quantized: true,
//   dtype: "q8",
// };
// const MODEL = {
//   label: "distilgpt2",
//   task: "text-generation",
//   model: "Xenova/distilgpt2",
//   quantized: true,
//   dtype: "q8",
// };

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");
  bootstrap();
}

async function bootstrap() {
  await loadScript("portal/transformer.js");
  try {
    transformer = await new PortalTransformer({
      task: MODEL.task,
      model: MODEL.model,
      quantized: MODEL.quantized,
      dtype: MODEL.dtype,
      maxNewTokens: 120,
      temperature: 0.2,
      onProgress: (p) => {
        modelProgressPct = toPercent(p);
        modelLoadStep = String(p?.status || p?.file || "");
        statusText =
          modelProgressPct == null
            ? `Loading ${MODEL.label}...`
            : `Loading ${MODEL.label}... ${modelProgressPct}%`;
      },
    }).init();
    modelReady = true;
    modelLoading = false;
    statusText = `${MODEL.label} ready`;
  } catch (e) {
    modelLoading = false;
    modelReady = false;
    bootError = e?.message || String(e);
    statusText = "Load error";
  }
}

function draw() {
  background(20);
  fill(255);

  textSize(26);
  text("PortalTransformer Structured LLM", 30, 50);

  textSize(16);
  text("Model: " + MODEL.label, 30, 82);
  text("Status: " + statusText, 30, 106);

  if (bootError) {
    text("Error: " + bootError, 30, 140, width - 60, 180);
    return;
  }

  if (modelLoading) {
    text("Loading model files...", 30, 140);
    if (modelLoadStep) text("Step: " + modelLoadStep, 30, 165, width - 60, 40);
    drawProgressBar(30, 205, width - 60, 28, modelProgressPct, "Model Load");
    return;
  }

  text("Question: " + questionText, 30, 140, width - 60, 45);
  text("Context: " + contextText, 30, 180, width - 60, 60);
  text("Answer: " + answerText, 30, 260, width - 60, 70);
  text("Confidence: " + confidenceText, 30, 345);
  text("Reason: " + reasonText, 30, 375, width - 60, 120);

  if (askInFlight) {
    drawProgressBar(30, 510, width - 60, 28, null, "Generating Answer");
    return;
  }

  const btn = uiButton("Ask", {
    x: 30,
    y: 500,
    width: 180,
    height: 62,
    fontSize: 28,
  });
  if (btn.clicked) askNow();
}

async function askNow() {
  if (!transformer || !modelReady || askInFlight) return;
  askInFlight = true;
  statusText = "Asking...";
  try {
    const result = await transformer.askStructured(questionText, {
      context: contextText,
    });
    answerText = result.answer || "-";
    console.log(answerText);
    confidenceText = nf((result.confidence || 0) * 100, 1, 1) + "%";
    reasonText = result.reason || "-";
    statusText = result.answer ? "Done" : "Done (empty answer)";
  } catch (e) {
    statusText = "Error: " + (e?.message || e);
  } finally {
    askInFlight = false;
  }
}

function toPercent(progressObj) {
  const p = Number(progressObj?.progress);
  if (Number.isFinite(p)) {
    if (p >= 0 && p <= 1) return Math.round(p * 100);
    if (p > 1 && p <= 100) return Math.round(p);
  }
  const loaded = Number(progressObj?.loaded);
  const total = Number(progressObj?.total);
  if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
    return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
  }
  return null;
}

function drawProgressBar(x, y, w, h, pct, label) {
  noStroke();
  fill(60);
  rect(x, y, w, h, 8);

  let ratio;
  if (Number.isFinite(pct)) {
    ratio = constrain(pct / 100, 0, 1);
  } else {
    ratio = (sin(millis() * 0.006) * 0.5 + 0.5) * 0.6 + 0.2;
  }

  fill(0, 220, 140);
  rect(x, y, Math.max(8, w * ratio), h, 8);

  fill(255);
  textSize(14);
  const suffix = Number.isFinite(pct) ? ` ${pct}%` : " ...";
  text(`${label}${suffix}`, x, y - 8);
}
