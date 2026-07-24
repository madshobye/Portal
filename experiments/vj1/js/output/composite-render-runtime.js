import { disposeP5Shader } from "../libraries/mapping-engine/mapping-engine/index.js?v=safe-shader-disposal-1";
import {
  isSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js?v=isf-runtime-1";
import {
  applyShaderTarget,
  clearShaderTarget,
  drawShaderTarget,
  drawShaderTargetRect,
  resetShaderTarget,
} from "./shader-target-runtime.js?v=canonical-effect-params-1";
import {
  COMPONENT_POST_FRAGMENT_SHADER,
  COMPONENT_UPSCALE_FRAGMENT_SHADER,
  LAYER_TRANSFORM_FRAGMENT_SHADER,
  OVERLAY_BLEND_FRAGMENT_SHADER,
  RENDER_PASS_VERTEX_SHADER,
} from "./render-pass-shaders.js?v=texture-dag-1";

// Fixed-function compositing backend shared by Components, Groups, and
// Canvases. The host owns target allocation and dirty evaluation; this runtime
// owns the context-bound fixed shader programs and direct draw operations.
export class CompositeRenderRuntime {
  constructor(host) {
    this.host = host;
    this.pipelineShaders = new Map();
    this.layerTransformShaders = new Map();
    this.overlayBlendShaders = new Map();
  }

  getPipelineShader(kind, target) {
    const contextKey = shaderContextKey(target);
    let shaders = this.pipelineShaders.get(contextKey);
    if (!shaders) {
      shaders = new Map();
      this.pipelineShaders.set(contextKey, shaders);
    }
    if (shaders.has(kind)) return shaders.get(kind);
    try {
      const fragment = kind === "upscale"
        ? COMPONENT_UPSCALE_FRAGMENT_SHADER
        : kind === "transform"
          ? LAYER_TRANSFORM_FRAGMENT_SHADER
          : COMPONENT_POST_FRAGMENT_SHADER;
      const shaderProgram = target.createShader(
        RENDER_PASS_VERTEX_SHADER,
        fragment,
      );
      shaders.set(kind, shaderProgram);
      return shaderProgram;
    } catch (error) {
      console.error("[VJ1_COMPONENT_PIPELINE_SHADER_FAILED]", {
        kind,
        message: error?.message || String(error),
      });
      return null;
    }
  }

  drawPipelinePass({
    target,
    shaderProgram,
    source,
    request,
    passName,
    uniforms,
  }) {
    const host = this.host;
    host.frameProfile.shaderPasses++;
    host.frameProfile.shaderChains++;
    return host.measureProfile("shaderMs", {
      type: "component-pipeline",
      passName,
      width: request.width,
      height: request.height,
    }, () => host.measureGpu(target, () => {
      drawShaderTarget(target, () => {
        clearShaderTarget(target);
        applyShaderTarget(target, shaderProgram);
        shaderProgram.setUniform("sourceTex", unwrapRenderTarget(source));
        shaderProgram.setUniform(
          "sourceFlipY",
          !host.isShaderBuffer(source),
        );
        uniforms?.();
        drawShaderTargetRect(target, request.width, request.height);
        resetShaderTarget(target);
      });
      return target;
    }));
  }

  drawLayerTransform(target, source, sourceUvMatrix) {
    const shaderProgram = this.getLayerTransformShader(target);
    if (!shaderProgram) return false;
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shaderProgram);
      shaderProgram.setUniform("sourceTex", unwrapRenderTarget(source));
      shaderProgram.setUniform(
        "sourceFlipY",
        !this.host.isShaderBuffer(source),
      );
      shaderProgram.setUniform("sourceUvMatrix", sourceUvMatrix);
      drawShaderTargetRect(target, target.width, target.height);
      resetShaderTarget(target);
    });
    return true;
  }

  getLayerTransformShader(target) {
    return this.getFixedShader(
      this.layerTransformShaders,
      target,
      LAYER_TRANSFORM_FRAGMENT_SHADER,
      "[VJ1_LAYER_TRANSFORM_SHADER_FAILED]",
    );
  }

  drawOverlay(target, base, layerSource, {
    layerUvMatrix,
    opacity = 1,
  } = {}) {
    const shaderProgram = this.getOverlayBlendShader(target);
    if (!shaderProgram) return false;
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shaderProgram);
      shaderProgram.setUniform("baseTex", unwrapRenderTarget(base));
      shaderProgram.setUniform("layerTex", unwrapRenderTarget(layerSource));
      shaderProgram.setUniform("baseFlipY", !this.host.isShaderBuffer(base));
      shaderProgram.setUniform(
        "layerFlipY",
        !this.host.isShaderBuffer(layerSource),
      );
      shaderProgram.setUniform("layerUvMatrix", layerUvMatrix);
      shaderProgram.setUniform("layerOpacity", opacity);
      drawShaderTargetRect(target, target.width, target.height);
      resetShaderTarget(target);
    });
    return true;
  }

  getOverlayBlendShader(target) {
    return this.getFixedShader(
      this.overlayBlendShaders,
      target,
      OVERLAY_BLEND_FRAGMENT_SHADER,
      "[VJ1_OVERLAY_SHADER_FAILED]",
    );
  }

  getFixedShader(cache, target, fragment, diagnostic) {
    const contextKey = shaderContextKey(target);
    if (cache.has(contextKey)) return cache.get(contextKey);
    try {
      const shaderProgram = target.createShader(
        RENDER_PASS_VERTEX_SHADER,
        fragment,
      );
      cache.set(contextKey, shaderProgram);
      return shaderProgram;
    } catch (error) {
      console.error(diagnostic, error?.message || error);
      return null;
    }
  }

  releaseContext(target) {
    const contextKey = shaderContextKey(target);
    disposeShaderMapEntry(this.pipelineShaders, contextKey);
    disposeShaderMapEntry(this.layerTransformShaders, contextKey);
    disposeShaderMapEntry(this.overlayBlendShaders, contextKey);
  }

  dispose() {
    disposeNestedShaderMap(this.pipelineShaders);
    disposeShaderMap(this.layerTransformShaders);
    disposeShaderMap(this.overlayBlendShaders);
  }
}

function shaderContextKey(target) {
  if (isSharedFramebufferTarget(target)) {
    return target?.__vj1ShaderContextId || target?._renderer || "global";
  }
  return target?.__vj1ShaderContextId || target?._renderer || target || "global";
}

function disposeShaderMapEntry(cache, key) {
  const value = cache.get(key);
  if (!value) return;
  cache.delete(key);
  if (value instanceof Map) {
    for (const shaderProgram of new Set(value.values())) {
      disposeP5Shader(shaderProgram);
    }
    value.clear();
  } else {
    disposeP5Shader(value);
  }
}

function disposeNestedShaderMap(cache) {
  for (const key of Array.from(cache.keys())) disposeShaderMapEntry(cache, key);
}

function disposeShaderMap(cache) {
  for (const shaderProgram of new Set(cache.values())) {
    disposeP5Shader(shaderProgram);
  }
  cache.clear();
}
