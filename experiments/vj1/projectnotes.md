# design and programming rules to obay:

- We are making a solid, compact and elegant architecture. we do it in iterations and it is okay to drop features or requests if there is not an elegant way to solve them. we do not want a lot of heavy code with special cases we want an elegant system where there are clear abstractions for nodes and components and where they can be reused. we do not want thousands of lines of codes for custom case and special situations. each iteration should work towards this goal. therefore almost always seek to generalise the concept instead of make special custom tweaks. 
- If there is a bug or an unknown problem we slow down and look for the root of the problem. we do not add hacks and quick fixes in a desperate attempt to solve a problem. we seeks to develop our profiling, testing and insight system to gain better knowledge until we find the problem. 
- We take great care in not changing major design principles or how the user setup work without clear dialogue and confirmation about the choice of strategy.
- the overarching principles for the system is among many thing the following:
-- there is (almost) no width or height resolution settings for the user. The system calculates resolution and buffer sizes based on the need in the output window. instead we work with proportions and scales throughout the system.
-- all elements and system should consistently maintain proportions of media coming in. This means that we newer default to using solutions that stretch media. instead we crop, scale etc.
-- the system helps the user to resize and cache media for them such that it performs well in realtime. 

- it is outmost essential that the render pipeline runs as fast as possible this means:
-- that we seek to design a shader based system with minimal use of p5 etc and seek to create cache bewteen elements that uses cpu to render fonts, curves, images etc. we should clean up whenever we encounter old heavy code. e.g. the sdf render engine should be used before traditional p5 draw commands for things in the render pipeline.
-- we take great care i not introducing elements that causes extra work for the render pipeline for each pixel or each element in a chain
-- we use fast calculations methods for noise, sqr root etc. as much as possible. We are okay with a bit of quality loss for the sake of fast rendering. 
- it is okay to give up and not know or dissagree and prevent bad code or quick fixes. Our gut feeling has a right to be heard if it does not feel like a good solution it is allowed to reflect or drop writing something in an iteration.
- codex.md is not a log book where every detail should be recorded it is a lean document with essential information that should be ongoingly updated or revised based on the corrunt state and progress.
- we do not support legacy features or projects in the general architecture. we migrate projects when they are loaded to the latest architecture.
- we aim for a stable system that can run on the lates webgl 2 hardware with a chrome based browser that supports file loading and usb serial. We do not need fallback to support a wide range of browsers since this is not a general webpage for the web. If we have a fallback code we write a warning if it happens so it does not happen silently.
- similarly all errors, failures etc should give console info. we do not fail silently. we give feedback to the console.
- the following sections in this document functions as follows: You follow the principles in this section. You read through the inbox and suggest something to work on (it can be a group of elements or one larger core problem). Bugs should be prioritised. Suggest a series of elements to work on and i say go. when you have done something you copy the text from the inbox down to the done section and add a note in bold of what you have done. Then you suggest what next to work on to me and we decide the next step. I will regularly add things to the inbox and i expect you to read up on it for each session.
- Authored project state is authoritative. Generated controls, compatibility projections, compiled plans, caches, thumbnails, and runtime resources are derived views and must never overwrite authored values.
- Derived state must be synchronized before first execution—not repaired incidentally by a later edit, movement, or refresh.
- Invalidation must be semantic and narrow. Media readiness invalidates its consumers; movement invalidates placement/composition; parameter edits invalidate their owning nodes. Unrelated edits must not rebuild or repair other elements.
- A cache may publish only a complete valid result. During asynchronous loading or seeking, retain the last valid result instead of replacing it with a placeholder, transparent frame, black frame, or broken thumbnail.
- ROI describes demanded output pixels; it must not redefine a source’s intrinsic coordinate system, aspect ratio, typography layout, mesh framing, or object bounds.
- Graph compilation and traversal stay outside the frame loop. The optimized renderer may use specialized kernels, but nodes and compiled plans define dependencies, transforms, ROI, resources, and invalidation.
- Diagnose performance domains separately: control-DOM rebuilding, compilation, media decoding, CPU rendering, GPU rendering, and presentation cadence are different systems.
- Every root-cause fix should include a failing regression test. Lifecycle bugs should additionally be checked with a clean browser reload.



#Inbox

previously we had a solution in which clicking a new component or scene in live view while a transition was happening would result in it being armed for the next transition can that come back but only if it is a transition involving the current output window. e.g. if another output window is selected it should not wait for the other one.

Open feature: allow individual elements to choose portrait, landscape, or
square frame shapes independently from the parent Component/Scene. This needs a
single semantic frame contract rather than copied dimensions.

it would be nice if seed and time could sync up between live view preview and output window such that the animations were in sync. it causes a bit of confusion sometimes that they are wastly different.

**Design decision remains open.** Preview and Output currently own separate
accumulated presentation clocks, including pause and time-stretch state. True
synchronization needs a shared session timeline and explicit rebase rules; it
should not be approximated by reading wall-clock time in individual nodes.

how close are we to important the isf shader library into the app as base shaders to use for different things? ISF has this repository https://github.com/Vidvox/ISF-Files/tree/master/ISF and I would like to import ideally all of them. Some use a vertex shader i think? and they have different porpuses. i assume the simple shaders is not a problem. but i would also like for the shaders that are e.g. transitions to be imported and used as transitions. i suggest that we create a transition generator that can be inserted in the chain. The concept would be the following: when a isf transition is inserted it be becomes an element that can contain children like a group and maybe two coloumns such that one can create two list underneath it for each transition. I would like for there also to be a mode where it can transition between what come before the isf shader and what is inside its group. either there should be a toggle as a param or a logic based on whether both coloumns has been filled out. Similarly sound should be implimented so it is compatible with isf. I suggest that we create some settings in input sources for sound and that we have a basic fft library to create fft textures (i think isf has this logic right?). be aware that the current version of p5 v2 does not seems to have a strong sound implimentation and i suggest that we bypas p5 and use tone js instead https://tonejs.github.io/ 

relating to the above and in general we need to work with live input like mouse, multitouch and webcam tracking. i suggest that we start to develop a logic where the system has a multitouch input bus attached to both output window and when the preview window in such a way that we can ahve a drawing shader that one can draw on top of live when the system is running. I want it to be in such a way that drawing in live view preview also produces touch signals to the output window. have a look at the portals multitouch code and copy it in or make your own iteration in the system. Further more i would like that settings has a hand tracking setting such that one can start a hand tracker that is converted into touch gestures as if it was a tablet or a touchpad. I would like for the system to use the following modes: 1. Click: use two fingers to "click" and it is detected as a click then movement from there is recorded either relatively or as absolutes. 2. a multi touch mode where all visible fingers are avaliable for finger painting etc. 

