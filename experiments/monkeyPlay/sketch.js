let video;
let handPose;
let activeClickPoint = null;
let isClicking = false;
let gestureAnchor = null;
let wledSocket = null;
let wledOn = false;
let wledStatus = "connecting";
let reconnectTimer = null;
let currentBrightness = 160;
let currentHue = 120;
let targetBrightness = 160;
let targetHue = 120;
let anchorBrightness = 160;
let anchorHue = 120;
let lastSentBrightness = -1;
let lastSentHue = -1;
let lastPublishMs = 0;
let lastSentStateKey = "";
let sendAwaitingEcho = false;
let trackedHands = [];
let wledUpdatePending = false;
let wledForcePending = false;
let smoothedClickPoint = null;
let lastDebugLogMs = 0;

const CLICK_THRESHOLD_PX = 45;
const WLED_WS_URL = "ws://192.168.3.78/ws";
const WLED_RECONNECT_DELAY_MS = 2000;
const BRIGHTNESS_PER_HAND_UNIT = 110;
const HUE_PER_HAND_UNIT = 110;
const MAX_GESTURE_OFFSET = 1;
const PUBLISH_INTERVAL_MS = 240;
const POINT_SMOOTHING = 0.18;
const DEBUG_LOG_INTERVAL_MS = 120;
const MIN_BRIGHTNESS_SEND_DELTA = 10;
const MIN_HUE_SEND_DELTA = 8;
const VALUE_SMOOTHING = 0.16;
const MIN_ACTIVE_BRIGHTNESS = 24;

async function setup() {
  createCanvas(windowWidth, windowHeight);

  video = await setupWebcamera(true, 1280, 720, true);
  await loadScript("portal/handPose.js");

  handPose = await new HandPose({
    video,
    videoIsFlipped: true,
    backend: "webgl",
  }).init();

  await handPose.start();
  handPose.scaleTo(width, height);
  connectWled();
}

function draw() {
  background(0);

  if (handPose) {
    handPose.scaleTo(width, height);
    handPose.drawImage();
  }

  activeClickPoint = getSmoothedClickPoint(findClickPoint());
  drawHandTracking();

  if (activeClickPoint) {
    drawClickTracker(activeClickPoint);
  }

  handleClickToggle(activeClickPoint);
  updateControlValues();
  flushWledState();
}

function findClickPoint() {
  const hands = handPose?.getHandsScaled?.() || [];
  trackedHands = hands;

  for (const hand of hands) {
    const indexTip = hand?.index_finger_tip || hand?.index_tip;
    const thumbTip = hand?.thumb_tip;
    const handSize = getHandSize(hand);
    if (!indexTip || !thumbTip) {
      continue;
    }

    const pinchDistance = dist(indexTip.x, indexTip.y, thumbTip.x, thumbTip.y);
    if (pinchDistance > CLICK_THRESHOLD_PX) {
      continue;
    }

    return {
      x: (indexTip.x + thumbTip.x) * 0.5,
      y: (indexTip.y + thumbTip.y) * 0.5,
      handSize,
    };
  }

  return null;
}

function getSmoothedClickPoint(rawPoint) {
  if (!rawPoint) {
    smoothedClickPoint = null;
    return null;
  }

  if (!smoothedClickPoint) {
    smoothedClickPoint = { ...rawPoint };
    return smoothedClickPoint;
  }

  smoothedClickPoint.x = lerp(smoothedClickPoint.x, rawPoint.x, POINT_SMOOTHING);
  smoothedClickPoint.y = lerp(smoothedClickPoint.y, rawPoint.y, POINT_SMOOTHING);
  smoothedClickPoint.handSize = lerp(smoothedClickPoint.handSize, rawPoint.handSize, POINT_SMOOTHING);
  return smoothedClickPoint;
}

function drawClickEllipse(point) {
  return drawClickTracker(point);
}

function drawHandTracking() {
  if (!trackedHands.length) {
    return;
  }

  const trackingColor = hueToRgb(currentHue, 255);
  const glowAlpha = map(currentBrightness, 0, 255, 40, 210);
  const coreAlpha = map(currentBrightness, 0, 255, 90, 255);

  const chains = [
    ["wrist", "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip"],
    ["wrist", "index_finger_mcp", "index_finger_pip", "index_finger_dip", "index_finger_tip"],
    ["wrist", "middle_finger_mcp", "middle_finger_pip", "middle_finger_dip", "middle_finger_tip"],
    ["wrist", "ring_finger_mcp", "ring_finger_pip", "ring_finger_dip", "ring_finger_tip"],
    ["wrist", "pinky_finger_mcp", "pinky_finger_pip", "pinky_finger_dip", "pinky_finger_tip"],
  ];

  push();
  for (const hand of trackedHands) {
    stroke(trackingColor.r, trackingColor.g, trackingColor.b, glowAlpha);
    strokeWeight(2);
    noFill();

    for (const chain of chains) {
      beginShape();
      for (const key of chain) {
        const point = hand?.[key];
        if (!point) {
          continue;
        }
        vertex(point.x, point.y);
      }
      endShape();
    }

    noStroke();
    for (const point of getTrackedPoints(hand)) {
      fill(trackingColor.r, trackingColor.g, trackingColor.b, glowAlpha * 0.22);
      ellipse(point.x, point.y, 18, 18);
      fill(255, 255, 255, coreAlpha * 0.6);
      ellipse(point.x, point.y, 4 + map(currentBrightness, 0, 255, 1, 4), 4 + map(currentBrightness, 0, 255, 1, 4));
    }
  }
  pop();
}

