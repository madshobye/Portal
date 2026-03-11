let canvas;
let apiKeyEncryptedGpt12 =
  "U2FsdGVkX18ufo+Jv5eV1uiVVu23Jjvr8SaHfqG2rnsUq75hmr1av/B4KStyhTJtJwMgyyM6CP9gKXuUEu8F2m52Ey+wyLSiuI34pcMYOnPOVrngAAE3EMJg1Sx52sdns3JzqQHJgma6chold+TcfgeYqG/4O8wdRiKLz64Ic+v9uB+xDrzxJ2Cazu4En9yWPTKskgvccEn3ls0+zVGacW1zLaNyJXmzm+yHE0mkro+a/5lWzZFRT6UX6+HVEgqi";
let apiKey = "";
let gpt;

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);

  await loadScript("portal/GptClient.js");

   apiKey = storedDecrypt({ apiKeyEncryptedGpt12 });
   gpt = new GptClient({
     apiKey,
     model: "gpt-4o-mini",
     instructions:
       "You answer questions clearly and as simple as possible. preferably one word.",
   });

   await gpt.ask("What is the capital of Argentina?");
   // 4. Now read result from the client
   if (gpt.error) {
     console.log("Error:", gpt.error);
   } else if (gpt.latestObject) {
     console.log("Answer text:", gpt.latestObject.text);
   }
}

function draw() {
  
}