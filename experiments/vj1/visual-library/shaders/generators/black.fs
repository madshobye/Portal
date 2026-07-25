/*{
  "ISFVSN": "2.0",
  "LABEL": "Black",
  "DESCRIPTION": "An opaque black frame.",
  "CATEGORIES": ["Utility"],
  "INPUTS": [],
  "VJ1": {
    "ID": "black",
    "VERSION": "0.1.0",
    "LOWERING": "fragment-generator",
    "TAGS": ["black", "utility"],
    "ALPHA": "premultiplied",
    "ROI": "local"
  }
}*/

void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
