import test from "node:test";
import assert from "node:assert/strict";

import {
  assertIsfWebgl2Profile,
  assertIsfWebgl2VertexProfile,
  canonicalizeIsfWebgl2Source,
  canonicalizeIsfWebgl2VertexSource,
  compileIsfFragmentSource,
  compileIsfOptimizedFragmentSource,
  compileIsfTransitionKernel,
  createIsfNodeDefinition,
  createIsfVisualComponent,
  evaluateIsfDimension,
  listProjectIsfTransitions,
  listProjectIsfVisualComponents,
  mergeProjectIsfDefinitions,
  parseIsfDocument,
} from "../js/libraries/isf-engine/index.js";
import { getEffectNodeComponent } from "../js/libraries/visual-nodes/catalog.js";
import {
  defaultParamValues,
  normalizeParamValues,
} from "../js/libraries/visual-nodes/shared/component-schema.js";
import { mapperTransitionFragmentShaderSource } from "../js/libraries/mapping-engine/mapping-engine/index.js";
import { serializeNodeProjectData } from "../js/libraries/node-engine/node-project.js";
import { createProjectNodeFork } from "../js/libraries/node-engine/node-editor.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/project-visual-node-resolver.js";
import { compileShaderSchedule } from "../js/graph/shader-scheduler.js";

const profile = (source) => canonicalizeIsfWebgl2Source(source);

const FILTER = profile(`/*{
  "ISFVSN": "2.0",
  "LABEL": "Tint",
  "DESCRIPTION": "Test filter",
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "level", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
    { "NAME": "center", "TYPE": "point2D", "DEFAULT": [0.25, 0.75] }
  ]
}*/
void main() {
  gl_FragColor = IMG_THIS_NORM_PIXEL(inputImage) * vec4(level, center.x, center.y, 1.0);
}`);

const TRANSITION = profile(`/*{
  "ISFVSN": "2.0",
  "LABEL": "Soft Wipe",
  "INPUTS": [
    { "NAME": "startImage", "TYPE": "image" },
    { "NAME": "endImage", "TYPE": "image" },
    { "NAME": "progress", "TYPE": "float", "MIN": 0, "MAX": 1 },
    { "NAME": "softness", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0, "MAX": 1 }
  ]
}*/
void main() {
  float edge = smoothstep(progress - softness, progress + softness, isf_FragNormCoord.x);
  gl_FragColor = mix(IMG_THIS_NORM_PIXEL(startImage), IMG_THIS_NORM_PIXEL(endImage), edge);
}`);

test("ISF parser validates metadata and identifies filters", () => {
  const document = parseIsfDocument(FILTER, { path: "shaders/tint.fs" });
  assert.equal(document.kind, "effect");
  assert.equal(document.name, "Tint");
  assert.equal(document.inputs.length, 3);
  assert.equal(document.passes.length, 1);
  assert.equal(document.roiSafe, true);
});

test("the VJ1 WebGL2 profile canonicalizes at import and rejects legacy runtime sources", () => {
  const legacy = `/*{ "ISFVSN": "2.0", "LABEL": "Legacy" }*/
    float sign(float value) { return value < 0.0 ? -1.0 : 1.0; }
    void main() {
      gl_FragColor = texture2D(inputImage, vv_FragNormCoord)
        * sign(vv_FragNormCoord.x);
    }`;
  const canonical = canonicalizeIsfWebgl2Source(legacy, {
    path: "shaders/legacy.fs",
  });
  const document = parseIsfDocument(canonical, {
    path: "shaders/legacy.fs",
  });

  assert.equal(assertIsfWebgl2Profile(document), document);
  assert.match(canonical, /"PROFILE": "vj1-isf-webgl2@1"/);
  assert.match(canonical, /isf_FragColor = texture\(inputImage, isf_FragNormCoord\)/);
  assert.match(canonical, /float vj1_sign\(float value\)/);
  assert.doesNotMatch(canonical, /\bgl_FragColor\b|\btexture2D\b|\bvv_FragNormCoord\b/);
  assert.throws(
    () => createIsfNodeDefinition({
      path: "shaders/legacy.fs",
      source: legacy,
    }),
    /VJ1_ISF_PROFILE_REQUIRED/,
  );
});

