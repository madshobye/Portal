import { drawBuffer } from "../render-draw-utils.js";
import {
  markRenderTargetOrientation,
  RENDER_TEXTURE_ORIENTATION,
} from "../render-target-contract.js";
import { MeshPatternRenderer } from "./mesh-pattern-renderer.js";

// Owns the two retained Mesh Pattern passes. Topology and material values come
// from ordinary compiled provider nodes; this capability only executes the
// fill/wire GPU kernels and preserves their explicit target chaining.
export class MeshPatternRuntime {
  constructor({ frameIndex, drawStandby } = {}) {
    this.renderer = new MeshPatternRenderer({ frameIndex });
    this.drawStandby = drawStandby || (() => {});
  }

  draw(
    output,
    pass,
    source = {},
    componentTime = 0,
    renderRequest = {},
    operation = null,
  ) {
    const input =
      pass === "wire"
        ? operation?.runtimeInputStates?.get?.("target")?.buffer || null
        : null;
    const continuesFramebuffer =
      operation?.framebufferSequence?.phase === "continue";
    if (input && input !== output) {
      output.push();
      drawBuffer(
        output,
        input,
        0,
        0,
        output.width,
        output.height,
      );
      output.pop();
    }
    const drawn = this.renderer.drawPass(
      output,
      pass,
      source,
      componentTime,
      renderRequest,
      operation,
      { preserveTarget: continuesFramebuffer || !!input },
    );
    if (!drawn) {
      this.drawStandby(
        output,
        `${pass} mesh topology unavailable`,
      );
      return false;
    }
    markRenderTargetOrientation(
      output,
      RENDER_TEXTURE_ORIENTATION.bottomLeft,
    );
    return true;
  }

  dispose() {
    this.renderer.dispose();
  }
}
