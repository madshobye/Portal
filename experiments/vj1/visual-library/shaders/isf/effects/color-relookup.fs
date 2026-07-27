/*{
  "CREDIT": "by VIDVOX",
  "ISFVSN": "2",
  "CATEGORIES": [
    "Glitch"
  ],
  "INPUTS": [
    {
      "NAME": "inputImage",
      "TYPE": "image"
    },
    {
      "NAME": "lookupImage",
      "TYPE": "image"
    },
    {
      "NAME": "mix_amount",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0.5
    }
  ],
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main() {
	vec4 thisColor = IMG_THIS_PIXEL(inputImage);
	vec2 lookupCoord;
	lookupCoord.x = mix (thisColor.r, thisColor.g, mix_amount);
	lookupCoord.x = mix (lookupCoord.x, thisColor.b, mix_amount);
	lookupCoord.x = RENDERSIZE.x * lookupCoord.x / 255.0;
	
	lookupCoord.y = mix (thisColor.r, thisColor.g, mix_amount);
	lookupCoord.y = mix (lookupCoord.y, thisColor.b, mix_amount);
	lookupCoord.y = RENDERSIZE.y * lookupCoord.y / 255.0;
	
	isf_FragColor = IMG_NORM_PIXEL(lookupImage, lookupCoord);
}
