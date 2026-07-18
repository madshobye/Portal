# Organic anatomical STL set

These meshes translate the anatomical wireframe moodboard into softer VJ-ready forms. They use continuous implicit surfaces rather than visibly intersecting geometric primitives, with asymmetry, tissue variation, branching vessels, carved fissures, and anatomical concavities.

Regenerate them with:

```sh
node experiments/vj1/tools/generate-organic-organ-stls.mjs
```

Every binary STL is normalized to a 100-unit maximum dimension and rests on `Z=0` for consistent import, scaling, and rotation.
