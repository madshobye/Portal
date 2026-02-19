let canvas;


async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);

  await pSetup();
 
  fill(255);
}

function draw() {
  background(0);

}

function keyPressed() {
  if (key == "f") {
    fullScreenToggle();
  }
}
