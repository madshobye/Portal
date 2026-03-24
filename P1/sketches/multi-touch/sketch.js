let multiTouch;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();
  background(0);

  await loadScript("portal/multiTouch.js");

  multiTouch = await new MultiTouch({
    preventDefault: true,
  }).init();

  await multiTouch.start();
}

function draw() {
  background(0);

  if (multiTouch) {
    multiTouch.drawTouches({ radius: 24, showLabels: true });

    fill(255);
    textSize(18);
    text(`touches: ${multiTouch.getTouchCount()}`, 20, 30);
  }
}
