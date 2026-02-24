let apiKeyEncryptedGpt12 =
  "U2FsdGVkX18ufo+Jv5eV1uiVVu23Jjvr8SaHfqG2rnsUq75hmr1av/B4KStyhTJtJwMgyyM6CP9gKXuUEu8F2m52Ey+wyLSiuI34pcMYOnPOVrngAAE3EMJg1Sx52sdns3JzqQHJgma6chold+TcfgeYqG/4O8wdRiKLz64Ic+v9uB+xDrzxJ2Cazu4En9yWPTKskgvccEn3ls0+zVGacW1zLaNyJXmzm+yHE0mkro+a/5lWzZFRT6UX6+HVEgqi";
let apiKey = "";
let gpt;

let cam;
let img;
let resultText = "Ready";
let isAsking = false;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textSize(20);

  await loadScript("portal/GptClient.js");
  apiKey = storedDecrypt({ apiKeyEncryptedGpt12 });

  // --- Step 3. Define structured response schema ---
  const functionSchemas = [
    {
      name: "color_response",
      description: "Return the dominant color of the image as a word.",
      parameters: {
        type: "object",
        properties: { color: { type: "string" } },
        required: ["color"],
      },
    },
  ];

  // --- Step 4. Make the GptClient ---
  gpt = new GptClient({
    apiKey,
    model: "gpt-4o-mini",
    instructions:
      "Look carefully at the user's image and describe the main color. Respond using the provided color_response tool.",
    functionSchemas,
    functionName: "color_response",
  });

  cam = await setupWebcamera(false, 640, 480, true);

  // --- Step 1. Make a red image using createGraphics() ---
  img = createGraphics(256, 256);
  img.background(255, 0, 0); // bright red square
  const block = await gpt._makeImageBlock(img);
  console.log("image block going to API:", block);

  // --- Step 5. Ask GPT about the image ---
  const res = await gpt.ask("What color is this image?", img);
  console.log("GPT result:", res);

  if (res.error) {
    resultText = "Error: " + res.error;
  } else if (res.color) {
    resultText = "Detected color: " + res.color;
  } else if (res.text) {
    resultText = "Answer: " + res.text;
  } else {
    resultText = "Unknown response";
  }
}

function draw() {
  background(245);

  if (cam) {
    image(cam, 24, 90, 640, 480);
  }

  if (
    uiButton("Take picture + detect color", {
      x: 24,
      y: 24,
      width: 280,
      height: 44,
      fontSize: 18,
    }).clicked &&
    !isAsking
  ) {
    askColorFromCamera();
  }

  if (img) {
    image(img, 700, 90, 220, 220);
  }

  fill(0);
  text("Result: " + resultText, 24, 600);
}

async function askColorFromCamera() {
  isAsking = true;
  resultText = "Analyzing...";

  img = createGraphics(256, 256);
  if (cam) img.image(cam, 0, 0, 256, 256);

  const res = await gpt.ask("Which color is this object?", img);
  console.log("GPT result:", res);

  if (res.error) {
    resultText = "Error: " + res.error;
  } else if (res.color) {
    resultText = "Detected color: " + res.color;
  } else if (res.text) {
    resultText = "Answer: " + res.text;
  } else {
    resultText = "Unknown response";
  }

  isAsking = false;
}
