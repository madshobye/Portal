let qr;
let qrText = "https://learn.hobye.dk/portal";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/qrCodeGen.js");
  textSize(18);
  qr = createQRCode(qrText);
}

function draw() {
  background(255);

  if (uiButton("Set QR Text", { x: 24, y: 24, width: 160, height: 42, fontSize: 18 }).clicked) {
    const next = prompt("QR text", qrText);
    if (next != null && next !== "") {
      qrText = next;
      qr = createQRCode(qrText);
    }
  }

  fill(0);
  text("qrCodeGen", 24, 95);
  text(qrText, 24, 125);
  drawQRCode(qr, width / 2 - 140, height / 2 - 140, 280);
}
