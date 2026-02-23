let canvas;
let cam, emotions;

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);

  await loadScript("portal/emotions.js");

  cam = await setupWebcamera(false, 640, 480, false);

  emotions = await new Emotions({
    video: cam,
    videoIsFlipped: false,
    onResults: ({ positions, emotions }) => {
      // console.log(positions, emotions);
    },
  }).init();

  await emotions.start();

  textSize(20);
  fill(255);
}

function draw() {
  background(200);

  emotions.scaleTo(width, height);
  emotions.drawImage();

  emotions?.drawPoints(0, 0, null, null, {
    pointSize: 2,
    color: [255, 255, 255],
    maxPoints: null,
  });

  emotions?.drawEmotionBars(20, height - 80, {
    barWidth: 30,
    barHeight: 100,
    spacing: 110,
    textSizePx: 20,
    textColor: [255, 255, 255],
  });

  // Example tracking point: CLM landmark 62 is near nose tip.
  if (emotions?.landmarkexists(62)) {
    const nose = emotions.getlandmark(62);
    const surprised = emotions.getEmotion("surprised");
    if((surprised?.value ?? 0) > 0.5) 
    {
      fill("red");
      ellipse(nose.x, nose.y, 20, 20);
    }
   
    
  }
}
