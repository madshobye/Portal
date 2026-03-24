// Portal MQTT demo based on the original click-to-toggle example.

let mqttClient;
let lightIsOn = false;
let lastIncoming = "-";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textSize(30);

  await loadScript("portal/mqtt.js");

  mqttClient = await new PortalMqtt({
    broker: "wss://public:public@public.cloud.shiftr.io",
    clientId: "p5jsids",
  }).init();

  await mqttClient.subscribe("/idsesp32");
}

function draw() {
  background(lightIsOn ? color(0, 0, 255) : color(100));
  fill(255);

  text("Click to turn on led", 100, 100);
  textSize(20);
  text(`MQTT connected: ${mqttClient?.connected ? "yes" : "no"}`, 100, 150);
  text(`Last message: ${lastIncoming}`, 100, 180);

  const btn = uiButton("Toggle LED", {
    x: 100,
    y: 220,
    width: 240,
    height: 70,
    fontSize: 28,
    rounding: 10,
  });

  if (btn.clicked) {
    toggleLight();
  }

  if (mqttClient?.hasNewResult()) {
    const { result } = mqttClient.consumeNew();
    if (result) {
      lastIncoming = `${result.topic}: ${result.message}`;
      print(lastIncoming);
    }
  }
}

async function mousePressed() {
  if (mouseY < 210) {
    await toggleLight();
  }
}

async function toggleLight() {
  if (!mqttClient?.connected) return;

  lightIsOn = !lightIsOn;
  if (lightIsOn) {
    await mqttClient.publish("/idsp5js", "on");
  } else {
    await mqttClient.publish("/idsp5js", "off");
  }
}
