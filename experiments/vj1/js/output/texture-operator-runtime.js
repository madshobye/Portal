import {
  textureTransitionFragmentShaderSource,
  transitionKernelCacheKey,
  transitionKernelUniformValues,
} from "../libraries/transition-engine/index.js";
import { disposeP5Shader } from "../libraries/mapping-engine/mapping-engine/index.js?v=safe-shader-disposal-1";
import { renderBufferKey } from "./component-render-state.js?v=async-media-dirty-1";
import { drawBuffer } from "./render-draw-utils.js?v=runtime-diagnostics-1";
import {
  RENDER_PASS_VERTEX_SHADER,
  TEXTURE_OPERATOR_FRAGMENT_SHADER,
} from "./render-pass-shaders.js?v=node-roi-placement-1";
import {
  applyShaderTarget,
  clearShaderTarget,
  drawShaderTarget,
  drawShaderTargetRect,
  resetShaderTarget,
  setShaderUniformIfPresent,
} from "./shader-target-runtime.js?v=premultiplied-alpha-write-1";
import { unwrapRenderTarget } from "./shared-framebuffer-target.js?v=premultiplied-alpha-5";
import {
  renderTargetNeedsShaderSampleFlip,
} from "./render-target-contract.js?v=source-target-ownership-1";

// Optimized backend for the generic texture-node family. The compiled visual
// plan owns topology and scheduling; this class owns shader programs and the
// two retained targets required only by explicit Feedback/Delay nodes.
export class TextureOperatorRuntime {
  constructor(host) {
    this.host = host;
    this.operatorShaders = new Map();
    this.transitionShaders = new Map();
  }

  renderRetained(plan, operation, current, renderRequest, scopeId) {
    let runtime = plan.retainedOperators.get(operation.id);
    if (!runtime) {
      runtime = {
        read: null,
        write: null,
        initialized: false,
        outputVersion: 0,
        outputState: {
          buffer: null,
          outputVersion: 0,
          nodeKey: renderBufferKey(scopeId, operation.id, "retained"),
          dirtyReason: `texture-${operation.opcode}`,
          instanceInvariant: false,
        },
      };
      plan.retainedOperators.set(operation.id, runtime);
    }
    const read = this.host.renderTargetRuntime.gpu(
      renderBufferKey(scopeId, operation.id, "retained-a"),
      renderRequest,
    );
    const write = this.host.renderTargetRuntime.gpu(
      renderBufferKey(scopeId, operation.id, "retained-b"),
      renderRequest,
    );
    if (runtime.read !== read && runtime.read !== write) {
      runtime.read = read;
      runtime.write = write;
      runtime.initialized = false;
    }
    if (!runtime.initialized) {
      runtime.read.push();
      runtime.read.clear();
      runtime.read.pop();
      runtime.initialized = true;
    }
    if (operation.opcode === "delay") {
      runtime.outputState.buffer = runtime.read;
      this.copyToTarget(runtime.write, current.buffer);
    } else {
      this.draw(
        runtime.write,
        current.buffer,
        runtime.read,
        "feedback",
        operation.configuration?.params || {},
        clamp01(operation.configuration?.params?.amount ?? 0.85),
      );
      runtime.outputState.buffer = runtime.write;
    }
    runtime.outputVersion++;
    runtime.outputState.outputVersion = runtime.outputVersion;
    const swap = runtime.read;
    runtime.read = runtime.write;
    runtime.write = swap;
    return runtime.outputState;
  }

