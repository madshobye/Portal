const CHAIN_COUNT = 20;
const POINTS_PER_CHAIN = 10;
const BRUSH_RADIUS = 28;
const chains = [];
let hasStarted = false;
let prevMouseX = 0;
let prevMouseY = 0;

function setup() {
  createCanvas(windowWidth, windowHeight);
  background(244, 240, 232);

  for (let c = 0; c < CHAIN_COUNT; c++) {
    const angle = c * 2.399963229728653;
    const radius = sqrt((c + 0.5) / CHAIN_COUNT) * BRUSH_RADIUS;
    const offsetX = cos(angle) * radius;
    const offsetY = sin(angle) * radius;
    const chain = Array.from({ length: POINTS_PER_CHAIN }, () => ({
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      offsetX,
      offsetY,
    }));
    chains.push(chain);
  }
}

function draw() {
  const moved = mouseX !== prevMouseX || mouseY !== prevMouseY;
  if (!hasStarted && moved) {
    hasStarted = true;
    prevMouseX = mouseX;
    prevMouseY = mouseY;
    for (const chain of chains) {
      for (const p of chain) {
        p.x = mouseX + p.offsetX;
        p.y = mouseY + p.offsetY;
        p.px = p.x;
        p.py = p.y;
      }
    }
  }

  if (!hasStarted) return;

  const mouseDistance = dist(prevMouseX, prevMouseY, mouseX, mouseY);
  const mouseSteps = max(1, floor(mouseDistance / 4));

  for (let step = 1; step <= mouseSteps; step++) {
    const t = step / mouseSteps;
    const mx = lerp(prevMouseX, mouseX, t);
    const my = lerp(prevMouseY, mouseY, t);
    const speedScale = map(constrain(mouseDistance, 0, 120), 0, 120, 1, 0.08);

    noStroke();
    fill(0, 8);

    for (let c = 0; c < chains.length; c++) {
      const chain = chains[c];
      chain[0].x = mx + chain[0].offsetX * speedScale;
      chain[0].y = my + chain[0].offsetY * speedScale;

      for (let i = 1; i < chain.length; i++) {
        chain[i].x = lerp(chain[i].x, chain[i - 1].x, 0.32);
        chain[i].y = lerp(chain[i].y, chain[i - 1].y, 0.32);
      }

      for (let i = 0; i < chain.length; i++) {
        const p = chain[i];
        const pointDistance = dist(p.px, p.py, p.x, p.y);
        const pointSteps = max(1, floor(pointDistance / 3));
        const size = map(constrain(pointDistance, 0, 40), 0, 40, 2, 8);

        for (let j = 1; j <= pointSteps; j++) {
          const tj = j / pointSteps;
          const x = lerp(p.px, p.x, tj);
          const y = lerp(p.py, p.y, tj);
          circle(x, y, size);
        }

        p.px = p.x;
        p.py = p.y;
      }
    }
  }

  prevMouseX = mouseX;
  prevMouseY = mouseY;
}
