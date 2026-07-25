import {
  createSharedFramebufferTarget,
  isSharedFramebufferTarget,
  unwrapRenderTarget,
} from "../shared-framebuffer-target.js?v=premultiplied-alpha-5";
import {
  markRenderTargetOrientation,
  renderTargetDescriptor,
  renderTargetNeedsShaderSampleFlip,
  RENDER_TEXTURE_ORIENTATION,
} from "../render-target-contract.js?v=source-target-ownership-1";
import { drawBuffer } from "../render-draw-utils.js?v=render-diagnostics-1";
import {
  GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER,
  RENDER_PASS_VERTEX_SHADER,
} from "../render-pass-shaders.js?v=render-coordinate-scope-3";
import {
  applyShaderTarget,
  clearShaderTarget,
  drawShaderTarget,
  drawShaderTargetRect,
  resetShaderTarget,
} from "../shader-target-runtime.js?v=premultiplied-alpha-write-1";
import { disposeRenderTarget } from "../../libraries/render-engine/render-target-lifetime.js";

// Shared allocation and presentation policy for the few retained native
// kernels. Individual Terrain, model, text, morph, and topology capabilities
// own distinct target keys and context-discard callbacks; this runtime only
// enforces one allocation, orientation, and disposal contract.
export class SpecializedTargetRuntime {
  constructor({ applyGraphicsPixelDensity } = {}) {
    this.applyGraphicsPixelDensity =
      applyGraphicsPixelDensity ||
      ((target, density) => target?.pixelDensity?.(density));
    this.targets = new Map();
    this.presentationShaders = new Map();
    this.presentationShaderFailures = new Set();
  }

  get(kind, width, height, density = 1, {
    onContextDiscard = null,
    preferSharedFramebuffer = false,
    depth = false,
  } = {}) {
    const widthPx = Math.max(1, Math.round(Number(width) || 1));
    const heightPx = Math.max(1, Math.round(Number(height) || 1));
    const targetDensity = Math.max(0.25, Math.min(4, Number(density) || 1));
    let target = this.targets.get(kind);
    if (!target) {
      target = createSpecializedTarget(
        widthPx,
        heightPx,
        targetDensity,
        preferSharedFramebuffer,
        depth,
        this.applyGraphicsPixelDensity,
      );
      this.targets.set(kind, target);
      return target;
    }
    const sizeChanged = target.width !== widthPx || target.height !== heightPx;
    const densityChanged = target.__vj1PixelDensity !== targetDensity;
    if (sizeChanged || densityChanged) {
      try {
        if (sizeChanged) target.resizeCanvas(widthPx, heightPx);
        if (!isSharedFramebufferTarget(target)) {
          this.applyGraphicsPixelDensity(target, targetDensity);
        }
      } catch (error) {
        console.error("[VJ1_SPECIALIZED_TARGET_RESIZE_FAILED]", {
          kind,
          width: widthPx,
          height: heightPx,
          density: targetDensity,
          fallback: "recreate-target",
          message:
            error?.message ||
            String(error || "specialized target resize failed"),
        });
        onContextDiscard?.(target?.drawingContext);
        disposeRenderTarget(target);
        target = createSpecializedTarget(
          widthPx,
          heightPx,
          targetDensity,
          preferSharedFramebuffer,
          depth,
          this.applyGraphicsPixelDensity,
        );
        this.targets.set(kind, target);
      }
      target.__vj1PixelDensity = targetDensity;
      if (!isSharedFramebufferTarget(target)) target.noStroke();
    }
    return target;
  }

  present(output, target) {
    const contextKey =
      output?.__vj1ShaderContextId || output?.drawingContext || output;
    let shaderProgram = this.presentationShaders.get(contextKey);
    if (!shaderProgram && typeof output?.createShader === "function") {
      try {
        shaderProgram = output.createShader(
          RENDER_PASS_VERTEX_SHADER,
          GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER,
        );
        this.presentationShaders.set(contextKey, shaderProgram);
      } catch (error) {
        shaderProgram = null;
        if (!this.presentationShaderFailures.has(contextKey)) {
          this.presentationShaderFailures.add(contextKey);
          console.error("[VJ1_PRESENTATION_SHADER_FAILED]", {
            target: renderTargetDescriptor(target).kind,
            fallback: "drawBuffer",
            message:
              error?.message ||
              String(error || "presentation shader creation failed"),
          });
        }
      }
    }
    if (!shaderProgram || typeof output?.drawWebGL !== "function") {
      output.push();
      output.clear();
      drawBuffer(output, target, 0, 0, output.width, output.height, true);
      output.pop();
      return;
    }
    drawShaderTarget(output, () => {
      clearShaderTarget(output);
      applyShaderTarget(output, shaderProgram);
      shaderProgram.setUniform("sourceTex", unwrapRenderTarget(target));
      shaderProgram.setUniform(
        "sourceFlipY",
        renderTargetNeedsShaderSampleFlip(
          target,
          isSharedFramebufferTarget(target),
        ),
      );
      drawShaderTargetRect(output, output.width, output.height);
      resetShaderTarget(output);
    });
  }

  markBottomLeft(target) {
    markRenderTargetOrientation(
      target,
      RENDER_TEXTURE_ORIENTATION.bottomLeft,
    );
  }

  dispose() {
    const seen = new Set();
    for (const target of this.targets.values()) {
      if (!target || seen.has(target)) continue;
      seen.add(target);
      disposeRenderTarget(target);
    }
    this.targets.clear();
    this.presentationShaders.clear();
    this.presentationShaderFailures.clear();
  }
}

function createSpecializedTarget(
  width,
  height,
  density,
  preferSharedFramebuffer,
  depth,
  applyDensity,
) {
  const target = preferSharedFramebuffer
    ? createSharedFramebufferTarget(width, height, { depth })
    : createGraphics(width, height, WEBGL);
  if (!isSharedFramebufferTarget(target)) applyDensity(target, density);
  target.__vj1PixelDensity = density;
  if (!isSharedFramebufferTarget(target)) target.noStroke();
  return target;
}
