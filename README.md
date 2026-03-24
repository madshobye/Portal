# Portal (P1) API Reference

## Instructions For LLM To Use This Library

Use these rules when generating code for Portal.

### 0. Default assumption when asked to "write a Portal sketch"

- Do not reimplement Portal features with plain `ml5`, raw browser APIs, or custom loaders if Portal already has a module for the task.
- If the user references [https://madshobye.github.io/Portal/](https://madshobye.github.io/Portal/) and asks for a sketch, assume they want code that fits the existing Portal environment.
- There are two standard scenarios:
  - **Cloud editor scenario**: return a copy-paste-friendly `sketch.js` for the base sketch at [https://editor.p5js.org/hobye/sketches/P07GGrfNY](https://editor.p5js.org/hobye/sketches/P07GGrfNY)
  - **Desktop empty-folder scenario**: create a small sketch folder with `index.html`, `style.css`, and `sketch.js`, modeled on the examples in [`P1/sketches`](/Users/madshobye/Media/codeRepo/Portal/P1/sketches)
- If the user asks for a "new sketch" and does not specify format, prefer:
  - a single `sketch.js` for cloud copy-paste
  - or a base-sketch-style folder if they are clearly working locally in an empty folder
- Do not refuse just because you do not see local `portal/*.js` files in the immediate folder. The standard Portal sketch pattern is already defined by this README and the example sketches.

### 0a. Portal system model

Portal is a system, not just a collection of unrelated scripts.

A normal Portal sketch is made from these layers:

1. `index.html`
   - loads p5
   - loads Portal base CSS
   - loads `portalLoader.js`
   - loads your `sketch.js`
2. `portalLoader.js`
   - bootstraps the Portal runtime
3. `sketch.js`
   - creates the canvas
   - loads Portal modules with `await loadScript("portal/<module>.js")`
   - initializes modules in `async setup()`
   - combines them through simple state and a polling `draw()` loop

If an LLM writes a Portal sketch correctly, it should preserve that structure instead of inventing:
- a custom script loader
- raw `ml5` replacements
- raw browser camera setup when `setupWebcamera(...)` exists
- separate runtime conventions unrelated to Portal

### 0b. Canonical entry points

These are the supported entry points an LLM should assume:

- Public guide: [https://madshobye.github.io/Portal/](https://madshobye.github.io/Portal/)
- GitHub source: [https://github.com/madshobye/Portal](https://github.com/madshobye/Portal)
- Cloud base sketch: [https://editor.p5js.org/hobye/sketches/P07GGrfNY](https://editor.p5js.org/hobye/sketches/P07GGrfNY)
- Hosted runtime loader: `https://madshobye.github.io/Portal/P1/portalLoader.js`
- Hosted base stylesheet: `https://madshobye.github.io/Portal/P1/portalBaseStyle.css`

If only the public guide is available, that is still enough to build a real Portal sketch. Use the hosted loader and base stylesheet.

### 1. Treat this as p5.js v2+

- Aim to produce a **copy-paste-friendly `sketch.js`** by default.
- The default target is the Portal base sketch in the p5 cloud editor:
  - [https://editor.p5js.org/hobye/sketches/P07GGrfNY](https://editor.p5js.org/hobye/sketches/P07GGrfNY)
- Unless the user explicitly asks for a multi-file structure, prefer code that can be pasted directly into that base sketch’s `sketch.js`.
- That means:
  - keep required code in one file when practical
  - avoid unnecessary extra assets or helper files
  - only introduce extra files when the task clearly benefits from it

- Use `async function setup()` when loading Portal modules or assets.
- In p5.js v2+, do not rely on `preload()` for typical asset or module loading. Prefer `async setup()` with `await`.
- Use `portalLoader.js` as the normal runtime entry point.
- Prefer `await` inside `setup()` for:
  - `loadScript(...)`
  - `new Module(...).init()`
  - Portal-provided async helpers

Correct pattern:

```js
let module;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/speech.js");
  module = await new PortalSpeech({ language: "en-GB" }).init();
}
```

Avoid:

```js
function preload() {
  // avoid putting normal Portal or asset loading here in p5.js v2+
}
```

### 2. Prefer Portal helpers over generic p5 workarounds

- If Portal has a module for a task, use that module instead of inventing a custom loader.
- For sound loading in p5 v2+, use Portal’s sound helper:
  - `await loadScript("portal/SoundFile.js")`
  - `let sound = await loadSoundFile(url)`
- Do not assume old p5 sound-loading patterns are reliable in this setup.

### 2a. Guaranteed runtime URLs

If an LLM only has the public Portal guide and needs a runnable standalone local sketch, these URLs are the supported starting point:

- `https://madshobye.github.io/Portal/P1/portalLoader.js`
- `https://madshobye.github.io/Portal/P1/portalBaseStyle.css`
- GitHub source: [https://github.com/madshobye/Portal](https://github.com/madshobye/Portal)

Use them in `index.html`, then in `sketch.js` load modules with:

```js
await loadScript("portal/handPose.js");
await loadScript("portal/GptClient.js");
await loadScript("portal/speech.js");
```

Do not treat the Portal site as documentation-only. The hosted `portalLoader.js` is the runtime entry point for standalone sketches.

### 2b. Hard rules for Portal sketches

In normal Portal sketches:

- do use `portalLoader.js`
- do use `await loadScript("portal/<module>.js")`
- do use `async setup()`
- do use `setupWebcamera(...)` when a Portal camera workflow needs video
- do combine modules through simple shared state in `draw()`

Do not:

- write a custom external script loader when `loadScript(...)` already exists
- swap in `ml5` or another library if Portal already has the needed module
- use `createCapture(VIDEO)` as the default for Portal camera/tracking sketches when `setupWebcamera(...)` is the Portal path
- guess undocumented module APIs if an example or README section already defines the pattern

### 3. Prefer simple, state-based sketches

Write code in this style:
- a few top-level state variables
- `async setup()` for loading
- `draw()` for rendering and polling
- small helper functions for rendering or state updates

Prefer:
- `if (module?.hasNewResult()) { ... }`
- `if (speech?.hasNewResult()) { ... }`
- explicit booleans like `isListening`, `showPanel`, `mode`

Avoid when possible:
- many nested callbacks
- many interdependent event listeners
- complex class hierarchies inside a beginner sketch
- hidden state spread across many closures

Good pattern:

```js
let speech;
let heard = "";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/speech.js");
  speech = await new PortalSpeech({ language: "en-GB" }).init();
}

function draw() {
  background(0);

  const { text } = speech?.getLatest?.() || {};
  heard = text || "";

  fill(255);
  text(heard, 20, 40);
}
```

### 4. Use polling in `draw()` instead of advanced event choreography

Portal is easiest to use when the sketch polls state each frame.

Prefer:
- `hasResult()`
- `hasNewResult()`
- `getLatest()`
- `consumeNew()`
- `getResult()`

Default rule:
- use `getLatest()` when you simply want the newest state each frame
- use `hasNewResult()` + `consumeNew()` when you want to react once to new input
- treat named getters like `getHands()`, `getBest()`, `getLeftHand()`, or `getRightHand()` as convenience helpers for richer access patterns

Only use callbacks when they are clearly simpler than polling.

### 5. Use the standard Portal lifecycle

For most modules, use:

```js
let module;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/<module>.js");
  module = await new SomeModule({...}).init();
  if (typeof module.start === "function") {
    await module.start();
  }
}
```

### 6. Keep sketches beginner-readable

When writing examples for students:
- choose descriptive variable names
- keep the number of moving parts low
- make one idea visible per sketch
- use comments sparingly, only when they explain intent
- avoid overly abstract helpers for tiny examples

Good:
- one module
- one visible output
- one interaction loop

Less good:
- multiple unrelated technologies in one starter sketch
- highly optimized code
- advanced patterns that hide the logic

### 7. Prefer Portal UI for controls

If the sketch needs simple controls, prefer `uiSlim2.js`:
- `uiButton(...)`
- `uiText(...)`
- `uiSlider(...)`
- `uiToggle(...)`
- `uiPromptText(...)`
- `uiListStart(...)` / `uiListEnd()`

This is usually better than creating custom DOM unless the sketch specifically needs a more complex interface.

### 8. Resize behavior

- Portal already provides shared canvas resize handling in `portal.js`.
- Do not add `windowResized()` unless the sketch has extra state that must also resize.
- If you do add `windowResized()`, only do it because the sketch needs additional resize logic, not just `resizeCanvas(windowWidth, windowHeight)`.

### 9. Fullscreen behavior

- Portal provides `fullScreenToggle()`.
- Do not add a sketch-local `f` key handler unless the sketch specifically needs that shortcut.
- Prefer fewer hidden keyboard shortcuts in beginner examples.

### 10. GPT usage

When using `GptClient`:
- load it with `await loadScript("portal/GptClient.js")`
- use `storedDecrypt(...)` for encrypted API keys
- prefer structured responses when the sketch depends on predictable fields
- keep prompts short and explicit
- inspect `gpt.error`, `gpt.latestObject`, and `gpt.lastRaw` when debugging

For image input:
- create a `p5.Graphics` or other supported image source
- pass it as the second argument to `gpt.ask(prompt, img)`

### 11. Speech usage

When using `PortalSpeech`:
- initialize it in `async setup()`
- use `listenRecurring(...)` for conversation-like flows
- use `hasNewResult()` + `consumeNew()` in `draw()` for simple architectures
- stop listening before speaking if echo is a problem
- use `interimResults: true` only when the sketch benefits from partial transcripts

### 12. Camera / ML usage

For camera-based modules:
- use `await setupWebcamera(...)`
- then pass the video into the relevant module
- initialize the module with `await new Module(...).init()`
- call `await module.start()` when required
- in `draw()`, render the video first, then draw results on top

### 13. Visual style guidance for beginner sketches

Prefer:
- one strong visual idea
- a limited color palette
- clear typography
- a simple layout

Avoid:
- mixing too many visual languages
- combining photo, vector, and code-drawn styles without intent
- large amounts of UI and ML logic in the same first example

### 14. Error handling

Use simple visible error handling:
- `print(...)`
- `console.log(...)`
- `uiDebug(...)`
- a short on-canvas status string

Do not hide errors inside deep promise chains if a beginner would benefit from seeing them.

### 15. Safe defaults

If unsure, generate code with these defaults:
- `async setup()`
- use `portalLoader.js` as the entry point
- load one Portal module
- one canvas
- one draw loop
- one state object or a few top-level variables
- polling instead of nested callbacks
- no `preload()`
- no custom resize handler unless necessary
- no fullscreen shortcut unless requested

### 16. Good default template for LLM-generated Portal sketches

```js
let module;
let statusText = "Loading...";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/<module>.js");

  module = await new SomeModule({
    // config
  }).init();

  if (typeof module.start === "function") {
    await module.start();
  }

  statusText = "Ready";
}

function draw() {
  background(0);

  const result = module?.getLatest?.();
  // update sketch state

  fill(255);
  text(statusText, 20, 30);
}
```

Portal is a p5.js helper layer for rapid sketch prototyping with camera, tracking, speech, UI, QR, GPT, projection mapping, and utility modules.

This README focuses on **detailed API usage**, but it now also includes a more beginner-friendly structure so both students and LLMs can navigate the library quickly.
For walkthrough-style teaching material, use:
- [Portal overview](https://learn.hobye.dk/portal)
- [IoT & communication](https://learn.hobye.dk/portal/iot-com)
- [Machine learning](https://learn.hobye.dk/portal/machine-learning)
- [Maps & GPS](https://learn.hobye.dk/portal/maps-gps)

## How To Use This README

If you are new to Portal, use this reading order:

1. Quick Start
2. Core Runtime (`portal.js`)
3. UI Layer (`uiSlim2.js`)
4. One focused module:
   - speech -> `portal/speech.js`
   - GPT -> `portal/GptClient.js`
   - camera / tracking -> `setupWebcamera(...)` plus one ML module
   - mapping -> `portal/mapper.js`

If you are using an LLM to write Portal code, give it:
- the module name you want to use
- the lifecycle you expect: `init()`, `start()`, `draw()`, polling
- whether the sketch is fullscreen or inside a layout
- whether you want plain text output or structured GPT output

Recommended prompt framing for an LLM:

```txt
Use Portal P1 APIs only.
Load needed scripts with loadScript(...).
Prefer current methods from the README.
Use async setup() when a module needs init().
In draw(), poll with `hasNewResult()` and read the new state with `consumeNew()`.
Do not invent undocumented Portal helpers.
```

## Official Starters

Use one of these two starting points depending on context.

### Option A: Cloud editor starter

Use this when:
- the user wants code they can paste directly into the browser editor
- the prompt is being copied into an LLM to generate a `sketch.js`
- there is no need for extra files

Use the base sketch:
- [https://editor.p5js.org/hobye/sketches/P07GGrfNY](https://editor.p5js.org/hobye/sketches/P07GGrfNY)

In that setup, the goal is usually:
- write a single copy-paste-friendly `sketch.js`
- keep Portal loading inside `async setup()`
- use `await loadScript("portal/<module>.js")`

Minimal pattern:

```js
let handPose;
let video;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  video = await setupWebcamera(true, 640, 480, true);
  await loadScript("portal/handPose.js");
  handPose = await new HandPose({
    video,
    videoIsFlipped: true,
    backend: "webgl",
  }).init();
  await handPose.start();
}

function draw() {
  background(0);
  image(video, 0, 0, width, height);

  const { first: hand } = handPose?.getLatest?.() || {};
  // update state here from named joints like hand.thumb_tip
}
```

### Option B: Local example-style sketch folder

Use this when:
- the user is on desktop in an empty folder
- the task is to create a runnable local sketch
- the output should mirror the examples in this repository

Match the structure used in [`P1/sketches`](/Users/madshobye/Media/codeRepo/Portal/P1/sketches):

- `index.html`
- `style.css`
- `sketch.js`

Best local starting point:
- [`P1/sketches/baseSketch/index.html`](/Users/madshobye/Media/codeRepo/Portal/P1/sketches/baseSketch/index.html)
- [`P1/sketches/baseSketch/style.css`](/Users/madshobye/Media/codeRepo/Portal/P1/sketches/baseSketch/style.css)
- [`P1/sketches/baseSketch/sketch.js`](/Users/madshobye/Media/codeRepo/Portal/P1/sketches/baseSketch/sketch.js)

When creating a new local sketch:
- if you are inside this repository, you can copy `baseSketch`
- if you are in an empty standalone folder, use the GitHub-hosted Portal files in `index.html`
- edit only `sketch.js` first unless custom layout is actually needed
- keep `index.html` and `style.css` minimal unless the user asks for more

Minimal local `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"
    />
    <title>My Portal Sketch</title>
    <script src="https://cdn.jsdelivr.net/npm/p5@2.2.0/lib/p5.js"></script>
    <link rel="stylesheet" type="text/css" href="https://madshobye.github.io/Portal/P1/portalBaseStyle.css" />
    <link rel="stylesheet" type="text/css" href="./style.css" />
  </head>
  <body>
    <main></main>
    <script src="./sketch.js"></script>
    <script src="https://madshobye.github.io/Portal/P1/portalLoader.js"></script>
  </body>
</html>
```

Notes:
- for a standalone local sketch outside this repo, use the GitHub-hosted URLs shown above
- keep the shared `portalBaseStyle.css` link as well, unless you intentionally want to replace the default Portal page styling
- inside this repository’s `P1/sketches/<name>/` structure, the local paths are:
  - `../../portalLoader.js`
  - `../../portalBaseStyle.css`
- once that loader is present, `sketch.js` can use Portal helpers like `loadScript(...)` directly

### What an LLM should do by default

If the user says something like:
- "write a Portal sketch that tracks a hand"
- "make a Portal sketch with GPT"
- "use Portal to read QR codes"

then the default response should be:
- choose the relevant Portal module
- write code in the Portal style
- target the cloud base sketch for copy-paste prompts
- target a local `baseSketch`-style folder for empty desktop folders
- avoid rebuilding the feature stack from scratch with unrelated libraries

## Public API

Think of Portal like any other online browser library:

1. load the runtime in `index.html`
2. write your sketch in `sketch.js`
3. load extra modules with `await loadScript("portal/<module>.js")`
4. initialize the module in `async setup()`
5. read results in `draw()`

Minimal mental model:

- `index.html` gives you p5 + Portal runtime
- `sketch.js` gives you your application logic
- Portal modules are loaded on demand
- most modules expose either:
  - a class with `init()` and often `start()`
  - or a small set of helper functions

General pattern:

```js
let module;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/<module>.js");
  module = await new SomeModule(...).init();
  if (typeof module.start === "function") {
    await module.start();
  }
}

function draw() {
  background(0);
  const result = module?.getLatest?.();
  // use result
}
```

Simple rule:
- use `getLatest()` as the default read pattern
- use `hasNewResult()` + `consumeNew()` when you only want to react once per update
- keep getters like `getBest()`, `getHands()`, or `getLeftHand()` for convenience and legacy code

## Module Examples

This is the practical module overview for using Portal as a library.

### Runtime and setup

- `portal/portal.js`
  - entry point through `portalLoader.js`
  - important functions:
    - `loadScript(url)`
    - `loadAllLibraries(urls)`
    - `setupWebcamera(front, w, h, flipped)`
    - `syncVideoDimensions(p5Video)`
    - `fullScreenToggle()`
    - `storedDecrypt(...)`
    - `storeKey(...)`
    - `getKey(...)`
    - `getData(url)`
    - `getP5Instance()`

### UI

- `portal/uiSlim2.js`
  - important functions:
    - `uiButton(...)`
    - `uiText(...)`
    - `uiPromptText(...)`
    - `uiSlider(...)`
    - `uiToggle(...)`
    - `uiRect(...)`
    - `uiListStart(...)`
    - `uiListEnd()`
    - `uiDebug(...)`
    - `uiGet(...)`
    - `uiSet(...)`
    - `uiSetBaseStyle(...)`

### GPT and language

- `portal/GptClient.js`
  - class: `GptClient`
- `portal/speech.js`
  - class: `PortalSpeech`
- `portal/transformer.js`
  - class: `PortalTransformer`

### Camera, tracking, and perception

- `portal/handPose.js`
  - class: `HandPose`
- `portal/bodyPose.js`
  - class: `BodyPose`
- `portal/faceMesh.js`
  - class: `FaceMesh`
- `portal/emotions.js`
  - classes:
    - `EmotionTracker`
    - `Emotions`
- `portal/P5ImageClassifier.js`
  - class: `P5ImageClassifier`
  - helper:
    - `setupImageClassifier(model, video)`
- `portal/P5ObjectDetector.js`
  - class: `P5ObjectDetector`
- `portal/handGestureKnn.js`
  - class: `HandGestureKnn`

### Learning modules

- `portal/neuralLearner.js`
  - class: `NeuralLearner`
- `portal/knnLearner.js`
  - class: `KnnLearner`

### Sound, input, and devices

- `portal/SoundFile.js`
  - function:
    - `loadSoundFile(url)`
- `portal/gamepad.js`
  - function:
    - `setupGamepad()`
- `portal/multiTouch.js`
  - class: `MultiTouch`
- `portal/heartRateBLE.js`
  - class: `HeartRateBLE`
- `portal/dmxSerial.js`
  - class: `DmxSerial`
- `portal/mqtt.js`
  - class: `PortalMqtt`

### QR, maps, and location

- `portal/QrReader.js`
  - class: `QrReader`
- `portal/qrCodeGen.js`
  - functions:
    - `createQRCode(text)`
    - `drawQRCode(qr, x, y, size)`
- `portal/location.js`
  - functions:
    - `getLocation()`
    - `getDistanceFromLatLonInKm(...)`
    - `bearingToTarget(...)`
    - `getArrowDirection(...)`
    - `drawArrow(...)`
- `portal/map.js`
  - map overlay helper module used by the map examples

### Drawing, mapping, and visuals

- `portal/mapper.js`
  - class: `ProjectionMapper`
- `portal/noMappingMapper.js`
  - class: `ProjectionMapper`
  - simplified no-mapping variant
- `portal/ink.js`
  - class: `InkDrawing`
- `portal/faceAnimation.js`
  - class: `PortalFaceAnimation`
- `portal/chainBrush.js`
  - class: `ChainBrush`
- `portal/paintPath.js`
  - class: `PortalPaintPath`
- `portal/pNoise.js`
  - functions:
    - `pSetNoiseSeed(...)`
    - `pSetNoiseRange(...)`
    - `pNoise1D(...)`
    - `pNoise2D(...)`
    - `pNoise3D(...)`
- `portal/simplexNoise.js`
  - simplex-noise utility module used by the simplex examples

### How to choose a module

- Need webcam landmarks:
  - `HandPose`, `BodyPose`, `FaceMesh`
- Need classification:
  - `P5ImageClassifier`, `P5ObjectDetector`, `KnnLearner`, `NeuralLearner`
- Need GPT or language:
  - `GptClient`, `PortalSpeech`, `PortalTransformer`
- Need interaction UI:
  - `uiSlim2.js`
- Need hardware or external IO:
  - `PortalMqtt`, `DmxSerial`, `HeartRateBLE`, `setupGamepad()`
- Need drawing or presentation:
  - `ProjectionMapper`, `InkDrawing`, `PortalFaceAnimation`, `ChainBrush`

## Combining Portal Elements

Portal sketches usually work best when they are built by combining a few stable parts.

### Common combinations

1. Camera + tracking
   - `setupWebcamera(...)`
   - one tracking module like `HandPose`, `BodyPose`, `FaceMesh`, `P5ImageClassifier`, or `P5ObjectDetector`
   - render video first, then overlays

2. Tracking + UI
   - tracking module in `setup()` / `draw()`
   - `uiSlim2.js` controls for thresholds, labels, modes, debugging

3. Speech + GPT
   - `PortalSpeech`
   - `GptClient`
   - speech recognition feeds text into GPT
   - GPT output is drawn and optionally spoken back

4. Tracking + GPT
   - tracking result updates sketch state
   - state is summarized into text or images
   - `GptClient` interprets that higher-level state

5. Sound + interaction
   - interaction state from UI, tracking, BLE, MQTT, or keyboard
   - playback via `SoundFile.js`

### Combination pattern

The safest pattern is:

```js
let video;
let tracker;
let uiState = {};
let derivedState = {};

async function setup() {
  createCanvas(windowWidth, windowHeight);
  video = await setupWebcamera(true, 640, 480, true);
  await loadScript("portal/<module>.js");
  tracker = await new SomeModule(video).init();
  await tracker.start();
}

function draw() {
  background(0);
  image(video, 0, 0, width, height);

  derivedState = tracker?.getLatest?.() || {};

  // draw state
  // draw UI
  // optionally trigger other modules from state
}
```

This is the default mental model:
- module outputs become sketch state
- sketch state drives visuals, UI, sound, GPT calls, or other logic
- the modules are combined by the sketch, not by hidden callbacks

## Internal Details

These details are useful when maintaining Portal itself, but they are not part of the normal sketch-writing path.

- `portal.js` is the low-level runtime loaded by `portalLoader.js`
- example sketches are for learning module behavior, not for deciding how to bootstrap Portal
- user sketches should start from the official starters above, not from internal runtime assumptions

## 1) Quick Start

### Load Portal from a sketch

For normal sketches, use one of these:

- cloud editor base sketch:
  - [https://editor.p5js.org/hobye/sketches/P07GGrfNY](https://editor.p5js.org/hobye/sketches/P07GGrfNY)
- standalone local `index.html`:
  - include `https://madshobye.github.io/Portal/P1/portalLoader.js`
  - include `https://madshobye.github.io/Portal/P1/portalBaseStyle.css`

In other words: use the existing Portal entry points, not a custom bootstrap.

### Typical module lifecycle

Most modules follow this pattern:

```js
let module;

async function setup() {
  await loadScript("portal/<module>.js");
  module = await new SomeModule({...}).init();
  await module.start();
}

function draw() {
  const data = module?.getLatest?.();
  // react to new data
}
```

### Beginner checklist

Before debugging a sketch, verify:
- the page loads `portalLoader.js`
- every extra module is loaded with `await loadScript("portal/<module>.js")`
- modules that need async setup are initialized with `await new Module(...).init()`
- modules that stream results are started with `await module.start()` when required
- your `draw()` loop checks `hasNewResult()` or `hasResult()` before reading data

### Common sketch template

```js
let module;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/<module>.js");

  module = await new SomeModule({
    // config here
  }).init();

  if (typeof module.start === "function") {
    await module.start();
  }
}

function draw() {
  background(0);

  const data = module?.getLatest?.();
  // react to data
}
```

## 2) Core Runtime (`portal.js`)

`portal.js` is the base layer. In standard sketches you do not load it directly; `portalLoader.js` loads it for you.

### Setup and loading
- `portalLoader.js` (standard entry point)
- `loadScript(url)`
- `loadAllLibraries(urls)`
- `loadGoogleFont(nameOrArray)`

### Camera and media
- `setupWebcamera(front=true, w=640, h=480, flipped=false)`
- `syncVideoDimensions(p5Video)`

### Sketch + viewport helpers
- `fullScreenToggle()`
- `pointFromAngle(x0, y0, length, degrees)`
- `generateID()`
- automatic `windowResized()` canvas handling:
  - resizes to the canvas parent container when the sketch is embedded in a layout
  - falls back to full-window resize when the canvas is effectively fullscreen
  - can be overridden with `window.PORTAL_CANVAS_RESIZE_MODE = "window"` or `"none"`

### URL/QR helpers used internally
- `resolveBaseURL()`
- `resolveSketchURL()`
- `isShareableSketchURL(url)`

### Data + key storage helpers
- `getData(url)`
- `storeKey(name, key)`
- `getKey(name)`
- `encryptKey(key, password)`
- `decryptKey(encryptedKey, password)`
- `storedDecrypt({NAME: encryptedValue})`

### p5 instance helper
- `getP5Instance()`

### Canvas resize behavior

Portal now resolves resize targets a bit more intelligently than a simple `resizeCanvas(windowWidth, windowHeight)`.

- Default behavior:
  - if the canvas parent is a layout container, resize to that parent
  - if the canvas fills the viewport, resize to the window
- Overrides:
  - `window.PORTAL_CANVAS_RESIZE_MODE = "window"` forces full-window resizing
  - `window.PORTAL_CANVAS_RESIZE_MODE = "none"` disables Portal’s automatic resize handling

This is useful for multi-column layouts where a p5 canvas lives inside part of the page instead of owning the whole viewport.

## 3) UI Layer (`uiSlim2.js`)

Primary UI functions:
- `uiUpdateSimple()`
- `uiButton(label, style)`
- `uiText(text, style)`
- `uiPromptText(id, label, style)`
- `uiSlider(id, label, opts, style)`
  - slider options live in `opts`: `min`, `max`, `init`
  - style keys can be passed either in `opts` or in `style`
  - example: `uiSlider("speed", "Speed", { min: 0, max: 100, init: 35, fontSize: 12, height: 24 })`
- `uiToggle(id, label, style)`
- `uiRect(x, y, w, h, style)`
- `uiListStart(opts)` / `uiListEnd()`

Low-level / debug helpers:
- `uiUpdate(...)`, `uiHit(...)`, `uiShowInfo(...)`, `_uiDrawHUD(...)`, `_uiDrawGrid(...)`
- `uiDebug(message)` for on-screen debug output
- `uiGet(id, init?)`
- `uiSetBaseStyle({...})`

Example:

```js
function draw() {
  const style = { x: 30, y: 30, width: 220, height: 64, fontSize: 24 };
  if (uiButton("Listen", style).clicked) {
    print("clicked");
  }
}
```

### UI styling notes

Portal UI uses a simple JSON style model rather than CSS classes.

Good beginner strategy:
- define one base style for your sketch with `uiSetBaseStyle(...)`
- override only the values you need per widget
- use `uiListStart(...)` / `uiListEnd()` to keep layout simple before doing manual positioning

Example:

```js
uiSetBaseStyle({
  common: {
    fontSize: 16,
    padding: 10,
    rounding: 8,
    bgColor: "#f2f2f2",
    textColor: "#111111",
  },
  button: { height: 40 },
});
```

## 3.5) Speech (`portal/speech.js`)

`PortalSpeech` wraps `p5.Speech`, `p5.SpeechRec`, and native browser speech synthesis into one higher-level helper.

### Constructor
```js
new PortalSpeech({
  language: "en-US",
  voice: null,   // browser voice name
  pitch: 1,
  rate: 1,
  volume: 1,
})
```

### Lifecycle
- `await init()`

### Voice + language
- `setLanguage(language)`
- `setVoice(voiceName)`
- `setPitch(pitch)`
- `setRate(rate)`
- `setVolume(volume)`

If an explicit voice has been selected, `setLanguage(...)` preserves it instead of replacing it with a generic fallback voice.

### Speaking
- `await speak(text, language?)`
- `isSpeaking()`
- `onSpeakingChange(handler)`
- `stopSpeaking()`

### Listening
- `await listen(language?)`
- `listenRecurring(onSentence = null, { language = null, interimResults = false } = {})`
- `stopListening()`
- `isListening()`
- `onListeningChange(handler)`
- `onResult(handler)`
- `setResultHandler(handler)`

### Result polling helpers
- `hasResult()`
- `hasNewResult()`
- `resetNewFlag()`
- `consumeNew()`
- `getResult()`
- `getText()`

### Interim / silence helpers
- `onInterimResult(handler)`
- `setInterimResultHandler(handler)`
- `hasInterimResult()`
- `getInterimText()`
- `clearInterimResult()`
- `msSinceSpeech()`
- `isSilentFor(ms)`
- `isReceivingSpeech(recentMs = 700)`

### Example
```js
let speech;

async function setup() {
  await loadScript("portal/speech.js");
  speech = await new PortalSpeech({
    language: "en-GB",
    voice: "Flo (English (United Kingdom))",
  }).init();

  speech.onInterimResult((partial) => {
    print("partial:", partial);
  });

  speech.listenRecurring(null, {
    language: "en-GB",
    interimResults: true,
  });
}

function draw() {
  const { text } = speech?.getLatest?.() || {};
  if (text) print("final:", text);
}
```

### Practical speech notes

- Speech recognition quality depends heavily on browser, OS, microphone, and selected language.
- `listenRecurring(...)` is good for conversation-like sketches.
- `interimResults: true` is useful when you want live partial transcripts.
- `isSilentFor(ms)` and `isReceivingSpeech(...)` are useful for pacing voice interfaces.
- If you are doing both speech-to-text and text-to-speech in the same sketch, stop listening before speaking to avoid self-echo.

## 3.6) Face Animation (`portal/faceAnimation.js`)

`PortalFaceAnimation` is a reusable portrait/avatar renderer for p5 sketches.

It is designed around a neutral-centered pose model:
- mood dimensions:
  - `valence`
  - `arousal`
  - `dominance`
  - `tension`
- interaction state:
  - `speaking`
  - `listening`
  - `thinking`
- orientation:
  - `gazeX`, `gazeY`
  - `headTurn`, `headTilt`, `headPitch`

### Constructor
```js
new PortalFaceAnimation({
  seed: Math.random() * 1000,
  skinTone: [240, 228, 214],
  paperTone: [236, 233, 225],
  inkTone: [17, 17, 17],
  accentTone: [216, 31, 38],
  hairTone: [20, 22, 28],
})
```

### Core API
- `setTarget(nextPose)`
- `setState(nextPose)` alias
- `update(dt = 1 / 60)`
- `render({ p = null, x = 0, y = 0, w = 300, h = 420 } = {})`

The renderer preserves portrait proportions and scales to fit the destination box instead of stretching to fill it.

### Example
```js
let face;

async function setup() {
  createCanvas(480, 640);
  await loadScript("portal/faceAnimation.js");
  face = new PortalFaceAnimation();
}

function draw() {
  background(216, 31, 38);

  face.setTarget({
    valence: -0.3,
    arousal: 0.2,
    dominance: 0.5,
    tension: 0.6,
    speaking: mouseIsPressed ? 1 : 0,
    listening: mouseIsPressed ? 0 : 1,
  });

  face.update(deltaTime / 1000);
  face.render({ p: window, x: 0, y: 0, w: width, h: height });
}
```

## 3.7) GPT (`portal/GptClient.js`)

`GptClient` is the shared browser-side helper for plain-text and structured GPT responses.

### Constructor
```js
new GptClient({
  apiKey,
  model: "gpt-4o-mini",
  instructions: "You answer clearly and briefly.",
  functionSchemas: [],   // optional structured schema list
  functionName: null,    // optional forced function/tool name
  temperature: 0.7,
  max_tokens: 400,
})
```

### Core API
- `await ask(userPrompt, img = null)`
- `latestObject`
- `lastRaw`
- `error`

### Plain-text example
```js
let gpt;
let apiKey = "";

async function setup() {
  await loadScript("portal/GptClient.js");
  apiKey = storedDecrypt({ apiKeyEncryptedGpt12 });

  gpt = new GptClient({
    apiKey,
    model: "gpt-4o-mini",
    instructions: "Answer clearly and simply.",
  });

  await gpt.ask("What is the capital of France?");

  if (gpt.error) {
    print("Error:", gpt.error);
  } else if (gpt.latestObject?.text) {
    print(gpt.latestObject.text);
  }
}
```

### Structured-response example
```js
let gpt;
let apiKey = "";

async function setup() {
  await loadScript("portal/GptClient.js");
  apiKey = storedDecrypt({ apiKeyEncryptedGpt12 });

  const schema = [
    {
      name: "color_response",
      description: "Return the color mentioned in the text.",
      parameters: {
        type: "object",
        properties: {
          color: { type: "string" },
        },
        required: ["color"],
      },
    },
  ];

  gpt = new GptClient({
    apiKey,
    model: "gpt-4o-mini",
    instructions: "Extract the color mentioned in the user's sentence.",
    functionSchemas: schema,
    functionName: "color_response",
  });

  const res = await gpt.ask("I like the color blue.");
  print(res.color);
}
```

### Image input example
```js
let gpt;
let img;

async function setup() {
  createCanvas(300, 300);
  await loadScript("portal/GptClient.js");
  apiKey = storedDecrypt({ apiKeyEncryptedGpt12 });

  gpt = new GptClient({
    apiKey,
    model: "gpt-4o-mini",
    instructions: "Return the dominant color of the image.",
    functionSchemas: [
      {
        name: "color_response",
        description: "Return the dominant color as a word.",
        parameters: {
          type: "object",
          properties: {
            color: { type: "string" },
          },
          required: ["color"],
        },
      },
    ],
    functionName: "color_response",
  });

  img = createGraphics(128, 128);
  img.background(255, 0, 0);

  const res = await gpt.ask("What color is this image?", img);
  print(res.color);
}
```

### GPT notes

- `storedDecrypt(...)` is the intended helper for encrypted browser-side API keys.
- Structured mode uses `functionSchemas` + `functionName`.
- `ask(prompt, img)` supports image input.
- `lastRaw` is useful for debugging raw API responses.
- If you are building production systems, do not assume browser-side keys are enough security on their own.

## 4) Projection Mapper (`mapper.js`)

`ProjectionMapper` lets you warp one or more p5 graphics surfaces to calibrated screen corners.

Core setup:
- `mapper = new ProjectionMapper()`
- `surface = mapper.add(w, h, name?)`
- `mapper.removeLastSurface({ clearStorage=true })`
- `mapper.render()`
- bottom-right `100x100` hold for `3s` toggles mapper corner markers by default

Persistence:
- `saveAll()` / `loadAll()` (legacy per-surface localStorage keys)
- `exportConfig()` / `importConfig(config, { replace=true })`
- `exportData()` (alias for `exportConfig()`)
- `downloadExport(filename?)`
- `saveToStorage(key?)`
- `loadFromStorage(key?, opts?)`
- `loadFromURL(url, opts?)`
- lowercase aliases: `savetostorage`, `loadfromstorage`, `loadfromurl`

Example:
```js
mapper.saveToStorage("my_mapping");
mapper.loadFromStorage("my_mapping");
await mapper.loadFromURL("assets/mapping.json");
mapper.downloadExport("my_mapping.json");
```

### Beginner mapper checklist

When mapping is not working, check:
- you created the sketch with `WEBGL`
- you loaded `portal/mapper.js`
- you draw into the returned `p5.Graphics` surfaces, not directly onto the main canvas
- you call `mapper.render()` every frame
- your mouse/key handlers forward events to the mapper when using manual calibration

## 5) Tracking + ML Modules

## Shared result pattern
Many modules expose:
- `hasResult()`
- `hasNewResult()`
- `getLatest()`
- `resetNewFlag()`
- `consumeNew()`

Use `getLatest()` as the default beginner read method in `draw()`. Use `hasNewResult()` + `consumeNew()` when you specifically want to react once to fresh input, then reach for richer getters only when you need a more specific view of the state.

## `NeuralLearner` (`portal/neuralLearner.js`)

Wrapper around `ml5.neuralNetwork` for both tasks:
- classification
- regression

### Constructor
```js
new NeuralLearner({
  task: "classification", // or "regression"
  backend: "webgl",
  nnOptions: {},          // forwarded to ml5.neuralNetwork
  trainingOptions: { epochs: 40, batchSize: 12 },
  autoTrain: true,
  retrainDebounceMs: 250,
  onResults: null,
  onTrained: null,
  onEpoch: null,
})
```

### Lifecycle
- `await init()`
- `await train(trainingOptions?)`

### Core recurring-learning API
- `learn(input, output)`  ← primary training call
- `learnMany(items)`
- `clearData()`
- `sampleCount()`
- `saveToStorage(key?)`
- `loadFromStorage(key?, { train=true, replace=true })`
- `loadFromURL(url, { train=true, replace=true })`
- `exportData()`
- `downloadExport(filename?)`

### Prediction
- `await predict(input)`
- `await classify(input)` alias
- `await regress(input)` alias

### State + polling helpers
- `isTrained()`
- `hasResult()`
- `hasNewResult()`
- `getLatest()` / `getlatest()`
- `resetNewFlag()`
- `consumeNew()`
- `getResult()`
- lowercase aliases: `istrained()`, `hasnewresult()`, `consumenew()`, `getresult()`

### Task-specific helpers
- Classification: `getBestLabel()` -> `{ label, confidence }`
- Regression: `getValue()` -> numeric value

### Minimal examples

Classification:
```js
learner.learn([mouseX / width, mouseY / height], "left");
await learner.predict([mouseX / width, mouseY / height]);
const best = learner.getBestLabel();
```

Regression:
```js
learner.learn([mouseX / width], mouseY / height);
await learner.predict([mouseX / width]);
const y = learner.getValue();
```

Object-style regression:
```js
learner.learn({ temp: 21 }, { mood: 2 });
learner.learn({ temp: 10 }, { mood: 1 });
learner.learn({ temp: 30 }, { mood: 4 });

await learner.predict({ temp: 25 });
const mood = learner.getValue("mood");
```

## `KnnLearner` (`portal/knnLearner.js`)

Wrapper around `ml5.KNNClassifier` (classification only).

### Constructor
```js
new KnnLearner({
  backend: "webgl",
  onResults: null,
})
```

### Lifecycle
- `await init()`

### Core API
- `learn(input, label)`  ← primary training call
- `learnMany(items)`
- `predict(input)` / `classify(input)`
- `clearData()`
- `load(url)` / `save(filename?)`
- `saveToStorage(key?)`
- `loadFromStorage(key?, { replace=true })`
- `loadFromURL(url, { replace=true })`
- `exportData()`
- `downloadExport(filename?)`

### Helpers
- `sampleCount()` / `samplecount()`
- `labelCount()`
- `getCountsByLabel()`
- `getBestLabel()` -> `{ label, confidence }`
- `getConfidences()`

### Polling state
- `hasResult()`
- `hasNewResult()` / `hasnewresult()`
- `getLatest()` / `getlatest()`
- `resetNewFlag()`
- `consumeNew()` / `consumenew()`
- `getResult()` / `getresult()`

### Minimal example
```js
const learner = await new KnnLearner().init();
learner.learn([x, y], "left");
await learner.predict([x, y]);
const best = learner.getBestLabel();
```

Use **KNN** for quick prototypes with small, interactive datasets.
Use **NeuralLearner** for trainable weight-based models (classification or regression).

## `PortalMqtt` (`portal/mqtt.js`)

Simple MQTT wrapper for browser sketches.

### Constructor
```js
new PortalMqtt({
  broker: "wss://public:public@public.cloud.shiftr.io",
  clientId: "p5jsids",
  options: {},
  autoConnect: true,
  onConnect: null,
  onMessage: null,
  onDisconnect: null,
  onError: null,
})
```

### Lifecycle + network
- `await init()`
- `await connect()`
- `disconnect(force?)`
- `await subscribe(topic, options?)`
- `await unsubscribe(topic)`
- `await publish(topic, message, options?)`

### Polling helpers
- `hasResult()`
- `hasNewResult()` / `hasnewresult()`
- `getLatest()` / `getlatest()`
- `resetNewFlag()`
- `consumeNew()` / `consumenew()`
- `getResult()` / `getresult()`

### Minimal example
```js
await loadScript("portal/mqtt.js");
const mq = await new PortalMqtt().init();
await mq.subscribe("/idsesp32");
await mq.publish("/idsp5js", "on");

if (mq.hasNewResult()) {
  const { result } = mq.consumeNew();
  print(result.topic + ": " + result.message);
}
```

## `HeartRateBLE` (`portal/heartRateBLE.js`)

Web Bluetooth helper for heart-rate monitors using the standard `heart_rate` service.

It is built for sketch stability:
- reconnects automatically if BLE disconnects
- attempts auto-reconnect after page refresh (for previously granted devices)

### Constructor
```js
new HeartRateBLE({
  autoReconnect: true,
  autoReconnectOnRefresh: true,
  reconnectDelayMs: 1200,
  reconnectMaxDelayMs: 30000,
  reconnectJitterMs: 350,
  storageKey: "portal.heartRateBLE.deviceId",
  onReading: null,
  onConnect: null,
  onDisconnect: null,
  onError: null,
  onState: null,
})
```

### Lifecycle + connection
- `await init()`
- `await connect()` / `await connectWithPicker()` (user gesture required first time)
- `await tryReconnectKnown()` (no picker, previously granted device only)
- `disconnect()`
- `enableAutoReconnect(enabled?)`

### Reading + polling
- `hasResult()`
- `hasNewResult()` / `hasnewresult()`
- `getLatest()` / `getlatest()`
- `resetNewFlag()`
- `consumeNew()` / `consumenew()`
- `getResult()` / `getresult()`
- `getBPM()`
- `getRRIntervals()`
- `getConnectionState()`
- `await resetEnergyExpended()`

### Minimal example
```js
await loadScript("portal/heartRateBLE.js");

const hr = await new HeartRateBLE().init();

// First time must be called from a user gesture:
// if (uiButton("pulse", ...).clicked) await hr.connect();

if (hr.hasNewResult()) {
  const { result } = hr.consumeNew();
  const bpm = result.heartRate;
  const rr = result.rrIntervals || [];
}
```

## `PortalTransformer` (`portal/transformer.js`)

Client-side LLM helper built on Transformers.js.

### Constructor
```js
new PortalTransformer({
  task: "question-answering",
  model: "Xenova/distilbert-base-cased-distilled-squad",
  quantized: true,
  dtype: null,
  device: null,
  context: "",
  maxNewTokens: 96,
  temperature: 0.2,
  topK: 40,
  onResult: null,
  onProgress: null,
})
```

### Lifecycle + model loading
- `await init()`
- `await loadModel({ task, model, quantized, dtype, device })`
- `setContext(text)`

### Q/A API (structured)
- `await ask(question, { context })`
- `await askStructured(question, { context })`

Structured result:
```js
{
  type: "qa",
  task: "...",
  model: "...",
  question: "...",
  answer: "...",
  confidence: 0.0-1.0,
  // optional:
  reason: "...",
  raw: ...
}
```

### Polling helpers
- `hasResult()`
- `hasNewResult()` / `hasnewresult()`
- `getLatest()` / `getlatest()`
- `resetNewFlag()`
- `consumeNew()` / `consumenew()`
- `getResult()` / `getresult()`
- `getAnswer()`
- `getConfidence()`

### Suggested small browser models
- `Xenova/distilbert-base-cased-distilled-squad` (`question-answering`)
- `Xenova/flan-t5-small` (`text2text-generation`)
- `Xenova/distilgpt2` (`text-generation`)

### Minimal example
```js
await loadScript("portal/transformer.js");
const t = await new PortalTransformer().init();
const r = await t.ask("What is Denmark's capital?", {
  context: "Denmark's capital is Copenhagen.",
});
print(r.answer, r.confidence);
```

## `HandPose` (`portal/handPose.js`)

### Constructor
```js
new HandPose({
  video,                // required p5 capture or HTML video
  videoIsFlipped=false,
  backend="webgl",
  onResults=null
})
```

### Lifecycle
- `await init()`
- `await start()`
- `stop()`

### Data
- `getLatest()` -> `{ hands, left, right, first, second }`
- `consumeNew()` -> `{ wasNew, hands, left, right, first, second }`
- `getHands()` (video-space pixels, flipped)
- `getHandsRaw()`
- `getHandsInRect(x, y, w, h)` (mapped to the same rect as `image(video, x, y, w, h)`)
- `getFirstHand()` / `getSecondHand()`
- `getLeftHand()` / `getRightHand()`
- `getLeftHandInRect(...)` / `getRightHandInRect(...)`

### Polling
- `hasResult()`
- `hasNewResult()`
- `getLatest()`
- `resetNewFlag()`
- `consumeNew()`

### Draw
- `drawHands(x=0, y=0, w=null, h=null, ptSize=6, drawSkeleton=true, showLabels=false)`

## `BodyPose` (`portal/bodyPose.js`)

### Constructor
```js
new BodyPose({
  video,
  videoIsFlipped=false,
  backend="webgl",
  modelType="SINGLEPOSE_THUNDER", // also supports other MoveNet modes
  onResults=null
})
```

### Lifecycle
- `await init()`
- `await start()`
- `stop()`

### Data
- `getLatest()` -> `{ poses, best }`
- `consumeNew()` -> `{ wasNew, poses, best }`
- `getPoses()` (video-space pixels)
- `getPosesRaw()`
- `getPosesInRect(x, y, w, h)` (mapped to the same rect as `image(video, x, y, w, h)`)
- `getBest()`
- `getPose(index=0)`
- `getLimbPosition(person, id, x, y, w, h)`
- `getLimpPosition(...)` (backward-compat alias)

### Polling
- `hasResult()`
- `hasNewResult()`
- `getLatest()`
- `resetNewFlag()`
- `consumeNew()`

### Draw
- `drawPoses(x, y, w, h, options)`

## `FaceMesh` (`portal/faceMesh.js`)

### Constructor
```js
new FaceMesh({
  video,
  videoIsFlipped=false,
  backend="webgl",
  options: { maxFaces: 1, refineLandmarks: true, flipHorizontal: false },
  onResults=null
})
```

### Lifecycle
- `await init()`
- `await start()`
- `stop()`

### Data
- `getLatest()` -> `{ faces, best }`
- `consumeNew()` -> `{ wasNew, faces, best }`
- `getFaces()` (video-space pixels)
- `getFacesRaw()`
- `getFacesInRect(x, y, w, h)` (mapped to the same rect as `image(video, x, y, w, h)`)
- `getBest()`

### Polling
- `hasResult()`
- `hasNewResult()`
- `getLatest()`
- `resetNewFlag()`
- `consumeNew()`

### Draw
- `drawKeypoints(x=0, y=0, w=null, h=null, { minConfidence, pointSize, color })`
- `drawFaces(...)` alias

## `EmotionTracker` / `Emotions` (`portal/emotions.js`)

### Constructor
```js
new EmotionTracker({
  video,
  videoIsFlipped=false,
  onResults=null
})
```

`Emotions` is an alias class extending `EmotionTracker`.

### Lifecycle
- `await init()`
- `await start()`
- `stop()`

### Landmarks + emotions
- `getLatest()` -> `{ positions, emotions }`
- `consumeNew()` -> `{ wasNew, positions, emotions }`
- `getPositions()` (video-space pixels) / `getPositionsRaw()` / `getPositionsInRect(...)` (draw-rect pixels)
- `getPoint(index, x, y, w, h)`
- `getLandmark(...)` / `getlandmark(...)`
- `landmarkExists(...)` / `landmarkexists(...)`
- `getLandmarks(x, y, w, h, limit)`
- `getEmotions()`
- `getEmotion(name)`
- `getDominantEmotion()`

### Polling
- `hasResult()`
- `hasNewResult()`
- `getLatest()`
- `resetNewFlag()`
- `consumeNew()`

### Draw
- `drawPoints(x, y, w, h, opts)`
- `drawEmotionBars(x, y, opts)`

## `QrReader` (`portal/QrReader.js`)

### Constructor
```js
new QrReader({
  video,
  videoIsFlipped=false,
  onResult=null,
  cooldownMs=5000
})
```

### Lifecycle
- `await init()`
- `start()`
- `stop()`
- `dispose()`

### Data
- `hasResult()`
- `hasNewResult()`
- `getLatest()` -> `{ text, result }`
- `resetNewFlag()`
- `consumeNew()` -> `{ wasNew, text, result }`
- `getText()`
- `getResult()`

### Draw
- `drawOverlay(x=0, y=0, w=null, h=null)`

## `P5ObjectDetector` (`portal/P5ObjectDetector.js`)

### Constructor
```js
new P5ObjectDetector({
  model="cocossd",    // or model URL
  video,
  backend="webgl",
  scoreThreshold=0.5,
  onDetections=null
})
```

### Lifecycle
- `await init()`
- `start()`
- `stop()`

### Data
- `hasResult()` / `hasNewResult()` / `getLatest()` / `resetNewFlag()` / `consumeNew()`
- `getDetections()`
- `getBest()`

### Draw
- `drawDetections(xOffset=0, yOffset=0, showScore=true)`

## `P5ImageClassifier` (`portal/P5ImageClassifier.js`)

### Constructor
```js
new P5ImageClassifier({
  model="MobileNet",   // or TM URL
  video,
  backend="webgl",
  topK=3,
  onResults=null
})
```

### Lifecycle
- `await init()`
- `start()`
- `stop()`

### Data
- `hasResult()` / `hasNewResult()` / `getLatest()` / `resetNewFlag()` / `consumeNew()`
- `getResults()`
- `getBest()`

### Draw
- `drawResults(x=16, y=24, lineH=20)`

## 5) Speech (`portal/speech.js`)

`PortalSpeech` wraps `p5.speech` with polling support and safer restart behavior.

### Constructor
```js
new PortalSpeech({
  language="en-US",
  voice=null,
  pitch=1,
  rate=1,
  volume=1
})
```

### Lifecycle
- `await init()`

### Voice + synthesis
- `setLanguage(lang)`
- `setVoice(name)`
- `setPitch(value)`
- `setRate(value)`
- `setVolume(value)`
- `await speak(text, languageOverride=null)`
- `stopSpeaking()`

### Listening
- `await listen(languageOverride=null)` one-shot
- `listenRecurring(onSentence=null, { language=null, interimResults=false })`
- `stopListening()`
- `isListening()`

### Result polling
- `hasResult()`
- `hasNewResult()` / `hasnewresult()`
- `getLatest()` / `getlatest()`
- `resetNewFlag()`
- `consumeNew()` / `consumenew()`
- `getResult()` / `getresult()` / `getText()`

### Events (optional)
- `onResult(handler)`
- `setResultHandler(handler)`
- `onListeningChange(handler)`

### Built-in matching helper
- `isMatch(query, options)` / `ismatch(...)`

`isMatch` supports:
- string, regex, array of queries, or predicate function
- `all`, `exact`, `wholeWord`, `caseSensitive`
- normalization options

Examples:

```js
speech.isMatch("red");
speech.isMatch(["background", "red"], { all: true });
speech.isMatch(/^where is/i);
```

### Speech + listening interaction
When recurring listening is active, `speak()` automatically:
1. pauses listening,
2. speaks,
3. resumes recurring listening.

## 6) Other Utility Modules

## Audio (`portal/SoundFile.js`)
- `await loadSoundFile(url)`
- `new SoundFile(url)` then `await load(url)`
- controls: `play()`, `pause()`, `stop()`, `toggle()`
- settings: `setVolume(v)`, `setLoop(bool)`, `seek(seconds)`
- events: `on(event, handler)`
- properties: `time`, `duration`, `playing`

## GPT client (`portal/GptClient.js`)
- `new GptClient({...})`
- `await ask(prompt, img=null)`
- supports text and image input
- supports optional function-call schema output
- result state: `latestObject`, `hasNew`, `error`, `lastRaw`

## Location helpers (`portal/location.js`)
- `getLocation()`
- `getDistanceFromLatLonInKm(...)`
- `bearingToTarget(...)`
- `getArrowDirection(...)`
- `drawArrow(...)`
- `onAskButtonClicked()` (iOS orientation permission)

## Gamepad (`portal/gamepad.js`)
- `await setupGamepad()`
- reads states into global `gamePads`

## Noise (`portal/pNoise.js`)
- `pSetNoiseSeed(seed)`
- `pSetNoiseRange(min, max)`
- `pNoise1D(x)`
- `pNoise2D(x, y=0)`
- `pNoise3D(x, y=0, z=0)`

## 7) Coordinate-Space Rule (Important)

For video-based modules, the default assumption is:
- coordinates are pixel coordinates
- the default getters (`getLatest()`, `getHands()`, `getFaces()`, `getPoses()`, `getPositions()`) are in video-space pixels
- they are not normalized `0..1`

If you draw the camera with `image(video, x, y, w, h)`, use the matching `...InRect(x, y, w, h)` helper to get draw-rect pixels aligned to that image call.

If your overlays are misaligned, it usually means you are mixing video-space pixels with draw-rect pixels.

## 8) Minimal End-to-End Example (Speech + UI polling)

```js
let speech;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/speech.js");
  speech = await new PortalSpeech({ language: "en-GB" }).init();
}

function draw() {
  background(20);

  if (uiButton(speech?.isListening() ? "Stop" : "Start", {
    x: 30, y: 30, width: 180, height: 60
  }).clicked) {
    if (speech?.isListening()) speech.stopListening();
    else speech.listenRecurring();
  }

  const { text } = speech?.getLatest?.() || {};
  if (text) {
    if (speech.isMatch("red")) speech.speak("i like blue", "en-GB");
    fill(255);
    text(text, 30, 130);
  }
}
```

## 9) Notes

- Portal is designed for **fast sketching first**: simple constructor + `init/start` + polling in `draw()`.
- Prefer polling with `getLatest()` for current state, and use `hasNewResult()` + `consumeNew()` when you need edge-triggered updates.
- Callback style is still supported in most modules when you want event-driven behavior.
