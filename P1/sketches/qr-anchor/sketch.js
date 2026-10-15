// Point the camera at the original QR containing the text qr7.
const markerText = 'qr7';
let camera;
let anchor;
let cubeLayer;
let overlay;
let lastStatus = '';
let startupError = '';
let centreTracking = new URLSearchParams(location.search).get('tracker') !== 'corners';
let lastLossState = false;
let nextStatsUpdate = 0;
let kalmanEnabled = new URLSearchParams(location.search).get('kalman') !== '0';
const sceneSize = 5; // Five QR widths across; all geometry stays in marker space.
const sceneScale = 3; // Enlarge the entire sculpture, including its height, to ~15 QR widths.
const sceneColors = ['#65e9ff', '#9c8cff', '#ff73bd', '#ffd179'];

async function setup() {
  createCanvas(windowWidth, windowHeight);
  overlay = createTrackingOverlay();
  try {
    await loadScript('portal/QrAnchor.js');
    // Camera and WebGL rendering stay here; Portal analyzes frames in a worker.
    cubeLayer = createGraphics(width, height, WEBGL);
    camera = await setupWebcamera(false, 1920, 1080, false);
    anchor = await new QrAnchor({
      video: camera,
      target: markerText,
      centreTracking,
      cameraMotion: new URLSearchParams(location.search).get("motion") !== "0",
      kalmanFilter: kalmanEnabled,
      // First acquisition must decode qr7. Afterwards, track the squares
      // and accept a clear-frame dot match of 30% or more every four seconds.
      patternMatchThreshold: 0.30,
      patternIntervalMs: 4000,
      patternConfirmMs: 3000, // Below 30%: confirm before releasing the anchor.
      rotationStabilization: new URLSearchParams(location.search).get('rotation') !== '0',
      smoothing: 1, // Kalman handles position; avoid a second observation delay.
      renderSmoothingMs: 20, // Brief interpolation between camera frames.
      markerSize: 1,
      horizontalFov: 60,
    }).init();
    anchor.start();
  } catch (error) {
    startupError = error.message || String(error);
  }
}

function draw() {
  const debug = typeof uiIsDebugOverlayVisible === 'function' && uiIsDebugOverlayVisible();
  background(20);
  anchor?.drawCamera();
  if (cubeLayer) {
    cubeLayer.clear();
    if (debug) {
      anchor?.drawCubeWebGL({ target: cubeLayer, size: 1, height: 0.6, wireframe: true });
    } else {
      anchor?.drawWebGL({ target: cubeLayer }, g => drawOrbitalGarden(g, performance.now() / 1000));
    }
    image(cubeLayer, 0, 0, width, height);
  }
  if (debug) anchor?.drawFinderMarkers();
  if (overlay) overlay.panel.hidden = !debug;
  updateTrackingOverlay(anchor?.getLatest());
}

// A faceted floating sculpture, with tilted orbits and comet-like particle trails.
// Fixed counts and time-based motion keep it smooth without growing particle lists.
function orbitPoint(index, time) {
  const band = index % 3;
  const phase = index * 2.399963 + time * (0.32 + band * 0.13);
  const radius = sceneSize * (0.28 + 0.18 * (0.5 + 0.5 * Math.sin(index * 7.13)));
  const tilt = [-0.55, 0.65, 1.05][band];
  const x = Math.cos(phase) * radius;
  const y = Math.sin(phase) * radius;
  const turn = band * Math.PI / 3 + time * 0.07;
  return [
    x * Math.cos(turn) - y * Math.cos(tilt) * Math.sin(turn),
    x * Math.sin(turn) + y * Math.cos(tilt) * Math.cos(turn),
    1.15 + y * Math.sin(tilt) * 0.48,
  ];
}

function drawCrystal(g, size) {
  // Eight independently shaded faces give this procedural model a crisp silhouette.
  g.noStroke();
  g.beginShape(TRIANGLES);
  for (let side = 0; side < 4; side++) {
    const a = side * Math.PI / 2, b = a + Math.PI / 2;
    for (const direction of [-1, 1]) {
      g.fill(sceneColors[(side + (direction > 0 ? 0 : 1)) % 4]);
      g.vertex(0, 0, direction * size * 1.6);
      g.vertex(Math.cos(a) * size, Math.sin(a) * size, 0);
      g.vertex(Math.cos(b) * size, Math.sin(b) * size, 0);
    }
  }
  g.endShape();
}

