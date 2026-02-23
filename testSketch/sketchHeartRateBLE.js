let heartRate;
let bpm = 0;
let rr = [];
let statusText = "idle";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/heartRateBLE.js");

  heartRate = await new HeartRateBLE({
    autoReconnect: true,
    autoReconnectOnRefresh: true,
    onState: (s) => {
      statusText = s;
    },
  }).init();

  textSize(20);
}

function draw() {
  background(245);

  if (uiButton("Connect Pulse", { x: 24, y: 24, width: 220, height: 44, fontSize: 18 }).clicked) {
    heartRate.connect().catch((e) => {
      statusText = e?.message || "connect failed";
    });
  }

  if (heartRate?.hasNewResult()) {
    const { result } = heartRate.consumeNew();
    bpm = result?.heartRate || 0;
    rr = result?.rrIntervals || [];
  }

  fill(0);
  text("HeartRateBLE", 24, 110);
  text("status: " + statusText, 24, 145);
  text("bpm: " + bpm, 24, 180);
  text("rr count: " + rr.length, 24, 215);
}
