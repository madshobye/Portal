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