In general i would like for the architecture to be relative generic or abstracted around media and shaders. e.g. i would like for there to be a few default shaders for stl files and a few default transitions but then i would like that one can use the media selector to select other shaders to use. e.g. that the bionome shader for terrain can also be used on a stl files and vice versa that a isf shader can be used on a terrain - would it even be possible to use an image (and thus the generator for an image) as a shader for a stl object?. and that besides some basic transition for transition in liveview that one can select other transition shaders to use. I suggest that the media library make sure to have a few categories that defines at least if something is a transition shader needing multiple sources or a more simple shader.

Similarly i wonder if it would be possible to make the architecture so most things are pretty agnostic about input sources e.g. the morphing generators could recieve a component as its input and output source. Maybe this case is not that good because it needs to analyse but it would be good to start aiming for a pretty flexible architecture around this so there are few base input and output sources and thiings are relatively interchangable.

I have a dream that we slowly move towards more complex chains in element list in scenes and components. my idea is that one can have a "group" that consists of nodes that are not neccesarely image nodes but the chain in the group should resolve in an image and possibly take an image in. These chains would then be a series of nodes that fit together. e.g. an stl loader + a mesh modifier + 3d mesh to image buffer output. I am thinking in terms of lego pieces or like littleBits - e.g. compoents conceptually either attract or reject lige poles of a magnet. so different compoentns nodes has a color for input and a color for output and one can then combine when they fit. in those terms we have already made a lot of nodes with the shader buffer input and output and they should then have a color.

Similarly i would like to have a set of webcam tracking elements like hand gesture and bodypose (see the portal modules a do copy code into the vj app). Then i would like to be able to have different lego components that could be added e.g. a component that draws the body or the hand.

I would like to slowly build an animation platform. my thought is that basic animations in our generators and effects like the heartbeat pulse should reside in the shader itself but they should not have default animations like the plasma that moves in a specific way or the terrain flyover. instead they should have a suggested animation mode and then there should be a generic animation node that they can inform how they work and they can then create a setup that can be modified by the user. The animation node should this be a part of each effect or generator group with preconfigured setting and the animation node should be shown as a view in the params list before the general tab. in this animation tab one has a list where one can add configurations based on the params in the element. e.g. one can select the opacity param and the tel the animation module to loop it within a certain timeframe or make it pin-pong and also have a way to choose envelopes and curves to make it more dynamic than simple transitions. In this animation mode one can also choose to set it to trigger mode and then a button show be avaliable and when clicking on it it animates e.g. a opacity ping pong once (or maybe with an option for number of animations). Later on we need to find a way to then connect this trigger button to a "bang"/signal from somewhere else. For this part it would be valuable to go through all the existing effects and generators and port them to this animation principle. Also it is valuable to be able to animate the color param as well such that it can transition between two colors.

I would like for the visibility toggle on an element in component or a scene to actually be a transition toggle. e.g. that pressing it creates a transition from e.g. opacity or a transition slider (it is fine to opacity first but a shader warp from central point to full size later could be interesting). This is to connect it more clearly to live use so that the visibility toggle uses the param transition time like the other params. this is only for live view e.g. not when one generally toggles visibility in scene or component view.


I would like to have a generator where one can select other element or components as a list (it could be a group like interface) and then they will be stacked in 3d such that they look like a parallax game design principle where he view port can shift a bit up, down, right and left to show the effect.

I would like to add an element that can be added to a component or scene chain which is a recording probe. what this probe does is that it records a pixel or a group of pixels like a color picker. one adds it to the chain and place it in the 2d canvas space and then it will record the color values for the area it is on top. the scale handles can be used to define size. The probe should then attach itself to a bus for live params that can be used by other elements. first and foremost by the animation engine that resides in the other nodes and elements. Here e.g. the brightness, the r,g,b or h,s, v (or b) values can the serve as information for the animation engine for another param e.g. opacity or scale. so e.g. if a probe reads 255 in brightness the opacity of the given elements is 100% procent or vice versa. This will create interlinked dynamics where changes in a scene will trigger other elements in the scene. I think we in the beginning needs to limit ourselves to connecting probes and animations within the same scene or component to limit the realtime setup since we else have to handle the edgecase of a probe is on a non active scene and the animation is tied to an active scene.

simmilarly we need to slowly impliment both wled control and dmx. I suggest we look up the most viable websocket based led control protocol for wled and create a settings panel where one can set up at wled ip or usb connection (have a look at the usb portal module and copy it to the vj1 app as a component) and for dmx have a look at the dmx controller experiment and copy dmx / usb serial control code from the portal modules as well - also make a settings panel for this. I suggest that we extend the probe concept so that there is a multiled probe where a ledstring can be placed in the mapper view on the preview output and then the pixels are recorded and transmitted to the wled or dmx. For dmx we need to be able to add fixtures and channels in settings. e.g. create a list of common fixtures "brigthnes.r.g.b" that one can add and define a start channel then this fixture can be placed as a probe in the mapper view.

We need to start to think in terms of shaders that uses a feedback loop for delay etc. e.g. that the shader draws in its a stored shader buffer with fadeout over time such that live movement and video gets a trail effect. this might also be a requirement for some isf shaders.

we are slowly moving towards a generalised react or similar framework for handling html dom and events. however it seems like we still need to tigthen it a bit more. I noticed there were html elements in the output render and i also notice that the state is lost on refresh except for custom handlers and the there is an ongoing balance of what elements to refresh on events. and that design elements are not naturally consistent on lists and params etc. it seems like a systematic redesign is in place. here i would like for an abastraction of the user interface where there are some generalised concepts like list items, thumbnails lists, search function, buttons, toggle, popup etc. and these then are the building blocks for the ui with custom params for different situations. I would like for these building blocks to also be state handlers on refresh of the page and when things change so they can be rebuild consistently with scroll location and which view is selected etc.

we need to have a midi input setup in settings where one can define a toucpad or controller to params in the system. i suggest we start with a set of specific midi controllers and get them to function. this also includes thinking it into the current param workflow.

we need a way to add post effect processing so one can add general effects and maybe also layer elements on top of each other. I suggest we look into resolumen style matrix based setup and think of a way to integrate this into the live view or make another view for it. this relates back to the midi controller where it would be lovely if one could select a series of scenes and have them as toucpad points in a matrix there as well.

