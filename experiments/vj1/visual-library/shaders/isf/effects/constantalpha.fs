/*{
  "CATEGORIES": [
    "Utility"
  ],
  "CREDIT": "VIDVOX",
  "DESCRIPTION": "Sets the alpha to a constant value",
  "INPUTS": [
    {
      "NAME": "inputImage",
      "TYPE": "image"
    },
    {
      "NAME": "alpha",
      "TYPE": "float"
    }
  ],
  "ISFVSN": "2",
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main()	{
	vec4		inputPixelColor = IMG_THIS_PIXEL(inputImage);
	inputPixelColor.a = alpha;
	isf_FragColor = inputPixelColor;
}
