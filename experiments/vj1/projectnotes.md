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

Open feature: allow individual elements to choose portrait, landscape, or
square frame shapes independently from the parent Component/Scene. This needs a
single semantic frame contract rather than copied dimensions.

how close are we to important the isf shader library into the app as base shaders to use for different things? ISF has this repository https://github.com/Vidvox/ISF-Files/tree/master/ISF and I would like to import ideally all of them. Some use a vertex shader i think? and they have different porpuses. i assume the simple shaders is not a problem. but i would also like for the shaders that are e.g. transitions to be imported and used as transitions. i suggest that we create a transition generator that can be inserted in the chain. The concept would be the following: when a isf transition is inserted it be becomes an element that can contain children like a group and maybe two coloumns such that one can create two list underneath it for each transition. I would like for there also to be a mode where it can transition between what come before the isf shader and what is inside its group. either there should be a toggle as a param or a logic based on whether both coloumns has been filled out. Similarly sound should be implimented so it is compatible with isf. I suggest that we create some settings in input sources for sound and that we have a basic fft library to create fft textures (i think isf has this logic right?). be aware that the current version of p5 v2 does not seems to have a strong sound implimentation and i suggest that we bypas p5 and use tone js instead https://tonejs.github.io/ 

**The application now carries 307 pinned ISF files (49 generators, 202
effects, and 56 transitions), including 38 shaders with paired custom vertex
stages. Every repository shader conforms
to the VJ1-owned `vj1-isf-webgl2@1` profile and compiles on the dedicated
WebGL2 path; the ordinary non-ISF renderer remains unchanged. The collection includes
persistent, float-target, and multipass examples backed by the shared runtime.
Dilate and Erode form a focused full-size, two-pass comparison set for the
non-persistent multipass path used by Ghosting. FFT Color Lines, FFT Filled
Waveform, and Waveform Displace prove shared native Web Audio waveform/FFT
textures without a second analyser. Shockwave Pulse and FFT Spectrogram prove
one-frame ISF event inputs through the existing transient event scheduler;
events are never saved as persistent booleans. Event parameters also expose
typed Animation tracks backed by the existing manual, periodic, random,
pointer, audio-beat, and Probe trigger graph. Cursor and Cursor Overlay prove
safe `IMPORTED` image resolution through a shared lazy retained texture cache;
both use one exact pinned upstream PNG and static shaders rerender only when
that resource becomes ready. ISF effects and generators may persist explicit
media, generator, or Component sources for additional named image inlets. The
compiler lowers those choices into ordinary hidden source nodes and named
texture-DAG edges; the automatic preceding effect image remains `inputImage`.
A repeatable inventory and importer select the 258 upstream shaders compatible
with the current profile and confirmed by the whole-catalog Chrome WebGL2
compile smoke. The importer canonicalizes legacy output, texture, coordinate,
and reserved-function syntax before files enter the repository; runtime node
creation rejects unprofiled sources rather than carrying legacy branches.
Same-stem `.vs` files are canonicalized offline, paired with their fragment
stage by the repository, project-folder, and package loaders, and compiled once
through the retained WebGL2 program cache. Two Live transitions needing a third
Surface-renderer image and unbundled imported resources remain intentionally
excluded rather than appearing as broken catalog items; 17 files are withheld
for WebGL2 profile compile failures. The repository rules and repeatable checks
are documented in `visual-library/ISF-WEBGL2-PROFILE.md`.**

relating to the above and in general we need to work with live input like mouse, multitouch and webcam tracking. i suggest that we start to develop a logic where the system has a multitouch input bus attached to both output window and when the preview window in such a way that we can ahve a drawing shader that one can draw on top of live when the system is running. I want it to be in such a way that drawing in live view preview also produces touch signals to the output window. have a look at the portals multitouch code and copy it in or make your own iteration in the system. Further more i would like that settings has a hand tracking setting such that one can start a hand tracker that is converted into touch gestures as if it was a tablet or a touchpad. I would like for the system to use the following modes: 1. Click: use two fingers to "click" and it is detected as a click then movement from there is recorded either relatively or as absolutes. 2. a multi touch mode where all visible fingers are avaliable for finger painting etc. 

