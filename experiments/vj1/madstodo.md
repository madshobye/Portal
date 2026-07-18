#new notes from mads (move these down to current notes when you have read them)

#current notes

# DONE

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
