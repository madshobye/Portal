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

## 4) Projection Mapper (`mapper.js`)

`ProjectionMapper` lets you warp one or more p5 graphics surfaces to calibrated screen corners.

Core setup:
- `mapper = new ProjectionMapper()`
- `surface = mapper.add(w, h, name?)`
- `mapper.render()`

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

## 5) Tracking + ML Modules

## Shared result pattern
Many modules expose:
- `hasResult()`
- `hasNewResult()`
- `resetNewFlag()`
- `consumeNew()` (when implemented)

This supports easy `draw()` polling instead of callback-only code.

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
- Prefer polling (`hasNewResult()` + `consumeNew()`) for readability in sketch loops.
- Callback style is still supported in most modules when you want event-driven behavior.