we need a global control flow view where one can map out different input sources and match them with params in the system. I suggest a flow view and there one can add input components like webcam gesture, posenet, websocket, mqtt, osc, etc and combine with different parser nodes and also add a piece of code as a middleman then output should be connected to different params and components in the system. e.g. change opasity for this specific component or set this scene in liveview etc.

we need to add a ble pulse sensor as an input source and param for animations have a look at portal and the ble pulse module and import it into the system make a copy of the code.

similar to multitouchlight in the experiments folder i need a shader that can create light points based on touch and move them around.

similar to textprompt in the experiments folder i need this as a generator and we need to write some eps32 code for the version that has usb host such that the esp32 works as a host for a usb keyboard and then the keystrokes are send via serial to the generator that then can generate the visuals. 

i would like a shader that can generate dazzle patters similar to dazzle camouflage: https://www.google.com/search?q=dazzle+camouflage&sca_esv=aafc69412a6fc5ff&udm=2&biw=1416&bih=687&sxsrf=APpeQnuS-LFjxU8_HfOVR_0erCpKJ4ZFcQ%3A1784967442548&ei=EnFkatD6IP6V9u8Pvd6aoAQ

the screen sharing interface in settings should have human id system. e.g. screen 1, screen 2 etc and then one can rename them in settings. on refresh one should be able to then use the already created id for e.g. screen 1 and reconnect it to a screen share. in the screen sharing generator there should be a drop down list where one can select from the list of ids from settings. If a screen id dissapears from settings then the generator should just pick the first active screen in the list and show that.

I would be good to be able to have the option for multiple webcams. e.g. that one can add more than one. they should have human ids webcam 1, 2... and with the possibility to rename. in the webcam input generator one should be able to select one them from the list. if the webcam is not in the list anymore then it should pick the first that is connected. if it is in the list but not active then it should just show a black screen.



#Done

shift refresh - hard refresh - on the vj tab takes forever to reload and sometimes it fails with just a black page or a message about time took too long. also having a live output window open can make it go stuck so it newer goes beyond the black screen (i think that might be one major issue). we need a test for this because it has been a recurring problem. this probably relates to the many many js files it has to laod as well.

**The black startup failure and duplicate native-module identities are
repaired.** Control no longer publishes an empty project while folder restore
is unresolved, startup has an explicit visible/error state, and save-worker
prewarming removes its first-use timeout. The remaining Output crash had a
different race: p5 could finish before either the fixture or Control baseline
arrived, causing Component compilation against `null`. Standalone Output now
waits without a timeout for its first authoritative state; the existing bridge
heartbeat completes the same gate when Control starts later. It does not request
a duplicate state or media snapshot.

The build-free graph also had 416 files but 518 browser module identities:
71 files were imported under conflicting historical `?v=` tags, creating 102
redundant evaluations and splitting module-level registries. Local imports are
now queryless and the source worker revision is the sole graph-wide cache
authority. An architecture test prevents per-import versions from returning.
Source revision 175 loaded and reloaded Control, fixture Output, and bridged
Output while the other window remained active, with full 1280×720 canvases and
zero warnings/errors. The remaining 416-file native graph is a later packaging
optimization, not a reason to alter the renderer or source-coherence contract.

changing params live view and possibly also other places has become laggy in the output window. does the diff based transport still run or has it been replaced with full refresh of project for every change? Are there noise in the background with many workers doing a lot of busywork? I suspect both. Verify both and fix it. this is a recurring problem so do make unit tests for it.

**Transport, duplicate Output activation, and the 411-warning resync loop are
repaired.** Continuous Live scrubs use one revisioned/coalesced patch packet;
committed placement changes cannot send complete project snapshots. Registration
pushes one authoritative state/media baseline, which Output buffers through p5
setup and imports once. Complete media packets remain ownership snapshots, so
the removed duplicate pull no longer reconciles every resource at startup.
Output installs a complete state before any buffered newer patch, discards
patches already included by that state, and rebases a genuinely newer packet
from the accepted revision. Protocol and lifecycle tests cover the ordering,
and clean browser reloads with active Control/Output show no
`VJ1_LIVE_PATCH_RESYNC` or duplicate reconciliation.

**Scaling-control range repaired without changing authored coordinates.**
Boundary and Content X/Y remain stored in the stable parent coordinate space,
while their editor ranges now expand from the visible scaled extent. A 1x
element retains the familiar ±2 controls; larger elements can still traverse
their full visible range without adding a second coordinate convention.
Component, Scene, Group, and Live projections use the same parameter contract.

**Live Canvas placement controls verified.** A Canvas is a Scene root, so it
does not own a fabricated root transform. Its element list exposes the same
Content X, Content Y, and Content scale controls as Component elements, while
ordinary Components mounted in Live expose their own Component placement
controls. Rendered-inspector tests preserve both sides of this ownership rule.

**Placed Component proportions are repaired.** Scene and Canvas placement derive
their geometry from the referenced Component's current aspect instead of
copying the parent allocation or storing a second stale aspect parameter.
Regression tests cover a square Component inside a non-square Scene and an
aspect change after placement.

**Scene Surface calibration interaction repaired.** Surface frames remain
visible in neutral grey, but only the explicitly selected Surface is yellow and
draggable. Selecting a chain element makes every Surface inert without erasing
the remembered Surface selection. Element handles retain pointer priority and
tests cover both interaction modes.

**Missing/loading presentation repaired at the shared standby contract.**
Diagnostics clear to alpha and render a compact image, video, model, or generic
resource icon instead of an opaque checkerboard and sentence. Clean Output
remains diagnostic-free. Text is opt-in and Feature Morph uses it only for
meaningful analysis progress/errors. The real p5/WebGL smoke verifies the
alpha-backed icon and absence of Output diagnostics.

**Broad interaction refresh repaired by structural sharing and scoped
projections.** Parameter edits, visibility, selection, reorder, add/remove, and
rename update only their authored path and derived UI projection; they do not
clone or normalize the complete in-memory project. Compiled programs remain
stable across parameter/visibility patches and only affected retained stages
invalidate. Idle/presentation cost and native-module startup remain separate
performance domains rather than reasons to rebuild the world model.

**First selection-stability iteration complete.** A selected element keeps
pointer ownership while clicks remain inside its authored boundary. Clicking
empty preview space explicitly deselects it; without an owner, ordinary visual
stacking chooses the next item. Selected Groups use the union of their visible
children rather than an invisible full-Component hit area. Alpha-aware picking
for generators remains an optional later feature because it needs a retained
readback/hit-mask contract and should not be approximated with per-click GPU
sampling.