test("project ISF ingestion migrates legacy library files before strict node creation", () => {
  const legacy = `/*{
    "ISFVSN": "2",
    "LABEL": "Legacy Project Shader",
    "IMPORTED": [],
    "INPUTS": [{ "NAME": "inputImage", "TYPE": "image" }]
  }*/
  void main() {
    gl_FragColor = IMG_THIS_PIXEL(inputImage);
  }`;
  const merged = mergeProjectIsfDefinitions({}, [{
    path: "shaders/Legacy Project Shader.fs",
    name: "Legacy Project Shader.fs",
    code: legacy,
  }]);
  const definition = merged.definitions[0];
  const sourcePart = definition.parts.find((part) => part.id === "isf-source");

  assert.equal(merged.definitions.length, 1);
  assert.match(sourcePart.source, /"PROFILE": "vj1-isf-webgl2@1"/);
  assert.match(sourcePart.source, /"IMPORTED": \{\}/);
  assert.match(sourcePart.source, /isf_FragColor = IMG_THIS_PIXEL/);
  assert.doesNotMatch(sourcePart.source, /\bgl_FragColor\b/);
});

test("paired ISF vertex stages compile as first-class WebGL2 node parts", () => {
  const fragmentSource = profile(`/*{
    "ISFVSN": "2.0",
    "LABEL": "Vertex Offset Probe",
    "INPUTS": [
      { "NAME": "inputImage", "TYPE": "image" },
      { "NAME": "spread", "TYPE": "float", "DEFAULT": 1 }
    ]
  }*/
  #if __VERSION__ <= 120
  varying vec2 offsetCoord;
  #else
  in vec2 offsetCoord;
  #endif
  void main() {
    gl_FragColor = IMG_NORM_PIXEL(inputImage, offsetCoord);
  }`);
  const vertexSource = canonicalizeIsfWebgl2VertexSource(`
    #if __VERSION__ <= 120
    varying vec2 offsetCoord;
    #else
    out vec2 offsetCoord;
    #endif
    void main() {
      isf_vertShaderInit();
      offsetCoord = isf_FragNormCoord + vec2(spread) / RENDERSIZE;
    }
  `, { path: "shaders/vertex-offset-probe.vs" });
  const component = createIsfVisualComponent({
    path: "shaders/vertex-offset-probe.fs",
    source: fragmentSource,
    vertexPath: "shaders/vertex-offset-probe.vs",
    vertexSource,
  });

  assert.equal(
    assertIsfWebgl2VertexProfile(vertexSource, {
      path: "shaders/vertex-offset-probe.vs",
    }),
    vertexSource,
  );
  assert.equal(component.nodeDefinition.parts.length, 2);
  assert.equal(component.nodeDefinition.metadata.isf.customVertexStage, true);
  assert.match(component.vertexCode, /^#version 300 es/);
  assert.match(component.vertexCode, /out vec2 offsetCoord;/);
  assert.match(component.vertexCode, /void isf_vertShaderInit\(\)/);
  assert.match(component.vertexCode, /uniform float spread;/);
  assert.match(component.code, /in vec2 offsetCoord;/);

  const merged = mergeProjectIsfDefinitions({}, [
    {
      path: "shaders/vertex-offset-probe.fs",
      name: "vertex-offset-probe.fs",
      code: fragmentSource,
    },
    {
      path: "shaders/vertex-offset-probe.vs",
      name: "vertex-offset-probe.vs",
      code: vertexSource,
    },
  ]);
  assert.equal(merged.definitions.length, 1);
  assert.equal(
    merged.definitions[0].parts.some((part) => part.stage === "vertex"),
    true,
  );
});

test("ISF imported images become validated sampler contracts", () => {
  const source = `/*{
    "ISFVSN": "2",
    "IMPORTED": { "noiseTex": { "PATH": "textures/noise.png" } }
  }*/
  void main() {
    gl_FragColor = IMG_NORM_PIXEL(noiseTex, isf_FragNormCoord);
  }`;
  const document = parseIsfDocument(source, {
    path: "shaders/imported.fs",
  });
  const compiled = compileIsfFragmentSource(document);

  assert.deepEqual(document.imported, [{
    name: "noiseTex",
    path: "textures/noise.png",
  }]);
  assert.match(compiled, /uniform sampler2D noiseTex;/);
  assert.match(compiled, /uniform vec2 noiseTex_imgSize;/);
  assert.match(compiled, /uniform bool noiseTex_flipY;/);
  assert.match(compiled, /uniform vec4 _noiseTex_imgRect;/);
  assert.match(compiled, /VJ1_IMG_NORM_PIXEL_noiseTex/);
  assert.throws(
    () => parseIsfDocument(
      source.replace("textures/noise.png", "../noise.png"),
      { path: "shaders/unsafe.fs" },
    ),
    /VJ1_ISF_IMPORTED_PATH_INVALID/,
  );
});

test("single-pass ISF transitions compile into the mapper transition kernel contract", () => {
  const document = parseIsfDocument(TRANSITION, { path: "shaders/transitions/soft-wipe.fs" });
  const kernel = compileIsfTransitionKernel(document, {
    id: "org.vj1.transition.soft-wipe",
    version: "1.0.0",
  });
  const mapperSource = mapperTransitionFragmentShaderSource({ transitionKernel: kernel });

  assert.equal(document.kind, "transition");
  assert.equal(kernel.implementation, "isf");
  assert.equal(kernel.uniforms.softness.defaultValue, 0.1);
  assert.equal(kernel.uniforms.startImage_imgSize.host, "startImageSize");
  assert.match(kernel.source, /vj1IsfOutput = mix\(vj1IsfStartColor, vj1IsfEndColor, edge\)/);
  assert.match(mapperSource, /vec4 color = vj1Transition\(fromColor, toColor, uv/);
  assert.match(mapperSource, /uniform float softness/);
});

test("project ISF transitions remain first-class transition nodes and compile from stable header identity", () => {
  const source = TRANSITION.replace(
    '"PROFILE": "vj1-isf-webgl2@1"',
    '"PROFILE": "vj1-isf-webgl2@1", "ID": "org.vj1.transition.soft-wipe", "VERSION": "1.2.0"'
  );
  const definition = createIsfNodeDefinition({
    path: "shaders/transitions/soft-wipe.fs",
    source,
  });
  const state = { nodes: { definitions: [definition] } };
  const transitions = listProjectIsfTransitions(state);

  assert.equal(definition.metadata.visualKind, "transition");
  assert.deepEqual(listProjectIsfVisualComponents(state), []);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].id, "org.vj1.transition.soft-wipe");
  assert.equal(transitions[0].version, "1.2.0");
  assert.equal(transitions[0].kernel.id, transitions[0].id);
  assert.deepEqual(transitions[0].parameters.map((param) => param.id), ["softness"]);
  assert.throws(
    () => createIsfVisualComponent({ path: "shaders/transitions/soft-wipe.fs", source }),
    /VJ1_ISF_TRANSITION_NOT_COMPONENT/
  );
});

