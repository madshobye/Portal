# Vidvox ISF-Files compatible collection

This directory records the provenance of the compatible ISF collection
under `visual-library/shaders/isf`.

- Upstream: https://github.com/Vidvox/ISF-Files
- Upstream tree: `395072d48b3ce7351ccb20a5fda54470591324df`
- License: MIT; see `LICENSE`
- Imported resources: 249 original ISF 2 fragment shaders and one shared PNG

The built-in collection contains 43 generators, 144 effects, and 62
transitions from the pinned upstream revision. The first 49 files were brought
in as focused capability tranches. The compatible-library import adds another
200 shaders after checking each upstream document against the runtime's current
input, pass, and resource contracts and compiling the complete resulting
catalog in Chrome's WebGL 1 implementation.

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

The collection still excludes paired custom vertex shaders, shaders requiring
additional live image connections (including two transitions with a third
image input), and shaders whose imported bitmap resources have not been
packaged. Twenty-four otherwise compatible files are also withheld because
their generated programs do not compile under VJ1's current WebGL 1 shader
contract. Those capabilities require their own runtime and user-facing input
contracts before they should be presented as built-ins.

The `.fs` resources retain the upstream shader text; repository import
normalizes the final newline only. VJ1 identity, classification, attribution,
and catalog presentation live in `visual-library.json`.

`scripts/import-compatible-isf-library.mjs` makes this selection repeatable
from the pinned upstream tree. `scripts/inventory-isf-library.mjs` reports the
capabilities and current-runtime compatibility without changing the project.
