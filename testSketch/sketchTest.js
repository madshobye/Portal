// Student-friendly PortalSpeech example.
// Click button to start/stop recurring listening.

let speech;

let heardRed = false;
let heardSentence = "";

async function setup() {
  createCanvas(windowWidth, windowHeight);

  await loadScript("portal/speech.js");
  speech = await new PortalSpeech({
    language: "en-GB",
    rate: 1,
    pitch: 1,
    volume: 1,
  }).init();
}

function draw() {
  background(20);
  if (heardRed) {
    background("red");
  }

  fill(255);
  textSize(22);
  text("Recurring speech listener", 30, 50);
  textSize(16);
  text("Listening: " + (speech?.isListening() ? "yes" : "no"), 30, 90);
  text(`Heard: ${heardSentence || "-"}`, 30, 120);

  const btnStyle = {
    fontSize: 26,
    x: 30,
    y: 190,
    width: 280,
    height: 64,
    rounding: 12,
  };

  const label = speech?.isListening() ? "Stop Listening" : "Start Listening";
  if (uiButton(label, btnStyle).clicked) {
    if (!speech?.isListening()) {
      speech.listenRecurring();
    } else {
      speech.stopListening();
    }
  }

  if (speech?.hasNewResult()) {
    const { text } = speech.consumeNew();
    heardSentence = text || "";
    print("heard: " + heardSentence);
    if(speech.isMatch("no red background") )
    {
      heardRed = false;
      speech.speak("fine no red");
    } else if (speech.isMatch("red")) {
      heardRed = true;
      speech.speak("i also like red");
    }
  
    
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
