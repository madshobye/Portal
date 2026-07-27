/*{
  "CATEGORIES": [
    "Pattern",
    "Color"
  ],
  "DESCRIPTION": "Draws basic graph paper pattern",
  "ISFVSN": "2",
  "INPUTS": [
    {
      "NAME": "bgColor",
      "TYPE": "color",
      "DEFAULT": [
        0.9399999976158142,
        0.9399999976158142,
        0.9700000286102295,
        1
      ]
    },
    {
      "NAME": "lineColor",
      "TYPE": "color",
      "DEFAULT": [
        0.6399999856948853,
        0.7699999809265137,
        0.9599999785423279,
        1
      ]
    },
    {
      "LABELS": [
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15",
        "16"
      ],
      "NAME": "majorDivisions",
      "TYPE": "long",
      "DEFAULT": 3,
      "VALUES": [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16
      ]
    },
    {
      "LABELS": [
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8"
      ],
      "NAME": "minorHDivisions",
      "TYPE": "long",
      "DEFAULT": 2,
      "VALUES": [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8
      ]
    },
    {
      "LABELS": [
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8"
      ],
      "NAME": "minorVDivisions",
      "TYPE": "long",
      "DEFAULT": 2,
      "VALUES": [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8
      ]
    },
    {
      "NAME": "majorDivisionLineWidth",
      "TYPE": "float",
      "MAX": 5,
      "DEFAULT": 3,
      "MIN": 1
    },
    {
      "NAME": "square",
      "TYPE": "bool",
      "DEFAULT": true
    }
  ],
  "CREDIT": "VIDVOX",
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

const float minorDivisionLineWidth = 1.0;


void main()	{
	vec4		inputPixelColor = bgColor;
	vec2		loc = gl_FragCoord.xy;
	vec2		divisionSize = (square) ? vec2(max(RENDERSIZE.x,RENDERSIZE.y)) : RENDERSIZE;
	divisionSize = (divisionSize - majorDivisionLineWidth) / (1.0 + float(majorDivisions));
	vec2		modLoc = mod(loc,divisionSize);
	if ((modLoc.x < majorDivisionLineWidth)||(modLoc.y < majorDivisionLineWidth))	{
		inputPixelColor = lineColor;
	}
	if (minorHDivisions > 0)	{
		vec2	locDivisionSize = (divisionSize) / (1.0+float(minorHDivisions));
		modLoc = mod(loc,locDivisionSize);
		if (modLoc.x < minorDivisionLineWidth)	{
			inputPixelColor = lineColor;
		}
	}
	if (minorVDivisions > 0)	{
		vec2	locDivisionSize = (divisionSize) / (1.0+float(minorVDivisions));
		modLoc = mod(loc,locDivisionSize);
		if (modLoc.y < minorDivisionLineWidth)	{
			inputPixelColor = lineColor;
		}
	}

	isf_FragColor = inputPixelColor;
}
