/*{
  "ISFVSN": "2.0",
  "LABEL": "Buffered Echo",
  "DESCRIPTION": "Fades a persistent image buffer, then conditionally captures and blends the current input into it.",
  "CATEGORIES": [
    "Feedback",
    "Temporal"
  ],
  "INPUTS": [
    {
      "NAME": "inputImage",
      "LABEL": "Input Image",
      "TYPE": "image"
    },
    {
      "NAME": "clearBuffer",
      "LABEL": "Clear Buffer",
      "TYPE": "event"
    },
    {
      "NAME": "captureNow",
      "LABEL": "Capture Now",
      "TYPE": "event"
    },
    {
      "NAME": "autoCapture",
      "LABEL": "Auto Capture",
      "TYPE": "bool",
      "DEFAULT": true
    },
    {
      "NAME": "stutterFrames",
      "LABEL": "Capture Every N Frames",
      "TYPE": "long",
      "MIN": 1,
      "MAX": 240,
      "DEFAULT": 1
    },
    {
      "NAME": "stutterOffset",
      "LABEL": "Capture Frame Offset",
      "TYPE": "long",
      "MIN": 0,
      "MAX": 239,
      "DEFAULT": 0
    },
    {
      "NAME": "fadeAmount",
      "LABEL": "Fade Per Frame",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0.02
    },
    {
      "NAME": "fadeMode",
      "LABEL": "Fade Mode",
      "TYPE": "long",
      "VALUES": [
        0,
        1,
        2,
        3
      ],
      "LABELS": [
        "Alpha",
        "Darken",
        "Alpha + Darken",
        "Toward Color"
      ],
      "DEFAULT": 2
    },
    {
      "NAME": "fadeColor",
      "LABEL": "Fade Color",
      "TYPE": "color",
      "DEFAULT": [
        0,
        0,
        0,
        0
      ]
    },
    {
      "NAME": "pauseFade",
      "LABEL": "Pause Fade",
      "TYPE": "bool",
      "DEFAULT": false
    },
    {
      "NAME": "thresholdMode",
      "LABEL": "Capture Threshold",
      "TYPE": "long",
      "VALUES": [
        0,
        1,
        2,
        3
      ],
      "LABELS": [
        "Always",
        "Highlights",
        "Shadows",
        "Alpha"
      ],
      "DEFAULT": 0
    },
    {
      "NAME": "threshold",
      "LABEL": "Threshold Level",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0.5
    },
    {
      "NAME": "thresholdSoftness",
      "LABEL": "Threshold Softness",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 0.5,
      "DEFAULT": 0.05
    },
    {
      "NAME": "blendMode",
      "LABEL": "Capture Blend Mode",
      "TYPE": "long",
      "VALUES": [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7
      ],
      "LABELS": [
        "Normal",
        "Add",
        "Screen",
        "Lighten",
        "Darken",
        "Multiply",
        "Difference",
        "Replace"
      ],
      "DEFAULT": 2
    },
    {
      "NAME": "captureOpacity",
      "LABEL": "Capture Opacity",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 0.35
    },
    {
      "NAME": "captureGain",
      "LABEL": "Capture Gain",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 2,
      "DEFAULT": 1
    },
    {
      "NAME": "bufferOpacity",
      "LABEL": "Buffer Opacity",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 1
    },
    {
      "NAME": "outputMix",
      "LABEL": "Dry / Buffered",
      "TYPE": "float",
      "MIN": 0,
      "MAX": 1,
      "DEFAULT": 1
    },
    {
      "NAME": "clampOutput",
      "LABEL": "Clamp Output",
      "TYPE": "bool",
      "DEFAULT": true
    }
  ],
  "PASSES": [
    {
      "TARGET": "echoBuffer",
      "PERSISTENT": true
    },
    {}
  ],
  "VJ1": {
    "ID": "buffered-echo",
    "VERSION": "0.1.0",
    "TAGS": [
      "feedback",
      "buffer",
      "echo",
      "stutter",
      "trigger"
    ],
    "ALPHA": "straight",
    "ROI": "full-frame",
    "PROFILE": "vj1-isf-webgl2@1"
  }
}*/

