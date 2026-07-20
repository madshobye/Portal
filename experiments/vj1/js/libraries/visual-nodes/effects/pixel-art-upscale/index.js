import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "pixelArtUpscale",
    name: "Pixel Art Upscale",
    category: "texture",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("upscale", "Pixel size", { min: 2, max: 32, step: 1, defaultValue: 10 }),
      createNumberParam("colorThreshold", "Color threshold", { min: 0.01, max: 1, step: 0.01, defaultValue: 0.1 }),
      createNumberParam("lineThickness", "Line thickness", { min: 0.05, max: 0.8, step: 0.01, defaultValue: 0.4 }),
      createNumberParam("antiAlias", "Antialiasing", { min: 0.1, max: 3, step: 0.01, defaultValue: 1 }),
    ],
    code: `
/*
Copyright 2020 Ethan Alexander Shulman

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Original shader: https://www.shadertoy.com/view/tsdcRM
The WebGL2 texelFetch operations are expressed through Portal's normalized
source sampler so the effect works in the existing WebGL shader pipeline.
*/

vec4 pixelArtSample(vec2 logicalPixel, vec2 grid) {
  return sampleSource((floor(logicalPixel) + 0.5) / grid);
}

bool pixelArtDiagonal(
  inout vec4 sum,
  vec2 logicalPixel,
  vec2 grid,
  vec2 p1,
  vec2 p2,
  float thickness
) {
  vec4 v1 = pixelArtSample(logicalPixel + p1, grid);
  vec4 v2 = pixelArtSample(logicalPixel + p2, grid);
  if (length(v1 - v2) < colorThreshold) {
    vec2 direction = p2 - p1;
    vec2 linePosition = logicalPixel - (floor(logicalPixel + p1) + 0.5);
    direction = normalize(vec2(direction.y, -direction.x));
    float line = clamp(
      (thickness - dot(linePosition, direction)) * upscale * antiAlias,
      0.0,
      1.0
    );
    sum = mix(sum, v1, line);
    return true;
  }
  return false;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 grid = max(resolution / max(upscale, 1.0), vec2(1.0));
  vec2 logicalPixel = uv * grid;
  vec4 result = pixelArtSample(logicalPixel, grid);
  float primary = lineThickness;
  float secondary = lineThickness * 0.75;

  if (pixelArtDiagonal(result, logicalPixel, grid, vec2(-1.0, 0.0), vec2(0.0, 1.0), primary)) {
    pixelArtDiagonal(result, logicalPixel, grid, vec2(-1.0, 0.0), vec2(1.0, 1.0), secondary);
    pixelArtDiagonal(result, logicalPixel, grid, vec2(-1.0, -1.0), vec2(0.0, 1.0), secondary);
  }
  if (pixelArtDiagonal(result, logicalPixel, grid, vec2(0.0, 1.0), vec2(1.0, 0.0), primary)) {
    pixelArtDiagonal(result, logicalPixel, grid, vec2(0.0, 1.0), vec2(1.0, -1.0), secondary);
    pixelArtDiagonal(result, logicalPixel, grid, vec2(-1.0, 1.0), vec2(1.0, 0.0), secondary);
  }
  if (pixelArtDiagonal(result, logicalPixel, grid, vec2(1.0, 0.0), vec2(0.0, -1.0), primary)) {
    pixelArtDiagonal(result, logicalPixel, grid, vec2(1.0, 0.0), vec2(-1.0, -1.0), secondary);
    pixelArtDiagonal(result, logicalPixel, grid, vec2(1.0, 1.0), vec2(0.0, -1.0), secondary);
  }
  if (pixelArtDiagonal(result, logicalPixel, grid, vec2(0.0, -1.0), vec2(-1.0, 0.0), primary)) {
    pixelArtDiagonal(result, logicalPixel, grid, vec2(0.0, -1.0), vec2(-1.0, 1.0), secondary);
    pixelArtDiagonal(result, logicalPixel, grid, vec2(1.0, -1.0), vec2(-1.0, 0.0), secondary);
  }

  return mix(color, result, amount);
}
`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
