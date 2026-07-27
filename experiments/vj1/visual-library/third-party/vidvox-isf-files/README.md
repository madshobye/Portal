# Vidvox ISF-Files curated collection

This directory records the provenance of the curated ISF proof collection
under `visual-library/shaders/isf`.

- Upstream: https://github.com/Vidvox/ISF-Files
- Upstream tree: `395072d48b3ce7351ccb20a5fda54470591324df`
- License: MIT; see `LICENSE`
- Imported resources: 45 original ISF 2 fragment shaders

The first proof slice contains 23 single-pass shaders: six generators, eight
effects, and nine transitions. The second tranche adds 17 shaders: four
generators, nine effects, and four transitions. It deliberately exercises the
general persistent, float-target, and multipass runtime through Comet Tails,
Freeze Frame, Slit Scan, and Ghosting.

A two-effect multipass comparison tranche adds Dilate and Erode. These
unchanged upstream shaders provide full-size, two-pass, non-persistent target
comparisons for Ghosting without introducing custom vertex varyings, resized
passes, or extra input-resource capabilities.

An audio tranche adds FFT Color Lines, FFT Filled Waveform, and Waveform
Displace. They use the shared native Web Audio analyser through retained
waveform and FFT textures; analysis is performed once per frame and reused by
all audio ISF instances.

The collection still excludes custom vertex shaders, imported image resources,
event inputs, and non-transition shaders with multiple image inputs. Those
capabilities require their own user-facing input contracts before they should
be presented as built-ins.

The `.fs` resources retain the upstream shader text; repository import
normalizes the final newline only. VJ1 identity, classification, attribution,
and catalog presentation live in `visual-library.json`.
