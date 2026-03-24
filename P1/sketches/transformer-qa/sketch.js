let transformer;
let contextText = "";
let questionText = "What is Denmark's capital?";
let answerText = "-";
let confidenceText = "-";
let statusText = "Loading model...";
let askInFlight = false;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");

  await loadScript("portal/transformer.js");

  transformer = await new PortalTransformer({
    task: "question-answering",
    model: "Xenova/distilbert-base-cased-distilled-squad",
    quantized: true,
    onProgress: (p) => {
      const pct = Number.isFinite(p?.progress) ? Math.round(p.progress * 100) : null;
      statusText = pct == null ? "Loading model..." : `Loading model... ${pct}%`;
    },
  }).init();

  contextText =
    "Denmark is a country in Northern Europe. The capital city of Denmark is Copenhagen.";
  statusText = "Model ready";
  await askNow();
}

function draw() {
  background(20);
  fill(255);

  textSize(26);
  text("PortalTransformer Q/A", 30, 50);

  textSize(16);
  text("Status: " + statusText, 30, 90);
  text("Question: " + questionText, 30, 120);
  text("Context: " + contextText, 30, 150, width - 60, 80);
  text("Answer: " + answerText, 30, 270);
  text("Confidence: " + confidenceText, 30, 300);

  const btn = uiButton("Ask", {
    x: 30,
    y: 340,
    width: 180,
    height: 62,
    fontSize: 28,
  });
  if (btn.clicked) {
    askNow();
  }

  if (transformer?.hasNewResult()) {
    const { result } = transformer.consumeNew();
    if (result) {
      answerText = result.answer || "-";
      confidenceText = nf((result.confidence || 0) * 100, 1, 1) + "%";
      statusText = "Answer updated";
    }
  }
}

async function askNow() {
  if (!transformer) {
    statusText = "No transformer instance";
    return;
  }
  if (askInFlight) {
    return;
  }
  askInFlight = true;
  statusText = "Asking...";
  try {
    const result = await transformer.ask(questionText, { context: contextText });
    answerText = result.answer || "-";
    confidenceText = nf((result.confidence || 0) * 100, 1, 1) + "%";
    statusText = result.answer ? "Done" : "Done (empty answer)";
  } catch (e) {
    const msg = e?.message || String(e);
    statusText = "Error: " + msg;
  } finally {
    askInFlight = false;
  }
}
