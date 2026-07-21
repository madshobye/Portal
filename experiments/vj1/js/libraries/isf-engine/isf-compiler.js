const STANDARD_UNIFORMS = Object.freeze([
  ["float", "TIME"],
  ["float", "TIMEDELTA"],
  ["int", "FRAMEINDEX"],
  ["int", "PASSINDEX"],
  ["vec4", "DATE"],
  ["vec2", "RENDERSIZE"],
]);

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
