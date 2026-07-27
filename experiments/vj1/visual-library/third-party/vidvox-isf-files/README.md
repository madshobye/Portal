# Vidvox ISF-Files curated collection

This directory records the provenance of the curated ISF proof collection
under `visual-library/shaders/isf`.

- Upstream: https://github.com/Vidvox/ISF-Files
- Upstream tree: `395072d48b3ce7351ccb20a5fda54470591324df`
- License: MIT; see `LICENSE`
- Imported resources: 49 original ISF 2 fragment shaders and one shared PNG

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

An event tranche adds Shockwave Pulse and FFT Spectrogram. Their momentary
event inputs use VJ1's existing transient frame scheduler and never become
saved boolean state. Together they exercise events with persistent,
floating-point multipass targets and the shared FFT texture.

An imported-image tranche adds Cursor and Cursor Overlay. Both retain their
upstream fragment source and share the exact upstream `cursor.png` bytes through
the built-in repository's retained resource cache.

The collection still excludes custom vertex shaders and non-transition shaders
with multiple image inputs. Those capabilities require their own user-facing
input contracts before they should be presented as built-ins.

The `.fs` resources retain the upstream shader text; repository import
normalizes the final newline only. VJ1 identity, classification, attribution,
and catalog presentation live in `visual-library.json`.
