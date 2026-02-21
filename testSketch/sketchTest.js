let myMap;
let mappa;

// Lets put all our map options in a single object
// lat and lng are the starting point for the map.
const options = {
  lat: 55.651389,
  lng: 12.135465,
  zoom: 12,
  style: "http://{s}.tile.osm.org/{z}/{x}/{y}.png",
};
let curLocation;

let canvas;
async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  
  await loadScript("https://unpkg.com/mappa-mundi@0.0.4/dist/mappa.min.js");
  await loadScript("portal/location.js");

  curLocation = await getLocation();
  options.lat = curLocation.latitude;
  options.lng = curLocation.longitude;

  // Create a tile map with the options declared
  mappa = new Mappa("Leaflet");
  myMap = await mappa.tileMap(options);
  myMap.overlay(canvas);
 
}

function draw() {
  clear();

  
  fill("red");
  var pixelLocation = myMap.latLngToPixel(
    curLocation.latitude,
    curLocation.longitude
  );

  // Using that position, draw an ellipse
  ellipse(pixelLocation.x, pixelLocation.y, 20, 20);

  var mapDistance = getDistanceFromLatLonInKm(
    curLocation.latitude,
    curLocation.longitude,
    55.375,
    10.396268
  );

  fill(0);
  textSize(20);
  text("Lat: " + curLocation.latitude, 70, 150);
  text("Long: " + curLocation.longitude, 70, 200);
  text("distance to odense km: " + Math.round(mapDistance), 70, 250);
}

