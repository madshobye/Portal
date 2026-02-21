let speech;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  background(20);
  fill(255);
  textSize(22);
  text("Click to speak", 30, 50);

  await loadScript("portal/speech.js");
  speech = await new PortalSpeech({ language: "en-US" }).init();
}

function draw()
{
  
}

async function mousePressed() {
  print("hep");
  if (!speech) {
    print("speech missing");
    return;
  }

  try {
    await speech.speak("Hello from Portal Speech", "en-US");
    print("hep2");
  } catch (e) {
    print("speak error:", e?.message || e);
  }
}