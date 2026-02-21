# Portal (P1) API Reference

Portal is a p5.js helper layer for rapid sketch prototyping with camera, tracking, speech, UI, QR, and utility modules.

This README focuses on **detailed API usage**.
For walkthrough-style teaching material, use:
- [Portal overview](https://learn.hobye.dk/portal)
- [IoT & communication](https://learn.hobye.dk/portal/iot-com)
- [Machine learning](https://learn.hobye.dk/portal/machine-learning)
- [Maps & GPS](https://learn.hobye.dk/portal/maps-gps)

## 1) Quick Start

### Load Portal from a sketch

Use `testSketch/portalLoader.js` style:

```js
// portalLoader.js
async function loadPortal(version = "P1") {
  const s = document.createElement("script");
  s.src = `https://madshobye.github.io/Portal/${version}/portal/portal.js`;
  document.head.appendChild(s);

  await new Promise((resolve, reject) => {
    s.onload = resolve;
    s.onerror = reject;
  });

  const originalSetup = setup;
  setup = async function () {
    await pSetup();
    await originalSetup();
  };
}

loadPortal("P1");
```

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
  if (module?.hasNewResult()) {
    const data = module.consumeNew ? module.consumeNew() : null;
    // react to new data
  }
}
```

## 2) Core Runtime (`portal.js`)

`portal.js` is the base layer loaded by `pSetup()`.

### Setup and loading
- `await pSetup()`
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

## 3) UI Layer (`uiSlim2.js`)

Primary UI functions:
- `uiUpdateSimple()`
- `uiButton(label, style)`
- `uiText(text, style)`
- `uiPromptText(id, label, style)`
- `uiSlider(id, label, opts, style)`
- `uiToggle(id, label, style)`
- `uiRect(x, y, w, h, style)`
- `uiListStart(opts)` / `uiListEnd()`

Low-level / debug helpers:
- `uiUpdate(...)`, `uiHit(...)`, `uiShowInfo(...)`, `_uiDrawHUD(...)`, `_uiDrawGrid(...)`

Example:

```js
function draw() {
  const style = { x: 30, y: 30, width: 220, height: 64, fontSize: 24 };
  if (uiButton("Listen", style).clicked) {
    print("clicked");
  }
}
```

## 4) Tracking + ML Modules

## Shared result pattern
Many modules expose:
- `hasResult()`
- `hasNewResult()`
- `resetNewFlag()`
- `consumeNew()` (when implemented)

This supports easy `draw()` polling instead of callback-only code.

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
- `getHands()` (video-space, flipped)
- `getHandsRaw()`
- `getHandsInRect(x, y, w, h)`
- `getLeftHand()` / `getRightHand()`
- `getLeftHandInRect(...)` / `getRightHandInRect(...)`

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
- `getPoses()`
- `getPosesRaw()`
- `getPosesInRect(x, y, w, h)`
- `getBest()`
- `getPose(index=0)`
- `getLimbPosition(person, id, x, y, w, h)`
- `getLimpPosition(...)` (backward-compat alias)

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
- `getFaces()`
- `getFacesRaw()`
- `getFacesInRect(x, y, w, h)`
- `getBest()`

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
- `getPositions()` / `getPositionsRaw()` / `getPositionsInRect(...)`
- `getPoint(index, x, y, w, h)`
- `getLandmark(...)` / `getlandmark(...)`
- `landmarkExists(...)` / `landmarkexists(...)`
- `getLandmarks(x, y, w, h, limit)`
- `getEmotions()`
- `getEmotion(name)`
- `getDominantEmotion()`

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
- `hasResult()` / `hasNewResult()` / `resetNewFlag()` / `consumeNew()`
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
- `hasResult()` / `hasNewResult()` / `resetNewFlag()` / `consumeNew()`
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

For camera modules, data often comes in one of two spaces:
- **video space** (`getHands()`, `getFaces()`, `getPoses()`)  
- **draw rect space** (`get...InRect(x,y,w,h)`) matching `image(video, x, y, w, h)`

If your overlays are misaligned, use the `...InRect(...)` method with the same `x,y,w,h` as your `image(...)` call.

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

  if (speech?.hasNewResult()) {
    const { text } = speech.consumeNew();
    if (speech.isMatch("red")) speech.speak("i like blue", "en-GB");
    fill(255);
    text(text, 30, 130);
  }
}
```

## 9) Notes

- Portal is designed for **fast sketching first**: simple constructor + `init/start` + polling in `draw()`.
- Prefer polling (`hasNewResult()` + `consumeNew()`) for teaching and beginner readability.
- Callback style is still supported in most modules when you want event-driven behavior.
