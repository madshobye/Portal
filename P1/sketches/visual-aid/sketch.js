// A phone asks for one startup tap when speech needs it.
window.PORTAL_ACTIVATION = "auto";

// Uses the encrypted key from the original visual-aid sketch.
let apiKeyEncryptedGpt152 = "U2FsdGVkX1+xIpT6ovNE1CMERN4mzSgCM+eMVPI3vfgOb4GeuLIVreoQRqSHYcpFfFyXo69Ne7z4LieGwgpvGIISCn0HSCST7Q9AMjmQ0E8Rdwt2AcYHnsFYeEiiUewKPxQEkwx/cH9B035GxHFagDN2YCtarlyPP4XKhmbI7ytCs8ojQlrFdc9rAcmSa+MwGQw9zduy39M13+F/vXDZ6K8k5qLfdJAFnFXPOeCHGosN/rTou68oJ5hTssVUaesp";

let cam, gpt, speech;
let resultText = "Starting camera…";
let lastDescription = "";
let isAnalyzing = false;

async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  // One pointer handler avoids duplicate touch + mouse requests.
  canvas.elt.addEventListener("pointerup", identifyObject);

  try {
    await loadScript("portal/GptClient.js");
    await loadScript("portal/speech.js");
    const apiKey = storedDecrypt({ apiKeyEncryptedGpt152 });
    if (!apiKey) throw new Error("No API key. Reload and enter the key password.");

    gpt = new GptClient({
      apiKey,
      model: "gpt-4o-mini",
      instructions: "Help a visually impaired person. If text is the main focus, such as a sign, label, or document, read the visible text directly in its original language, without an introduction. For long text, read the heading and most relevant short passage. Do not guess unreadable words; say when text is unclear. Otherwise, name the most important visible object immediately, followed by one useful detail. For object descriptions, use one short sentence, preferably under 12 words, for example: 'A red mug on a wooden table.' Never start with 'The main object', 'This image shows', 'I see', or similar introductions. If the object is unclear, say 'I cannot identify this clearly.'",
      functionSchemas: [{
        name: "response",
        description: "Read visible text when it is the main focus; otherwise name the object with one useful detail. No introduction.",
        parameters: {
          type: "object",
          properties: { sentence: { type: "string" } },
          required: ["sentence"],
        },
      }],
      functionName: "response",
    });

    try {
      speech = await new PortalSpeech({ language: "en-GB", rate: 1 }).init();
    } catch (error) {
      console.warn("Speech unavailable:", error);
    }
    // Rear camera, unmirrored. Portal does not request microphone access.
    cam = await setupWebcamera(false, 640, 480, false);
    resultText = "Tap the camera to identify an object.";
  } catch (error) {
    resultText = error.message || "Could not start the camera.";
  }
}

function draw() {
  background(0);
  const video = cam?.elt;
  if (video?.videoWidth && video.videoHeight) {
    // Fill the canvas without stretching; crop the preview edges as needed.
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    image(cam, (width - w) / 2, (height - h) / 2, w, h);
  }
  drawResultText();
}

function drawResultText() {
  const margin = 16;
  const padding = 20;
  const boxWidth = Math.max(1, width - margin * 2);
  const lineHeight = 30;
  push();
  textFont("sans-serif");
  textSize(22);
  // uiText accepts explicit line breaks; wrap to the available canvas width.
  const lines = [];
  for (const paragraph of resultText.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && textWidth(candidate) > boxWidth - padding * 2) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  const boxHeight = lines.length * lineHeight + padding * 2;
  textLeading(lineHeight);
  uiText(lines.join("\n"), {
    x: margin,
    y: Math.max(margin, height - boxHeight - margin),
    width: boxWidth,
    height: boxHeight,
    font: "sans-serif",
    fontSize: 22,
    textColor: "#ffffff",
    bgColor: "#000000d9",
    padding,
    rounding: 8,
    hAlign: "left",
    vAlign: "top",
  });
  pop();
}

async function identifyObject() {
  if (isAnalyzing || !gpt || !cam) return;
  const video = cam.elt;
  if (video.readyState < 2 || !video.videoWidth) {
    resultText = "Camera is not ready. Try again in a moment.";
    return;
  }

  isAnalyzing = true;
  speech?.stopSpeaking();
  resultText = "Analyzing…";
  let snapshot;
  try {
    snapshot = createGraphics(512, Math.max(1, Math.round(512 * video.videoHeight / video.videoWidth)));
    snapshot.pixelDensity(1);
    snapshot.image(cam, 0, 0, snapshot.width, snapshot.height);
    const result = await gpt.ask("If text is the main focus, read it directly. Otherwise name the object and add one useful detail. No introduction.", snapshot);
    if (result.error) throw new Error(result.error);
    const description = result.sentence || result.text;
    if (typeof description !== "string" || !description.trim()) throw new Error("No description returned. Please try again.");
    lastDescription = description.trim();
    resultText = lastDescription;
    // Display the result immediately; speech may wait for another gesture.
    say(lastDescription);
  } catch (error) {
    resultText = `Could not identify the object: ${error.message || error}`;
  } finally {
    snapshot?.remove();
    isAnalyzing = false;
  }
}

function say(text) {
  if (!speech || !text) return;
  speech.speak(text).catch(error => {
    if (error.name !== "AbortError") console.warn("Speech unavailable:", error);
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
