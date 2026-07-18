# VJ1 render architecture contract

This document records the cleanup decisions made after the render-coordinate and media-lifetime audit. It is a guardrail for future work, not a second implementation.

## User truth and observed runtime state

User commands are authoritative desired state. Browser, decoder, network, GPU, and analysis status are observations about progress toward that state.

- `playing`, visibility, transform, and selected route are commands.
- `paused`, `readyState`, buffer availability, shader readiness, and analysis progress are observations.
- A failed or deferred attempt never rewrites the command. The runtime retries or reports the failure while continuing to converge.
- Interactive controls optimistically record their command before asynchronous render/state acknowledgement. Pointer motion is frame-coalesced, while pointer release commits the final value immediately and cancels older queued motion.

## Canonical project model

Persisted projects are migrated once on load. Version 18 converts legacy source/shader chains, Canvas layers/frames, route fields, time scale, and preview viewport aliases into the current model.

Runtime code consumes only:

- `component.chain` for visual nodes;
- `recordingFrames` for Canvas capture regions;
- `sourceNodeId` for Scene routes;
- `previewViewports[workspace]` for navigation;
- `global.timeStretch` for visual time.

Compatibility belongs in `project-migrations.js`. Adding a legacy fallback to a normalizer, renderer, or controller recreates multiple truths and is not allowed.

## Render coordinates

The Composition frame is the immutable logical render space. Every chain node receives and returns that frame; transforms change sampled content, never buffer dimensions.

- Composition coordinates: +X right, +Y down, positive rotation clockwise.
- Shader UV transforms use the inverse sampling matrix from `content-coordinate-space.js`.
- p5 `aTexCoord` is already treated as top-left content coordinates. Texture-storage orientation is handled only at render-target presentation.
- Raw WebGL model/camera space is +Y up. The generic placement conversion negates Y and rotation exactly once at that boundary.
- Asset import basis is separate from user transform. STL's format-specific Z basis correction is applied in `modelImportBasis`; handles remain neutral at zero rotation.

No generator/effect may add a local “flip fix”. A new backend must declare its render-target orientation and convert at its adapter boundary.

## Render graph and alpha

The graph scheduler compiles the canonical chain even when it is empty; it no longer synthesizes a source/effect graph from legacy component fields.

- Nodes pass explicit texture state and render requests downstream.
- Groups are isolated compositing scopes with one parent transform, alpha, and blend operation.
- Source/group opacity is a compositing property. Effect `amount` controls effect strength, not output alpha.
- All shader output crossing the compositor uses premultiplied alpha. Effects that change alpha must premultiply RGB before returning.
- Transparent loading output is valid content. Diagnostic text is presentation controlled by the debug flag and must never become a saved thumbnail.

## p5 boundary

p5 remains an application and import helper, not the primary pixel engine.

Allowed uses:

- canvas/event lifecycle and simple diagnostic drawing;
- browser image/video/camera import wrappers;
- test pattern/checker/black utility sources;
- temporary compatibility targets when `p5.Framebuffer` is unavailable, with a console warning.

Primary rendering uses cached WebGL shaders, shared framebuffers, raw model/terrain renderers, and GPU noise. CPU per-pixel generators and p5 noise loops were removed. A shader generator that cannot compile becomes transparent (or a debug diagnostic) and logs the failure; it must not silently switch to a CPU implementation with different performance or appearance.

## Media and thumbnails

Media ownership is demand driven. Full images, videos, cameras, STL, and OBJ assets are held only while claimed by the current frame or a bounded LRU. Catalog thumbnails use short-lived decoded resources/renditions and do not keep the full library resident.

Existing component thumbnails remain visible while edits are pending. Signature changes request replacement capture without blanking the old thumbnail. Capture waits until all component assets/analysis are content-ready, so loading diagnostics are never persisted.

## Fallback observability

A fallback that changes output, performance, persistence, or backend writes a tagged console message containing the chosen fallback and error when available. Examples include media draw bridging, shader compile failure, framebuffer replacement, font fallback, persistent analysis-cache failure, and unavailable GPU analysis backend.

The following are not fallbacks and need no log: resource disposal, feature/capability queries whose result is the contract, expected file-existence probes, and invalid user input rejected before execution.

## Remaining size boundaries

`output-renderer.js`, `control-shell-controller.js`, and `models.js` remain orchestration-heavy. New feature logic must go into an owned runtime/view/domain module rather than expanding those files. Extraction should follow ownership boundaries (media, thumbnails, surface planning, specialized sources, interaction geometry) and preserve this contract with source tests before moving code.
