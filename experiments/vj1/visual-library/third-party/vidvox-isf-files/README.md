# Vidvox ISF-Files proof collection

This directory records the provenance of the curated ISF proof collection
under `visual-library/shaders/isf`.

- Upstream: https://github.com/Vidvox/ISF-Files
- Upstream tree: `395072d48b3ce7351ccb20a5fda54470591324df`
- License: MIT; see `LICENSE`
- Imported resources: 23 original ISF 2 fragment shaders

The proof collection deliberately includes only single-pass fragment shaders:
six generators, eight effects, and nine transitions. It excludes custom vertex
shaders, audio and audioFFT inputs, imported image resources, multipass
programs, persistent feedback, float targets, and event inputs.

The `.fs` resources retain the upstream shader text; repository import
normalizes the final newline only. VJ1 identity, classification, attribution,
and catalog presentation live in `visual-library.json`.
