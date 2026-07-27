/*{
  "CREDIT": "by zoidberg",
  "ISFVSN": "2",
  "CATEGORIES": [
    "Color Adjustment"
  ],
  "INPUTS": [
    {
      "NAME": "inputImage",
      "TYPE": "image"
    },
    {
      "NAME": "bright",
      "TYPE": "float",
      "MIN": -1,
      "MAX": 1,
      "DEFAULT": 0
    }
  ],
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main() {
	isf_FragColor = clamp(IMG_THIS_PIXEL(inputImage) + vec4(bright,bright,bright,0.0), 0.0, 1.0);
}
