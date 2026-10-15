# Implementation status

Firmware 0.10 is installed and tested on the controller. The public source
contains the standalone application, visitor UI, artist SDK and application tests.
See README.md for build/control instructions and SPECIFICATION.md for the target.

Implemented: four universes, sparse fixture mapping up to 448 RGB pixels, ten
local effects, idle fade, brightness cap, persistent configuration, DHCP/MQTT,
keyed artist control, diagnostics and immediate confirmed-state publication.

Original manufacturer binaries, recovered packaging constants and utilities,
stock-image diagnostics and unpublished pre-cleanup history are excluded from
the public branch. Local-only material is in the ignored .private directory.
The public build generates raw application artifacts, not an upload package.

Remaining physical validation and publication status are listed in VALIDATION.md.
