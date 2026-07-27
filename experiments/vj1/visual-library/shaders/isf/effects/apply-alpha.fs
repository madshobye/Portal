/*{
  "CATEGORIES": [
    "Color Adjustment",
    "Masking",
    "Utility"
  ],
  "CREDIT": "by VIDVOX",
  "INPUTS": [
    {
      "NAME": "inputImage",
      "TYPE": "image"
    }
  ],
  "ISFVSN": "2",
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main() {
	vec4		srcPixel = IMG_THIS_PIXEL(inputImage);
	srcPixel.rgb = srcPixel.rgb * srcPixel.a;
	srcPixel.a = 1.0;
	isf_FragColor = srcPixel;
}