function drawOrbitalGarden(g, time) {
  // Hide the printed QR in the rendered view only; tracking still sees the camera.
  // Diameter 3 covers the square's diagonal and follows the marker's perspective.
  g.push();
  g.noStroke();g.fill(0);
  g.translate(0, 0, 0.005);
  g.ellipse(0, 0, 3, 3);
  g.pop();

  g.push();
  g.scale(sceneScale, sceneScale, sceneScale);
  // Central floating crystal and two independently tumbling rings.
  g.push();
  g.translate(0, 0, 1.15 + Math.sin(time * 1.2) * 0.12);
  g.rotateZ(time * 0.28);
  g.rotateX(Math.sin(time * 0.7) * 0.25);
  drawCrystal(g, 0.36);
  for (let ring = 0; ring < 2; ring++) {
    g.push();
    g.rotateX(Math.PI / 3 + ring * 0.8);
    g.rotateY(time * (ring ? -0.3 : 0.4));
    g.noStroke();g.fill(sceneColors[ring * 2]);
    g.torus(0.62 + ring * 0.17, 0.018, 48, 5);
    g.pop();
  }
  g.pop();

  // Twelve small satellites fly through three differently tilted orbital planes.
  for (let i = 0; i < 12; i++) {
    g.push();
    g.translate(...orbitPoint(i * 5, time));
    g.rotateZ(time * 0.8 + i);g.rotateY(time * 0.5 + i);
    drawCrystal(g, 0.055 + (i % 3) * 0.018);
    g.pop();
  }

  // Batched streaks and bright points avoid a separate sphere mesh per particle.
  g.noFill();g.strokeWeight(1.5);
  for (let band = 0; band < 3; band++) {
    g.stroke(sceneColors[band]);
    g.beginShape(LINES);
    for (let i = band; i < 90; i += 3) {
      g.vertex(...orbitPoint(i, time - 0.18));
      g.vertex(...orbitPoint(i, time));
    }
    g.endShape();
  }
  g.stroke('#efffff');g.strokeWeight(3.5);
  g.beginShape(POINTS);
  for (let i = 0; i < 90; i++) g.vertex(...orbitPoint(i, time));
  g.endShape();
  g.pop();
}

function createTrackingOverlay() {
  const panel = document.createElement('aside');
  panel.hidden = !(typeof uiIsDebugOverlayVisible === 'function' && uiIsDebugOverlayVisible());
  panel.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;max-width:520px;padding:12px 14px;border-radius:10px;background:#000c;color:white;font:13px/1.4 system-ui;z-index:30;pointer-events:none;';
  const heading = document.createElement('strong');
  heading.textContent = 'QR tracker · Debug';
  const label = document.createElement('label');
  label.style.cssText = 'display:block;pointer-events:auto;cursor:pointer;';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = centreTracking;
  toggle.onchange = () => {
    centreTracking = toggle.checked;
    anchor?.setCentreTracking(centreTracking);
  };
  label.append(toggle, ' Track black square centres');
  const kalmanLabel = document.createElement('label');
  kalmanLabel.style.cssText = label.style.cssText;
  const kalmanToggle = document.createElement('input');
  kalmanToggle.type = 'checkbox';
  kalmanToggle.checked = kalmanEnabled;
  kalmanToggle.onchange = () => {
    kalmanEnabled = kalmanToggle.checked;
    anchor?.setKalmanEnabled(kalmanEnabled);
  };
  kalmanLabel.append(kalmanToggle, ' Kalman motion prediction');
  const motion = document.createElement('div');
  const motionPermission = document.createElement('button');
  motionPermission.textContent = 'Enable gyro assistance';
  motionPermission.hidden = true;
  motionPermission.style.pointerEvents = 'auto';
  motionPermission.onclick = () => anchor?.requestMotionPermission();
  const confidence = document.createElement('div');
  confidence.style.marginTop = '8px';
  const meter = document.createElement('meter');
  meter.min = 0; meter.max = 1; meter.value = 0;
  meter.style.cssText = 'width:100%;height:10px;';
  meter.setAttribute('aria-label', 'Tracking confidence');
  const status = document.createElement('div');
  status.style.cssText = 'margin:6px 0;font-weight:600;';
  const log = document.createElement('ol');
  log.style.cssText = 'margin:0;padding:0;list-style:none;max-height:112px;overflow:auto;opacity:.8;pointer-events:auto;';
  const lastLoss = document.createElement('div');
  lastLoss.textContent = 'Last tracking loss: none';
  lastLoss.style.cssText = 'margin:6px 0;color:#ffd881;';
  panel.append(heading, label, kalmanLabel, motion, motionPermission, confidence, meter, status, lastLoss, log);
  document.body.append(panel);
  return { panel, confidence, meter, status, lastLoss, log, motion, motionPermission };
}

