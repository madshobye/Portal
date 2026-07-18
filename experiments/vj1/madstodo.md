#new notes from mads (move these down to current notes when you have read them)

the list of params for a component in live view is still not nice compared to components view.  then insert does not really work to show levels. 



#current notes 

move things around in a component still has the problem of jumping back. save with sliders. one has to change fast for it to happens or more precisely it seems link there is some internal render cycle or timing where when one hist right in that cycle a race condition occurs.

plasma effect is outdated in its params. i am missing better control over movement but other params may also be interesting. in general scaling can be done though the handles so that is not as attractive and it might also be relevant to rethink scaling on effects and generators that has it and maybe remove it and just let the handles do that? this brings me to another thought we have hidden the scaling, rotation and position as slider params but it may be relevant to have a multiple views on params and have those params in another view this way they can also be used as "significant" sliders.

go through and verify that our profiling, state update, cpu load measurement etc. does not actually cause overload. small events here and there on central proxies can become a lot of processing.

toggling the visibility button on an element over and over is good test to pinpoint the update glitch. in general it is much better but doing so still reveals that sometimes the toggle does not go through. it is as if e.g. turning visibility off quickly does it and then an internal update switches it back to on again. also moving an alement around seems to flood the event path and when letting go a previous position becomes the stored on and the element snaps back

go through all fall back code pieces and makes sure that they write in console




# DONE

when toggling visibility on an element thumbnail on the overall component or canvas etc. does not need to return to no thumbnail.
Solution: Thumbnail invalidation now keeps the last valid image visible while its content signature schedules a replacement capture. The old preview is replaced only after the new render is ready.

moving eyeballs up moves them down. same with gradients.
Solution: Standalone generator shaders now apply the canonical top-left Composition UV matrix directly. WebGL storage orientation is handled only at the render-target presentation boundary, so Eyeball, Gradient, and Waves share +Y-down movement.

go through and review legacy code not used or debris with intention of handling legacy projects.
Solution: Project version 18 migrates legacy source/shader chains, Canvas layers/frames, time scale, preview viewport, and route aliases on load. Runtime normalization, graph compilation, folder loading, preview navigation, and Scene routing now consume canonical fields rather than rediscovering legacy shapes.

toggling visibility of a surface on should also select that element.
Solution: Shared toggle controls carry an explicit selection target. Toggling a Scene surface, Component/Canvas chain item, or selectable pill selects that same physical element.

the list of params in live view is a bloody mess; list the components in the scene with thumbnails and select one for params.
Solution: Live’s first column now includes thumbnail navigation for direct and recursively referenced scene components. The inspector renders only the selected component rather than concatenating every parameter list.

right click a param to reset it or make it significant, and show significant params in scene view.
Solution: Persistent parameter controls open a compact context menu with Reset and Significant actions. Significant paths persist on the Component, use orange control styling, and appear in dedicated Scene and Live sections whenever that Component is routed.

stl object generator is showing the object rotated 180 degrees on the z axis.
Solution: STL import orientation is an explicit asset import-basis adapter shared by p5 and raw WebGL model paths. User rotation remains neutral at zero and OBJ assets retain their native basis.

review architecture for hotfixes, flip fixes, node data flow, and general alpha handling.
Solution: Added ARCHITECTURE_CLEANUP.md and enforced canonical Composition coordinates, render-target orientation metadata, stable Scene routes, premultiplied-alpha compositing, migration-only compatibility, and command-vs-observed runtime state. Removed legacy graph synthesis and Canvas-layer runtime conversion.

assess p5 and make the primary architecture a lean shader engine.
Solution: Removed CPU procedural generator implementations from the p5 generator runtime. Procedural sources now use cached shaders/shared framebuffers or specialized raw WebGL renderers; p5 is limited to lifecycle/import helpers, diagnostics, and basic utility sources. Missing shaders log and remain transparent instead of silently switching to CPU rendering.

the x for deleting in lists has to be smaller and all the way to the top right.
Solution: Thumbnail delete affordances are 18 px with a 14 px icon and sit 3 px from the top-right, retaining the delayed hover reveal.

moving the wave up is down and down is up.
Solution: Waves uses the same corrected standalone-generator Composition UV adapter as Eyeball and Gradient.

Morphing thumbnails are sometimes captured while loading.
Solution: Thumbnail capture now asks the renderer whether all nested media and generator analysis dependencies are content-ready. Loading/analysis standby frames are never persisted.

loading media messages are annoying in live output and can flash white through invert when debug is off.
Solution: Standby drawing is diagnostic-policy controlled. With debug off, media, camera, surfaces, and specialized generators clear to transparent alpha instead of rendering black-backed text.
