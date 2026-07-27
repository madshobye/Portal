/*{
  "DESCRIPTION": "this is basically identical to the demonstration of a persistent buffer",
  "CREDIT": "by zoidberg",
  "ISFVSN": "2",
  "CATEGORIES": [
    "Blur"
  ],
  "INPUTS": [
    {
      "NAME": "inputImage",
      "TYPE": "image"
    },
    {
      "NAME": "blurAmount",
      "TYPE": "float",
      "DEFAULT": 0
    }
  ],
  "PASSES": [
    {
      "TARGET": "bufferVariableNameA",
      "PERSISTENT": true,
      "FLOAT": true
    },
    {}
  ],
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main()
{
	vec4		freshPixel = IMG_PIXEL(inputImage,gl_FragCoord.xy);
	vec4		stalePixel = IMG_PIXEL(bufferVariableNameA,gl_FragCoord.xy);
	isf_FragColor = mix(freshPixel,stalePixel,blurAmount);
}
