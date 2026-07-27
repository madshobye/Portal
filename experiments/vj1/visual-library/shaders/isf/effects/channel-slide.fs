/*{
  "CREDIT": "by zoidberg",
  "ISFVSN": "2",
  "CATEGORIES": [
    "Color Effect"
  ],
  "INPUTS": [
    {
      "NAME": "inputImage",
      "TYPE": "image"
    },
    {
      "NAME": "slideAmt",
      "LABEL": "slide amount",
      "TYPE": "color",
      "DEFAULT": [
        0,
        0,
        0,
        0
      ]
    },
    {
      "NAME": "reflection",
      "TYPE": "bool",
      "DEFAULT": 0
    }
  ],
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main() {
	vec4		srcPixel = IMG_THIS_PIXEL(inputImage);
	if (reflection == true)	{
		vec4		outPixel;
		outPixel.rgb = srcPixel.rgb - slideAmt.rgb;
		outPixel.a = srcPixel.a + slideAmt.a;	//	alpha behaves the same in both modes (just easier to work with)
		isf_FragColor.x = (outPixel.x<0.0) ? outPixel.x+1.0 : outPixel.x;
		isf_FragColor.y = (outPixel.y<0.0) ? outPixel.y+1.0 : outPixel.y;
		isf_FragColor.z = (outPixel.z<0.0) ? outPixel.z+1.0 : outPixel.z;
		//isf_FragColor.a = (outPixel.a<0.0) ? outPixel.a+1.0 : outPixel.a;
		isf_FragColor.a = (outPixel.a>1.0) ? outPixel.a-1.0 : outPixel.a;
	}
	else	{
		vec4		outPixel = srcPixel+slideAmt;
		isf_FragColor.x = (outPixel.x>1.0) ? outPixel.x-1.0 : outPixel.x;
		isf_FragColor.y = (outPixel.y>1.0) ? outPixel.y-1.0 : outPixel.y;
		isf_FragColor.z = (outPixel.z>1.0) ? outPixel.z-1.0 : outPixel.z;
		isf_FragColor.a = (outPixel.a>1.0) ? outPixel.a-1.0 : outPixel.a;
	}
}
