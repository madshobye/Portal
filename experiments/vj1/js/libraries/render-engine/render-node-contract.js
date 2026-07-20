import { numberType, optionalType, recordType, valueType } from "../node-engine/node-types.js";

export const RenderRequestType = recordType("render-request", {
  role: valueType("string"),
  width: numberType(),
  height: numberType(),
  logicalWidth: optionalType("number"),
  logicalHeight: optionalType("number"),
  pixelScale: optionalType("number"),
  renderIdentity: optionalType("string"),
});

export const RenderTimingType = recordType("render-timing", {
  time: numberType(),
  delta: numberType(),
  frame: numberType(),
});

export const RenderContextType = recordType("render-context", {
  request: RenderRequestType,
  timing: RenderTimingType,
  transform: valueType("transform2d"),
  quality: numberType(),
});

export const TextureFrameType = recordType("texture-frame", {
  texture: valueType("texture"),
  request: RenderRequestType,
  transform: valueType("transform2d"),
  timing: RenderTimingType,
  version: numberType(),
});

export function createRenderRequest({
  role = "texture",
  width = 1,
  height = 1,
  logicalWidth,
  logicalHeight,
  pixelScale = 1,
  renderIdentity = "",
} = {}) {
  const rasterWidth = positiveDimension(width);
  const rasterHeight = positiveDimension(height);
  return Object.freeze({
    role: String(role || "texture"),
    width: rasterWidth,
    height: rasterHeight,
    logicalWidth: positiveDimension(logicalWidth ?? rasterWidth),
    logicalHeight: positiveDimension(logicalHeight ?? rasterHeight),
    pixelScale: positiveNumber(pixelScale, 1),
    renderIdentity: String(renderIdentity || ""),
  });
}

export function createRenderTiming({ time = 0, delta = 0, frame = 0 } = {}) {
  return Object.freeze({
    time: finiteNumber(time),
    delta: Math.max(0, finiteNumber(delta)),
    frame: Math.max(0, Math.round(finiteNumber(frame))),
  });
}

export function createRenderContext({ request = {}, timing = {}, transform = {}, quality = 0.5 } = {}) {
  return Object.freeze({
    request: request?.role ? request : createRenderRequest(request),
    timing: timing?.frame !== undefined ? timing : createRenderTiming(timing),
    transform: normalizeTransform(transform),
    quality: clamp01(quality),
  });
}

export function createTextureFrame(texture, context, version = 0) {
  if (!texture || typeof texture !== "object") throw new TypeError("RENDER_TEXTURE_REQUIRED");
  return Object.freeze({
    texture,
    request: context.request,
    transform: context.transform,
    timing: context.timing,
    version: Math.max(0, Math.round(Number(version) || 0)),
  });
}

// A compiled render program is deliberately not a generic graph scheduler. It
// resolves its step functions once and retains one state slot per step. Frame
// execution is a direct loop with no packet, port, definition, or editor walk.
export class CompiledRenderProgram {
  constructor({ id = "render-program", steps = [] } = {}) {
    this.id = String(id || "render-program");
    this.steps = Object.freeze(steps.map(normalizeCompiledStep));
    this.stepStates = this.steps.map(() => ({}));
    this.lastValue = null;
    this.disposed = false;
  }

  execute(input, context) {
    if (this.disposed) throw new Error(`RENDER_PROGRAM_DISPOSED:${this.id}`);
    let value = input;
    for (let index = 0; index < this.steps.length; index++) {
      value = this.steps[index].execute(value, context, this.stepStates[index]);
    }
    this.lastValue = value;
    return value;
  }

  invalidate() {
    for (const state of this.stepStates) {
      for (const key of Object.keys(state)) delete state[key];
    }
    this.lastValue = null;
  }

  dispose() {
    if (this.disposed) return;
    for (let index = this.steps.length - 1; index >= 0; index--) {
      this.steps[index].dispose?.(this.stepStates[index]);
    }
    this.stepStates.length = 0;
    this.lastValue = null;
    this.disposed = true;
  }
}

export function compileRenderProgram(specification = {}) {
  return new CompiledRenderProgram(specification);
}

// Per-node retained output/signature state used by the live renderer. This is
// separate from the editable NodeInstance runtime so live frames stay free of
// generic packets and port normalization.
export class RenderNodeRuntime {
  constructor(id = "") {
    this.id = id;
    this.signature = null;
    this.output = null;
    this.outputVersion = 0;
    this.lastUsedFrame = 0;
    this.lastDirtyReason = "new";
  }

  bindOutput(output) {
    if (this.output === output) return;
    this.output = output;
    this.signature = null;
    this.outputVersion = 0;
    this.lastDirtyReason = "buffer";
  }

  evaluate(signature, render, { frame = 0, dirtyReason = "dependency" } = {}) {
    this.lastUsedFrame = frame;
    if (this.output && this.signature === signature) {
      return {
        output: this.output,
        outputVersion: this.outputVersion,
        rendered: false,
        dirtyReason: "clean",
      };
    }

    const output = render(this.output);
    if (output && output !== this.output) this.output = output;
    this.signature = signature;
    this.outputVersion++;
    this.lastDirtyReason = dirtyReason;
    return {
      output: this.output,
      outputVersion: this.outputVersion,
      rendered: true,
      dirtyReason,
    };
  }

  invalidate(reason = "invalidated") {
    this.signature = null;
    this.lastDirtyReason = reason;
  }
}

export function textureStateKey(state = {}) {
  return `${state.nodeKey || "texture"}@${Math.max(0, Number(state.outputVersion) || 0)}`;
}

function normalizeCompiledStep(step = {}, index = 0) {
  if (typeof step.execute !== "function") throw new Error(`RENDER_PROGRAM_STEP_NOT_EXECUTABLE:${step.id || index}`);
  return Object.freeze({
    id: String(step.id || `step-${index + 1}`),
    execute: step.execute,
    dispose: typeof step.dispose === "function" ? step.dispose : null,
  });
}

function normalizeTransform(value = {}) {
  return Object.freeze({
    translation: Object.freeze(Array.isArray(value.translation) ? [finiteNumber(value.translation[0]), finiteNumber(value.translation[1])] : [finiteNumber(value.x), finiteNumber(value.y)]),
    scale: Object.freeze(Array.isArray(value.scale) ? [positiveNumber(value.scale[0], 1), positiveNumber(value.scale[1], 1)] : [positiveNumber(value.scale, 1), positiveNumber(value.scale, 1)]),
    rotation: finiteNumber(value.rotation),
  });
}

function positiveDimension(value) {
  return Math.max(1, Math.round(Number(value) || 1));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finiteNumber(value)));
}