test("multipass ISF transitions are rejected until they have an explicit retained-target policy", () => {
  const document = parseIsfDocument(TRANSITION.replace(
    '"LABEL": "Soft Wipe",',
    '"LABEL": "Soft Wipe",\n  "PASSES": [{ "TARGET": "history" }, {}],'
  ));
  assert.throws(() => compileIsfTransitionKernel(document), /VJ1_ISF_TRANSITION_MULTIPASS_UNSUPPORTED/);
});

test("audio and FFT inputs materialize as host resources without graph texture inlets", () => {
  const definition = createIsfNodeDefinition({
    path: "shaders/audio-input.fs",
    source: profile(`/*{
      "ISFVSN": "2.0",
      "INPUTS": [
        { "NAME": "waveform", "TYPE": "audio" },
        { "NAME": "spectrum", "TYPE": "audioFFT" }
      ]
    }*/
    void main() {
      gl_FragColor = IMG_THIS_PIXEL(waveform) + IMG_THIS_PIXEL(spectrum);
    }`),
  });
  const components = listProjectIsfVisualComponents({
    nodes: { definitions: [{ ...definition }] },
  });
  assert.equal(components.length, 1);
  assert.deepEqual(components[0].inlets, []);
  assert.equal(components[0].runtime.cacheable, false);
  assert.equal(components[0].isf.dynamic, true);
  assert.match(components[0].code, /uniform sampler2D waveform;/);
  assert.match(components[0].code, /uniform sampler2D spectrum;/);
});

