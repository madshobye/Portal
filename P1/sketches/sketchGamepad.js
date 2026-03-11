let padStatus = "No controller";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/gamepad.js");
  await setupGamepad();
  textSize(18);
}

function draw() {
  background(250);
  fill(0);

  const pad = gamePads?.[0];
  if (pad) {
    padStatus = "Controller connected";
  }

  text("Gamepad", 24, 40);
  text(padStatus, 24, 70);

  if (pad) {
    const state = pad.state || {};
    let y = 110;
    for (const k of Object.keys(state).slice(0, 20)) {
      text(k + ": " + nf(Number(state[k] || 0), 1, 3), 24, y);
      y += 22;
    }
  } else {
    text("Press a button on your gamepad.", 24, 110);
  }
}