In general i would like for the architecture to be relative generic or abstracted around media and shaders. e.g. i would like for there to be a few default shaders for stl files and a few default transitions but then i would like that one can use the media selector to select other shaders to use. e.g. that the bionome shader for terrain can also be used on a stl files and vice versa that a isf shader can be used on a terrain - would it even be possible to use an image (and thus the generator for an image) as a shader for a stl object?. and that besides some basic transition for transition in liveview that one can select other transition shaders to use. I suggest that the media library make sure to have a few categories that defines at least if something is a transition shader needing multiple sources or a more simple shader.

Similarly i wonder if it would be possible to make the architecture so most things are pretty agnostic about input sources e.g. the morphing generators could recieve a component as its input and output source. Maybe this case is not that good because it needs to analyse but it would be good to start aiming for a pretty flexible architecture around this so there are few base input and output sources and thiings are relatively interchangable.

I have a dream that we slowly move towards more complex chains in element list in scenes and components. my idea is that one can have a "group" that consists of nodes that are not neccesarely image nodes but the chain in the group should resolve in an image and possibly take an image in. These chains would then be a series of nodes that fit together. e.g. an stl loader + a mesh modifier + 3d mesh to image buffer output. I am thinking in terms of lego pieces or like littleBits - e.g. compoents conceptually either attract or reject lige poles of a magnet. so different compoentns nodes has a color for input and a color for output and one can then combine when they fit. in those terms we have already made a lot of nodes with the shader buffer input and output and they should then have a color.

Similarly i would like to have a set of webcam tracking elements like hand gesture and bodypose (see the portal modules a do copy code into the vj app). Then i would like to be able to have different lego components that could be added e.g. a component that draws the body or the hand.


I would like for the visibility toggle on an element in component or a scene to actually be a transition toggle. e.g. that pressing it creates a transition from e.g. opacity or a transition slider (it is fine to opacity first but a shader warp from central point to full size later could be interesting). This is to connect it more clearly to live use so that the visibility toggle uses the param transition time like the other params. this is only for live view e.g. not when one generally toggles visibility in scene or component view.


I would like to have a generator where one can select other element or components as a list (it could be a group like interface) and then they will be stacked in 3d such that they look like a parallax game design principle where he view port can shift a bit up, down, right and left to show the effect.


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

it would be interesting to have a global definition of sun position and brightness and color in the system. such that all generators and effects using light position would use that param and the coordinated. 

i want to be able to have a remote control interface where i can use a tablet as interface for live view. it needs the following. communication should be based on peer js. and there should be a qr code in settings with an url underneat going to that url should show a live view version without the rest and where the params are transported over webrtc. it is important that it is just a boiled down version without a full copy of the whole project and media files. so the remote should show the same as liveview a thumbnail list and params etc. the live view should just send change information back to the master and changes on the master should also be updated on the remote view. the key to use to connect the two so be a randomly and long generated key that can be changed in settings. make sure that it is possible to have multiple remotes connecting at the same time.

we need to add a dynamic way to adjust cpu and gpu load whenever fps drops. i suggest that we do two things. go through the render quality param for effects and elements. it should ideally work as a slider for amount of repetition or amount of elements. amounts of steps etc not as a simple resolution slider. this should only be in the cases where there is not a natural place to adjust load. then i suggest we define pixel density and fps in settings as targets. and then impliment some kind of generic algorithm which adjust pixel density and render quality and the individual pixel density on the different elements as live params such that the fps target is meet. here is it also relevant to look at the max texture size since that one can quickly become heavy. The idea is that there is som pid or running avg like profiler that looks at the live profiler and adjusts according. next to fps in the topbar and the output there should be some meter that indicates how much is adjusted in the given situation. aim is to prioritise render quality over fps stutter when doing live sessions and making sure that it recalibrates back to target quality whenever the load is less. e.g. that one can add a heavy shader and the quality of that shader is lowered instead of the fps dropping or stutter appears. this should be a setting which is on by default such that it can be disabled whenever development or debugging is needed where behind the scenes adjustments can hide cpu overhead etc that needs to be fixed. also this scheduler should prioritise the output window vs that preview render if both are running by lowering the fps for the previev window. e.g. the preview can run 10fps if this adds processing space for the output window. it is important that this does not change the actual project settings but just adjusts the live params on the fly.

