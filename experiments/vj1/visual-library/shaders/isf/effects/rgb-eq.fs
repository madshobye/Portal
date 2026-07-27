/*{
  "CREDIT": "by VIDVOX",
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
      "NAME": "red",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 1
    },
    {
      "NAME": "green",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 1
    },
    {
      "NAME": "blue",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 1
    },
    {
      "NAME": "gain",
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
	vec4	pixel = IMG_THIS_PIXEL(inputImage);	
	float	brightness = (pixel.r * red + pixel.g * green + pixel.b * blue) / 3.0;
	
	pixel.r = pixel.r * red;
	pixel.g = pixel.g * green;
	pixel.b = pixel.b * blue;

	if (gain >= 0.0)	{
		pixel.a = (brightness >= gain) ? pixel.a : 0.0;
	}
	else	{
		pixel.a = (brightness <= 1.0-abs(gain)) ? pixel.a : 0.0;
	}
	isf_FragColor = pixel;
}
