let canvas;
let btnStyle = {
  hAlign: "center",
  fontSize: 20,
  x: 20,
  y: 20,
  width: 220,
  height: 50,
};

let apiKeyEncryptedGpt12 =
  "U2FsdGVkX18ufo+Jv5eV1uiVVu23Jjvr8SaHfqG2rnsUq75hmr1av/B4KStyhTJtJwMgyyM6CP9gKXuUEu8F2m52Ey+wyLSiuI34pcMYOnPOVrngAAE3EMJg1Sx52sdns3JzqQHJgma6chold+TcfgeYqG/4O8wdRiKLz64Ic+v9uB+xDrzxJ2Cazu4En9yWPTKskgvccEn3ls0+zVGacW1zLaNyJXmzm+yHE0mkro+a/5lWzZFRT6UX6+HVEgqi";

let apiKey = "";
let instructionsStr =
  "Generate clear, vivid images from prompts. Keep style coherent and visually readable.";

let gpt;
let resultText = "Ready";
let generatedImage = null;
let currentPrompt = "an abstract painting in bauhaus style";
let isGenerating = false;

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);

  await loadScript("portal/GptClient.js");

  apiKey = storedDecrypt({ apiKeyEncryptedGpt12 });

  gpt = new GptClient({
    apiKey,
    model: "gpt-4o-mini",
    instructions: instructionsStr,
  });

  textSize(20);
  fill(255);
}

function draw() {
  background(0);

  if (generatedImage) {
    const maxW = width - 40;
    const maxH = height - 220;
    const s = min(maxW / generatedImage.width, maxH / generatedImage.height);
    const w = generatedImage.width * s;
    const h = generatedImage.height * s;
    const x = (width - w) * 0.5;
    const y = 180 + (maxH - h) * 0.5;
    image(generatedImage, x, y, w, h);
  } else {
    stroke(120);
    noFill();
    rect(20, 180, width - 40, height - 220);
    noStroke();
  }

  if (gpt?.latestObject) {
    const promptLine = gpt.latestObject?.meta?.prompt || currentPrompt;
    text("Prompt: " + promptLine, 20, 110, width - 40);
    text("Status: " + resultText, 20, 145, width - 40);
  } else {
    text("Prompt: " + currentPrompt, 20, 110, width - 40);
    text("Status: " + resultText, 20, 145, width - 40);
  }

  const label = isGenerating ? "GENERATING..." : "GENERATE IMAGE";
  if (uiButton(label, btnStyle).clicked && !isGenerating) {
    runImageGeneration();
  }
}

async function runImageGeneration() {
  if (!gpt || isGenerating) return;
  isGenerating = true;
  resultText = "Generating image...";

  const res = await gpt.generateImage(currentPrompt, {
    model: "gpt-image-1",
    size: "1024x1024",
    output_format: "png",
    preferB64: true,
    loadAsP5Image: true,
  });

  if (res?.error) {
    resultText = "Error: " + res.error;
    generatedImage = null;
  } else {
    generatedImage = res.image || null;
    resultText = generatedImage ? "Image generated" : "Generated (no local image decode)";
  }

  isGenerating = false;
}