it would be nice if search in thumbnail lists would also search for keywords from the generators e.g. "blur" would show all components with blur effect or if one has an image names heart.png then both png and heart would show it.

**Implemented through one shared catalog-search projection. Component, Scene,
and Live thumbnail filters now index the authored title plus nested visual
names, generator IDs, media IDs, and media filenames. The visible label and
stable identity remain unchanged. Unit coverage proves nested effect and media
matches, and browser verification shows searching for `blur` returning
`Waves Luma Stack` even though its title does not contain the term. The complete
suite passes (1,350/1,350).**

another observation - canv 5 has always been the heaviest to compute because it does a lot of individual renders of the same komponents which it should. but the fps seems noticiably slower now than usual. is something is going on there. normally it would be around 45 fps in output window 25-30.

**Repaired and browser verified. The July 20 and July 25 profiles contain the
same five authored Comp 33 renders and ten shader passes, but the migrated
shader host had coupled two unrelated lifetimes: evicting one of its
size-keyed scratch framebuffer pairs also cleared every program in their
shared WebGL context. Canv 5 therefore recompiled Cellular Circles, Eyeball,
and the shared effects while cycling through its normal regional sizes.
Scratch allocation eviction now retains shared-context programs; explicit
shader invalidation and renderer disposal still clear them. A compile-count
test exercises four target sizes and proves one compilation. In a clean
10-second browser run with Preview and Output active, Canv 5 averaged 46.7 FPS
with zero graph compiles and zero cache invalidations. Its remaining CPU work
is the five intentionally distinct branches; resolution, ROI, shader math,
and branch count are unchanged.**

short looping videos in comp74 sometimes shows video unavaliable in their loops as if the cache reloads them or something. also sometimes there also frames without a video e.g. just alpha which also makes it blink like the black streen. at least keep the last frame while video restarts in a loop.

**Repaired and verified at the decoded-frame lifecycle. Full-length and trimmed
videos use one manual boundary controller that seeks before decoder exhaustion.
The retained last confirmed texture remains authoritative while seeking,
ready-state dips cannot publish an empty revision, and a callback queued before
the seek is rejected unless its media time belongs to the new loop target.
Readiness remains latched through temporary decoder dips. Unit tests cover each
boundary, and a clean Comp 74 browser run kept all four videos present while
the 0.78 s and 1.28 s trims crossed multiple loop restarts.**

video or other asynchronous media must continue rendering without moving another element. movement must never be the signal that makes a ready resource visible.

**Verified at the shared media-revision boundary. Decode completion increments
the exact resource revision, emits `media-ready`, and schedules the retained
presentation independently of pointer or transform activity; asynchronously
loaded persisted renditions do the same through `media-rendition-ready`.
Unit coverage starts with an unavailable image and proves readiness emits the
wakeup. The clean browser contract rendered an initially missing PNG on its
third scheduled frame with the expected pixels and exactly one media-ready
invalidation, without any movement or unrelated edit.**

in mapping view the surfaces for different mappings seems to bleed over so it is in practice only one mapping where surfaces can be mapped others does not have handles in preview - it might be as simple as a preview state that is not tied correctly to the different mappings i am not sure.

**Repaired at retained Mapping ownership. Mapping identity is now semantic
runtime state: switching documents clears the previous document's pending
pointer ownership, rebuilds its Surface handles even when IDs and calibration
JSON happen to match, and applies only the selected Mapping's calibration. A
regression test covers equal IDs/equal calibration across two Mappings. Browser
verification switching between `debug` and `projection` shows their distinct
Surface sets and projections without retained handles bleeding between them.**

refresh reset the live output selection it should keep the current selection this is a bit complicated with the multiple surfaces but ideally the live output state should be consistent on reset including params tweaked in liveview. e.g. a local storage. i think for debugging this we need a live preview reset button i think the best placement to the right of the timing header text. maybe change the timing header to live

**Repaired at the project-scoped Live preference boundary. The selected Live
route and selected Scene now restore atomically from local preferences after a
clean reload, without serializing transient Live overrides into project.json.
Invalid or deleted route IDs normalize to the normal Scene Mapping selection.
State and routing tests cover restoration, and a clean browser reload retained
the selected direct-output row.**

changing draw mode on a stl object does not affect the preview output. it seems like the param is not connected. changing in composition works fine. it seems to be all params for stl render that is not connected this seems odd because i assume this is a generic abstraction. e.g. other elements in liveviews params works fine. the params from stl generator is clearly connection to output window so this is only affected in the preview window of live view

svg elements params does not seems to have an effect in live preview when changed. cut edge and feather does not seem to work for svg.

images: feather and cut edge only seems to work for window output not in the liveview preview. a pattern starts to emerge where most params in live view is not wired out to the preview output. this seems odd since i assume that it is the same wiring for live preiview and widnow out.

**Repaired together at the compiled-compound instance boundary. These were not
three renderer-specific wiring failures: private child configurations were
shared by every instance of a compound Node definition, allowing Preview and
Output compilation order to overwrite the same mutable render parameters.
Every compiled compound now owns an isolated private configuration tree.
Regression coverage proves that editing one Project Media instance cannot
change another. Clean browser checks confirm retained 3D draw mode, image fit,
and image cut-edge update the embedded Live Preview immediately; SVG uses the
same Project Media compound path.**

verify that we have not introduced a large overhead of constant recompile of node structures or merging of models everytime some changes or a new frame is rendered. I would like for some how to have a visuel marker that counts some event and data flow e.g. per frame or something so i can also keep an eye on it. e.g. it could be another circel with the other circel and a part of the general profiler. it is important to catch signalling regressions that result in complex rerenders and cache updates. I do not know exactly what to measure but an arbitrary summary of certain key point in the system so at least it is noticed when it goes off the roof randomly or can detect patterns like mouse movement over at preview results in rerendering of massive amount of elements.

