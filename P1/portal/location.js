/*

OBS look at this sketch for compass stuff
https://editor.p5js.org/hobye/sketches/bQ4Pyg6Zw

live udpate postion
if (navigator.geolocation) {
    const options = {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0,
    };
    navigator.geolocation.watchPosition(updatePosition, null, {
      enableHighAccuracy: true,
    });
  }
*/

// Convert geolocation API to Promise
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by your browser"));
    } else {
      // Request GPS data
  
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;
          resolve({ latitude, longitude });
        },
        (error) => {
          reject(new Error("Unable to retrieve your location"));
        }
      );
    }
  });
}

// Haversine distance calculation
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of Earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}


// Function to calculate the bearing between two GPS coordinates
function bearingToTarget(lat1, lon1, lat2, lon2) {
  let dLon = radians(lon2 - lon1);
  let y = sin(dLon) * cos(radians(lat2));
  let x =
    cos(radians(lat1)) * sin(radians(lat2)) -
    sin(radians(lat1)) * cos(radians(lat2)) * cos(dLon);
  let bearing = degrees(atan2(y, x));
  return (bearing + 360) % 360; // Normalize to 0-360 degrees
}

// Function to get arrow direction adjusted by device rotation
function getArrowDirection(
  targetLat,
  targetLon,
  currentLat,
  currentLon,
  deviceRotation = 0
) {
  let bearing = bearingToTarget(currentLat, currentLon, targetLat, targetLon);
  let adjustedBearing = deviceRotation - bearing;
  return (adjustedBearing + 360) % 360; // Normalize to 0-360 degrees
}

// Function to draw an arrow pointing in a specific direction
function drawArrow(compassDir,targetDir,targetDist) {
  push();
  translate(width / 2, height / 2);
  noStroke();
  strokeWeight(5);
  stroke(200);
  ellipse(0,0,targetDist);
  pop();
  push();
  rotate(radians(targetDir));
  translate(0,-distance*1000);
  fill("pink");
  noStroke();
    ellipse(0,0,20);
  pop();
  
  push();
  rotate(radians(compassDir)); // Rotate by the calculated direction
  stroke(0);
  fill(255, 0, 0);
  strokeWeight(2);

  // Draw a simple arrow
  beginShape();
  vertex(-10, 20);
  vertex(0, -20);
  vertex(10, 20);
  endShape(CLOSE);

  pop();
  
}

// will handle first time visiting to grant access
function onAskButtonClicked() {
  DeviceOrientationEvent.requestPermission()
    .then((response) => {
      if (response === "granted") {
        permissionGranted = true;
      } else {
        permissionGranted = false;
      }
      this.remove();
    })
    .catch(console.error);
}