function drawClickTracker(point) {
  const pulse = 0.5 + 0.5 * sin(frameCount * 0.12);
  const spin = frameCount * 0.06;
  const trackingColor = hueToRgb(currentHue, 255);
  const glowAlpha = map(currentBrightness, 0, 255, 70, 255);
  const coreSize = map(currentBrightness, 0, 255, 6, 18);

  push();
  translate(point.x, point.y);

  noFill();
  strokeWeight(2);

  stroke(trackingColor.r, trackingColor.g, trackingColor.b, glowAlpha);
  ellipse(0, 0, 34 + pulse * 18, 34 + pulse * 18);

  stroke(trackingColor.r, trackingColor.g, trackingColor.b, glowAlpha * 0.55);
  ellipse(0, 0, 58 + pulse * 26, 58 + pulse * 26);

  stroke(255, 255, 255, 140);
  ellipse(0, 0, 82 + pulse * 12, 82 + pulse * 12);

  rotate(spin);
  stroke(trackingColor.r, trackingColor.g, trackingColor.b, glowAlpha * 0.85);
  line(-22, 0, -8, 0);
  line(8, 0, 22, 0);
  line(0, -22, 0, -8);
  line(0, 8, 0, 22);

  rotate(-spin * 2);
  stroke(255, 255, 255, 110);
  line(-34, -34, -24, -24);
  line(34, -34, 24, -24);
  line(-34, 34, -24, 24);
  line(34, 34, 24, 24);

  noStroke();
  fill(trackingColor.r, trackingColor.g, trackingColor.b, glowAlpha * 0.9);
  ellipse(0, 0, coreSize + pulse * 4, coreSize + pulse * 4);
  fill(255, 255, 255, glowAlpha * 0.5);
  ellipse(0, 0, coreSize * 0.35, coreSize * 0.35);
  pop();
}

function handleClickToggle(point) {
  const nextClicking = !!point;

  if (nextClicking && !isClicking) {
    gestureAnchor = { ...point };
    anchorBrightness = targetBrightness;
    anchorHue = targetHue;
    if (!wledOn) {
      wledOn = true;
    }
    queueWledState(true);
  }

  if (nextClicking && gestureAnchor) {
    const referenceHandSize = max(gestureAnchor.handSize || 1, 1);
    const rawDeltaX = (point.x - gestureAnchor.x) / referenceHandSize;
    const rawDeltaY = (point.y - gestureAnchor.y) / referenceHandSize;
    const deltaX = constrain(rawDeltaX, -MAX_GESTURE_OFFSET, MAX_GESTURE_OFFSET);
    const deltaY = constrain(rawDeltaY, -MAX_GESTURE_OFFSET, MAX_GESTURE_OFFSET);

    targetBrightness = constrain(
      Math.round(anchorBrightness - deltaY * BRIGHTNESS_PER_HAND_UNIT),
      MIN_ACTIVE_BRIGHTNESS,
      255
    );
    targetHue = wrapHue(anchorHue + deltaX * HUE_PER_HAND_UNIT);

    if (rawDeltaX !== deltaX || rawDeltaY !== deltaY) {
      shiftGestureAnchor(point, referenceHandSize, rawDeltaX - deltaX, rawDeltaY - deltaY);
    }

    queueWledState();
  }

  if (!nextClicking && isClicking) {
    gestureAnchor = null;
  }

  isClicking = nextClicking;
}

function queueWledState(force = false) {
  wledUpdatePending = true;
  wledForcePending = wledForcePending || force;
}

function updateControlValues() {
  currentBrightness = lerp(currentBrightness, targetBrightness, VALUE_SMOOTHING);
  currentHue = lerpHue(currentHue, targetHue, VALUE_SMOOTHING);
}