**Implemented and browser verified.** A fourth top-bar health circle and the
Performance panel now report a rolling one-second Signal load across authored
transactions, render invalidations/wakeups, graph recompiles, resource
revisions, cache invalidations, cache hits, and Preview/Output presentations.
The counter is instrumented at the shared state, compiler, resource, cache, and
presentation boundaries rather than in individual controls. Expected throughput
such as successful cache hits and ordinary presentation frames remains visible
but does not increase pressure; this makes unexpected coordination churn stand
out without treating video or a 60 fps Output as an authored edit. Ten-second
analysis and its downloaded report include category averages, peak pressure,
and the exact causes of compile/invalidation pressure. Intermediate scrub
samples remain visible as redraw/wakeup activity but one completed drag counts
as one authored transaction, matching undo and persistence semantics.
Browser verification showed an active 60 fps Output producing roughly 649 cache
hits and 59 presentations per second while transactions, recompiles, wakeups,
resource revisions, and cache invalidations remained zero. Source coherence
revision 167 and the complete 1,340-test suite cover the implementation.
When a retained Component has no new work, the Performance panel now clears its
previous hotspot rows and reports that it is waiting for an active renderer
sample. A disabled compiled Group is skipped before value evaluation and before
any child source renderer; focused coverage explicitly proves that a disabled
3D compound cannot execute Scene-to-Image work.

The 10-second image-drag profile
`2026-07-25T23-30-30-813Z-mappertest.profile.json` confirms that movement itself
is narrow: 384 pointer samples caused only two control-UI renders, no long
tasks, 3.1 ms p95 event-loop lag, and no broad cache invalidation. Preview
rendering averaged 58.6 fps, 1.8 ms CPU, and 1.43 ms GPU. The original report
incorrectly classified every scrub sample as an authored transaction; that
diagnostic boundary is now corrected. A fresh profile will identify the cause
of any remaining compile through its recorded reason instead of requiring a
guess.

there is a strange bug in which fit for images is affected by whether there is another image on top of them (next in the chain). then they resort to fit and does do cover or stretch.does not seem to happen with an effect but there may be other things like generators which does the same.

**Repaired at the compiled-compound ownership boundary. Private child
configurations in a visual Group were being reused directly from the immutable
Node definition, so every instance of the same compound shared its mutable
render parameters; the later Project Media instance therefore overwrote the
earlier instance's fit. Compilation now creates an instance-owned configuration
tree for every compound. A regression test proves two instances retain
different fit values and that updating one cannot mutate the other. Browser
verification shows stretch and contain operating simultaneously in the same
Component, and the focused compiler/render suites pass (271/271).**

we need to look a possible optimization at least there should be some kind of loading bar that shows a progress or something and it should not timeout.

**Implemented the fail-visible part without claiming the larger optimization.
The initial document now owns an indeterminate progress bar and reports source
revision, module loading, node-library, application-service, and project-restore
stages. Startup promise failures are rendered and logged instead of becoming an
empty page. Save work still has a correctness timeout and local fallback so a
dead Worker cannot hold every later transaction; prewarming removes its normal
cold-start cost. Native-module packaging remains a separate open task above.**

live output window does not seem to like showing feature morph it newer transitions to it. this may have something to do with the need to load the library etc. feature morph has a tendency to reanalyse images at different scales which i dont think it needs to. also feature morph two has this problem. it however seems to be a bug because when one transitions away from a scene with feature morph then it does the transition with it. so a flag that says that it is loaded is newer set. that is the first problem.

**Regression repaired at the prepared-program readiness boundary. An incoming Live scene can now evaluate its pure retained-value graph before its first render, construct the exact Feature Morph analysis request, and start that retained request while the transition waits. Readiness polling observes the same request and cannot restart it. Analysis identity remains based on image fingerprints, analysis parameters, provider code, and algorithm revision—not Preview or Output dimensions—so scale changes do not trigger reanalysis. Morph and Morph V2 share this capability path. Focused first-render tests and the complete suite pass (1,320/1,320); a clean Live browser transition remains the final visual confirmation.**

moving a image partly outside its components boundary make the image scale to roi instead of to its own bounds. still.

svg images has the same problem of using roi as its boundary instead of using the image. please make a test for this case.

an image uses its roi to place the image instead of its own boundary box which means that it scales when its boundary is moved outside its parents boundary.

**Repaired at the shared ROI request boundary. A node-local ROI now has its own `nodeRegionView` contract and is deliberately distinct from `regionView`, which is reserved for a parent requesting a regional render of an entire Component. The optimized direct-media placement path declines node-local regional allocations, so cropped raster images, SVGs, and videos use the existing retained render-view path: fit and layout remain relative to the full authored element boundary while allocation remains limited to visible pixels. Full-frame media still uses direct placement. This separation also preserves authored boundary placement for shaders, 3D nodes, and compiled Groups; using the Component-level flag for nodes briefly detached all content from its yellow boundary and was removed. Cross-type boundary tests and the complete suite pass (1,319/1,319). Live visual verification of the corrected follow-up remains pending because browser control was unavailable.**

terrain is weirdly tied to the frame it is below the boundary instead of being in the boundary

**Repaired by the same shared node-ROI/Component-region separation above. Terrain Flyover has no private boundary-placement authority: its retained Surface/Wire kernels render the requested node view and the shared compositor places that view in the authored yellow boundary. Terrain is now an explicit case in the cross-source boundary regression alongside raster, SVG, shader, and model sources.**

there used to be a graceperiod before thumbnails updated such that clicking on a scene did not cause a flickr as soon a the scene was loaded. i suggest making a graceperiod and also verify that we are not generating thumbnails every frame etc. also it would be nice if there were a transition to camoufalge the flicker

**The retained thumbnail runtime now owns this as event-driven background work: invalidations coalesce by semantic Component/Surface signature, wait 240 ms after the latest change, run through `requestIdleCallback`, and space captures rather than capturing per presentation frame. Unready media/AI renders keep the last valid thumbnail and retry later. The suggested cosmetic thumbnail transition is a separate feature and is intentionally not part of this regression pass.**

stl generator multiple obs: it seems like the edge budget and point budget depends on which types of rendering one uses. they only seems to affect the 3 outline modes. stl loader had a brilliant parser that optimized the amount of vertizes have we lost it or is it still doing its job.
stl generator cpu load is high which could point to that we have regressed to the old p5 based render or the stl optimizer is not used for surfaces or we are using the old one. canv 15 seems significantly slower that it used to be.

**Repaired and clarified at the shared retained mesh-LOD boundary. STL/OBJ loading still uses the compact parser, worker-side meshoptimizer QEM simplification, derived progressive-LOD cache, and direct retained Scene-to-Image renderer; static meshes do not rebuild or render from p5 each frame. Surface and Outline now select the same topology through one logarithmic Geometry detail control. Its useful range is 6,000–80,000 triangles with a midpoint near 22,000, avoiding both unusably coarse outlines and needlessly dense filled surfaces. Edge and point budgets intentionally affect only their respective drawing modes and never choose the mesh LOD. Focused topology/runtime tests and the complete suite pass (1,318/1,318); a clean browser load exposes one Geometry detail control under one coherent module revision.**




