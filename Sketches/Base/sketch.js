let canvas;
let cam, handPose;



async function setup() {

  canvas = createCanvas(windowWidth, windowHeight);

  await pSetup();
  textSize(20);
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
