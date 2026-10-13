// A phone asks for one startup tap when speech needs it.
window.PORTAL_ACTIVATION = "auto";

// Uses the encrypted key from the original visual-aid sketch.
let apiKeyEncryptedGpt152 = "U2FsdGVkX1+xIpT6ovNE1CMERN4mzSgCM+eMVPI3vfgOb4GeuLIVreoQRqSHYcpFfFyXo69Ne7z4LieGwgpvGIISCn0HSCST7Q9AMjmQ0E8Rdwt2AcYHnsFYeEiiUewKPxQEkwx/cH9B035GxHFagDN2YCtarlyPP4XKhmbI7ytCs8ojQlrFdc9rAcmSa+MwGQw9zduy39M13+F/vXDZ6K8k5qLfdJAFnFXPOeCHGosN/rTou68oJ5hTssVUaesp";

let cam, gpt, speech;
let resultLabel, resultPanel;
let lastDescription = "";
let isAnalyzing = false;

async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  createResultPanel();
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
    resultLabel.textContent = "Tap the camera to identify an object.";
  } catch (error) {
    resultLabel.textContent = error.message || "Could not start the camera.";
  }
}

function createResultPanel() {
  const panel = document.createElement("section");
  resultPanel = panel;
  panel.style.cssText = "position:fixed;top:32px;left:32px;width:calc(100% - 64px);box-sizing:border-box;padding:16px 20px;border-radius:8px;background:rgba(0,0,0,.85);color:white;font:22px/1.4 system-ui;z-index:10;max-height:45vh;overflow:auto;pointer-events:none";
  resultLabel = document.createElement("p");
  resultLabel.textContent = "Starting camera…";
  resultLabel.style.margin = "0";
  resultLabel.setAttribute("role", "status");
  panel.appendChild(resultLabel);

  document.body.appendChild(panel);
}

function draw() {
  background(0);
  if (!cam) return;
  // Fill the canvas without stretching; crop the preview edges as needed.
  const video = cam.elt;
  if (!video.videoWidth || !video.videoHeight) return;
  const margin = 16;
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const w = video.videoWidth * scale;
  const h = video.videoHeight * scale;
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  image(cam, x, y, w, h);
  // Keep the text box inside the visible canvas.
  resultPanel.style.left = `${margin}px`;
  resultPanel.style.top = `${margin}px`;
  resultPanel.style.width = `${Math.max(1, width - margin * 2)}px`;
}

async function identifyObject() {
  if (isAnalyzing || !gpt || !cam) return;
  const video = cam.elt;
  if (video.readyState < 2 || !video.videoWidth) {
    resultLabel.textContent = "Camera is not ready. Try again in a moment.";
    return;
  }

  isAnalyzing = true;
  speech?.stopSpeaking();
  resultLabel.textContent = "Analyzing…";
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
    resultLabel.textContent = lastDescription;
    // Display the result immediately; speech may wait for another gesture.
    say(lastDescription);
  } catch (error) {
    resultLabel.textContent = `Could not identify the object: ${error.message || error}`;
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
