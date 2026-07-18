# VJ1 sculptural STL collection

Procedural models for testing and performing with VJ1's 3D renderer. The
collection contains abstract landscapes and structures together with stylized
human anatomy: skull, heart, brain, lungs, kidneys, ribcage, hand, and pelvis.

Each file is an independent binary STL, centered in X/Y, placed on Z=0, and
scaled to a maximum dimension of 100 units. Anatomy assets are expressive
rendering forms rather than medically accurate models.

Some models contain several overlapping closed shells. This avoids expensive
boolean construction and is appropriate for realtime rendering, but the files
are not intended as clinical or precision-manufacturing data.

Regenerate the collection with:

```sh
node experiments/vj1/tools/generate-sculptural-stls.mjs
```