in the output window it when debug is on it shows all the components and elements and their render sizes. i would like that list to be a part of the profiling popup one for the current preview and one for the output window. just make the profiling popup a scrollable list so i can scroll down and see it. remove it from the output window the it has been added to the profiler popup.

When changing projection mappings and debug is on i want the boundary and the corners shown in the out window such that it is simplere to map and see where the corners goes to. 

there seems to be a difference in how to grab elements between components and scenes. when clicking in a scene it seems to catch the principle of selecting via alpha channel it does not seem to work with components view. here it often selects the top one and often an effect instead of a visible object. 

We need to review the difference between components and scenes. They should foundamentally be the same except the following: surface frame as mapped in scene view and scenes cannot be added to components. We have earlier had the rule that components cannot be added to components however i think that should be possible. here it is of course super relevant to make a solid verification that it is not recursive or at least that if it is recursive it only creates interesting glitches but does not create a stall.

we need to make an animatronics interface where either a hand tracking view computer vision or via a gamepad can be used as a generic animation interface that controls multiple parameters .e.g the eye moving around blinking and looking around and getting smaller and bigger. Think in terms of a hand puppeting. we also need a posenet input. have a look at portal for code pieces for this.

we need to add a pulse sensor over ble to the possible inputs. look at the portal system and see the pulse sensor input system and copy it over and make it a general omponent for animations.

In portal there is a facemesh component look at that and integrate it as a generator. make sure to optimize such that we are using existing generators if it is a 3d object and make sure to render it in a shader and not through p5 line drawings etc. give it similar params as other 3d objects. 

animations does not seems to follow when one copies an element between scenes or components.

when creating a new animation and the element is a part of a live output the default setting should be that the animation is disable similar to when adding effects and eleemtns.

We need to design a Lego component view where the existing nodes has a Lego piece information and then one can create a group of nodes by combining the Lego pieces.  One Lego piece is defined as the output piece and that defines the interface. If the output piece is a image buffer then it can be added to the component chains. There should be the param view like elements in the components view. Any param made significant here should be available in the element param view when added in component view. So significant is on another abstraction layer. Each node may need to have multiple types of LEGO connectors. Eg. The stl loader might have both a raw stl and xxx

the current text generator is buggy and overly simple. the mardkwon editor does not work. have a look at the one in Portal/p1_embed/web/ and the rendering seems heavy i suggest that we make some kind of fast xx.

on refresh on has to reconnect dmx this should be done automatically if possible there should not be a reconnect usb button

the resolution ceiling setting in settings i am not sure what it exactly does. it think it should be a general max render resolution where one can say no texture, buffer, image etch is allocated beyond this resolution. and there shuld be hd and fullhd as params and there should be a mode called none.

the reset live param btn seems to have a timing similar to the delete btn in other views. it should should be present all the time. also it should work. and I am missing a globale live param reset btn that should be next to the "sources" header and right justified. Further more the live params are current stored in the browser the live params should be stored in the project but only as diffs.

animation params is not a part of live params that can be changed.


