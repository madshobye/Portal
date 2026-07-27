/*{
  "ISFVSN": "2.0",
  "LABEL": "Dissolve",
  "DESCRIPTION": "Premultiplied linear dissolve between two prepared endpoint views.",
  "CATEGORIES": [
    "Transition"
  ],
  "INPUTS": [
    {
      "NAME": "startImage",
      "LABEL": "Start Image",
      "TYPE": "image"
    },
    {
      "NAME": "endImage",
      "LABEL": "End Image",
      "TYPE": "image"
    },
    {
      "NAME": "progress",
      "LABEL": "Progress",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0
    }
  ],
  "VJ1": {
    "ID": "vj1.transition.dissolve",
    "VERSION": "1.0.0",
    "TAGS": [
      "dissolve",
      "crossfade",
      "transition"
    ],
    "ALPHA": "premultiplied",
    "ROI": "prepared-endpoints",
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

void main() {
  isf_FragColor = mix(
    IMG_THIS_NORM_PIXEL(startImage),
    IMG_THIS_NORM_PIXEL(endImage),
    clamp(progress, 0.0, 1.0)
  );
}
