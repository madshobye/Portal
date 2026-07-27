/*{
  "CREDIT": "by VIDVOX",
  "ISFVSN": "2",
  "CATEGORIES": [
    "Geometry Adjustment"
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
	vec2		normSrcCoord;

	normSrcCoord.x = isf_FragNormCoord[0];
	normSrcCoord.y = isf_FragNormCoord[1];

	normSrcCoord.x = (1.0-normSrcCoord.x);

	isf_FragColor = IMG_NORM_PIXEL(inputImage, normSrcCoord);
}
