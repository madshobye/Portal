/*{
  "DESCRIPTION": "performs a 3d rotation",
  "CREDIT": "by zoidberg",
  "ISFVSN": "2",
  "CATEGORIES": [
    "Geometry Adjustment",
    "Utility"
  ],
  "INPUTS": [
    {
      "NAME": "inputImage",
      "TYPE": "image"
    },
    {
      "NAME": "xrot",
      "LABEL": "X rotate",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 1
    },
    {
      "NAME": "yrot",
      "LABEL": "Y rotate",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 1
    },
    {
      "NAME": "zrot",
      "LABEL": "Z rotate",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 1
    },
    {
      "NAME": "zoom",
      "LABEL": "Zoom Level",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 1
    }
  ],
  "VJ1": {
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main()
{
	isf_FragColor = IMG_THIS_PIXEL(inputImage);
}
