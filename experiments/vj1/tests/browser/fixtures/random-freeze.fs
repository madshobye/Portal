/*
{
  "CATEGORIES" : ["Glitch"],
  "DESCRIPTION" : "Causes only part of an image to update",
  "ISFVSN" : "2",
  "INPUTS" : [
    { "NAME" : "inputImage", "TYPE" : "image" },
    {
      "NAME" : "maxUpdateSize",
      "TYPE" : "float",
      "MAX" : 1,
      "DEFAULT" : 0.5,
      "LABEL" : "Size",
      "MIN" : 0
    },
    {
      "NAME" : "maxBlendAmount",
      "TYPE" : "float",
      "MAX" : 1,
      "DEFAULT" : 0,
      "MIN" : 0
    },
    {
      "NAME" : "resetImage",
      "TYPE" : "event",
      "LABEL" : "Reset Image"
    }
  ],
  "PASSES" : [
    {
      "TARGET" : "lastState",
      "PERSISTENT" : true,
      "DESCRIPTION" : ""
    }
  ],
  "CREDIT" : "VIDVOX"
}
*/

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453);
}

vec4 rand4(vec4 co) {
  vec4 returnMe = vec4(0.0);
  returnMe.r = rand(co.rg);
  returnMe.g = rand(co.gb);
  returnMe.b = rand(co.ba);
  returnMe.a = rand(co.rb);
  return returnMe;
}

bool pointInRect(vec2 pt, vec4 r) {
  return pt.x >= r.x && pt.y >= r.y &&
    pt.x <= r.x + r.z && pt.y <= r.y + r.w;
}

void main() {
  vec2 loc = isf_FragNormCoord.xy;
  bool doReset = resetImage || FRAMEINDEX == 0;
  vec4 returnMe = doReset
    ? IMG_THIS_PIXEL(inputImage)
    : IMG_THIS_PIXEL(lastState);
  vec4 seeds1 = TIME * vec4(0.2123,0.34517,0.53428,0.7431);
  vec4 randCoords = rand4(seeds1);
  randCoords.zw *= maxUpdateSize;
  if (randCoords.x + randCoords.z > 1.0)
    randCoords.z = 1.0 - randCoords.x;
  if (randCoords.y + randCoords.w > 1.0)
    randCoords.w = 1.0 - randCoords.y;
  if (pointInRect(loc, randCoords)) {
    float mixAmount = maxBlendAmount * rand(vec2(TIME,0.32234));
    vec4 newColor = IMG_THIS_PIXEL(inputImage);
    newColor.a = 1.0;
    returnMe = mix(newColor, returnMe, mixAmount);
  }
  gl_FragColor = returnMe;
}
