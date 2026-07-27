/*{
  "CREDIT": "by zoidberg",
  "ISFVSN": "2",
  "DESCRIPTION": "Inverts the RGB channels of the input",
  "CATEGORIES": [
    "Color Effect",
    "Utility"
  ],
  "INPUTS": [
    {
      "NAME": "inputImage",
      "TYPE": "image"
    }
  ],
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main() {
	vec4		srcPixel = IMG_THIS_PIXEL(inputImage);
	isf_FragColor = vec4(1.0-srcPixel.r, 1.0-srcPixel.g, 1.0-srcPixel.b, srcPixel.a);
}
