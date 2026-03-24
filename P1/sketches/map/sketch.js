let portalMap;
let centerPos;
let currentPos = null;
let odenseDistanceKm = null;

async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  await loadScript("portal/map.js");
  await loadScript("portal/uiSlim2.js");
  await loadScript("portal/location.js");

  portalMap = await new PortalMap({
    lat: 55.6415,
    lng: 12.0803,
    zoom: 10,
  }).init({ canvas });

  requestLocationInBackground();
  textSize(18);
}

function draw() {
  clear();
  centerPos = portalMap?.getCenter?.() || null;

  if (currentPos) {
    portalMap.drawMarker(currentPos.latitude, currentPos.longitude, 22, "#ff2d55");
  }

  noStroke();
  fill(255, 245);
  rect(18, 18, 400, 170, 12);
  fill(0);
  text("PortalMap", 32, 44);
  text(
    `center lat: ${centerPos ? nf(centerPos.latitude, 2, 4) : "-"}`,
    32,
    76
  );
  text(
    `center lon: ${centerPos ? nf(centerPos.longitude, 2, 4) : "-"}`,
    32,
    104
  );
  text(
    `current lat: ${currentPos ? nf(currentPos.latitude, 2, 4) : "permission needed"}`,
    32,
    132
  );
  text(
    `distance to Odense: ${odenseDistanceKm != null ? Math.round(odenseDistanceKm) + " km" : "-"}`,
    32,
    160
  );
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  portalMap?.invalidateSize?.();
  setTimeout(() => portalMap?.invalidateSize?.(), 80);
}

async function requestLocationInBackground() {
  try {
    currentPos = await getLocation();

    portalMap?.setCenter?.(currentPos.latitude, currentPos.longitude);
    odenseDistanceKm = getDistanceFromLatLonInKm(
      currentPos.latitude,
      currentPos.longitude,
      55.375,
      10.396268
    );
  } catch (error) {
    currentPos = null;
  }
}
