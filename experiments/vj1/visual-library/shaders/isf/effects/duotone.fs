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
      "NAME": "threshold",
      "TYPE": "float",
      "DEFAULT": 0.5
    },
    {
      "NAME": "softness",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0
    },
    {
      "NAME": "brightColor",
      "TYPE": "color",
      "DEFAULT": [
        1,
        1,
        1,
        1
      ]
    },
    {
      "NAME": "darkColor",
      "TYPE": "color",
      "DEFAULT": [
        0,
        0,
        0,
        1
      ]
    }
  ],
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

//const vec4		lumcoeff = vec4(0.299, 0.587, 0.114, 0.0);
const vec4 	lumcoeff = vec4(0.2126, 0.7152, 0.0722, 0.0);

void main() {
	vec4		srcPixel = IMG_THIS_PIXEL(inputImage);
	float		luminance = dot(srcPixel,lumcoeff);
	//isf_FragColor = (luminance>=threshold) ? (brightColor) : (darkColor);
	
	//	if i'm doing hard edges, it's either one color or the other
	if (softness<=0.0)	{
		isf_FragColor = (luminance>=threshold) ? vec4(brightColor.rgb, srcPixel.a) : vec4(darkColor.rgb, srcPixel.a);
	}
	//	else i'm doing soft edges...
	else	{
		//	'softness' is normalized proportion of luminance on either side of threshold to be interpolated
		//	e.g.: 'softness' is 0.5 and 'threshold' is 0.5: vals < 0.25 are "dark", vals from 0.25-0.75 are "interpolated", and vals > 0.75 are "light"
		vec4		midColor = (brightColor+darkColor)/vec4(2.0);
		vec4		dstPixel;
		if (luminance>=threshold)	{
			isf_FragColor = mix(midColor, brightColor, smoothstep(threshold, threshold+((1.0-threshold)*softness), luminance));
		}
		else	{
			isf_FragColor = mix(darkColor, midColor, smoothstep(threshold-((1.0-threshold)*softness), threshold, luminance));
		}
		
		/*
		//	'softness' is the absolute width (in luminance) on either side of the threshold to be interpolated
		//	e.g.: if softness is 0.25 and threshold is 0.5, vals < 0.25 are "dark", vals from 0.25-0.75 are "smoothed", and vals > 0.75 are "light"
		vec4		midColor = (brightColor+darkColor)/vec4(2.0);
		vec4		dstPixel;
		if (luminance>=threshold)	{
			isf_FragColor = mix(midColor, brightColor, smoothstep(threshold, threshold+softness, luminance));
		}
		else	{
			isf_FragColor = mix(darkColor, midColor, smoothstep(threshold-softness, threshold, luminance));
		}
		*/
	}
}
