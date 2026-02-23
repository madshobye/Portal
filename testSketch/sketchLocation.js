let currentPos = null;
let infoText = "Press Get Location";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/location.js");
  textSize(18);
}

function draw() {
  background(245);

  if (uiButton("Get Location", { x: 24, y: 24, width: 180, height: 42, fontSize: 18 }).clicked) {
    getLocation()
      .then((loc) => {
        currentPos = loc;
        infoText = "Location updated";
      })
      .catch((e) => {
        infoText = e?.message || "Location failed";
      });
  }

  fill(0);
  text("Location", 24, 95);
  text(infoText, 24, 125);

  if (currentPos) {
    const targetLat = 55.6761;
    const targetLon = 12.5683;
    const distanceKm = getDistanceFromLatLonInKm(
      currentPos.latitude,
      currentPos.longitude,
      targetLat,
      targetLon
    );
    const bearing = bearingToTarget(
      currentPos.latitude,
      currentPos.longitude,
      targetLat,
      targetLon
    );

    text("lat: " + nf(currentPos.latitude, 2, 6), 24, 165);
    text("lon: " + nf(currentPos.longitude, 2, 6), 24, 195);
    text("to Copenhagen (km): " + nf(distanceKm, 1, 2), 24, 225);
    text("bearing: " + nf(bearing, 1, 2), 24, 255);
  }
}
