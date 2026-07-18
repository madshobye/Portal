#new notes from mads (move these down to current notes when you have read them)

#current notes

# DONE

replace periodic media polling with a Media-modal refresh button
Solution: Removed the unconditional five-second recursive project-folder scan from the live application. The Choose Media modal now has an explicit refresh action that releases preview leases, performs the existing authoritative folder reconciliation on demand, prevents duplicate concurrent scans, updates the open catalog, and emits `VJ1_MEDIA_REFRESH_FAILED` if the requested scan fails. Focus and visibility restoration still reconcile external changes once when returning to the app.

measure the communication stream in performance profiles
Solution: Output transport now timestamps every full state and Live parameter-patch message at the control boundary, then measures delivery/structured-clone delay, receive-to-apply time, apply-to-first-render time, and end-to-end visible latency. Each profile sample separates full snapshots, patch messages, individual patches, revisions, and resync causes, with interval and cumulative counters. Payloads are not JSON-stringified for byte estimates because doing so would add large allocations to the path being measured.

phase-shift embedded Preview and standalone Output rendering
Solution: When a standalone Output connects, the duplicate embedded Preview now pauses once and resumes halfway through its own render interval (about 16.7 ms at 30 fps). Output remains the presentation clock; ordinary state and slider updates do not reset the phase, while reconnecting or changing the effective frame cap deliberately realigns it. This staggers GPU submissions without changing render truth or reducing the configured Output rate.

separate Live Component controls from its element list and restore missing Component parameters
Solution: The selected Live Component now has Controls and Elements views. Controls owns Component opacity, speed, and blend plus every parameter or transform published through Significant—including scale and effect amount—while Elements retains the nested outline and opens the chosen element's Primary, Details, and Transform section below. The selected view is normalized as UI state instead of being inferred from renderer internals.

add a fade duration beside the Live scene transition for parameter changes
Solution: Live Timing now has an independent Param fade duration. Numeric Live patches update their commanded target immediately but the embedded preview and standalone output interpolate only the render-time value from the currently displayed value, including smooth mid-fade retargeting. Toggles, menus, and colors remain immediate, and the setting persists with the project.

new elements added to an on-air Component or Canvas should not become visible
Solution: All element-insertion paths now evaluate the current Live program graph, including Components nested inside an on-air Canvas and the fading source of an active transition. Sources, effects, Groups, pasted items, and dropped media inserted anywhere in that graph start disabled; non-live edits retain their existing visible defaults.

selecting another Scene during a slow transition jumps
Solution: Standalone output now has a one-slot, latest-request-wins Scene queue. A requested Scene may load in parallel, but cannot replace an active transition. Once the current transition reaches its actual target, the newest queued Scene starts from that completed program state with a fresh transition clock; superseded intermediate Scenes never become transition sources.

diagonal black line appears during mapped Live Scene transitions
Solution: Mapped shader quads now own an explicit fill-only raster-state contract at the mapper primitive. Both ordinary and transition `TRIANGLE_STRIP` draws disable inherited p5 strokes locally, preventing calibration or overlay style state from outlining the two triangles and exposing their shared diagonal.

wait to transition to a Live Scene until its media is loaded
Solution: Standalone output now treats a requested Live Scene as prepared state rather than rendered truth until the existing media-readiness graph reports every referenced image, video, model, and media-backed generator ready. Incoming decoded resources are reserved against LRU eviction during preparation, parameter patches continue into the requested state using a separate transport revision, and transition time begins only at activation. A failed load keeps the current Scene visible and emits `VJ1_SCENE_PREPARE_FAILED` with the blocking media IDs.

new Scenes should not contain arbitrary Components
Solution: The Scene plus control now creates a deliberately empty Scene snapshot: every known Surface starts disabled with no Component or Canvas-frame route. The former current-state capture factory remains explicit and separate, and creating a Component no longer silently assigns it to every empty Surface.

Live slider motion becomes jagged under moderate GPU pressure
Solution: Live patch delivery no longer waits for the control window's animation frame, and opening a standalone output now caps the duplicate embedded preview at 30 fps in every workspace. The standalone output keeps its configured rate and receives parameter truth independently, leaving it more GPU scheduling headroom without reducing control-event frequency.

add a maximum frame-rate setting
Solution: Rendering settings now expose one normalized 1–120 fps project cap. Standalone outputs adopt it directly, embedded previews respect it as an upper bound alongside their existing workload throttle, and render-cost metrics use the selected frame budget instead of assuming 120 fps.

