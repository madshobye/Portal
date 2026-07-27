/*{
  "CATEGORIES": ["Feedback", "Glitch"],
  "CREDIT": "VIDVOX",
  "DESCRIPTION": "Feedback motion blur based on pixel brightness",
  "VJ1": { "PROFILE": "vj1-isf-webgl2@1" },
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    {
      "DEFAULT": 0.5,
      "MAX": 1,
      "MIN": 0,
      "NAME": "absorptionRate",
      "TYPE": "float"
    },
    {
      "DEFAULT": 0.02,
      "MAX": 1,
      "MIN": 0,
      "NAME": "dischargeRate",
      "TYPE": "float"
    }
  ],
  "ISFVSN": "2",
  "PASSES": [
    {
      "FLOAT": true,
      "PERSISTENT": true,
      "TARGET": "feedbackBuffer"
    }
  ]
}*/

const vec4 kRGBToYPrime = vec4(0.299, 0.587, 0.114, 0.0);
const vec4 kRGBToI = vec4(0.596, -0.275, -0.321, 0.0);
const vec4 kRGBToQ = vec4(0.212, -0.523, 0.311, 0.0);

vec3 rgb2yiq(vec3 c) {
  float yPrime = dot(c, kRGBToYPrime.rgb);
  float i = dot(c, kRGBToI.rgb);
  float q = dot(c, kRGBToQ.rgb);
  return vec3(yPrime, i, q);
}

void main() {
  vec4 freshPixel = IMG_PIXEL(inputImage, gl_FragCoord.xy);
  vec4 stalePixel = IMG_PIXEL(feedbackBuffer, gl_FragCoord.xy);
  float realGamma = absorptionRate <= 0.5
    ? absorptionRate * 2.0
    : ((absorptionRate - 0.5) * 2.0 * 4.0) + 1.0;
  vec4 tmpColorA = stalePixel;
  vec4 tmpColorB;
  tmpColorB.rgb = pow(tmpColorA.rgb, vec3(1.0 / realGamma));
  tmpColorB.a = tmpColorA.a;
  float feedbackLevel = rgb2yiq(tmpColorB.rgb).r;
  if (rgb2yiq(freshPixel.rgb).r > feedbackLevel)
    feedbackLevel = 0.0;
  else
    feedbackLevel *= 1.0 - dischargeRate;
  isf_FragColor = mix(freshPixel, stalePixel, feedbackLevel);
}
