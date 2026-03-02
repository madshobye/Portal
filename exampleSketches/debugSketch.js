// faste funktioner
let canvas;
let cam, bodyPose;

// Inden man starter idle
let gameState = "idle"; // "idle" | "playing" | "done"
let score = 0;

// tid på spillet
let startTimeMs = 0;
const gameDurationMs = 30 * 1000; // 30 sekunder

//størrelse på målet
let target = { x: 200, y: 200, r: 35, col: null }; // cirkel du skal ramme
let hitCooldownMs = 150; // så den ikke tæller flere hits på samme frame
let lastHitMs = 0;

// highscore funktionen
let highScore = 0;
const HIGH_SCORE_KEY = "circle_hit_highscore_v1";

//Sang
let sang;

//Madses kode, så ingen kommentar til dette 
async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  await loadScript("portal/bodyPose.js");

  cam = await setupWebcamera(false, 640, 480, true);

  bodyPose = await new BodyPose({
    video: cam,
    backend: "webgl",
    videoIsFlipped: true,
    onResults: () => {},
  }).init();

  await bodyPose.start();

  textSize(22);
  fill(255);

  const saved = localStorage.getItem(HIGH_SCORE_KEY);
  highScore = saved ? Number(saved) : 0;

  function spawnTarget() {
    const margin = 80;

    target.x = random(margin, width - margin);
    target.y = random(margin, height - margin);
    target.r = random(28, 48);

    // tilfældig farve
    target.col = color(random(50, 255), random(50, 255), random(50, 255));
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  spawnTarget(); // så traget ikke ender udenfor efter resize
}

function draw() {
  background(0);

  // Webcam + pose overlay
  bodyPose.scaleTo(width, height);
  bodyPose.drawImage();

  bodyPose.drawPoses(0, 0, null, null, {
    drawSkeleton: true,
    drawKeypoints: true,
    showLabels: false,
    ptSize: 6,
    minConfidence: 0.4,
    minPoseScore: 0,
  });

  // Hent pose (en person)
  const pose = bodyPose.getPosesScaled?.()[0];

  // UI
  drawHUD();

  if (gameState === "idle") {
    // Hvad der står inden man starter spillet.
    drawCenterText
      ("Klar til at spille?\nSlå highscoren og bliv champen\nTryk på musen");
      
  }

  if (gameState === "done") {
    drawTarget(); // ligegyldigt, men ok
    drawCenterText(`Tid! Score: ${score}\nTryk på musen`);
    return;
  }

  // Playing
  const now = millis();
  const timeLeft = gameDurationMs - (now - startTimeMs);
  if (timeLeft <= 0) {
    endGame();
    return;
  }
  function endGame() {
    gameState = "done";

    if (score > highScore) {
      highScore = score;
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
    }
  }
  // Tegn target
  drawTarget();

  // Tegn hænder (cirkel på håndled) + collision
  if (pose) {
    const lw = pose.left_wrist;
    const rw = pose.right_wrist;

    if (lw) drawMaraca(pose, "left");
    if (rw) drawMaraca(pose, "right");

    const hit = checkHit(lw, rw);
    if (hit && now - lastHitMs > hitCooldownMs) {
      score++;
      lastHitMs = now;
      spawnTarget();
    }
  }
}
function keyPressed() {
  // keyCode 32 = SPACE (mere robust end key === " ")
  if (keyCode === 32) {
    if (gameState === "idle" || gameState === "done") {
      startGame();
    }
    // forhindrer at browseren scroller / gør noget andet
    return false;
  }
}

function mousePressed() {
  // Klik på canvas for at starte
  if (gameState === "idle" || gameState === "done") {
    startGame();
  }
  return false;
}

function startGame() {
  score = 0;
  startTimeMs = millis();
  lastHitMs = 0;
  spawnTarget();
  gameState = "playing";
}

function spawnTarget() {
  
  const margin = 80;

  target.x = random(margin, width - margin);
  target.y = random(margin, height - margin);
  target.r = random(28, 48);

  // tilfældig farve
  target.col = color(random(80, 255), random(80, 255), random(80, 255));
}

function drawTarget() {
  push();

  fill(target.col);
  stroke(255);
  strokeWeight(3);
  ellipse(target.x, target.y, target.r * 2);

  pop();
}

function drawHandMarker(x, y, side) {
  push();
  noStroke();
  // farver forskel
  if (side === "left") fill(0, 200, 255, 200);
  else fill(255, 200, 0, 200);

  ellipse(x, y, 24, 24);
  pop();
}

function checkHit(leftWrist, rightWrist) {
  // hit hvis en af hænderne er tæt nok på target
  const hitRadius = target.r + 12; // target radius + hånd marker

  if (leftWrist) {
    const d = dist(leftWrist.x, leftWrist.y, target.x, target.y);
    if (d <= hitRadius) return true;
  }
  if (rightWrist) {
    const d = dist(rightWrist.x, rightWrist.y, target.x, target.y);
    if (d <= hitRadius) return true;
  }
  return false;
}

function drawHUD() {
  const now = millis();
  let timeLeftSec = 30;
  if (gameState === "playing") {
    timeLeftSec = max(0, ceil((gameDurationMs - (now - startTimeMs)) / 1000));
  }

  push();
  fill(255);
  noStroke();
  //Score
  fill("blue");
  textAlign(LEFT, TOP);
  textSize(22);
  text(`Score: ${score}`, 20, 20);
  //Highscore system
  fill("red");
  text(`Highscore: ${highScore}`, 20, 48);
  //Nedtælling
  fill("green");
  textAlign(RIGHT, TOP);
  text(`Tid: ${timeLeftSec}`, width - 20, 20);
  pop();
}

function drawCenterText(msg) {
  push();
  fill(255);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(26);
  text(msg, width / 2, height / 2);
  pop();
}
// Macarene 
function drawMaraca(pose, side) {
  const wrist = side === "left" ? pose.left_wrist : pose.right_wrist;
  const elbow = side === "left" ? pose.left_elbow : pose.right_elbow;

  if (!wrist) return;

  // rotation: peger fra albue
  let ang = 0;
  if (elbow) ang = atan2(wrist.y - elbow.y, wrist.x - elbow.x);


  // farver
  const headCol = side === "left" ? color(0, 220, 255) : color(255, 170, 0);
  const stripeCol = color(255);
  
  
  push();
  translate(wrist.x, wrist.y);
  rotate(ang);


  // skala (størrelse på maraca)
  const s = 2.0;

  // håndtag
  noStroke();
  fill(90, 60, 30); 
  rectMode(CENTER);
  rect(-38 * s, 0, 50 * s, 12 * s, 6);

  // lille “grip” ring
  fill(70, 45, 20);
  rect(-20 * s, 0, 8 * s, 14 * s, 4);

  // Ellipse
  fill(headCol);
  stroke(255, 80);
  strokeWeight(2);
  ellipse(10 * s, 0, 46 * s, 38 * s);

  // striber på ellipse
  noStroke();
  fill(red(stripeCol), green(stripeCol), blue(stripeCol), 160);
  ellipse(10 * s, -8 * s, 36 * s, 10 * s);
  ellipse(10 * s, 8 * s, 36 * s, 10 * s);

  // lille highlight
  fill(255, 80);
  ellipse(2 * s, -10 * s, 10 * s, 8 * s);
  pop();
}