stl file only rotates when the element is moved within the component and moving the component makes does not make the stl follow the frame. output window and preview the stl is froozen.

**Repaired at the retained typed-value and raw mesh transform boundaries. Animated 3D values now invalidate their exact Scene-to-Image consumer, so STL rotation no longer waits for an unrelated element move. Authored Content Y is converted once into the raw mesh matrix with the same screen-space sign, so moving up no longer renders down. An attempted framebuffer-orientation layer caused repeated retained transforms and was removed completely; STL import basis and the optimized retained renderer remain intact. A regression test proves repeated frames derive byte-identical matrices, and the complete suite passes (1,313/1,313).**

the render pipeline seems to be significantly broken. transitions stutters and output breaks. my guess is redundant rendering and or redundant cache loading. just preview seems fine but when window output is there as well it stutters and fps goes up and down. if anything appears sometimes it is just black screen. this may also be a consequence of me opening anonther vj window - can both tabs somehow catch the same window and thus creating a fight between two vj controller tryong to control one window. in that case we need to create some ownership between output window and a tab or make some check that causes and error if two tabs are trying to control the same output window.

OBS: I have spend an insane amount of time getting the visibility routing in the output matrix right. please dont loose this is the process. i think the latest commit has the right logic. In short: if scene mapping is enabled and an active element is mounted to scene mapping in liveview then scene mapping maps according to its frames to the surfaces that are avaliable. If there are mounted elements directly to individual output surfaces then they win over scene mapping. Toggling visibility of scene mapping either in mapping view or live view off does not disable the outpur surfaces they can still be active as output elements for direct mounting. The preview in live view when clicked on scene mapping should show the mounted scene. the preview in live view when clicked on one of the output should show the outputscreens similar to mapping view. I think this describes it. but do verify in previous sources and make sure to make test that tjecks this so it is not lost in migrations. if an element is directly mounted to any of the output an x should appear and clicking the x should remove the mounting. It is only scene mapping that used the scene preview with the flat 2d frames in yellow. The others should use the projected preview with yellow marker on the current output.when a surface is selected you mount either a composition or a scene directly to the surface . when scene mapping is selected and it is a scene where the frames are used to indirectly map the scene to the surfaces IF they do not already have a scene.when it is a composition with another proportion. compositions should be conceptually temporarely be embedded in a temporary scene with cover. when mounting to scene mapping if it is a composition with another proportion then the compositions should be conceptually temporarely (not litterally) be embedded in a temporary (not litterally) scene with cover mode.disabling scene mapping should remove the indirect mapping to other surfaces. 



Done: terrain flyover upside-down regression. The renderer now treats render-target
orientation as a shared contract at both shader-sampling and image-presentation
boundaries. Terrain remains on the retained optimized framebuffer path; no
Terrain-specific flip or fallback was added.


in preview the direct and surface preview should show the output of the output windows not the scene. they now show the scene preview. preview is a complete mess.

the yellow frames on scene mapping in preview should should the output that are enabled in preview. also there is one yellow frame but it does not seem to match the frames in scene view.

**Regression repaired at the retained Live Preview presentation boundary. Scene Mapping remains the sole flat source monitor and receives Scene-space guides from the compiled output routes. Direct-output and Surface rows now present the real compiled output matrix through the same projected view and frame overlay used by Mapping, with the selected destination marked yellow. Selection resets only the retained canvas viewport; it does not replace the canvas, mutate authored routes, add a render target, or alter the optimized output path. State, renderer, architecture, and UI contract tests pass; the complete suite passes (1,302/1,302), and a clean fixture browser check confirms the distinct row selection and yellow destination overlay.**

when trying to do liveview with heart stl: `VJ1_COMPONENT_PROGRAM_MISSING`

**Regression repaired at the reused-Preview compiler boundary. The embedded Preview keeps one renderer while switching Component, Mapping, and Live modes, but its Component-program runtime had captured only the construction-time mode. Root reachability therefore remained Component-only after entering Live and omitted routed components such as the heart STL. The runtime now reads the renderer's current mode whenever it computes and compiles roots. A failing mode-switch regression test proves the routed Live component is compiled; the focused test passes and a clean browser mode switch no longer produced the missing-program crash.**

something is still wrong with content scale for stl renders: it can scale without updating the demanded render resolution, so the model becomes blurry. moving or scaling the frame must update only the correct transform and render demand, not incidentally repair or alter unrelated state.

**Regression repaired in the shared compiled-Group source-detail contract. Content scale now raises semantic mesh LOD/detail demand while retained target allocation remains bounded to the requested ROI/output pixels. The optimized retained Scene-to-Image path is unchanged: no STL-specific renderer, extra framebuffer, or broad invalidation was added. Unit and runtime integration tests prove the separated allocation/detail contracts; the complete suite passes (1,300/1,300), `git diff --check` is clean, and a clean browser reload activates one coherent module revision.**

we get a lot of `VJ1_CONTROL_UI_LONG_RENDER` warnings, almost every click, with `cause` and `topic` equal to `component-thumbnail` and Preview as the dominant phase.

**Regression repaired at the derived-state projection boundary. Folder-restored thumbnail batches already carried a narrow `component-thumbnails` projection, but thumbnails generated by Preview published only the generic `component-thumbnail` reason. Those runtime events therefore missed the DOM patch path and rebuilt the complete shell and Preview. All thumbnail publishers now emit the same exact component/surface/url projection, so the existing owned thumbnail element is replaced without project serialization, shell reconstruction, or renderer-state replacement. A failing state-contract test now covers runtime publication; focused thumbnail/control tests and the complete suite pass (1,292/1,292), and source revision 141 boots cleanly.**

stl loader cpu load is high.

**Regression repaired at the retained-value invalidation boundary. Static Model Media graphs were incorrectly classified as continuously frame-dependent because both the animated transform and demand-sensitive LOD nodes used frame triggers. Animated transforms now own presentation cadence only while an authored spin is nonzero; LOD selection still follows render demand but does not turn wall-clock time into a dependency. The optimized retained 3D renderer, ROI projection, parser, and QEM LOD path remain unchanged. Focused ROI/topology/LOD tests and the complete suite pass (1,292/1,292), and a clean local browser startup succeeds.**

the spacing between header and param is still not consistent. slider header+slider is the correct. color param+header is wrong

**Audited without a speculative visual change. Slider, color, and ordinary field labels already use the same zero-gap label/control token and full-width next-row control contract. Focused coverage now protects that shared spacing.**