function flushWledState() {
  if (!wledUpdatePending && !wledForcePending) {
    return;
  }

  if (!wledSocket || wledSocket.readyState !== WebSocket.OPEN) {
    wledStatus = "socket unavailable";
    return;
  }

  const force = wledForcePending;
  const now = millis();
  const roundedBrightness = Math.round(currentBrightness);
  const hueRounded = Math.round(currentHue);
  const brightnessDelta = Math.abs(roundedBrightness - lastSentBrightness);
  const hueDelta = getCircularHueDistance(hueRounded, lastSentHue);
  if (
    !force &&
    (
      sendAwaitingEcho ||
      now - lastPublishMs < PUBLISH_INTERVAL_MS ||
      (
        lastSentBrightness >= 0 &&
        brightnessDelta < MIN_BRIGHTNESS_SEND_DELTA &&
        hueDelta < MIN_HUE_SEND_DELTA
      )
    )
  ) {
    return;
  }

  const rgb = hueToRgb(currentHue, 255);
  const nextColor = [rgb.r, rgb.g, rgb.b];
  const nextStateKey = JSON.stringify({
    on: true,
    bri: roundedBrightness,
    color: nextColor,
  });
  if (
    !force &&
    lastSentStateKey === nextStateKey
  ) {
    wledUpdatePending = false;
    wledForcePending = false;
    return;
  }

  const payload = {
    on: true,
    bri: roundedBrightness,
    tt: 0,
    seg: [{
      id: 0,
      col: [
        nextColor,
        [0, 0, 0],
        [0, 0, 0],
      ],
    }],
  };
  wledSocket.send(JSON.stringify(payload));
  logWledSend(payload);

  lastSentBrightness = roundedBrightness;
  lastSentHue = hueRounded;
  lastSentStateKey = nextStateKey;
  lastPublishMs = now;
  sendAwaitingEcho = true;
  wledUpdatePending = false;
  wledForcePending = false;
  wledStatus = `bri ${roundedBrightness} hue ${hueRounded}`;
}

function connectWled() {
  clearTimeout(reconnectTimer);

  if (wledSocket && (wledSocket.readyState === WebSocket.OPEN || wledSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  wledStatus = "connecting";
  wledSocket = new WebSocket(WLED_WS_URL);

  wledSocket.addEventListener("open", () => {
    console.log("[monkeyPlay] WLED socket open", WLED_WS_URL);
    wledStatus = "connected";
    wledSocket.send(JSON.stringify({ v: true }));
  });

  wledSocket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      logWledReceive(payload);
      if (typeof payload?.state?.on === "boolean") {
        wledOn = payload.state.on;
      }
      if (typeof payload?.state?.bri === "number") {
        currentBrightness = payload.state.bri;
        targetBrightness = payload.state.bri;
      }
      sendAwaitingEcho = false;
      wledStatus = wledOn ? "on" : "off";
    } catch {
      wledStatus = "connected";
    }
  });

  wledSocket.addEventListener("close", () => {
    console.log("[monkeyPlay] WLED socket close");
    sendAwaitingEcho = false;
    wledStatus = "disconnected";
    scheduleReconnect();
  });

  wledSocket.addEventListener("error", (event) => {
    console.log("[monkeyPlay] WLED socket error", event);
    sendAwaitingEcho = false;
    wledStatus = "socket error";
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectWled();
  }, WLED_RECONNECT_DELAY_MS);
}

function shiftGestureAnchor(point, referenceHandSize, overflowX, overflowY) {
  gestureAnchor.x = point.x - (overflowX * referenceHandSize);
  gestureAnchor.y = point.y - (overflowY * referenceHandSize);
  gestureAnchor.handSize = referenceHandSize;
  anchorBrightness = targetBrightness;
  anchorHue = targetHue;
}

function getHandSize(hand) {
  const indexBase = hand?.index_finger_mcp;
  const pinkyBase = hand?.pinky_finger_mcp;
  const wrist = hand?.wrist;

  if (indexBase && pinkyBase) {
    return dist(indexBase.x, indexBase.y, pinkyBase.x, pinkyBase.y);
  }

  if (wrist && indexBase) {
    return dist(wrist.x, wrist.y, indexBase.x, indexBase.y) * 1.6;
  }

  return 120;
}

function getTrackedPoints(hand) {
  return [
    hand?.wrist,
    hand?.thumb_tip,
    hand?.index_finger_tip,
    hand?.middle_finger_tip,
    hand?.ring_finger_tip,
    hand?.pinky_finger_tip,
    hand?.index_finger_mcp,
    hand?.middle_finger_mcp,
    hand?.ring_finger_mcp,
    hand?.pinky_finger_mcp,
  ].filter(Boolean);
}

function logWledSend(payload) {
  const now = millis();
  if (now - lastDebugLogMs < DEBUG_LOG_INTERVAL_MS) {
    return;
  }

  lastDebugLogMs = now;
  console.log("[monkeyPlay] send", {
    on: payload.on,
    bri: payload.bri,
    color: payload.seg?.[0]?.col?.[0]?.join(","),
    bufferedAmount: wledSocket?.bufferedAmount || 0,
  });
}

function logWledReceive(payload) {
  if (!payload?.state) {
    return;
  }

  console.log("[monkeyPlay] recv", {
    on: payload.state.on,
    bri: payload.state.bri,
    seg: payload.state.seg?.[0]?.col?.[0]?.join(","),
  });
}

function wrapHue(value) {
  const hue = value % 360;
  return hue < 0 ? hue + 360 : hue;
}

function getCircularHueDistance(a, b) {
  if (b < 0) {
    return Infinity;
  }

  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

function lerpHue(current, target, amount) {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return wrapHue(current + delta * amount);
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
  handPose?.scaleTo?.(windowWidth, windowHeight);
}