- [ ] Filter that takes mobile llm and evolves on top of current image.
- [ ] 3d model + noise shader morphing.
- [ ] Warping projection mapping
- [ ] Web xr
- [ ] Special groups as tracks that are merged at the end of the group.
- [ ] Embedded components as existing generator and effect groups.
- [ ] Example components/groups as templates
- [ ] Node view and chain view same same different views. Hidden nodes shown as side chains in chain view.
- [ ] Many objects as multi simulators/spawners/virtualizators.
- [ ] Yolo or the like as tracking
- [ ] Fdm based font
- [ ] Markers and cad like trackers on image
- [ ] Generate smart group nodes that expects a certain type of input and generates and output. Eg a scene to image node that takes in a 3d model
- [ ] 


1. VJ1 is not a self-contained deployable product
The main output depends on:
p5 loaded dynamically from jsDelivr in [constants.js (line 11)](/Users/madshobye/Media/codeRepo/Portal/experiments/vj1/js/constants.js:11).
Code outside VJ1: ../../P1/portal/portal.js, loaded in [output-app.js (line 148)](/Users/madshobye/Media/codeRepo/Portal/experiments/vj1/js/output/output-app.js:148).
Portal then loads WebFont Loader and CryptoJS from another CDN, plus Portal-local scripts and fonts.
TensorFlow.js and MobileNet are also loaded dynamically from jsDelivr in [mobilenet-morph-service.js (line 23)](/Users/madshobye/Media/codeRepo/Portal/experiments/vj1/js/output/specialized/mobilenet-morph-service.js:23).
Material Symbols come from Google Fonts in [index.html (line 12)](/Users/madshobye/Media/codeRepo/Portal/experiments/vj1/index.html:12).
This creates offline, deployment, version, and supply-chain failure modes. Deploying only experiments/vj1 will break rendering and camera/font initialization.
Required work:
Vendor or package all runtime dependencies.
Remove the dependency on P1/portal by extracting the small capabilities VJ1 genuinely needs.
Produce one versioned, immutable deployment artifact.
Add dependency integrity, licenses/notices, and a reproducible dependency lock.
Decide explicitly whether offline show operation is required. For a VJ tool, I strongly recommend it.


6. The executable-project trust model is undefined
VJ1 intentionally evaluates editable JavaScript using Function in node editors, procedural drawing, ISF expressions, and package migrations. With no CSP and unrestricted remote script loading, an imported malicious project or node package can execute with the application origin’s privileges.


Reduce remaining orchestration hotspots
The architecture is modular, but several files remain too large to safely evolve:
control-shell-controller.js: 2,489 lines.
source-render-runtime.js: 2,111 lines.
visual-render-plan.js: 2,069 lines.
project-migrations.js: 2,058 lines.
parameter-animation-tracks.js: 2,042 lines.
models.js: 1,791 lines.
project-folder-service.js: 1,469 lines.



Eliminate implicit global integration
Portal capabilities are accessed through globals and even Function("return typeof pSetup...") in [font-loader.js (line 30)](/Users/madshobye/Media/codeRepo/Portal/experiments/vj1/js/output/font-loader.js:30) and [shared-input-runtime.js (line 146)](/Users/madshobye/Media/codeRepo/Portal/experiments/vj1/js/output/shared-input-runtime.js:146).
Replace these with injected contracts:
Font loader
Camera input
Canvas lifecycle
Optional Portal compatibility adapter
This should also help locate the duplicate canvas.

4. Browser support policy and fallback behavior conflict
The compatibility gate requires Chrome 150+, FileSystemObserver, screen capture, OffscreenCanvas, and several other APIs in [browser-compatibility.js (line 1)](/Users/madshobye/Media/codeRepo/Portal/experiments/vj1/js/libraries/diagnostics-engine/browser-compatibility.js:1).
However, the project-folder service contains an intentional manual-refresh fallback when FileSystemObserver is unavailable. The global compatibility gate prevents reaching that fallback.
Required work:
Separate hard requirements from optional capabilities.
Display capability degradation per subsystem.
Fail the application only for genuinely indispensable capabilities.
Maintain and test one explicit supported Chrome/GPU/OS matrix.
#Done

