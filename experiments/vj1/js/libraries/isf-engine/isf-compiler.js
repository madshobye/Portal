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
  const imageNames = uniqueIdentifiers([
    ...document.inputs.filter((input) => ["image", "audio", "audioFFT"].includes(input.type)).map((input) => input.name),
    ...document.passes.map((pass) => pass.target).filter(Boolean),
    ...(effect ? ["inputImage"] : []),
  ]);
  const adaptedSource = adaptImageMacros(
    String(document.fragmentSource)
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
  return `
precision highp float;
varying vec2 vTexCoord;
uniform vec4 renderUvRect;
uniform mat3 ${effect ? "effectUvMatrix" : "contentUvMatrix"};
uniform float ${effect ? "amount" : "useContentTransform"};
uniform bool vj1IsfFinalPass;
${[...standard, ...inputUniforms, ...targetUniforms, ...imageSizeUniforms].map(([type, name]) => `uniform ${type} ${name};`).join("\n")}

vec2 vj1IsfBoundaryUv() {
  vec2 baseUv = renderUvRect.xy + vTexCoord * renderUvRect.zw;
  ${effect
    ? "vec2 topLeftUv = (effectUvMatrix * vec3(baseUv, 1.0)).xy; return vec2(topLeftUv.x, 1.0 - topLeftUv.y);"
    : "vec2 transformedUv = (contentUvMatrix * vec3(baseUv, 1.0)).xy; vec2 topLeftUv = mix(baseUv, transformedUv, step(0.5, useContentTransform)); return vec2(topLeftUv.x, 1.0 - topLeftUv.y);"}
}
vec2 vj1IsfPixelUv(vec2 pixelCoord) { return pixelCoord / max(RENDERSIZE, vec2(1.0)); }
#define vj1IsfFragCoord vec4(vj1IsfBoundaryUv() * RENDERSIZE, 0.0, 1.0)
#define isf_FragNormCoord (vj1IsfBoundaryUv())
#define IMG_THIS_NORM_PIXEL(image) texture2D(image, vj1IsfBoundaryUv())
#define IMG_THIS_PIXEL(image) texture2D(image, vj1IsfBoundaryUv())
${imageNames.map((name) => `
#define VJ1_IMG_NORM_PIXEL_${name}(coord) texture2D(${name}, (coord))
#define VJ1_IMG_PIXEL_${name}(coord) texture2D(${name}, (coord) / max(${name}_imgSize, vec2(1.0)))`).join("\n")}

${source}

void main() {
  vj1IsfUserMain();
  ${effect ? "if (vj1IsfFinalPass) gl_FragColor = mix(IMG_THIS_NORM_PIXEL(inputImage), gl_FragColor, clamp(amount, 0.0, 1.0));" : ""}
  ${transition ? "" : "if (vj1IsfFinalPass) gl_FragColor.rgb *= gl_FragColor.a;"}
}`.trim();
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
  if (!/^[\d\s+\-*/().]+$/.test(source)) throw new Error(`VJ1_ISF_PASS_SIZE_INVALID:${expression}`);
  // This is a deliberately restricted arithmetic expression. Identifiers,
  // property access, calls, assignments, and statement separators are absent.
  const value = Function(`"use strict"; return (${source});`)();
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
      .replace(new RegExp(`\\bIMG_NORM_PIXEL\\s*\\(\\s*${escaped}\\s*,`, "g"), `VJ1_IMG_NORM_PIXEL_${name}(`)
      .replace(new RegExp(`\\bIMG_PIXEL\\s*\\(\\s*${escaped}\\s*,`, "g"), `VJ1_IMG_PIXEL_${name}(`);
  }
  return adapted;
}

function uniqueIdentifiers(values) {
  return [...new Set(values.map(String).filter((value) => /^[A-Za-z_]\w*$/.test(value)))];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
