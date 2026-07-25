/*{
  "ISFVSN": "2.0",
  "LABEL": "Gray",
  "DESCRIPTION": "Blends straight RGB toward luminance while preserving alpha.",
  "CATEGORIES": ["Filter"],
  "INPUTS": [
    { "NAME": "inputImage", "LABEL": "Input Image", "TYPE": "image" },
    { "NAME": "amount", "LABEL": "Amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 }
  ],
  "VJ1": {
    "ID": "gray",
    "VERSION": "0.1.0",
    "LOWERING": "local-effect",
    "TAGS": ["gray", "grayscale", "filter"],
    "ALPHA": "straight",
    "ROI": "local"
  }
}*/

void main() {
  vec4 color = IMG_THIS_NORM_PIXEL(inputImage);
  float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(color.rgb, vec3(luminance), amount), color.a);
}