the group insert in live view does not match other group inserts make it the same param.

**Component and Live compound controls now use one shared parameter-group template and one spacing/title style instead of parallel wrappers.**

height of these two list seems higher than in the other list verify and make sure that list item height is one param accross the board.

**Text-list row and internal-control heights now come from one root token pair. The competing 42px and 34px row definitions were removed; current compact lists retain their intended 34px density.**

in live view control / element view btns are bigger that the normal view buttons in similar sections.

**Live Controls/Elements and Scenes/Parts selectors now use the same compact 24px inspector-view option primitive as Primary/Details/General tabs. Focused UI coverage and the complete suite pass (1,291/1,291).**

changes to a component a prodably also a scene is not saved on refresh

**Regression repaired and verified against the real `mappertest` folder. Three storage boundaries were failing together: migrated state was incorrectly marked as already persisted, a silent save-preparation Worker could hold the serialized write queue forever, and a failed immutable snapshot remained at the queue head and prevented every later valid edit. Migrated state now stays dirty until its write closes; Worker requests have a bounded fallback to the same local preparation contract; obsolete failed snapshots are reported and discarded so a newer authoritative snapshot can save. Output recovery is explicitly read-only until local folder access exists. A visibility edit changed the real file's timestamp, checksum, graph configuration, and survived a clean browser reload.**

undo does not work nothing happens and redo is not activiated

**Regression repaired at the project-history transaction boundary and verified against the real `mappertest` folder. During diagnosis, the old restore primitive exposed its destructive failure mode and truncated `project.json`; the file was recovered from the validated original revision before further testing. Undo/redo now validate revision JSON before touching the target, retain existing file data until an explicit positioned write is committed, truncate to the exact UTF-8 byte length, reread and verify the persisted document, reload it successfully, and only then consume the source revision. Invalid revisions fail without changing the project or deleting recovery history. The real sequence save → reload → undo → redo → final undo produced valid version-37 files at every step and left the original element enabled; the final reload remained clean. Complete suite: 1,299/1,299.**

moving an alement should not rebuild everything the elements should be quite confident that they are the same maybe except for the element move. => Therefore, movement making media appear is evidence of an architectural fault: movement currently invalidates a broader layer that incidentally repairs a missed media-resource invalidation. The solution is not to reproduce that broad rebuild when media becomes ready. It is to connect media revision to its consumer stage while keeping transform invalidation narrowly scoped.

video only playes when i move the object as similar to the other problems with image loading.

**Verified through the shared resource-revision contract rather than a movement workaround. Media readiness and decoded-frame revisions are inputs to the owning source node and retained Component signature, while placement remains a separate transform invalidation. A clean browser image decode repaints without movement; sustained independent-video, loop, retained-frame, resize, transition, and context-recovery tests pass without missing or black frames. No additional runtime code was added in this audit.**

do not refresh a thumbnail when an image etc is not loaded. just keep the old thumbnail.

**Verified in the retained thumbnail runtime. An unavailable or pending Component is retried without publishing; the previous valid thumbnail remains authoritative until a complete ready render is captured.**

feature morph generator now elicit a similar problem in which nothing is shown until i move the element with the mouse then it renders fine. no loading of media information though. same with v2

**Regression repaired and live-confirmed. Freshly generated Component topology could retain a generic source compiler hook even after the compound definition was available, leaving Morph opaque and hiding its image-analysis readiness from the retained graph. Component compilation now refreshes render-node hooks from resolved definitions, so Morph and Morph V2 compile as their actual image-resource → analysis → renderer Groups. Asynchronous capability requirements and revisions are projected to the exact retained render consumers and propagate through enclosing Component/Scene signatures; no Morph-name dispatch or per-frame redraw was added. Exposing the real graphs also revealed and repaired retained video ownership for compiled Groups and conditional frame invalidation for static Anatomy motion. The user confirmed Morph now looks correct, and the complete suite passes (1,281/1,281).**

when loading media the placeholder checker pattern and text is not aligned on top of the element it is offset in a weird way. also make sure that it does not show up on output window when debug is disabled such that it does not show up whenever there is live rendering going on.

**Regression repaired at the shared diagnostic boundary. Standby rendering now owns a target-local identity transform, so checker and text diagnostics cannot inherit source, content, or ROI transforms. Clean Output rendering is always transparent while Preview retains diagnostics. This does not add a render pass or alter the optimized visual path. Failing contract tests and a real p5/WebGL shared-framebuffer smoke test pass; complete suite: 1,289/1,289.**

i can see that you have defaulted media loading to stretch. this is the most deadly sin for me. the core philosophy for this system is that you cannot or at least it takes a lot of effter to destry proportions of media. this needs to be scrubbed and fixed. also fix my mapptertest project which i assume is now infected with it. media should be loaded as contain.

**Regression repaired at the authored contract and migration boundary. Project Media's manifest accidentally materialized `stretch` even though the reusable media renderer already defined `contain` as its native-aspect default. New Project Media elements now default to `contain`. Project schema v37 migrates existing `mediaImage` values from `stretch` to `contain` in compatibility chains, graph-authoritative render nodes, generated Fit controls, nested Groups, and retained Live snapshots; explicit `cover`, 3D model settings, and unrelated controls remain unchanged. The browser source revision was advanced through load/save/catalog paths so the correction does not rely on Shift-refresh. Complete suite: 1,283/1,283.**

When searching / filtering and selecting an element the search dissappears instead of staying.

**Regression repaired in the shared DOM projection boundary. Opt-in ephemeral controls now carry stable view-state keys whose values survive surrounding template replacement without entering authored project state or overriding parameter inputs. Component, Scene, Mapping, and Live catalog filters use scoped keys, and restored queries are reapplied immediately to their cards. Browser verification covers selection and workspace reconstruction.**