send only changed Live params to the output window
Solution: Live parameter scrubs now send coalesced revisioned Component-path patches in a microtask, independently of preview frame pacing. The output applies valid patches directly to its accepted render state without rebuilding route or surface state. Full snapshots remain authoritative for startup, reconnection, scene and structural changes; missing revisions or invalid paths produce a visible console warning and request a targeted full resync.

reduce garbage collection pressure from 2026-07-18T03-00-04-850Z-mappertest.profile.json
Solution: The trace's 28 animated Eyeball stages were CPU-bound while GPU work stayed low. Generator quality params now remain borrowed unless adjustment is required; per-instance eye vectors, transform matrices, and standard uniform arrays update in place; and continuously changing eye vectors bypass p5's allocation-heavy array-uniform cache while using its normal WebGL upload path. These bounded per-instance caches are pruned with the existing render-cache lifecycle.

changing params in live view is not live in the output window
Solution: Live output synchronization is now owned by the output bridge rather than the general project/autosave subscriber. Live commits broadcast derived render truth immediately, slider scrubs coalesce to the newest value within the current event turn without waiting for a preview frame, and bridge disposal invalidates pending delivery and unsubscribes cleanly.

review 2026-07-18T02-33-28-399Z-mappertest.profile.json
Solution: The profile shows no renderer bottleneck: CPU render averages 1.35 ms with a 2.34 ms p95, and output GPU samples remain roughly 5–7 ms. Preview and output FPS dip together while measured render work stays low, locating the remaining stutter outside the render passes in shared browser/main-thread scheduling or interaction-state transport.

changing a param in another view than main view makes it jump back to main view
Solution: The shared inspector remembers each element's active parameter-view radio by stable group and input ID before replacing its HTML, then restores it before rebinding controls. Details and Transform therefore remain selected across parameter updates in Component, Canvas, Scene, and Live.

seascape generator moves down when moved up; after correcting movement it renders upside down
Solution: Shadertoy generators now transform the shared canonical top-left Composition UV, then convert to Shadertoy's bottom-left `fragCoord` only at the `mainImage` API boundary. Seascape therefore moves in the correct direction and retains its intended orientation without a generator-specific flip.

there is some recurring stutter in cpu load and framerate added a profile to screenshots.
Solution: The profile isolated a CPU-side allocation/garbage-collection sawtooth while GPU time and render topology stayed stable. Render-cache eviction now remains immediate under hard memory pressure, but routine age scans and Component-time cleanup run as bounded 120-frame maintenance instead of allocating and sorting cache snapshots every frame.

component names in liveview seems to use internal id see screenshot
Solution: Live Component-source labels resolve referenced Component and media metadata before choosing display text, so the outline and settings show user-facing names rather than stored IDs.

making window narrow makes second collumn oddly wide maybe just keep width and make preview small and then black. see screenshot
Solution: At narrow desktop widths the catalog and inspector retain fixed 190 px and 300 px tracks. The preview loop is disabled and unused space stays black instead of stretching the inspector.

in the surface in scenes where one can select a component make the components used for the surface be the first one when opening the surface. can you do this in an elegant way
Solution: The shared source catalog uses a stable selected-first partition for Surface assignment. The assigned Component appears first without changing the order of the remaining catalog.

when toggling resolution in the preview then legnth of the toggle changes because resolution etch changes which means that the toggle shifts and one loose it over the mouse
Solution: Preview quality and performance readouts have stable toolbar footprints. Changing quality or resolution text no longer moves the resolution toggle away from the pointer.

refresh causes liveview to switch scene instead of styaing on the current scene
Solution: Live Scene selection is no longer excluded from project autosave and receives an immediate persistence checkpoint. The serialized selected Scene is restored after refresh.

tiny visual bug with text length in liveview see screenshot
Solution: Live outline labels are constrained to their available grid column and ellipsize before the element-type and visibility controls.

transform view is empty in liveview
Solution: Removed an obsolete Live-only CSS rule that forcibly hid the active Transform panel. Live now exposes the same generic position, scale, rotation, and anchor controls as Component view.

another small text length bug see screenshot
Solution: Live outline rows now establish a hard overflow boundary and their selection grid uses border-box sizing. Long selected media names cannot paint through the visibility-button column.

i think the styling of the view tabs should be toggle buttons. e.g. content and transform etc as seperate btns.
Solution: Primary, Details, and Transform render as independently rounded toggle buttons with spacing, neutral inactive controls, and the shared dark-orange selected state.

Live Component Controls needs position, scale, and rotation
Solution: The selected Component's Controls view now always exposes Position X, Position Y, Scale, and Rotation as temporary per-Scene Live overrides. Rendering applies this root transform to the completed full-frame Component texture in one optional GPU pass, rather than pretending the first chain element is the Component or rewriting internal element transforms.