  draw(target, textureA, textureB, opcode, params = {}, amount = 0.5) {
    const shaderProgram = this.getOperatorShader(target);
    if (!shaderProgram) {
      this.copyToTarget(target, textureA);
      return;
    }
    const blendMode = opcode === "mix"
      ? ({ crossfade: 0, add: 1, multiply: 2, screen: 3 }[params.mode] ?? 0)
      : 0;
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shaderProgram);
      shaderProgram.setUniform("textureA", unwrapRenderTarget(textureA));
      shaderProgram.setUniform("textureB", unwrapRenderTarget(textureB));
      shaderProgram.setUniform(
        "flipA",
        renderTargetNeedsShaderSampleFlip(
          textureA,
          this.host.renderTargetRuntime.isShaderBuffer(textureA),
        ),
      );
      shaderProgram.setUniform(
        "flipB",
        renderTargetNeedsShaderSampleFlip(
          textureB,
          this.host.renderTargetRuntime.isShaderBuffer(textureB),
        ),
      );
      shaderProgram.setUniform("operation", opcode === "mask" ? 1 : 0);
      shaderProgram.setUniform("blendMode", blendMode);
      shaderProgram.setUniform("amount", amount);
      shaderProgram.setUniform("maskLuminance", params.channel === "luminance");
      shaderProgram.setUniform("invertMask", params.invert === true);
      drawShaderTargetRect(target, target.width, target.height);
      resetShaderTarget(target);
    });
  }

  drawTransition(
    target,
    fromTexture,
    toTexture,
    transition,
    progress,
    componentTime,
  ) {
    const kernel = transition.transitionKernel;
    const shaderProgram = this.getTransitionShader(target, kernel);
    if (!shaderProgram) {
      this.draw(
        target,
        fromTexture,
        toTexture,
        "mix",
        { mode: "crossfade" },
        progress,
      );
      return;
    }
    const fromFlip = renderTargetNeedsShaderSampleFlip(
      fromTexture,
      this.host.renderTargetRuntime.isShaderBuffer(fromTexture),
    );
    const toFlip = renderTargetNeedsShaderSampleFlip(
      toTexture,
      this.host.renderTargetRuntime.isShaderBuffer(toTexture),
    );
    const uniforms = transitionKernelUniformValues(
      kernel,
      transition.transitionParameters,
      {
        time: Number(componentTime) || 0,
        timeDelta: this.host.frameRuntime.visualDeltaSeconds,
        frameIndex: this.host.frameRuntime.frameIndex,
        passIndex: 0,
        renderSize: [target.width, target.height],
        startImageSize: [
          fromTexture?.width || target.width,
          fromTexture?.height || target.height,
        ],
        endImageSize: [
          toTexture?.width || target.width,
          toTexture?.height || target.height,
        ],
      },
    );
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shaderProgram);
      shaderProgram.setUniform("fromTex", unwrapRenderTarget(fromTexture));
      shaderProgram.setUniform("toTex", unwrapRenderTarget(toTexture));
      shaderProgram.setUniform(
        "uFromSourceRect",
        fromFlip ? [0, 1, 1, -1] : [0, 0, 1, 1],
      );
      shaderProgram.setUniform(
        "uToSourceRect",
        toFlip ? [0, 1, 1, -1] : [0, 0, 1, 1],
      );
      shaderProgram.setUniform("uFromOpacity", 1);
      shaderProgram.setUniform("uToOpacity", 1);
      shaderProgram.setUniform("uTransition", progress);
      for (const [name, value] of Object.entries(uniforms)) {
        setShaderUniformIfPresent(shaderProgram, name, value);
      }
      drawShaderTargetRect(target, target.width, target.height);
      resetShaderTarget(target);
    });
  }

  getOperatorShader(target) {
    const contextKey = shaderContextKey(target);
    if (this.operatorShaders.has(contextKey)) {
      return this.operatorShaders.get(contextKey);
    }
    try {
      const shaderProgram = target.createShader(
        RENDER_PASS_VERTEX_SHADER,
        TEXTURE_OPERATOR_FRAGMENT_SHADER,
      );
      this.operatorShaders.set(contextKey, shaderProgram);
      return shaderProgram;
    } catch (error) {
      console.error(
        "[VJ1_TEXTURE_OPERATOR_SHADER_FAILED]",
        error?.message || error,
      );
      return null;
    }
  }

  getTransitionShader(target, kernel) {
    const contextKey = shaderContextKey(target);
    let shaders = this.transitionShaders.get(contextKey);
    if (!shaders) {
      shaders = new Map();
      this.transitionShaders.set(contextKey, shaders);
    }
    const key = transitionKernelCacheKey(kernel);
    if (shaders.has(key)) return shaders.get(key);
    try {
      const shaderProgram = target.createShader(
        RENDER_PASS_VERTEX_SHADER,
        textureTransitionFragmentShaderSource(kernel),
      );
      shaders.set(key, shaderProgram);
      return shaderProgram;
    } catch (error) {
      console.error("[VJ1_TEXTURE_TRANSITION_SHADER_FAILED]", {
        id: kernel?.id || "dissolve",
        message: error?.message || String(error),
      });
      return null;
    }
  }

  copyToTarget(target, source) {
    target.push();
    target.clear();
    drawBuffer(
      target,
      source,
      0,
      0,
      target.width,
      target.height,
      this.host.renderTargetRuntime.isShaderBuffer(source),
    );
    target.pop();
  }

  dispose() {
    this.disposeOperatorShaders();
    this.disposeTransitionShaders();
  }

  disposeOperatorShaders() {
    for (const shaderProgram of this.operatorShaders.values()) {
      disposeP5Shader(shaderProgram);
    }
    this.operatorShaders.clear();
  }

  disposeTransitionShaders() {
    for (const shaders of this.transitionShaders.values()) {
      for (const shaderProgram of shaders.values()) {
        disposeP5Shader(shaderProgram);
      }
      shaders.clear();
    }
    this.transitionShaders.clear();
  }
}

function shaderContextKey(target) {
  return target?.__vj1ShaderContextId || target?._renderer || "global";
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
