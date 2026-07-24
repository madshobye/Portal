import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";

export const TEXT_GENERATOR_VERTEX_SHADER = `
precision mediump float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}`;

export const TEXT_GENERATOR_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D textMask;
uniform vec2 resolution;
uniform vec4 renderUvRect;
uniform vec4 fillColor;
uniform vec4 outlineColor;
uniform vec4 backgroundColor;
uniform float outlineWidth;
uniform float fillEnabled;
uniform float outlineEnabled;
uniform mat3 contentUvMatrix;
varying vec2 vTexCoord;

float maskAt(vec2 uv) {
  return texture2D(textMask, clamp(uv, 0.0, 1.0)).a;
}

vec4 over(vec4 top, vec4 bottom) {
  float alpha = top.a + bottom.a * (1.0 - top.a);
  vec3 color = alpha > 0.00001
    ? (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / alpha
    : vec3(0.0);
  return vec4(color, alpha);
}

void main() {
  vec2 boundaryUv = renderUvRect.xy + vTexCoord * renderUvRect.zw;
  vec2 uv = (contentUvMatrix * vec3(boundaryUv, 1.0)).xy;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float fillMask = maskAt(uv) * inside;
  vec2 texel = 1.0 / max(resolution, vec2(1.0));
  float radius = outlineWidth * min(resolution.x, resolution.y);
  float outlineMask = fillMask;
  for (int ring = 1; ring <= 3; ring++) {
    float ringRadius = radius * float(ring) / 3.0;
    for (int index = 0; index < 16; index++) {
      float angle = 6.28318530718 * float(index) / 16.0;
      vec2 offset = vec2(cos(angle), sin(angle)) * texel * ringRadius;
      outlineMask = max(outlineMask, maskAt(uv + offset) * inside);
    }
  }
  vec4 result = backgroundColor;
  float outlineOnlyMask = max(0.0, outlineMask - fillMask);
  result = over(vec4(outlineColor.rgb, outlineOnlyMask * outlineColor.a * outlineEnabled), result);
  result = over(vec4(fillColor.rgb, fillMask * fillColor.a * fillEnabled), result);
  gl_FragColor = vec4(result.rgb, result.a * inside);
}`;

export const TEXT_MASK_MAX_DIMENSION = 4096;

// Text layout is cached in the complete boundary coordinate domain so an ROI
// can move without squeezing the glyphs or rebuilding the CPU mask every
// frame. Cap only the cached mask raster, never the boundary math: unusually
// large/off-screen text remains allocation-bounded while ordinary output
// sizes retain one source pixel per rendered pixel.
export function textMaskDimensions(width = 1, height = 1, maxDimension = TEXT_MASK_MAX_DIMENSION) {
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const ceiling = Math.max(1, Number(maxDimension) || TEXT_MASK_MAX_DIMENSION);
  const scale = Math.min(1, ceiling / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export const FONT_FAMILIES = Object.freeze({
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  condensed: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif',
  display: 'Impact, "Arial Black", sans-serif',
});

export function createTextMask(params = {}, width = 1, height = 1, existing = null) {
  const canvas = existing || document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  // The mask is transferred into a p5 image through getImageData after every
  // layout rebuild. This option must be present on the first context request;
  // asking for it only at readback time is too late for Chromium to select
  // the read-optimized canvas implementation.
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.textBaseline = "alphabetic";

  const padding = clamp(Number(params.padding), 0, 0.4, 0.06) * Math.min(canvas.width, canvas.height);
  const availableWidth = Math.max(1, canvas.width - padding * 2);
  const availableHeight = Math.max(1, canvas.height - padding * 2);
  const parsedLines = parseTextMarkdown(params.text || "");
  const lineHeight = clamp(Number(params.lineHeight), 0.5, 2, 0.92);
  const textScale = clamp(Number(params.textScale), 0.1, 4, 1);
  const family = FONT_FAMILIES[params.fontFamily] || FONT_FAMILIES.sans;
  const textStyle = {
    bold: params.bold === true,
    italic: params.italic === true,
    underline: params.underline === true,
  };
  const spacingRatio = clamp(Number(params.letterSpacing), -0.1, 0.5, 0);
  const layout = params.layout || "fit lines";
  const sizes = layoutTextLines(context, parsedLines, {
    availableWidth,
    availableHeight,
    family,
    lineHeight,
    spacingRatio,
    layout,
    fixedSize: clamp(Number(params.fontSize), 8, 512, 96) * textScale,
    textScale,
    textStyle,
  });
  const totalHeight = sizes.reduce((sum, size) => sum + size * lineHeight, 0);
  const verticalAlign = params.verticalAlign || "center";
  let y = padding;
  if (verticalAlign === "center") y += Math.max(0, (availableHeight - totalHeight) * 0.5);
  else if (verticalAlign === "bottom") y += Math.max(0, availableHeight - totalHeight);

  parsedLines.forEach((line, lineIndex) => {
    const size = sizes[lineIndex];
    const lineWidth = measureStyledLine(context, line, size, family, spacingRatio, textStyle);
    let x = padding;
    if (params.align === "center") x += Math.max(0, (availableWidth - lineWidth) * 0.5);
    else if (params.align === "right") x += Math.max(0, availableWidth - lineWidth);
    const baseline = y + size * 0.8;
    drawStyledLine(context, line, x, baseline, size, family, spacingRatio, textStyle);
    y += size * lineHeight;
  });
  return canvas;
}

export function textMaskSignature(params = {}, width = 1, height = 1) {
  return JSON.stringify([
    Math.round(width), Math.round(height), params.text || "", params.layout || "fit lines",
    params.fontFamily || "sans", params.fontSize, params.textScale, params.align,
    params.verticalAlign, params.lineHeight, params.letterSpacing, params.padding,
    params.bold === true, params.italic === true, params.underline === true,
  ]);
}

export function parseTextMarkdown(markdown = "") {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  return lines.map((source) => {
    const heading = source.match(/^(#{1,4})\s+(.+)$/);
    const level = heading ? heading[1].length : 0;
    const text = heading ? heading[2] : source;
    return {
      headingLevel: level,
      scale: level ? [1.55, 1.32, 1.16, 1.06][level - 1] : 1,
      runs: parseInlineMarkdown(text),
    };
  });
}

export function parseInlineMarkdown(text = "") {
  const plainText = String(text)
    .replace(/<u>([\s\S]*?)<\/u>/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
  return [{ text: plainText }];
}

export function layoutTextLines(context, lines, options) {
  const weights = lines.map((line) => line.scale || 1);
  if (options.layout === "fixed") return weights.map((weight) => options.fixedSize * weight);
  let low = 4;
  let high = Math.max(options.availableWidth, options.availableHeight) * 2;
  let best = low;
  for (let step = 0; step < 16; step++) {
    const base = (low + high) * 0.5;
    const sizes = weights.map((weight) => base * weight * options.textScale);
    const fitsHeight = sizes.reduce((sum, size) => sum + size * options.lineHeight, 0) <= options.availableHeight;
    const fitsWidth = lines.every((line, index) => measureStyledLine(context, line, sizes[index], options.family, options.spacingRatio, options.textStyle) <= options.availableWidth);
    if (fitsHeight && fitsWidth) { best = base; low = base; } else high = base;
  }
  const sizes = weights.map((weight) => best * weight * options.textScale);
  if (options.layout !== "fit lines") return sizes;
  const heightBudget = options.availableHeight / Math.max(1, sizes.reduce((sum, size) => sum + size * options.lineHeight, 0));
  return sizes.map((size, index) => {
    const width = measureStyledLine(context, lines[index], size, options.family, options.spacingRatio, options.textStyle);
    const widthGrowth = width > 0 ? options.availableWidth / width : 1;
    return size * Math.min(widthGrowth, Math.max(1, heightBudget));
  });
}

export function measureStyledLine(context, line, size, family, spacingRatio, textStyle = {}) {
  let width = 0;
  let characters = 0;
  for (const run of line.runs) {
    context.font = fontString(textStyle, size, family);
    width += context.measureText(run.text).width;
    characters += run.text.length;
  }
  return width + Math.max(0, characters - 1) * size * spacingRatio;
}

export function drawStyledLine(context, line, startX, baseline, size, family, spacingRatio, textStyle = {}) {
  let x = startX;
  for (const run of line.runs) {
    context.font = fontString(textStyle, size, family);
    for (const character of [...run.text]) {
      context.fillText(character, x, baseline);
      const width = context.measureText(character).width;
      if (textStyle.underline && character.trim()) context.fillRect(x, baseline + size * 0.06, width, Math.max(1, size * 0.055));
      x += width + size * spacingRatio;
    }
  }
}

export function fontString(style, size, family) {
  return `${style.italic ? "italic" : "normal"} ${style.bold ? 700 : 400} ${Math.max(1, size)}px ${family}`;
}

export function clamp(value, min, max, fallback) {
  const number = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

export function textNodeProcess(inputs = {}, context = {}) {
  if (typeof context.renderNativeVisualNode !== "function") throw new Error("TEXT_NODE_RENDER_HOST_MISSING");
  return context.renderNativeVisualNode({ inputs, context });
}

export function textNodeModuleParts() {
  const algorithmSource = [
    `const FONT_FAMILIES = Object.freeze(${JSON.stringify(FONT_FAMILIES)});`,
    `const TEXT_MASK_MAX_DIMENSION = ${TEXT_MASK_MAX_DIMENSION};`,
    createTextMask,
    textMaskDimensions,
    textMaskSignature,
    parseTextMarkdown,
    parseInlineMarkdown,
    layoutTextLines,
    measureStyledLine,
    drawStyledLine,
    fontString,
    clamp,
  ].map((value) => typeof value === "function" ? value.toString() : value).join("\n\n");
  return [
    {
      id: "text-layout-module",
      name: "Text layout and mask algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["createTextMask", "textMaskDimensions", "textMaskSignature", "parseTextMarkdown"],
      source: algorithmSource,
    },
    {
      id: "text-process",
      name: "Text process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "textNodeProcess",
      entry: "process",
      dependsOn: ["text-layout-module"],
      source: textNodeProcess.toString(),
    },
    {
      id: "vertex-shader",
      name: "Text vertex shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "vertex",
      editable: true,
      source: TEXT_GENERATOR_VERTEX_SHADER,
    },
    {
      id: "fragment-shader",
      name: "Text fill and outline shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "fragment",
      editable: true,
      source: TEXT_GENERATOR_FRAGMENT_SHADER,
    },
  ];
}

export const TextNodeModuleExports = Object.freeze({
  createTextMask,
  textMaskDimensions,
  textMaskSignature,
  parseTextMarkdown,
});
