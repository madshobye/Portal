async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/map.js");
  textSize(18);
}

function draw() {
  background(245);
  fill(0);
  text("Map module", 24, 40);
  text("map.js currently exposes only base globals.", 24, 72);
  text("myMap: " + String(typeof myMap !== "undefined" ? myMap : null), 24, 104);
  text("latitude: " + String(typeof latitude !== "undefined" ? latitude : "n/a"), 24, 136);
  text("longitude: " + String(typeof longitude !== "undefined" ? longitude : "n/a"), 24, 168);
}
