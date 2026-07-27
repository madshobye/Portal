/*{
  "CATEGORIES": [
    "Utility"
  ],
  "CREDIT": "by zoidberg",
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

const vec2		pointOffset = vec2(0.0, 1.0);

void main() {
	vec4		outColor;
	//	"upper" (a.k.a. "the top row")
	if (fract((gl_FragCoord.y+0.5)/2.0) == 0.0)	{
		//isf_FragColor = vec4(1,0,0,1);
		outColor = (IMG_PIXEL(inputImage, gl_FragCoord.xy) + IMG_PIXEL(inputImage, gl_FragCoord.xy - pointOffset))/2.0;
		isf_FragColor = outColor;
	}
	//	"lower" (a.k.a. "the bottom row")
	else	{
		//isf_FragColor = vec4(0,1,0,1);
		outColor = (IMG_PIXEL(inputImage, gl_FragCoord.xy) + IMG_PIXEL(inputImage, gl_FragCoord.xy + pointOffset))/2.0;
		isf_FragColor = outColor;
	}
}
