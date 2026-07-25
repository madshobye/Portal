/*{
  "ISFVSN": "2.0",
  "LABEL": "Invert",
  "DESCRIPTION": "Inverts straight RGB while preserving alpha.",
  "CATEGORIES": ["Color"],
  "INPUTS": [
    { "NAME": "inputImage", "LABEL": "Input Image", "TYPE": "image" },
    { "NAME": "amount", "LABEL": "Amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 }
  ],
  "VJ1": {
    "ID": "invert",
    "VERSION": "0.1.0",
    "LOWERING": "local-effect",
    "TAGS": ["invert", "color"],
    "ALPHA": "straight",
    "ROI": "local"
  }
}*/

void main() {
  vec4 color = IMG_THIS_NORM_PIXEL(inputImage);
  gl_FragColor = vec4(mix(color.rgb, 1.0 - color.rgb, amount), color.a);
}