test("ISF event inputs materialize as transient event parameters", () => {
  const component = createIsfVisualComponent({
    path: "shaders/event.fs",
    source: profile(`/*{
      "ISFVSN": "2.0",
      "INPUTS": [{ "NAME": "restart", "LABEL": "Restart", "TYPE": "event" }]
    }*/
    void main() { gl_FragColor = restart ? vec4(1.0) : vec4(0.0); }`),
  });
  const restart = component.params.find((param) => param.id === "restart");
  assert.equal(restart.type, "event");
  assert.equal(restart.isfUniformType, "event");
  assert.equal("restart" in defaultParamValues(component), false);
  assert.equal(normalizeParamValues(component, { restart: 7 }).restart, 7);
  assert.equal(compileShaderSchedule([{
    id: component.id,
    instanceId: "event-instance",
    params: { restart: 7, renderQuality: 0.5 },
  }], {
    getEffectComponent: () => component,
  })[0].pass.params.restart, 7);
  assert.equal(component.runtime.cacheable, false);
});

test("named multi-image ISF files materialize as executable visual graph nodes", () => {
  const definition = createIsfNodeDefinition({
    path: "shaders/two-inputs.fs",
    source: profile(`/*{
      "ISFVSN": "2.0",
      "LABEL": "Two Images",
      "INPUTS": [
        { "NAME": "foreground", "TYPE": "image" },
        { "NAME": "background", "TYPE": "image" }
      ]
    }*/
    void main() {
      gl_FragColor = mix(
        IMG_THIS_NORM_PIXEL(background),
        IMG_THIS_NORM_PIXEL(foreground),
        0.5
      );
    }`),
  });
  const components = listProjectIsfVisualComponents({
    nodes: { definitions: [definition] },
  });

  assert.equal(components.length, 1);
  assert.equal(components[0].kind, "generator");
  assert.deepEqual(
    components[0].inlets.map((inlet) => inlet.id),
    ["foreground", "background"],
  );
  assert.match(components[0].code, /uniform sampler2D foreground/);
  assert.match(components[0].code, /uniform sampler2D background/);
});

