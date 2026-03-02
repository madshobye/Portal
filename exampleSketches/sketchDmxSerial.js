let dmx;
const dmxChannels = 30;
let statusText = "idle";
let outputOn = true;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/dmxSerial.js");

  dmx = await new DmxSerial({
    channels: dmxChannels,
    autoReconnect: true,
    autoReconnectOnRefresh: true,
    autoStream: true,
    frameIntervalMs: 30,
    onState: (state) => {
      statusText = state;
    },
  }).init();

  // Match legacy DMX sketch behavior:
  // channel 4 as a default master/dimmer.
  dmx.set(4, 255);
  uiSet("dmx_output_on", true);

  textSize(18);
}

function draw() {
  background(20);

  drawControls();
  drawStatus();
}

function drawControls() {
  if (
    uiButton("Connect DMX", {
      x: 20,
      y: 20,
      width: 170,
      height: 42,
      fontSize: 18,
    }).clicked
  ) {
    dmx?.connect().catch((e) => {
      statusText = e?.message || "connect failed";
    });
  }

  if (
    uiButton("Send", {
      x: 200,
      y: 20,
      width: 100,
      height: 42,
      fontSize: 18,
    }).clicked
  ) {
    dmx?.sendFrame();
  }

  outputOn = uiToggle("dmx_output_on", "Output", {
    x: 310,
    y: 20,
    width: 170,
    height: 42,
    fontSize: 16,
    onBgColor: "#a80",
    offBgColor: "#666",
  }).value;
  if (outputOn) dmx?.startOutput();
  else dmx?.stopOutput();

  for (let ch = 1; ch <= dmxChannels; ch++) {
    const col = Math.floor((ch - 1) / 10);
    const row = (ch - 1) % 10;
    const x = 20 + col * 320;
    const y = 88 + row * 44;

    const slider = uiSlider(
      "dmx_ch_" + ch,
      "Ch " + ch,
      {
        min: 0,
        max: 255,
        init: dmx?.getChannel?.(ch) || 0,
      },
      {
        x,
        y,
        width: 300,
        height: 34,
        fontSize: 15,
      }
    );

    if (dmx) dmx.setChannel(ch, slider.value);
  }
}

function drawStatus() {
  fill(255);
  textSize(18);
  text("DmxSerial", 20, height - 90);
  text("status: " + statusText, 20, height - 64);
  text("connected: " + (dmx?.connected ? "yes" : "no"), 20, height - 38);
  text("streaming: " + (outputOn ? "yes" : "no"), 20, height - 12);
}
