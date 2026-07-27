/*{
  "CREDIT": "by carter rosenberg",
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
      "NAME": "inputEV",
      "TYPE": "float",
      "MIN": -10,
      "MAX": 10,
      "DEFAULT": 0.5
    }
  ],
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main() {
	//	based on
	//	https://developer.apple.com/library/mac/documentation/graphicsimaging/reference/CoreImageFilterReference/Reference/reference.html#//apple_ref/doc/filter/ci/CIExposureAdjust
	vec4		tmpColorA = IMG_THIS_PIXEL(inputImage);
	tmpColorA.rgb = tmpColorA.rgb * pow(2.0, inputEV);
	isf_FragColor = tmpColorA;
}
