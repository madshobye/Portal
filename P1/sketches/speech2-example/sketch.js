let speech;
let statusText = "Loading...";
let finalTranscript = "";
let interimTranscript = "";
let lastFinalAt = 0;
let errorText = "";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");

  try {
    await loadScript("portal/speech2.js");
    speech = await new PortalSpeech2({
      language: "en-GB",
      rate: 1,
      pitch: 1,
      volume: 1,
    }).init();

    speech.onResult((text) => {
      finalTranscript = String(text || "");
      lastFinalAt = Date.now();
    });

    speech.onInterimResult((text) => {
      interimTranscript = String(text || "");
    });

    speech.onListeningChange((isListening) => {
      statusText = isListening ? "Listening..." : "Ready";
      if (!isListening) interimTranscript = "";
    });

    statusText = "Ready";
  } catch (error) {
    statusText = "Speech2 unavailable";
    errorText = String(error?.message || error);
  }
}

function draw() {
  background(14, 17, 24);
  fill(235);

  textSize(26);
  text("Speech2 Example", 24, 42);

  textSize(15);
  text(`Status: ${statusText}`, 24, 74);
  text(`Listening: ${speech?.isListening?.() ? "yes" : "no"}`, 24, 96);
  text(`Speaking: ${speech?.isSpeaking?.() ? "yes" : "no"}`, 24, 118);

  if (speech?.isListening?.()) {
    noStroke();
    fill(240, 54, 54);
    circle(width - 30, 30, 14);
    fill(235);
  }

  textSize(17);
  text("Final transcript:", 24, 160);
  textSize(20);
  text(finalTranscript || "-", 24, 190, width - 48, 120);

  textSize(17);
  text("Interim transcript:", 24, 330);
  textSize(18);
  text(interimTranscript || "-", 24, 358, width - 48, 100);

  textSize(14);
  const secondsSinceFinal = lastFinalAt ? Math.floor((Date.now() - lastFinalAt) / 1000) : "-";
  text(`Seconds since final: ${secondsSinceFinal}`, 24, 470);

  if (errorText) {
    fill(255, 130, 130);
    text(`Error: ${errorText}`, 24, 500, width - 48, 120);
    fill(235);
  }

  const top = height - 82;
  if (
    uiButton("Start", {
      x: 24,
      y: top,
      width: 140,
      height: 52,
      fontSize: 22,
      rounding: 10,
    }).clicked
  ) {
    startRecurring();
  }

  if (
    uiButton("Stop", {
      x: 174,
      y: top,
      width: 140,
      height: 52,
      fontSize: 22,
      rounding: 10,
    }).clicked
  ) {
    stopRecurring();
  }

  if (
    uiButton("Speak Final", {
      x: 324,
      y: top,
      width: 200,
      height: 52,
      fontSize: 22,
      rounding: 10,
    }).clicked
  ) {
    speakFinal();
  }

  if (
    uiButton("Clear", {
      x: 534,
      y: top,
      width: 140,
      height: 52,
      fontSize: 22,
      rounding: 10,
    }).clicked
  ) {
    finalTranscript = "";
    interimTranscript = "";
    lastFinalAt = 0;
  }
}

function startRecurring() {
  if (!speech) return;
  errorText = "";
  try {
    speech.listenRecurring(
      (sentence) => {
        finalTranscript = String(sentence || "");
        lastFinalAt = Date.now();
      },
      { interimResults: true }
    );
  } catch (error) {
    errorText = String(error?.message || error);
  }
}

function stopRecurring() {
  if (!speech) return;
  speech.stopListening();
  interimTranscript = "";
}

async function speakFinal() {
  if (!speech || !finalTranscript) return;
  try {
    await speech.speak(finalTranscript);
  } catch (error) {
    errorText = String(error?.message || error);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
