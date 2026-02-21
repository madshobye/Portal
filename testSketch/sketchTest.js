let speech;
let heardSentence = "";
let recurring = false;
let reply = "";

async function onHeardSentence(sentence) {
  heardSentence = sentence;
  print("heard: " + sentence);

  const txt = String(sentence || "").toLowerCase();
  if (txt.includes("red")) {
    reply = "i like blue";
    await speech.speak(reply);
  } else {
    reply = "";
  }
}

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
  fill(255);
  textSize(22);
  text("Recurring speech listener", 30, 50);

  textSize(16);
  text(`Listening: ${speech?.isListening() ? "yes" : "no"}`, 30, 90);
  text(`Heard: ${heardSentence || "-"}`, 30, 120);
  text(`Reply: ${reply || "-"}`, 30, 150);

  const btnStyle = {
    fontSize: 26,
    x: 30,
    y: 190,
    width: 280,
    height: 64,
    rounding: 12,
  };

  const label = recurring ? "Stop Listening" : "Start Listening";
  if (uiButton(label, btnStyle).clicked) {
    if (!speech) return;
    if (!speech.isListening()) {
      recurring = true;
      speech.listenRecurring(onHeardSentence);
    } else {
      recurring = false;
      speech.stopListening();
    }
  }
}
