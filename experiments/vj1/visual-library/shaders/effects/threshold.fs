/*{
  "ISFVSN": "2.0",
  "LABEL": "Threshold",
  "DESCRIPTION": "Blends straight RGB toward a luminance threshold while preserving alpha.",
  "CATEGORIES": ["Filter"],
  "INPUTS": [
    { "NAME": "inputImage", "LABEL": "Input Image", "TYPE": "image" },
    { "NAME": "amount", "LABEL": "Amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.65 },
    { "NAME": "cutoff", "LABEL": "Cutoff", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 }
  ],
  "VJ1": {
    "ID": "threshold",
    "VERSION": "0.1.0",
    "LOWERING": "local-effect",
    "TAGS": ["threshold", "luminance", "filter"],
    "ALPHA": "straight",
    "ROI": "local"
  }
}*/

void main() {
  vec4 color = IMG_THIS_NORM_PIXEL(inputImage);
  float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  float quantizedCutoff = floor(cutoff * 255.0) / 255.0;
  float ink = step(quantizedCutoff, luminance);
  gl_FragColor = vec4(mix(color.rgb, vec3(ink), amount), color.a);
}