test("ISF compiler owns standard declarations without redeclaring shader uniforms", () => {
  const document = parseIsfDocument(FILTER.replace("void main()", "uniform float TIME;\nvoid main()"));
  const source = compileIsfFragmentSource(document);
  assert.equal((source.match(/uniform float TIME;/g) || []).length, 1);
  assert.match(source, /uniform sampler2D inputImage;/);
  assert.match(source, /void vj1IsfUserMain\(/);
  assert.match(
    source,
    /mix\(VJ1_IMG_NORM_PIXEL_inputImage\(vj1IsfBoundaryUv\(\)\), isf_FragColor/,
  );
  assert.match(source, /uniform bool vj1IsfFinalPass/);
});

test("ISF compiler preserves declared dynamic loops for WebGL 2", () => {
  const document = parseIsfDocument(`/*{
    "ISFVSN": "2.0",
    "LABEL": "Neighborhood",
    "INPUTS": [
      { "NAME": "inputImage", "TYPE": "image" },
      { "NAME": "radius", "TYPE": "float", "DEFAULT": 2, "MIN": 1, "MAX": 15 }
    ],
    "PASSES": [{ "TARGET": "firstPass" }, {}]
  }*/
  void main() {
    vec4 color = vec4(0.0);
    for (float i=0.; i<=float(int(radius)); ++i) {
      color += IMG_PIXEL(inputImage, gl_FragCoord.xy + vec2(i, 0.0));
    }
    gl_FragColor = color;
  }`);
  const compiled = compileIsfFragmentSource(document);

  assert.match(compiled, /#version 300 es/);
  assert.match(compiled, /for \(float i=0\.; i<=float\(int\(radius\)\); \+\+i\)/);
});

test("an explicit ISF effect amount owns interpolation without a duplicate host mix", () => {
  const source = FILTER
    .replace(
      '{ "NAME": "level", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },',
      '{ "NAME": "amount", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },',
    )
    .replace(/\blevel\b/g, "amount");
  const compiled = compileIsfFragmentSource(parseIsfDocument(source));

  assert.equal((compiled.match(/uniform float amount;/g) || []).length, 1);
  assert.doesNotMatch(
    compiled,
    /isf_FragColor = mix\(VJ1_IMG_NORM_PIXEL_inputImage/,
  );
});

test("restricted optimized ISF lowerings preserve direct generation, fusion, and premultiplied alpha", () => {
  const black = parseIsfDocument(`/*{
    "ISFVSN": "2.0",
    "LABEL": "Black",
    "INPUTS": [],
    "VJ1": { "ID": "black-test", "LOWERING": "fragment-generator" }
  }*/
  void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }`);
  const invert = parseIsfDocument(`/*{
    "ISFVSN": "2.0",
    "LABEL": "Invert",
    "INPUTS": [
      { "NAME": "inputImage", "TYPE": "image" },
      { "NAME": "amount", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.0 }
    ],
    "VJ1": { "ID": "invert-test", "LOWERING": "local-effect" }
  }*/
  void main() {
    vec4 color = IMG_THIS_NORM_PIXEL(inputImage);
    gl_FragColor = vec4(mix(color.rgb, 1.0 - color.rgb, amount), color.a);
  }`);
  const generatorCode = compileIsfOptimizedFragmentSource(black);
  const effectCode = compileIsfOptimizedFragmentSource(invert);

  assert.match(generatorCode, /void main\(\)/);
  assert.doesNotMatch(generatorCode, /runEffect/);
  assert.match(effectCode, /vec4 runEffect\(vec2 uv, vec4 vj1SourceColor\)/);
  assert.match(effectCode, /vj1SourceColor\.rgb \/ vj1SourceAlpha/);
  assert.match(effectCode, /vj1IsfOutput\.rgb \* vj1IsfOutput\.a/);
  assert.doesNotMatch(effectCode, /texture2D/);
});

test("optimized local ISF carries declared float scalars into the fused effect contract", () => {
  const threshold = createIsfVisualComponent({
    path: "shaders/threshold.fs",
    source: profile(`/*{
      "ISFVSN": "2.0",
      "LABEL": "Threshold",
      "INPUTS": [
        { "NAME": "inputImage", "TYPE": "image" },
        { "NAME": "amount", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0.0, "MAX": 1.0 },
        { "NAME": "cutoff", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0 }
      ],
      "VJ1": { "ID": "threshold-test", "LOWERING": "local-effect" }
    }*/
    void main() {
      vec4 color = IMG_THIS_NORM_PIXEL(inputImage);
      float ink = step(cutoff, dot(color.rgb, vec3(0.2126, 0.7152, 0.0722)));
      gl_FragColor = vec4(mix(color.rgb, vec3(ink), amount), color.a);
    }`),
  });
  const params = Object.fromEntries(
    threshold.params.map((param) => [param.id, param]),
  );

  assert.equal(threshold.fusible, true);
  assert.equal(threshold.spatial, false);
  assert.equal(threshold.boundaryEditable, true);
  assert.equal(params.amount.defaultValue, 0.65);
  assert.equal(params.cutoff.defaultValue, 0.5);
  assert.match(threshold.code, /step\(cutoff,/);
  assert.match(threshold.code, /vj1IsfOutput\.rgb \* vj1IsfOutput\.a/);
});

test("optimized ISF lowering rejects semantics that cannot stay in the declared fast path", () => {
  const dynamic = parseIsfDocument(`/*{
    "ISFVSN": "2.0",
    "INPUTS": [],
    "VJ1": { "ID": "dynamic-test", "LOWERING": "fragment-generator" }
  }*/
  void main() { gl_FragColor = vec4(TIME); }`);
  const neighborhood = parseIsfDocument(`/*{
    "ISFVSN": "2.0",
    "INPUTS": [
      { "NAME": "inputImage", "TYPE": "image" },
      { "NAME": "amount", "TYPE": "float", "DEFAULT": 1.0 }
    ],
    "VJ1": { "ID": "neighbor-test", "LOWERING": "local-effect" }
  }*/
  void main() {
    gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord + vec2(0.01));
  }`);
  const vectorInput = parseIsfDocument(`/*{
    "ISFVSN": "2.0",
    "INPUTS": [
      { "NAME": "inputImage", "TYPE": "image" },
      { "NAME": "amount", "TYPE": "float", "DEFAULT": 1.0 },
      { "NAME": "center", "TYPE": "point2D", "DEFAULT": [0.5, 0.5] }
    ],
    "VJ1": { "ID": "vector-test", "LOWERING": "local-effect" }
  }*/
  void main() {
    vec4 color = IMG_THIS_NORM_PIXEL(inputImage);
    gl_FragColor = vec4(color.rgb * center.x, color.a);
  }`);

  assert.throws(
    () => compileIsfOptimizedFragmentSource(dynamic),
    /VJ1_ISF_FRAGMENT_GENERATOR_SYMBOL_UNSUPPORTED/,
  );
  assert.throws(
    () => compileIsfOptimizedFragmentSource(neighborhood),
    /VJ1_ISF_LOCAL_EFFECT_SYMBOL_UNSUPPORTED/,
  );
  assert.throws(
    () => compileIsfOptimizedFragmentSource(vectorInput),
    /VJ1_ISF_LOCAL_EFFECT_INPUT_CONTRACT_INVALID/,
  );
});

test("ISF fragment coordinates remain semantic when the physical preview size changes", () => {
  const source = FILTER.replace(
    "isf_FragColor = IMG_THIS_NORM_PIXEL(inputImage) * vec4(level, center.x, center.y, 1.0);",
    "vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;\n  isf_FragColor = vec4(uv, 0.0, 1.0);",
  );
  const compiled = compileIsfFragmentSource(parseIsfDocument(source));
  assert.match(compiled, /vec2 uv = vj1IsfFragCoord\.xy \/ RENDERSIZE\.xy/);
  assert.match(compiled, /#define vj1IsfFragCoord vec4\(vj1IsfBoundaryUv\(\) \* RENDERSIZE/);
  assert.match(compiled, /return vec2\(topLeftUv\.x, 1\.0 - topLeftUv\.y\)/);
  assert.match(compiled, /uniform bool inputImage_flipY/);
  assert.match(
    compiled,
    /VJ1_IMG_NORM_PIXEL_inputImage\(vj1IsfBoundaryUv\(\)\)/,
  );
  assert.match(
    compiled,
    /vec2 topLeftUv = vec2\(isfUv\.x, 1\.0 - isfUv\.y\)/,
  );
});

test("ISF files materialize as typed project visual nodes", () => {
  const component = createIsfVisualComponent({ path: "shaders/tint.fs", source: FILTER });
  assert.equal(component.kind, "effect");
  assert.equal(component.type, "isf");
  assert.equal(component.spatial, false);
  assert.equal(component.boundaryEditable, true, "ISF effects expose the shared boundary handles");
  assert.equal(component.nodeDefinition.metadata.projectAssetPath, "shaders/tint.fs");
  assert.equal(component.params.find((param) => param.id === "level").defaultValue, 0.5);
  assert.equal(component.params.find((param) => param.id === "centerX").defaultValue, 0.25);
  assert.equal(component.fusible, false);
});

test("animated ISF definitions preserve temporal invalidation at the node compiler boundary", () => {
  const source = FILTER.replace(
    "isf_FragColor =",
    "isf_FragColor = vec4(sin(TIME)) +",
  );
  const definition = createIsfNodeDefinition({ path: "shaders/animated.fs", source });

  assert.equal(definition.metadata.isf.dynamic, true);
  assert.deepEqual(definition.metadata.renderInvalidation, {
    mode: "frame",
    reason: "isf-time",
  });
  assert.doesNotThrow(() => structuredClone(definition));
  assert.equal(definition.metadata.visualContract.roi.mode, "local");
});

test("ISF pass dimensions stay relative to current render demand", () => {
  assert.equal(evaluateIsfDimension("$WIDTH / 4", { WIDTH: 1920 }), 480);
  assert.equal(evaluateIsfDimension("$HEIGHT * 0.5", { HEIGHT: 1080 }), 540);
  assert.equal(evaluateIsfDimension("floor($WIDTH / 3.0)", { WIDTH: 10 }), 3);
  assert.equal(
    evaluateIsfDimension(
      "max(floor($WIDTH * min($quality, 1.0)), 1.0)",
      { WIDTH: 100, quality: 0.25 },
    ),
    25,
  );
  assert.throws(() => evaluateIsfDimension("globalThis.alert(1)", { WIDTH: 10 }), /VJ1_ISF_PASS_SIZE_INVALID/);
  assert.throws(() => evaluateIsfDimension("ceil($WIDTH)", { WIDTH: 10 }), /VJ1_ISF_PASS_SIZE_INVALID/);
});

test("ISF pass metadata accepts the standard allow-listed dimension functions", () => {
  const source = FILTER.replace(
    '"DESCRIPTION": "Test filter",',
    '"DESCRIPTION": "Test filter",\n  "PASSES": [{ "TARGET": "small", "WIDTH": "max(floor($WIDTH * 0.25), 1.0)", "HEIGHT": "floor($HEIGHT / 2.0)" }, {}],',
  );
  const document = parseIsfDocument(source);

  assert.equal(document.passes[0].width, "max(floor($WIDTH * 0.25), 1.0)");
  assert.equal(document.passes[0].height, "floor($HEIGHT / 2.0)");
});

test("multipass ISF exposes named persistent targets without duplicating them", () => {
  const source = FILTER.replace(
    '"DESCRIPTION": "Test filter",',
    '"DESCRIPTION": "Test filter",\n  "PASSES": [{ "TARGET": "history", "PERSISTENT": true, "WIDTH": "$WIDTH / 2" }, {}],'
  );
  const document = parseIsfDocument(source);
  const definition = createIsfNodeDefinition({
    path: "shaders/multipass.fs",
    source,
  });
  const component = createIsfVisualComponent({
    path: "shaders/multipass.fs",
    source,
  });
  const compiled = compileIsfFragmentSource(document);
  assert.equal(document.passes.length, 2);
  assert.equal(document.passes[0].persistent, true);
  assert.equal(document.roiSafe, false);
  assert.equal(definition.metadata.roi.mode, "full-frame");
  assert.equal(definition.metadata.visualContract.roi.mode, "full-frame");
  assert.equal(
    definition.metadata.visualCompilerHook.contract.roi.mode,
    "full-frame",
  );
  assert.equal(component.runtime.roi.mode, "full-frame");
  assert.equal((compiled.match(/uniform sampler2D history;/g) || []).length, 1);
  assert.throws(() => parseIsfDocument(source.replace('{ "TARGET": "history", "PERSISTENT": true, "WIDTH": "$WIDTH / 2" }', '{}')), /VJ1_ISF_PASS_ORDER_INVALID/);
});

test("project ISF bases stay file-backed while an edited fork recompiles", () => {
  const definition = createIsfNodeDefinition({ path: "shaders/tint.fs", source: FILTER });
  const persisted = serializeNodeProjectData({ definitions: [definition] });
  assert.deepEqual(persisted.definitions, []);
  const editedSource = FILTER.replace("* vec4(level, center.x, center.y, 1.0)", "* vec4(1.0, level, center.y, 1.0)");
  const fork = createProjectNodeFork(definition, {
    forkId: "edited-isf",
    overrides: { parts: [{ ...definition.parts[0], source: editedSource }] },
  });
  const resolver = createProjectVisualNodeResolver({ nodes: { definitions: [definition], forks: [fork] } });
  assert.match(resolver.effect(definition.metadata.visualId).code, /vec4\(1\.0, level/);
});

test("a built-in ISF fork stays editable and recompiles through the same fusible lowering", () => {
  const base = getEffectNodeComponent("invert");
  const editedSource = base.nodeDefinition.parts[0].source.replace(
    "1.0 - color.rgb",
    "vec3(0.25)",
  );
  const fork = createProjectNodeFork(base.nodeDefinition, {
    forkId: "edited-built-in-invert",
    overrides: {
      parts: [{ ...base.nodeDefinition.parts[0], source: editedSource }],
    },
  });
  const resolver = createProjectVisualNodeResolver({
    nodes: { forks: [{ ...fork, active: true }] },
  });
  const edited = resolver.effect("invert");

  assert.equal(edited.projectForkId, fork.id);
  assert.equal(edited.renderAuthority, "project-isf-node-fork");
  assert.equal(edited.fusible, true);
  assert.equal(edited.sampling, "local");
  assert.match(edited.nodeDefinition.parts[0].source, /vec3\(0\.25\)/);
  assert.match(edited.code, /vec3\(0\.25\)/);
});

test("ISF parser rejects unsupported versions and malformed ports", () => {
  assert.throws(() => parseIsfDocument(FILTER.replace('"2.0"', '"3.0"')), /VJ1_ISF_VERSION_UNSUPPORTED/);
  assert.throws(() => parseIsfDocument(FILTER.replace('"level"', '"bad name"')), /VJ1_ISF_INPUT_NAME_INVALID/);
});

test("project visual resolution tolerates file-backed definitions that are still pending", () => {
  const resolver = createProjectVisualNodeResolver({ nodes: { definitions: [] } });
  assert.equal(resolver.generator("isf-shaders-pending"), null);
  assert.equal(resolver.generatorShader("isf-shaders-pending"), null);
  assert.equal(resolver.effect("isf-shaders-pending"), null);
});
