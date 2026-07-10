# VJ1 Codex Handover

This app is an experimental browser-based VJ/projection-mapping tool in `experiments/vj1`.

## Current Shape

- `js/app.js` boots either the control UI or an output/preview client based on URL mode.
- `js/app-state.js` owns the editable project model and exposes actions.
- `js/domain/models.js` normalizes project data, scenes, compositions, live render state, and defaults.
- `js/control/control-shell-controller.js` renders and binds the control UI.
- `js/control/shell-view.js` contains the top-level shell markup.
- `js/output/embedded-preview-app.js` mounts the embedded p5 preview canvas.
- `js/output/output-app.js` mounts the popup/output window.
- `js/output/output-renderer.js` is the main render pipeline.
- `js/output/vj-mapper.js` is the custom lightweight mapper used by VJ1.
- `js/services/project-folder-service.js` treats the selected folder as primary storage.
- `js/services/media-library-service.js` scans and imports media.

## State Model

- Compositions are reusable visual chains.
- Scenes assign compositions to projection surfaces.
- Live view selects the scene that drives the output window and applies temporary overrides only.
- Scene editing should not switch the live output scene.
- Project JSON and generated revisions live in the project folder.
- Browser local/session storage should only be used for UI convenience, not as authoritative project state.

## Rendering Notes

- Composition chains now behave like sequential layers/effects.
- Source nodes draw into the current composition buffer.
- Effect nodes process the current accumulated buffer.
- Some effects have transform controls.
- The preview-disabled mode intentionally uses composition thumbnails, so render-cost/CPU can drop close to zero.
- Composition thumbnails are captured at `512x288` and stored in the project JSON as data URLs.
- Video files currently show browser metadata-frame previews in pickers; they are not yet stored as standalone media thumbnail files.

## Mapping Notes

- VJ1 uses `js/output/vj-mapper.js`, not the old generic `mapper2.js` directly.
- Mapping data is stored under `state.mappings.local`.
- Surface disabling should skip drawing that surface entirely.
- Output blackout should affect the output window only.
- Render resolution changes scale existing mapping corners proportionally from old world size to new world size.
- The output window is height-fit: output frame fills window height, keeps aspect ratio, and crops horizontally.

## Recent Fixes

- Fixed live/debug overlay blinking by changing `OutputRenderer.shouldCalibrateFromState()` so embedded previews only calibrate when `global.calibrating` is true.
- Changed the label toggle into a debug overlay button.
- Made the mapping-handle toggle green when handles are actively shown.
- Split composition chain list from selected-chain-item editor.
- Removed squeezed numeric values from live sliders.
- Added video previews to media/add-element pickers.
- Raised composition thumbnail resolution.

## Known Fragile Areas

- p5/WebGL context pressure can still become a problem if multiple preview/output instances are accidentally created.
- Media thumbnails for movies are not yet generated and written as separate folder assets.
- Some older shader/filter conversions may still need careful verification for orientation, alpha, and blank-output cases.
- Live overrides and editor state must stay separate: live view can switch the output scene; scene view edits scenes without switching live output.
- Avoid broad DOM replacement during pointer interactions; slider/dropdown focus stability depends on keeping updates scoped.

## Verification

Useful quick checks:

```sh
node --check experiments/vj1/js/control/control-shell-controller.js
node --check experiments/vj1/js/output/output-renderer.js
node --check experiments/vj1/js/output/output-app.js
node --check experiments/vj1/js/output/embedded-preview-app.js
git diff --check
```

`experiments/vj1/todo.md` should be empty when a work iteration is done.