undo does not give a consistent result. undo should only capture user changes such that pressing it results in an undo of the user action. after 3 to 6 clicks on undo the undo happened but then the selected component was reset such that the view i was in was lost. also this error appeared: portal.js?v=adaptive-component-demand-29:407 ## https://learn.hobye.dk/portal v:1.172
portal.js?v=adaptive-component-demand-29:408 http://127.0.0.1:8082/P1/
[Violation] 'pointerup' handler took <N>ms
[Violation] 'pointerup' handler took <N>ms
[Violation] 'pointerup' handler took <N>ms
[Violation] 'pointerup' handler took <N>ms
[Violation] 'pointerup' handler took <N>ms
index.js:37 [VJ1_AUTOSAVE_WORKER_UNAVAILABLE] {fallback: 'prepare project saves on the main thread', message: 'VJ1_PROJECT_SAVE_PREPARATION_TIMEOUT:5000'}
vj1DiagnosticConsole @ index.js:37
wrapped @ portal.js?v=adaptive-component-demand-29:56
defaultFallbackWarning @ project-save-preparation.js?v=autosave-worker-timeout-1:153
reportFallback @ project-save-preparation.js?v=autosave-worker-timeout-1:55
retireWorker @ project-save-preparation.js?v=autosave-worker-timeout-1:69
(anonymous) @ project-save-preparation.js?v=autosave-worker-timeout-1:116
setTimeout
(anonymous) @ project-save-preparation.js?v=autosave-worker-timeout-1:114
request @ project-save-preparation.js?v=autosave-worker-timeout-1:113
prepareState @ project-save-preparation.js?v=autosave-worker-timeout-1:136
flushAutoSave @ project-folder-service.js?v=project-history-transaction-1:728
(anonymous) @ project-folder-service.js?v=project-history-transaction-1:707
setTimeout
scheduleAutoSave @ project-folder-service.js?v=project-history-transaction-1:705
(anonymous) @ app.js?v=live-output-projection-1:138
emit @ index.js?v=compiler-template-authority-1:198
(anonymous) @ app.js?v=live-output-projection-1:198
publish @ index.js:19
emit @ app-state.js?v=live-output-projection-1:43
replace @ app-state.js?v=live-output-projection-1:61
update @ app-state.js?v=live-output-projection-1:78
commitChainBoundary @ embedded-preview-app.js?v=live-output-projection-1:901
updateChainBoundary @ embedded-preview-app.js?v=live-output-projection-1:889
mouseReleased @ component-preview-interaction.js?v=output-resource-runtime-capability-1:259
mouseReleased @ output-renderer.js?v=live-output-projection-1:304
finishPointer @ embedded-preview-app.js?v=live-output-projection-1:381
project-save-preparation.js?v=autosave-worker-timeout-1:114 [Violation] 'setTimeout' handler took 92ms
project-save-preparation.js?v=autosave-worker-timeout-1:114 [Violation] 'setTimeout' handler took 51ms
p5.js:17642 Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently
loadPixels @ p5.js:17642
textMaskImage @ text-render-runtime.js?v=visual-stage-authority-1:242
draw @ text-render-runtime.js?v=visual-stage-authority-1:144
(anonymous) @ specialized-source-runtime.js?v=standby-local-diagnostic-1:121
execute @ native-renderer-registry.js:32
drawCompiledNativeSource @ source-render-runtime.js?v=standby-local-diagnostic-1:1864
drawGeneratorSource @ source-render-runtime.js?v=standby-local-diagnostic-1:1735
drawSourceToGraphics @ source-render-runtime.js?v=standby-local-diagnostic-1:1608
safeDrawSourceToGraphics @ source-render-runtime.js?v=standby-local-diagnostic-1:1560
runtime.evaluate.frame @ source-render-runtime.js?v=standby-local-diagnostic-1:1021
evaluate @ render-node-contract.js:160
renderItemState @ source-render-runtime.js?v=standby-local-diagnostic-1:1013
(anonymous) @ visual-plan-runtime.js?v=source-detail-value-1:603
measure @ output-render-profile.js?v=profiling-capability-1:20
measureOperation @ source-render-runtime.js?v=standby-local-diagnostic-1:268
renderOperations @ visual-plan-runtime.js?v=source-detail-value-1:598
renderOperations @ visual-plan-runtime.js?v=source-detail-value-1:855
execute @ visual-plan-runtime.js?v=source-detail-value-1:128
execute @ component-program-compiler.js?v=compiled-capability-revision-1:341
executeCompiled @ component-render-runtime.js?v=compiled-capability-revision-1:193
(anonymous) @ component-render-runtime.js?v=compiled-capability-revision-1:153
measureComponent @ output-render-profile.js?v=profiling-capability-1:30
renderResolved @ component-render-runtime.js?v=compiled-capability-revision-1:152
(anonymous) @ component-render-runtime.js?v=compiled-capability-revision-1:70
withResolutionTrace @ component-render-runtime.js?v=compiled-capability-revision-1:216
render @ component-render-runtime.js?v=compiled-capability-revision-1:69
renderComponents @ output-presentation-runtime.js?v=live-output-projection-1:276
drawFrame @ output-presentation-runtime.js?v=live-output-projection-1:62
draw @ output-presentation-runtime.js?v=live-output-projection-1:40
draw @ output-renderer.js?v=live-output-projection-1:289
draw @ embedded-preview-app.js?v=live-output-projection-1:285
(anonymous) @ portal.js?v=adaptive-component-demand-29:424

**The undo/view-loss portion is repaired at the transaction boundary.** All
`select-*` changes are non-history editor projections, Mapping selection
explicitly publishes UI scope, and undo/redo preserves the current editor UI
while restoring authored project state. The save-preparation Worker is now
prewarmed during startup and has a bounded main-thread fallback; it no longer
holds the serialized save queue while its module graph starts. End-to-end tests
cover one authored transaction, stable editor selection, Worker readiness, and
fallback completion.

**Surface visibility is a scoped route transaction.** Mapping changes clone and
stamp only the selected Mapping and Surface, emit one `surfaces` render patch,
and retain the rest of the authored world. Live visibility is a separate
runtime projection and sends only the derived Surface route patch to Output—no
project snapshot. The control UI updates only the projection rail and retained
Preview projection. Tests preserve both the narrow transport and the
independence of Scene Mapping versus direct Surface visibility.


moving an element should not rebuild the complete Component or Scene. Media/resource readiness must invalidate its exact consumer independently; movement making an element appear is evidence that the narrower invalidation is still missing.

**The movement/commit regression is repaired at the retained-patch scheduler
boundary.** Preview already applied each placement patch correctly, but the
control scheduler discarded its `previewPatched` context when a DOM update was
deferred until pointer release. The final value-identical commit then replaced
the complete Preview state and rebuilt Component and Mapping programs. Deferred
renders now retain their activation context, and an accepted retained patch
remains authoritative through the final commit. One placement commit is locked
to one patch packet and zero project snapshots. Source revision 167 passed all
1,340 tests; repeated browser dragging then settled at zero graph compiles and
zero cache invalidations, with only ordinary Preview presentations and cache
hits. Media/resource readiness remains independently responsible for waking its
exact consumer; movement is not a readiness signal.
