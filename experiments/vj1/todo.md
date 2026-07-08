# VJ1 Interface Vision

This application should feel like a visual instrument, not a control panel.

The person using it is not managing data. They are preparing a space, shaping light, and moving between visual ideas. Every interface decision should reduce the feeling of configuration and increase the feeling of direct engagement with the image.

## Product Principle

The app has three natural layers:

1. **Project**
   The folder is the show. The app begins by choosing a local folder, and everything important belongs there: media, scenes, shaders, mappings, and settings.

2. **Setup**
   Setup describes the physical world. Projection surfaces, corner mapping, projector output, and calibration belong here. Setup is calm, precise, and sparse. It should never feel like performance.

3. **Scene**
   Scenes describe the visual world. Once the surfaces exist, the user chooses what each surface shows: media, generators, shaders, opacity, blending, and motion. Scene work should feel exploratory and immediate.

Output is not a separate creative mode. Output is the presentation surface for Project, Setup, and Scene.

## Core Mental Model

A surface has two identities:

```text
Setup surface: where is this physical projection surface?
Scene surface: what visual material is playing on it?
```

Do not mix these identities in the same interface state.

When the user is mapping corners, the interface should feel like calibration. When the user is designing visuals, corner anchors should disappear and the interface should feel like composition.

## Desired Flow

```text
Open folder
  -> Setup surfaces
  -> Map/correct projection corners
  -> Create a scene
  -> Choose visuals for each surface
  -> Add effects
  -> Save scene
  -> Open output
```

This should not behave like a rigid wizard. The user can move freely, but the interface should reveal only what is meaningful for the current layer.

## Interface Hierarchy

### Empty State

Before a folder is selected, the app should show one clear action:

```text
Open project folder
```

Avoid showing scenes, shaders, layers, surfaces, or mapping controls before there is a project context. These controls are meaningless until the show has a home.

### Project State

After a folder is selected, show:

- project name
- media count
- output status
- save/open output actions

Keep this quiet. The project identity should anchor the app, not dominate it.

### Setup State

Setup is for the physical projection arrangement.

Visible:

- large projection preview
- corner anchors
- selected physical surface
- add/remove/rename surface
- save/reset mapping
- output/calibration status

Hidden:

- shader library
- layer mix
- scene capture
- effect chains
- detailed media controls

Setup should answer one question: “Where does the light land?”

### Scene State

Scene is for the visual composition.

Visible:

- large output preview without mapping anchors
- scene list/capture
- selected surface as creative target
- media/generator assignment
- effect chain for the selected target
- opacity/blend/speed controls

Hidden or minimized:

- physical corner mapping
- mapping save/reset
- calibration-only tools

Scene should answer one question: “What does each surface become?”

### Output State

Output is for the projector/feed.

Visible:

- fullscreen mapped graphics
- optional calibration overlay when explicitly enabled
- minimal HUD only when useful

Hidden:

- editing controls
- project library
- scene design controls

Output should feel like a clean signal, not an editor.

## Visual Language

Use a restrained, elegant interface:

- icon-led top actions using Material Symbols Rounded
- one primary visual canvas
- soft rails and contextual panels
- few visible controls at once
- no large tab taxonomy
- no “perform mode” label
- no redundant panels showing the same concept twice

Prefer direct manipulation over form hierarchy. If the user selects a surface, show only the controls needed for that surface in the current state.

## Progressive Disclosure

The app should reveal information in steps:

1. No folder: only project start.
2. Setup: surfaces and mapping.
3. Scene: visuals and effects per surface.
4. Output: clean projection feed.

At any moment the user should understand:

```text
What am I editing?
Why is this control visible?
What will change in the image if I touch it?
```

If a control cannot answer those questions, hide it until the relevant state.

## Implementation Direction

Introduce a simple app mode/state:

```js
ui.workspace = "setup" | "scene";
```

Use this to decide what is visible:

- `setup`: mapping-focused interface, mapper calibration on
- `scene`: composition-focused interface, mapper calibration off

Keep the renderer architecture as-is:

- control window owns project state and parameters
- output/preview owns p5, WebGL, and ProjectionMapper
- setup commands are sent to output
- scene state is sent to output

The important change is not more architecture. It is clearer presentation of the architecture.

## Design Test

Look at the screen and ask:

```text
Could a person understand the next useful action without reading documentation?
Can they tell whether they are setting up the room or designing the scene?
Is the central visual result more important than the controls?
Are hidden controls discoverable when they become relevant?
```

If the answer is no, simplify.

## First Refinement Target

Create two clear interface states:

1. **Setup**
   A calm calibration view for surfaces and anchors.

2. **Scene**
   A playful visual design view for assigning media, generators, and effects to surfaces.

The user should be able to move between them with a small segmented control or two icon buttons. The words should be simple: `Setup` and `Scene`.

Do not add more features until this hierarchy feels inevitable.
