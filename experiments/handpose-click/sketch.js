let video;
let handPose;
let mqttClient;
let isClicking = false;
let lastPublishStatus = "idle";
let lastClickPoint = null;
let gestureAnchor = null;
let anchorBrightness = 160;
let anchorHue = 120;
let currentBrightness = 160;
let currentHue = 120;
let lastSentBrightness = -1;
let lastSentHue = -1;
let lastPublishMs = 0;

const CLICK_THRESHOLD_PX = 45;
const MQTT_BROKER = "wss://public:public@public.cloud.shiftr.io";
const MQTT_TOPIC = "wled/hobye";
const MQTT_API_TOPIC = `${MQTT_TOPIC}/api`;
const BRIGHTNESS_PER_PIXEL = 0.65;
const HUE_PER_PIXEL = 0.35;
const PUBLISH_INTERVAL_MS = 90;

async function setup() {
  createCanvas(windowWidth, windowHeight);

  video = await setupWebcamera(true, 640, 480, true);
  await loadScript("portal/handPose.js");
  await loadScript("portal/mqtt.js");

  handPose = await new HandPose({
    video,
    videoIsFlipped: true,
    backend: "webgl",
  }).init();

  await handPose.start();

  mqttClient = await new PortalMqtt({
    broker: MQTT_BROKER,
    clientId: `portal_handpose_click_${Math.random().toString(16).slice(2, 8)}`,
  }).init();
}

function draw() {
  background(0);

  image(video, 0, 0, width, height);

  const hands = handPose?.getHandsInRect?.(0, 0, width, height) || [];
  let activeClickPoint = null;

  for (const hand of hands) {
    const indexTip = hand?.index_finger_tip || hand?.index_tip;
    const thumbTip = hand?.thumb_tip;
    if (!indexTip || !thumbTip) continue;

    const pinchDistance = dist(indexTip.x, indexTip.y, thumbTip.x, thumbTip.y);
    if (pinchDistance > CLICK_THRESHOLD_PX) continue;

    const clickX = (indexTip.x + thumbTip.x) * 0.5;
    const clickY = (indexTip.y + thumbTip.y) * 0.5;
    activeClickPoint = { x: clickX, y: clickY };

    noStroke();
    fill(64, 255, 120, 220);
    circle(clickX, clickY, 34);

    stroke(255, 255, 255, 180);
    strokeWeight(2);
    noFill();
    circle(clickX, clickY, 52);
  }

  handleClickToggle(activeClickPoint);
  drawHud(hands.length);
}

function drawHud(handCount) {
  noStroke();
  fill(0, 170);
  rect(18, 18, 450, 152, 14);

  fill(255);
  textSize(18);
  text("HandPose Click", 32, 48);
  textSize(14);
  text(`Hands: ${handCount}  Pinch threshold: ${CLICK_THRESHOLD_PX}px`, 32, 76);
  text(`MQTT: ${mqttClient?.connected ? "connected" : "connecting..."}`, 32, 100);
  text(`Brightness: ${currentBrightness}  Hue: ${Math.round(currentHue)}°`, 32, 124);
  text(`Topic: ${MQTT_TOPIC}`, 32, 148);
}

function handleClickToggle(activeClickPoint) {
  const nextClicking = !!activeClickPoint;

  if (nextClicking) {
    lastClickPoint = activeClickPoint;
  }

  if (nextClicking && !isClicking) {
    gestureAnchor = { ...activeClickPoint };
    anchorBrightness = currentBrightness;
    anchorHue = currentHue;
    publishWledState(true);
  }

  if (nextClicking && gestureAnchor) {
    const deltaX = activeClickPoint.x - gestureAnchor.x;
    const deltaY = activeClickPoint.y - gestureAnchor.y;

    currentBrightness = constrain(
      Math.round(anchorBrightness - deltaY * BRIGHTNESS_PER_PIXEL),
      0,
      255
    );
    currentHue = wrapHue(anchorHue + deltaX * HUE_PER_PIXEL);

    drawGestureGuide(activeClickPoint);
    publishWledState();
  }

  if (!nextClicking && isClicking) {
    gestureAnchor = null;
  }

  isClicking = nextClicking;

  if (lastPublishStatus && lastPublishStatus !== "idle") {
    noStroke();
    fill(0, 170);
    rect(18, height - 62, 420, 34, 12);
    fill(255);
    textSize(13);
    text(lastPublishStatus, 32, height - 40);
  }
}

function drawGestureGuide(activeClickPoint) {
  if (!gestureAnchor || !activeClickPoint) return;

  const preview = hueToRgb(currentHue, currentBrightness);

  stroke(255, 255, 255, 120);
  strokeWeight(2);
  line(gestureAnchor.x, gestureAnchor.y, activeClickPoint.x, activeClickPoint.y);

  noStroke();
  fill(255, 255, 255, 100);
  circle(gestureAnchor.x, gestureAnchor.y, 18);

  fill(preview.r, preview.g, preview.b, 220);
  circle(activeClickPoint.x, activeClickPoint.y, 28);
}

async function publishWledState(force = false) {
  if (!mqttClient?.connected) {
    lastPublishStatus = "MQTT not connected yet";
    return;
  }

  const now = millis();
  const hueRounded = Math.round(currentHue);
  if (
    !force &&
    now - lastPublishMs < PUBLISH_INTERVAL_MS &&
    hueRounded === lastSentHue &&
    currentBrightness === lastSentBrightness
  ) {
    return;
  }

  if (
    !force &&
    hueRounded === lastSentHue &&
    currentBrightness === lastSentBrightness
  ) {
    return;
  }

  const rgb = hueToRgb(currentHue, currentBrightness);
  const apiCommand = [
    `T=${currentBrightness > 0 ? 1 : 0}`,
    `A=${currentBrightness}`,
    `R=${rgb.r}`,
    `G=${rgb.g}`,
    `B=${rgb.b}`,
  ].join("&");

  try {
    await mqttClient.publish(MQTT_API_TOPIC, apiCommand);
    lastSentBrightness = currentBrightness;
    lastSentHue = hueRounded;
    lastPublishMs = now;
    const pointText = lastClickPoint
      ? ` @ ${Math.round(lastClickPoint.x)},${Math.round(lastClickPoint.y)}`
      : "";
    lastPublishStatus = `Published ${apiCommand} to ${MQTT_API_TOPIC}${pointText}`;
  } catch (error) {
    lastPublishStatus = `Publish failed: ${error?.message || error}`;
  }
}

function wrapHue(value) {
  const hue = value % 360;
  return hue < 0 ? hue + 360 : hue;
}

function hueToRgb(hue, brightness) {
  const h = wrapHue(hue) / 60;
  const c = constrain(brightness, 0, 255) / 255;
  const x = c * (1 - abs((h % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h >= 0 && h < 1) {
    r1 = c;
    g1 = x;
  } else if (h < 2) {
    r1 = x;
    g1 = c;
  } else if (h < 3) {
    g1 = c;
    b1 = x;
  } else if (h < 4) {
    g1 = x;
    b1 = c;
  } else if (h < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: Math.round(r1 * 255),
    g: Math.round(g1 * 255),
    b: Math.round(b1 * 255),
  };
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
