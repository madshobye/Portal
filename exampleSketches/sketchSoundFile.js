let soundFile = null;
let audioState = "Not loaded";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/SoundFile.js");
  textSize(18);
}

function draw() {
  background(245);

  if (uiButton("Load Sound", { x: 24, y: 24, width: 160, height: 42, fontSize: 18 }).clicked) {
    loadSoundFile(baseURL + "assets/testsound.mp3")
      .then((sf) => {
        soundFile = sf;
        audioState = "Loaded";
      })
      .catch((e) => {
        audioState = e?.message || "Load failed";
      });
  }

  if (uiButton("Play / Pause", { x: 200, y: 24, width: 170, height: 42, fontSize: 18 }).clicked) {
    if (soundFile) soundFile.toggle();
  }

  if (uiButton("Stop", { x: 386, y: 24, width: 100, height: 42, fontSize: 18 }).clicked) {
    if (soundFile) soundFile.stop();
  }

  fill(0);
  text("SoundFile", 24, 95);
  text("state: " + audioState, 24, 125);
  if (soundFile) {
    text("playing: " + String(soundFile.playing), 24, 155);
    text("time: " + nf(soundFile.time || 0, 1, 2), 24, 185);
  }
}
