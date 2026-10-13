// Use "auto" for a mobile startup prompt and desktop fallback.
// This demo uses "always" so the startup prompt can also be tested on desktop.
window.PORTAL_ACTIVATION = "always";
let sound;
let speech;
let statusText = "Loading sound and speech…";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/speech.js");
  const results = await Promise.allSettled([
    loadSoundFile(baseURL + "assets/testsound.mp3").then(value => { sound = value; }),
    new PortalSpeech({ language: "en-GB" }).init().then(value => { speech = value; }),
  ]);
  const errors = results.filter(result => result.status === "rejected");
  statusText = errors.length ? "Some media could not load. Check the console." : "Ready. Try playback now or after a delay.";
  errors.forEach(result => console.warn(result.reason));
}

function report(promise) {
  Promise.resolve(promise).catch(error => {
    statusText = error.name === "AbortError" ? "Playback cancelled." : `Playback failed: ${error.message || error.error || error}`;
  });
}

function draw() {
  background(245);
  uiListStart({ x: 20, y: 20, width: Math.min(width - 40, 420) });
  uiText("Shared media activation", { fontSize: 22, height: 48 });
  if (uiButton("Play sound", { disabled: !sound }).clicked) report(sound.play());
  if (uiButton("Speak", { disabled: !speech }).clicked) report(speech.speak("Speech is working."));
  if (uiButton("Speak after three seconds", { disabled: !speech }).clicked) {
    statusText = "Waiting three seconds…";
    setTimeout(() => { statusText = "Delayed speech requested."; report(speech.speak("This response arrived after a delay.")); }, 3000);
  }
  if (uiButton("Stop").clicked) { sound?.stop(); speech?.stopSpeaking(); }
  uiListEnd();
  fill(30); noStroke(); textSize(15); textAlign(LEFT, TOP);
  text(statusText, 20, 290, width - 40, 110);
}
