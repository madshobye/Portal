

go through and review legacy code not used or debris with intention of handling legacy projects. this should not be necessary since we have a structure where projects are automatically migrated when they are opened and this shoul d be the only way to approach it.

toggling visibility of a surface on should also select that element this is both surfaces in scenes, and components in either component and canvas view

the list of params in live view is a bloody mess. this is partly because of the restyling has not been done right there. and partly because as the complexity of the components grow there are simply too many params to list. as minimum rethink the styling so that it is similar to components param list in component view, but also rethink the way to navigate it. i suggest that underneath the scenes list and the scenes params in the first column list the components in the scene with thumbnails and the one can select a component and get its params. i am not sure this works with the complex herarchi of the canvas etc but this may be a solution

i would like to be able to right click a param in a component and have a small popup appear. it could be something else than right click but something similar. this popup should have two options. reset the param to default and second make this param "significant" when the param is significant a border or a bg should be on it (maybe just the handle being orange) and the significant params should be shown in a list in scene view whenever those params are present.

stl object generator is current showing the object rotated 180 degrees on the z axis it think this is a product of the many flipping of views that has happened around it. it can simple be solved with a rotate but it would be nicer if default was correct. 

go through the system and review the architecture from a the point of view of hotfixes and quick solutions. if statements that are there to "fix" something like flipped rendering etc. where time has not been taken to properly think a generalised way of building the architecture. E.g. this is also in terms of how the nodes render and data is passed through. complex loops with extra logic to compensate for something that should be a generalised param. or it can be a alpha channel param that is manually coded into a few effects instead of being thought through as general param that all effects should have. etc. etc. 

make an assessment of p5 implementation and consider if we have any hot fixes and tweaks to try to integrate with p5. the system has evolved beyond p5 and the primary architecture should be a lean and efficient shader based render engine and p5 can sneak in nasty limitations. it is better to clean up and convert to clean raw shader architecture also so we can secure further development does not do unintented things. e.g. noise from p5 is extremely slow and i think it is cpu bound so using noise seems simple but if it suddenly is used for everypixel then the whole system is struggling

toggling the visibility button on an element over and over is good test to pinpoint the update glitch. in general it is much better but doing so still reveals that sometimes the toggle does not go through. it is as if e.g. turning visibility off quickly does it and then an internal update switches it back to on again. also moving an alement around seems to flood the event path and when letting go a previous position becomes the stored on and the element snaps back

the x for deleting in lists that appear after a while has to be smaller and all the way to the top right to minimize risk of clicking

moving the wave up is down and down is up

go through all fall back code pieces and makes sure that they write in console

Morphing thumbnails has a tendency to be created while it is loading the morphing so it is a snapshot of the debug "loading..." insteaf of the actual rendering. this is probably a general problem of thumbnails being too fast at being generated instead of just waiting a bit or getting a loaded signal from the elements.

Although loading media messages are good for debug and feedback they are quite annyoing when running live output. i suggest that these message are replaced with a clean alpha channel whenever the debug toggle is off. one problem is that if one uses invert on the loading message one gets a bright white frame because loading has a black bg. 


# DONE