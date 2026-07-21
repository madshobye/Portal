import { registerRenderTarget, RENDER_TARGET_KIND, RENDER_TEXTURE_ORIENTATION } from "./render-target-contract.js?v=render-core-contract-1";

const TWO_D_METHODS = [
  "background",
  "beginShape",
  "blendMode",
  "circle",
  "fill",
  "ellipse",
  "endShape",
  "imageMode",
  "line",
  "noFill",
  "noStroke",
  "noTint",
  "rect",
  "rectMode",
  "rotate",
  "scale",
  "stroke",
  "strokeCap",
  "strokeJoin",
  "strokeWeight",
  "text",
  "textAlign",
  "textFont",
  "textSize",
  "textStyle",
  "tint",
  "translate",
  "vertex",
];

/**
 * A small p5.Graphics-compatible facade around p5.Framebuffer.
 *
 * Framebuffers belong to the main p5 WebGL renderer, so every target created
 * through this adapter shares shaders and textures in one WebGL context. The
 * facade intentionally exposes only the 2D-style methods used by VJ1's
 * compositor. Shader and 3D drawing use drawWebGL() directly.
 */
export class SharedFramebufferTarget {
  constructor(framebuffer) {
    this.framebuffer = framebuffer;
    this.__vj1SharedFramebuffer = true;
    this.__vj1ShaderContextId = "shared-main-context";
    this._twoDDepth = 0;
    registerRenderTarget(this, {
      kind: RENDER_TARGET_KIND.sharedFramebuffer,
      orientation: RENDER_TEXTURE_ORIENTATION.topLeft,
      directP5ImageSafe: false,
    });
    for (const method of TWO_D_METHODS.filter((name) => name !== "blendMode")) {
      this[method] = (...args) => callP5(method, ...args.map(unwrapRenderTarget));
    }
  }

  get width() {
    return this.framebuffer.width;
  }

  get height() {
    return this.framebuffer.height;
  }

  get color() {
    return this.framebuffer.color;
  }

  get drawingContext() {
    return this.framebuffer?.renderer?.GL || globalThis.drawingContext || null;
  }

  get _renderer() {
    return this.framebuffer?.renderer || null;
  }

  createShader(vertexSource, fragmentSource) {
    return callP5("createShader", vertexSource, fragmentSource);
  }

  resizeCanvas(width, height) {
    this.framebuffer.resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  pixelDensity() {
    return 1;
  }

  noSmooth() {}

  smooth() {}

  push() {
    if (this._twoDDepth === 0) {
      this.framebuffer.begin();
      callP5("push");
      // p5.Framebuffer uses WEBGL's centered origin. The compositor's existing
      // p5.Graphics contract uses a top-left origin.
      callP5("translate", -this.width * 0.5, -this.height * 0.5);
      // Framebuffers share the main renderer's style state. Re-establish the
      // p5.Graphics 2D defaults so a previous CENTER-mode draw on the main
      // canvas cannot shift framebuffer content into the upper-left quarter.
      callP5("imageMode", "corner");
      callP5("rectMode", "corner");
    } else {
      callP5("push");
    }
    this._twoDDepth++;
  }

  pop() {
    if (this._twoDDepth <= 0) return;
    callP5("pop");
    this._twoDDepth--;
    if (this._twoDDepth === 0) this.framebuffer.end();
  }

  clear() {
    callP5("clear");
  }

  blendMode(mode) {
    // p5's WebGL renderer does not implement the Canvas2D-only blend modes.
    // Avoid its per-frame warning storm; complex blend equations are handled
    // at explicit compositor boundaries rather than leaking renderer state.
    const unsupported = new Set([
      "color-burn",
      "overlay",
      "hard-light",
      "soft-light",
      "color-dodge",
    ]);
    callP5("blendMode", unsupported.has(mode) ? (globalThis.BLEND ?? "source-over") : mode);
  }

  image(source, ...args) {
    callP5("image", unwrapRenderTarget(source), ...args);
  }

  get(...args) {
    return this.framebuffer.get(...args);
  }

  drawWebGL(draw) {
    const nestedIn2D = this._twoDDepth > 0;
    if (!nestedIn2D) this.framebuffer.begin();
    callP5("push");
    // Shader quads use WEBGL's centered origin. When a shader is rendered
    // directly into a source target that is already inside push(), undo the
    // facade's top-left translation for the duration of the WebGL draw.
    if (nestedIn2D) callP5("translate", this.width * 0.5, this.height * 0.5);
    try {
      return draw();
    } finally {
      callP5("pop");
      if (!nestedIn2D) this.framebuffer.end();
    }
  }

  remove() {
    this.framebuffer.remove();
  }
}

export function createSharedFramebufferTarget(width, height, { depth = false, format = null } = {}) {
  if (typeof globalThis.createFramebuffer !== "function") {
    reportFramebufferUnavailable();
    return null;
  }
  try {
    const options = {
      width: Math.max(1, Math.round(Number(width) || 1)),
      height: Math.max(1, Math.round(Number(height) || 1)),
      density: 1,
      depth,
      antialias: false,
    };
    if (format != null) options.format = format;
    const framebuffer = globalThis.createFramebuffer(options);
    return new SharedFramebufferTarget(framebuffer);
  } catch (error) {
    console.error("[VJ1_FRAMEBUFFER_CREATE_FAILED]", error);
    return null;
  }
}

let reportedFramebufferUnavailable = false;

function reportFramebufferUnavailable() {
  if (reportedFramebufferUnavailable) return;
  reportedFramebufferUnavailable = true;
  console.warn("[VJ1_FRAMEBUFFER_UNAVAILABLE]", {
    fallback: "p5.Graphics",
    message: "p5.createFramebuffer is unavailable; shared-context render targets are disabled",
  });
}

export function isSharedFramebufferTarget(target) {
  return !!target?.__vj1SharedFramebuffer;
}

export function unwrapRenderTarget(target) {
  // p5.Framebuffer also has a `.framebuffer` property, but that property is
  // the raw WebGLFramebuffer handle and is not a valid p5 texture source.
  // Only unwrap VJ1's facade; an already-unwrapped p5.Framebuffer must pass
  // through untouched.
  return isSharedFramebufferTarget(target) ? target.framebuffer : target;
}

function callP5(name, ...args) {
  const method = globalThis[name];
  if (typeof method !== "function") throw new Error(`p5.${name} is unavailable`);
  return method(...args);
}
