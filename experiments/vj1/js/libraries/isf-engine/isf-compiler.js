import {
  defineTransitionKernel,
  TRANSITION_IMPLEMENTATION_FORMATS,
} from "../transition-engine/index.js";

const STANDARD_UNIFORMS = Object.freeze([
  ["float", "TIME"],
  ["float", "TIMEDELTA"],
  ["int", "FRAMEINDEX"],
  ["int", "PASSINDEX"],
  ["vec4", "DATE"],
  ["vec2", "RENDERSIZE"],
]);

const TRANSITION_STANDARD_UNIFORMS = Object.freeze({
  TIME: { type: "float", host: "time", defaultValue: 0 },
  TIMEDELTA: { type: "float", host: "timeDelta", defaultValue: 0 },
  FRAMEINDEX: { type: "int", host: "frameIndex", defaultValue: 0 },
  PASSINDEX: { type: "int", host: "passIndex", defaultValue: 0 },
  RENDERSIZE: { type: "vec2", host: "renderSize", defaultValue: [1, 1] },
});

export function compileIsfFragmentSource(document, { kind = document?.kind || "generator" } = {}) {
  if (!document?.fragmentSource) throw new Error("VJ1_ISF_DOCUMENT_REQUIRED");
  const effect = kind === "effect";
  const transition = kind === "transition";
  const explicitEffectAmount = effect &&
    document.inputs.some((input) =>
      input.name === "amount" && input.type === "float"
    );
  const imageNames = uniqueIdentifiers([
    ...document.inputs.filter((input) => ["image", "audio", "audioFFT"].includes(input.type)).map((input) => input.name),
    ...document.passes.map((pass) => pass.target).filter(Boolean),
    ...(effect ? ["inputImage"] : []),
  ]);
  const adaptedSource = adaptImageMacros(
    normalizeParameterBoundedLoops(
      String(document.fragmentSource),
      document.inputs,
    )
      .replace(/\bvarying\s+vec2\s+vTexCoord\s*;/g, "")
      // VJ1 may render only a physical ROI or a lower-resolution preview while
      // preserving the full logical ISF pass. Raw WebGL gl_FragCoord belongs
      // to that storage target, so expose the semantic pass coordinate instead.
      .replace(/\bgl_FragCoord\b/g, "vj1IsfFragCoord"),
    imageNames,
  );
  const source = renameMain(adaptedSource);
  const declared = declaredUniformNames(source);
  const inputUniforms = document.inputs
    .map((input) => [isfGlslType(input.type), input.name])
    .filter(([, name]) => !effect || name !== "amount")
    .filter(([, name]) => !declared.has(name));
  if (effect && !declared.has("inputImage") && !inputUniforms.some(([, name]) => name === "inputImage")) {
    inputUniforms.unshift(["sampler2D", "inputImage"]);
  }
  const reserved = new Set([...declared, ...inputUniforms.map(([, name]) => name)]);
  const targetUniforms = document.passes
    .map((pass) => pass.target)
    .filter(Boolean)
    .filter((name) => !reserved.has(name))
    .map((name) => ["sampler2D", name]);
  const standard = STANDARD_UNIFORMS.filter(([, name]) => !declared.has(name));
  const imageSizeUniforms = imageNames
    .map((name) => ["vec2", `${name}_imgSize`])
    .filter(([, name]) => !declared.has(name));
  const imageFlipUniforms = imageNames
    .map((name) => ["bool", `${name}_flipY`])
    .filter(([, name]) => !declared.has(name));
  return `
precision highp float;
varying vec2 vTexCoord;
uniform vec4 renderUvRect;
uniform mat3 ${effect ? "effectUvMatrix" : "contentUvMatrix"};
uniform float ${effect ? "amount" : "useContentTransform"};
uniform bool vj1IsfFinalPass;
${[...standard, ...inputUniforms, ...targetUniforms, ...imageSizeUniforms, ...imageFlipUniforms].map(([type, name]) => `uniform ${type} ${name};`).join("\n")}

vec2 vj1IsfBoundaryUv() {
  vec2 baseUv = renderUvRect.xy + vTexCoord * renderUvRect.zw;
  ${effect
    ? "vec2 topLeftUv = (effectUvMatrix * vec3(baseUv, 1.0)).xy; return vec2(topLeftUv.x, 1.0 - topLeftUv.y);"
    : "vec2 transformedUv = (contentUvMatrix * vec3(baseUv, 1.0)).xy; vec2 topLeftUv = mix(baseUv, transformedUv, step(0.5, useContentTransform)); return vec2(topLeftUv.x, 1.0 - topLeftUv.y);"}
}
vec2 vj1IsfPixelUv(vec2 pixelCoord) { return pixelCoord / max(RENDERSIZE, vec2(1.0)); }
vec2 vj1IsfSamplerUv(vec2 isfUv, bool storageFlipY) {
  vec2 topLeftUv = vec2(isfUv.x, 1.0 - isfUv.y);
  return storageFlipY ? vec2(topLeftUv.x, 1.0 - topLeftUv.y) : topLeftUv;
}
#define vj1IsfFragCoord vec4(vj1IsfBoundaryUv() * RENDERSIZE, 0.0, 1.0)
#define isf_FragNormCoord (vj1IsfBoundaryUv())
${imageNames.map((name) => `
#define VJ1_IMG_NORM_PIXEL_${name}(coord) texture2D(${name}, vj1IsfSamplerUv((coord), ${name}_flipY))
#define VJ1_IMG_PIXEL_${name}(coord) texture2D(${name}, vj1IsfSamplerUv((coord) / max(${name}_imgSize, vec2(1.0)), ${name}_flipY))`).join("\n")}

${source}

void main() {
  vj1IsfUserMain();
  ${effect && !explicitEffectAmount ? "if (vj1IsfFinalPass) gl_FragColor = mix(VJ1_IMG_NORM_PIXEL_inputImage(vj1IsfBoundaryUv()), gl_FragColor, clamp(amount, 0.0, 1.0));" : ""}
  ${transition ? "" : "if (vj1IsfFinalPass) gl_FragColor.rgb *= gl_FragColor.a;"}
}`.trim();
}

// WebGL 1 requires statically bounded loops. Some valid desktop ISF shaders
// use a numeric input as the upper bound instead. Keep the imported source
// unchanged and port only the narrow form whose finite maximum is declared in
// the ISF header; the early break preserves the requested runtime radius.
function normalizeParameterBoundedLoops(source, inputs = []) {
  const numericInputs = new Map(
    inputs
      .filter((input) => ["float", "long"].includes(input.type))
      .map((input) => [input.name, input]),
  );
  const parameterBoundedLoop =
    /for\s*\(\s*float\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*;\s*\1\s*<=\s*float\s*\(\s*int\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*\)\s*;\s*\+\+\s*\1\s*\)\s*\{/g;

  return String(source).replace(
    parameterBoundedLoop,
    (loop, indexName, startLiteral, parameterName) => {
      const input = numericInputs.get(parameterName);
      const maximum = Math.trunc(Number(input?.max));
      const start = Number(startLiteral);
      if (
        !Number.isFinite(maximum) ||
        !Number.isFinite(start) ||
        maximum < start ||
        maximum > 256
      ) {
        return loop;
      }
      return `for (float ${indexName}=${startLiteral}; ${indexName}<=${maximum}.0; ++${indexName}) {\nif (${indexName} > float(int(${parameterName}))) break;`;
    },
  );
}

// A deliberately narrow optimization contract for portable built-in ISF.
// General ISF continues through IsfRenderRuntime. These lowerings accept only
// semantics that are provably equivalent to VJ1's existing direct generator
// or fusible local-effect kernels.
export function compileIsfOptimizedFragmentSource(
  document,
  { lowering = document?.metadata?.VJ1?.LOWERING || "" } = {},
) {
  if (!document?.fragmentSource) throw new Error("VJ1_ISF_DOCUMENT_REQUIRED");
  if (
    document.passes.length !== 1 ||
    document.passes[0]?.persistent ||
    document.passes[0]?.target
  ) {
    throw new Error(
      `VJ1_ISF_OPTIMIZED_MULTIPASS_UNSUPPORTED:${document.path || document.name}`,
    );
  }
  if (lowering === "fragment-generator") {
    if (document.kind !== "generator" || document.inputs.length) {
      throw new Error(
        `VJ1_ISF_FRAGMENT_GENERATOR_CONTRACT_INVALID:${document.path || document.name}`,
      );
    }
    assertOptimizedIsfSymbols(document.fragmentSource, {
      allowed: [],
      code: "VJ1_ISF_FRAGMENT_GENERATOR_SYMBOL_UNSUPPORTED",
      path: document.path || document.name,
    });
    return ensureFragmentPrecision(document.fragmentSource);
  }
  if (lowering === "local-effect") {
    if (document.kind !== "effect") {
      throw new Error(
        `VJ1_ISF_LOCAL_EFFECT_REQUIRED:${document.path || document.name}`,
      );
    }
    const imageInputs = document.inputs.filter((input) =>
      ["image", "audio", "audioFFT"].includes(input.type)
    );
    if (
      imageInputs.length !== 1 ||
      imageInputs[0].name !== "inputImage" ||
      !document.inputs.some((input) =>
        input.name === "amount" && input.type === "float"
      ) ||
      document.inputs.some((input) =>
        !["image", "float"].includes(input.type)
      )
    ) {
      throw new Error(
        `VJ1_ISF_LOCAL_EFFECT_INPUT_CONTRACT_INVALID:${document.path || document.name}`,
      );
    }
    assertOptimizedIsfSymbols(document.fragmentSource, {
      allowed: ["isf_FragNormCoord", "IMG_THIS_NORM_PIXEL", "IMG_THIS_PIXEL"],
      code: "VJ1_ISF_LOCAL_EFFECT_SYMBOL_UNSUPPORTED",
      path: document.path || document.name,
    });
    return compileLocalEffectBody(document.fragmentSource, document.path);
  }
  throw new Error(
    `VJ1_ISF_OPTIMIZED_LOWERING_UNKNOWN:${lowering || "missing"}`,
  );
}

// ISF transitions are embedded as a kernel inside the mapper's existing
// projective presentation shader. Endpoint rendering, fit, ROI, feathering,
// and the transition itself therefore remain one physical mapper draw.
export function compileIsfTransitionKernel(document, {
  id = "",
  version = "0.1.0",
} = {}) {
  if (document?.kind !== "transition") throw new Error("VJ1_ISF_TRANSITION_REQUIRED");
  if (document.passes.length !== 1 || document.passes[0]?.persistent || document.passes[0]?.target) {
    throw new Error(`VJ1_ISF_TRANSITION_MULTIPASS_UNSUPPORTED:${document.path || document.name}`);
  }
  const uniforms = {};
  for (const input of document.inputs) {
    if (input.type === "image" || input.name === "progress") continue;
    uniforms[input.name] = {
      type: isfGlslType(input.type),
      parameter: input.name,
      defaultValue: isfTransitionDefault(input),
    };
  }
  for (const [name, specification] of Object.entries(TRANSITION_STANDARD_UNIFORMS)) {
    if (new RegExp(`\\b${name}\\b`).test(document.fragmentSource)) uniforms[name] = specification;
  }
  uniforms.startImage_imgSize = { type: "vec2", host: "startImageSize", defaultValue: [1, 1] };
  uniforms.endImage_imgSize = { type: "vec2", host: "endImageSize", defaultValue: [1, 1] };

  let source = String(document.fragmentSource)
    .replace(/\bvarying\s+vec2\s+vTexCoord\s*;/g, "")
    .replace(/\buniform\s+\w+\s+(?:startImage|endImage|progress)\s*;/g, "")
    .replace(/\bgl_FragCoord\b/g, "vec4(vj1IsfUv * RENDERSIZE, 0.0, 1.0)")
    .replace(/\bisf_FragNormCoord\b/g, "vj1IsfUv")
    .replace(/\bprogress\b/g, "vj1IsfProgress")
    .replace(/\bgl_FragColor\b/g, "vj1IsfOutput");
  source = adaptTransitionImageMacros(source, "startImage", "vj1IsfStartColor", "vj1IsfSampleStart", "vj1IsfSampleStartPixel");
  source = adaptTransitionImageMacros(source, "endImage", "vj1IsfEndColor", "vj1IsfSampleEnd", "vj1IsfSampleEndPixel");
  source = renameMain(source);

  return defineTransitionKernel({
    id: id || `isf.transition.${document.sourceHash || "inline"}`,
    version,
    name: document.name,
    description: document.description,
    implementation: TRANSITION_IMPLEMENTATION_FORMATS.ISF,
    uniforms,
    source: `
vec4 vj1IsfStartColor;
vec4 vj1IsfEndColor;
vec4 vj1IsfOutput;
vec2 vj1IsfUv;
float vj1IsfProgress;

vec4 vj1IsfSampleStart(vec2 uv) {
  return texture2D(fromTex, uFromSourceRect.xy + clamp(uv, vec2(0.0), vec2(1.0)) * uFromSourceRect.zw) * uFromOpacity;
}
vec4 vj1IsfSampleEnd(vec2 uv) {
  return texture2D(toTex, uToSourceRect.xy + clamp(uv, vec2(0.0), vec2(1.0)) * uToSourceRect.zw) * uToOpacity;
}
vec4 vj1IsfSampleStartPixel(vec2 pixelCoord) {
  return vj1IsfSampleStart(pixelCoord / max(startImage_imgSize, vec2(1.0)));
}
vec4 vj1IsfSampleEndPixel(vec2 pixelCoord) {
  return vj1IsfSampleEnd(pixelCoord / max(endImage_imgSize, vec2(1.0)));
}

${source}

vec4 vj1Transition(vec4 startColor, vec4 endColor, vec2 uv, float transitionProgress) {
  vj1IsfStartColor = startColor;
  vj1IsfEndColor = endColor;
  vj1IsfOutput = startColor;
  vj1IsfUv = uv;
  vj1IsfProgress = transitionProgress;
  vj1IsfUserMain();
  return vj1IsfOutput;
}`,
    metadata: {
      isf: true,
      path: document.path,
      sourceHash: document.sourceHash,
      directMapperPass: true,
    },
  });
}

export function evaluateIsfDimension(expression, values = {}) {
  const source = String(expression || "").replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
    const value = Number(values[name]);
    return Number.isFinite(value) ? String(value) : "0";
  });
  const allowedFunctions = new Map([
    ["floor", "Math.floor"],
    ["min", "Math.min"],
    ["max", "Math.max"],
  ]);
  const identifiers = source.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  if (
    !/^[\d\s+\-*/().,A-Za-z_]+$/.test(source) ||
    identifiers.some((name) => !allowedFunctions.has(name))
  ) {
    throw new Error(`VJ1_ISF_PASS_SIZE_INVALID:${expression}`);
  }
  const executable = source.replace(
    /\b(?:floor|min|max)\b/g,
    (name) => allowedFunctions.get(name),
  );
  // Only numeric literals, arithmetic, parentheses, commas, and the three
  // allow-listed Math calls can reach this evaluator.
  let value;
  try {
    value = Function(`"use strict"; return (${executable});`)();
  } catch {
    throw new Error(`VJ1_ISF_PASS_SIZE_INVALID:${expression}`);
  }
  if (!Number.isFinite(value)) throw new Error(`VJ1_ISF_PASS_SIZE_NONFINITE:${expression}`);
  return Math.max(1, Math.round(value));
}

export function isfGlslType(type) {
  if (type === "bool" || type === "event") return "bool";
  if (type === "long") return "int";
  if (type === "float") return "float";
  if (type === "point2D") return "vec2";
  if (type === "color") return "vec4";
  return "sampler2D";
}

function renameMain(source) {
  let replaced = false;
  const result = String(source).replace(/\bvoid\s+main\s*\(/, () => {
    replaced = true;
    return "void vj1IsfUserMain(";
  });
  if (!replaced) throw new Error("VJ1_ISF_MAIN_MISSING");
  return result;
}

function adaptTransitionImageMacros(source, imageName, currentColor, normalizedSampler, pixelSampler) {
  const escaped = escapeRegExp(imageName);
  return String(source)
    .replace(new RegExp(`\\bIMG_SIZE\\s*\\(\\s*${escaped}\\s*\\)`, "g"), `${imageName}_imgSize`)
    .replace(new RegExp(`\\bIMG_THIS_NORM_PIXEL\\s*\\(\\s*${escaped}\\s*\\)`, "g"), currentColor)
    .replace(new RegExp(`\\bIMG_THIS_PIXEL\\s*\\(\\s*${escaped}\\s*\\)`, "g"), currentColor)
    .replace(new RegExp(`\\bIMG_NORM_PIXEL\\s*\\(\\s*${escaped}\\s*,`, "g"), `${normalizedSampler}(`)
    .replace(new RegExp(`\\bIMG_PIXEL\\s*\\(\\s*${escaped}\\s*,`, "g"), `${pixelSampler}(`);
}

function isfTransitionDefault(input) {
  if (input.type === "bool" || input.type === "event") return input.defaultValue === true;
  if (input.type === "long") return Math.round(Number(input.defaultValue) || 0);
  if (input.type === "point2D") return Array.isArray(input.defaultValue) ? input.defaultValue.slice(0, 2) : [0, 0];
  if (input.type === "color") return Array.isArray(input.defaultValue) ? input.defaultValue.slice(0, 4) : [1, 1, 1, 1];
  return Number(input.defaultValue) || 0;
}

function declaredUniformNames(source) {
  return new Set([...String(source).matchAll(/\buniform\s+\w+\s+([A-Za-z_]\w*)\s*;/g)].map((match) => match[1]));
}

function adaptImageMacros(source, imageNames) {
  let adapted = String(source || "");
  for (const name of imageNames) {
    const escaped = escapeRegExp(name);
    adapted = adapted
      .replace(new RegExp(`\\bIMG_SIZE\\s*\\(\\s*${escaped}\\s*\\)`, "g"), `${name}_imgSize`)
      .replace(new RegExp(`\\bIMG_THIS_NORM_PIXEL\\s*\\(\\s*${escaped}\\s*\\)`, "g"), `VJ1_IMG_NORM_PIXEL_${name}(vj1IsfBoundaryUv())`)
      .replace(new RegExp(`\\bIMG_THIS_PIXEL\\s*\\(\\s*${escaped}\\s*\\)`, "g"), `VJ1_IMG_NORM_PIXEL_${name}(vj1IsfBoundaryUv())`)
      .replace(new RegExp(`\\bIMG_NORM_PIXEL\\s*\\(\\s*${escaped}\\s*,`, "g"), `VJ1_IMG_NORM_PIXEL_${name}(`)
      .replace(new RegExp(`\\bIMG_PIXEL\\s*\\(\\s*${escaped}\\s*,`, "g"), `VJ1_IMG_PIXEL_${name}(`);
  }
  return adapted;
}

function assertOptimizedIsfSymbols(source, {
  allowed = [],
  code,
  path,
} = {}) {
  const allowedSymbols = new Set(allowed);
  const symbols = [
    "TIME",
    "TIMEDELTA",
    "FRAMEINDEX",
    "PASSINDEX",
    "DATE",
    "RENDERSIZE",
    "gl_FragCoord",
    "isf_FragNormCoord",
    "IMG_THIS_NORM_PIXEL",
    "IMG_THIS_PIXEL",
    "IMG_NORM_PIXEL",
    "IMG_PIXEL",
    "IMG_SIZE",
  ];
  for (const symbol of symbols) {
    if (allowedSymbols.has(symbol)) continue;
    if (new RegExp(`\\b${symbol}\\b`).test(source)) {
      throw new Error(`${code}:${path || "inline"}:${symbol}`);
    }
  }
}

function ensureFragmentPrecision(source) {
  const text = String(source || "").trim();
  return /\bprecision\s+(?:lowp|mediump|highp)\s+float\s*;/.test(text)
    ? text
    : `precision mediump float;\n${text}`;
}

function compileLocalEffectBody(source, path = "") {
  const extracted = extractMainFunction(source, path);
  const surrounding = `${extracted.before}\n${extracted.after}`
    .replace(/\bprecision\s+(?:lowp|mediump|highp)\s+\w+\s*;/g, "")
    .replace(/\bvarying\s+\w+\s+\w+\s*;/g, "")
    .replace(/\buniform\s+\w+\s+\w+\s*;/g, "")
    .trim();
  if (surrounding) {
    throw new Error(
      `VJ1_ISF_LOCAL_EFFECT_HELPERS_UNSUPPORTED:${path || "inline"}`,
    );
  }
  let body = extracted.body
    .replace(
      /\bIMG_THIS_(?:NORM_)?PIXEL\s*\(\s*inputImage\s*\)/g,
      "vj1IsfInput",
    )
    .replace(/\bisf_FragNormCoord\b/g, "uv")
    .replace(/\bgl_FragColor\b/g, "vj1IsfOutput");
  if (/\b(?:IMG_[A-Z_]+|discard|return)\b/.test(body)) {
    throw new Error(
      `VJ1_ISF_LOCAL_EFFECT_BODY_UNSUPPORTED:${path || "inline"}`,
    );
  }
  return `
vec4 runEffect(vec2 uv, vec4 vj1SourceColor) {
  float vj1SourceAlpha = vj1SourceColor.a;
  vec4 vj1IsfInput = vec4(
    vj1SourceAlpha > 0.0001
      ? vj1SourceColor.rgb / vj1SourceAlpha
      : vec3(0.0),
    vj1SourceAlpha
  );
  vec4 vj1IsfOutput = vj1IsfInput;
  ${body.trim()}
  return vec4(
    vj1IsfOutput.rgb * vj1IsfOutput.a,
    vj1IsfOutput.a
  );
}`.trim();
}

function extractMainFunction(source, path = "") {
  const text = String(source || "");
  const match = /\bvoid\s+main\s*\(\s*\)\s*\{/.exec(text);
  if (!match) throw new Error(`VJ1_ISF_MAIN_MISSING:${path || "inline"}`);
  const open = text.indexOf("{", match.index);
  let depth = 0;
  let close = -1;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) {
    throw new Error(`VJ1_ISF_MAIN_UNTERMINATED:${path || "inline"}`);
  }
  return {
    before: text.slice(0, match.index),
    body: text.slice(open + 1, close),
    after: text.slice(close + 1),
  };
}

function uniqueIdentifiers(values) {
  return [...new Set(values.map(String).filter((value) => /^[A-Za-z_]\w*$/.test(value)))];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