float luminanceOf(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec4 fadedBuffer(vec4 stale) {
  if (pauseFade) {
    return stale;
  }

  float retention = 1.0 - fadeAmount;
  if (fadeMode == 0) {
    stale.a *= retention;
  } else if (fadeMode == 1) {
    stale.rgb *= retention;
  } else if (fadeMode == 2) {
    stale.rgb *= retention;
    stale.a *= retention;
  } else {
    stale.rgb = mix(stale.rgb, fadeColor.rgb, fadeAmount);
    stale.a = mix(stale.a, fadeColor.a, fadeAmount);
  }
  return stale;
}

float captureMask(vec4 fresh) {
  if (thresholdMode == 0) {
    return 1.0;
  }

  float signal = thresholdMode == 3 ? fresh.a : luminanceOf(fresh.rgb);
  float width = max(thresholdSoftness, 0.00001);
  if (thresholdMode == 2) {
    return 1.0 - smoothstep(threshold - width, threshold + width, signal);
  }
  return smoothstep(threshold - width, threshold + width, signal);
}

vec3 blendRgb(vec3 base, vec3 source) {
  if (blendMode == 1) {
    return base + source;
  }
  if (blendMode == 2) {
    return 1.0 - (1.0 - base) * (1.0 - source);
  }
  if (blendMode == 3) {
    return max(base, source);
  }
  if (blendMode == 4) {
    return min(base, source);
  }
  if (blendMode == 5) {
    return base * source;
  }
  if (blendMode == 6) {
    return abs(base - source);
  }
  return source;
}

vec4 compositeCapture(vec4 base, vec4 fresh, float mask) {
  vec4 source = vec4(fresh.rgb * captureGain, fresh.a * captureOpacity * mask);
  source.a = clamp(source.a, 0.0, 1.0);

  if (blendMode == 7) {
    return mix(base, source, source.a);
  }

  float outputAlpha = source.a + base.a * (1.0 - source.a);
  vec3 blended = blendRgb(base.rgb, source.rgb);
  vec3 outputPremultiplied =
    base.rgb * base.a * (1.0 - source.a) +
    source.rgb * source.a * (1.0 - base.a) +
    blended * base.a * source.a;
  vec3 outputRgb = outputAlpha > 0.00001
    ? outputPremultiplied / outputAlpha
    : vec3(0.0);
  return vec4(outputRgb, outputAlpha);
}

void main() {
  vec2 uv = isf_FragNormCoord.xy;

  if (PASSINDEX == 0) {
    vec4 stale = FRAMEINDEX == 0
      ? vec4(0.0)
      : IMG_NORM_PIXEL(echoBuffer, uv);
    vec4 nextBuffer = clearBuffer ? vec4(0.0) : fadedBuffer(stale);

    int interval = max(stutterFrames, 1);
    int phase = stutterOffset % interval;
    bool scheduledCapture = autoCapture && (FRAMEINDEX % interval == phase);
    if (!clearBuffer && (captureNow || scheduledCapture)) {
      vec4 fresh = IMG_NORM_PIXEL(inputImage, uv);
      nextBuffer = compositeCapture(nextBuffer, fresh, captureMask(fresh));
    }

    isf_FragColor = clampOutput ? clamp(nextBuffer, 0.0, 1.0) : nextBuffer;
    return;
  }

  vec4 dry = IMG_NORM_PIXEL(inputImage, uv);
  vec4 buffered = IMG_NORM_PIXEL(echoBuffer, uv);
  buffered.a *= bufferOpacity;
  vec4 outputColor = mix(dry, buffered, outputMix);
  isf_FragColor = clampOutput ? clamp(outputColor, 0.0, 1.0) : outputColor;
}
