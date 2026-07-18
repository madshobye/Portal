# Dante's Inferno STL collection

Fourteen procedural models derived from the supplied visual moodboard. Each
file is an independent binary STL, centered in X/Y, placed on Z=0, and scaled
to a maximum dimension of 100 units for predictable use in VJ1.

The terrain pieces are closed heightfield solids. Architectural models may
contain several closed shells so their parts can overlap without requiring an
expensive boolean union; this is suitable for rendering and most slicers.

Regenerate the collection with:

```sh
node experiments/vj1/tools/generate-dantes-inferno-stls.mjs
```