function updateTrackingOverlay(state) {
  if (!overlay) return;
  const d = state?.diagnostics || {};
  const live = state?.visible && !state.holding && d.mode && !state.error;
  const match = d.patternMatch;
  const confidence = live ? d.confidence || 0 : 0;
  if(performance.now()>=nextStatsUpdate) {
    nextStatsUpdate=performance.now()+250;
    const scene = d.sceneMotion;
    overlay.motion.textContent = scene ? `Scene: ${scene.mode} · ${scene.reason} · Gyro: ${d.gyroAssisted ? 'assisting search' : d.motionSensor || 'unavailable'}` : 'Scene motion: off / waiting for QR';
    overlay.motionPermission.hidden = d.motionSensor !== 'permission-needed';
    let info = `Pattern match: ${match ? Math.round(match.score * 100) + '%' : '—'} · Tracking: ${Math.round(confidence * 100)}%`;
    if (d.patternVerification === 'cached') info += ' · last check';
    if (d.patternVerification === 'suspect') info += ' · confirming identity';
    if (d.patternVerification === 'deferred') info += ' · check deferred';
    if (match?.coverage != null) info += ` · Visible data: ${Math.round(match.coverage * 100)}%`;
    if (state?.holding) info += ` · ${state.predicting ? 'Predicting' : 'Held'}: ${Math.round(state.poseAgeMs)} ms`;
    info += ` · ${d.backend === 'worker' ? 'Worker' : 'Main thread'} ${Math.round(d.processingMs || 0)} ms`;
    if(overlay.confidence.textContent!==info)overlay.confidence.textContent=info;
    overlay.meter.value = confidence;
  }
  const status = startupError || state?.statusMessage || 'Starting camera…';
  if(overlay.status.textContent!==status)overlay.status.textContent=status;
  // Only state changes enter the list. Confidence updates do not flood it.
  const lost = !!state && (state.holding || !state.visible);
  if(lost && !lastLossState) overlay.lastLoss.textContent = `Last tracking loss: ${d.centreReason || d.trackingReason || status}`;
  lastLossState = lost;
  const entry = startupError || (state?.visible && !state.holding ? status : state?.predicting ? 'Predicting briefly' : state?.holding ? 'Holding last pose' : 'Searching');
  const stateKey = `${entry}|centres=${centreTracking}|kalman=${kalmanEnabled}`;
  if (stateKey === lastStatus) return;
  const settingChanged = lastStatus && lastStatus.split('|').slice(1).join('|') !== stateKey.split('|').slice(1).join('|');
  lastStatus = stateKey;
  const line = document.createElement('li');
  line.textContent = `${new Date().toLocaleTimeString('en-GB')}  ${settingChanged ? `Settings: centres ${centreTracking ? 'on' : 'off'}, Kalman ${kalmanEnabled ? 'on' : 'off'} · ` : ''}${entry}`;
  overlay.log.prepend(line);
  while (overlay.log.children.length > 7) overlay.log.lastElementChild.remove();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  cubeLayer?.resizeCanvas(width, height);
}

window.addEventListener('pagehide', () => {
  anchor?.dispose();
  cubeLayer?.remove();
  overlay?.panel.remove();
});
