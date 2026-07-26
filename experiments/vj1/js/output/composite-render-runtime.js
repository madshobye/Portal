import { disposeP5Shader } from "../libraries/mapping-engine/mapping-engine/index.js";
import { clamp01 } from "../domain/models.js";
import { textureStateKey } from "../libraries/render-engine/render-node-contract.js";
import {
  FULL_NODE_BOUNDARY,
  nodeRoiRequest,
} from "../libraries/render-engine/roi/index.js";
import {
  createSharedFramebufferTarget,
  isSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js";
import {
  renderTargetNeedsShaderSampleFlip,
} from "./render-target-contract.js";
import {
  chainLayerState,
  renderBufferKey,
} from "./component-render-state.js";
import { applyBlend } from "./blend-utils.js";
import {
  instanceInvariantRenderRequest,
  renderRequestStateKey,
} from "./render-geometry.js";
import { drawBuffer } from "./render-draw-utils.js";
import { isIdentityTransform } from "./preview-interaction-geometry.js";
import { contentTransformCanvasPlacement } from "./content-coordinate-space.js";
import { effectTransformUniforms } from "./render-runtime-math.js";
import {
  applyShaderTarget,
  clearShaderTarget,
  disposeGraphics,
  drawShaderTarget,
  drawShaderTargetRect,
  resetShaderTarget,
} from "./shader-target-runtime.js";
import {
  COMPONENT_POST_FRAGMENT_SHADER,
  COMPONENT_UPSCALE_FRAGMENT_SHADER,
  LAYER_BLEND_FRAGMENT_SHADER,
  LAYER_TRANSFORM_FRAGMENT_SHADER,
  OVERLAY_BLEND_FRAGMENT_SHADER,
  RENDER_PASS_VERTEX_SHADER,
} from "./render-pass-shaders.js";

// Fixed-function compositing backend shared by Components, Groups, and
// Canvases. RenderTargetRuntime owns target allocation and
// RenderEvaluationRuntime owns dirty-node storage; this capability owns
// layer/ROI evaluation, target elimination, context-bound programs, and the
// direct draw operations used by compiled visual plans.
export class CompositeRenderRuntime {
  constructor(host, {
    createTarget = createSharedFramebufferTarget,
    disposeTarget = disposeGraphics,
  } = {}) {
    this.host = host;
    this.createTarget = createTarget;
    this.disposeTarget = disposeTarget;
    this.pipelineShaders = new Map();
    this.layerTransformShaders = new Map();
    this.layerBlendShaders = new Map();
    this.overlayBlendShaders = new Map();
  }

  renderComponentPipeline({
    component,
    source,
    sourceRequest,
    outputRequest,
    componentTime,
    pipeline,
  }) {
    const upscalingEnabled =
      pipeline.upscaling.enabled && pipeline.upscaling.amount < 0.999;
    const post = pipeline.postProcessing;
    const postEnabled =
      (post.noiseEnabled && post.noiseAmount > 0.0001) ||
      (post.grayscaleEnabled && post.grayscaleAmount > 0.0001);
    if (!upscalingEnabled && !postEnabled) return source;

    let current = source;
    if (upscalingEnabled) {
      const target = this.getPipelineTarget(
        `${component.id}:upscale:${outputRequest.renderIdentity || "shared"}`,
        outputRequest,
      );
      const shaderProgram = this.getPipelineShader("upscale", target);
      if (shaderProgram) {
        current = this.drawPipelinePass({
          target,
          shaderProgram,
          source: current,
          request: outputRequest,
          passName: "Component upscale",
          uniforms: () => {
            shaderProgram.setUniform(
              "sourceResolution",
              [sourceRequest.width, sourceRequest.height],
            );
          },
        });
      }
    }

    if (postEnabled) {
      const target = this.getPipelineTarget(
        `${component.id}:post:${outputRequest.renderIdentity || "shared"}`,
        outputRequest,
      );
      const shaderProgram = this.getPipelineShader("post", target);
      if (shaderProgram) {
        current = this.drawPipelinePass({
          target,
          shaderProgram,
          source: current,
          request: outputRequest,
          passName: "Component post",
          uniforms: () => {
            shaderProgram.setUniform("time", componentTime);
            shaderProgram.setUniform(
              "noiseAmount",
              post.noiseEnabled ? post.noiseAmount : 0,
            );
            shaderProgram.setUniform(
              "grayscaleAmount",
              post.grayscaleEnabled ? post.grayscaleAmount : 0,
            );
          },
        });
      }
    }
    return current;
  }

  getPipelineTarget(id, request) {
    const idKey = renderBufferKey(
      "component-pipeline",
      id,
    );
    return this.host.renderTargetRuntime.gpu(idKey, request, {
      role: "component-pipeline",
      createTarget: this.createTarget,
      disposeTarget: this.disposeTarget,
      beforeDispose: (target) => {
        if (!isSharedFramebufferTarget(target)) this.releaseContext(target);
      },
    });
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
    host.profileRuntime.frameProfile.shaderPasses++;
    host.profileRuntime.frameProfile.shaderChains++;
    return host.profileRuntime.measure("shaderMs", {
      type: "component-pipeline",
      passName,
      width: request.width,
      height: request.height,
    }, () => host.presentationRuntime.measureGpu(target, () => {
      drawShaderTarget(target, () => {
        clearShaderTarget(target);
        applyShaderTarget(target, shaderProgram);
        shaderProgram.setUniform("sourceTex", unwrapRenderTarget(source));
        shaderProgram.setUniform(
          "sourceFlipY",
          renderTargetNeedsShaderSampleFlip(
            source,
            host.renderTargetRuntime.isShaderBuffer(source),
          ),
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
        renderTargetNeedsShaderSampleFlip(
          source,
          this.host.renderTargetRuntime.isShaderBuffer(source),
        ),
      );
      shaderProgram.setUniform("sourceUvMatrix", sourceUvMatrix);
      drawShaderTargetRect(target, target.width, target.height);
      resetShaderTarget(target);
    });
    return true;
  }

  drawLayer(target, base, layerSource, {
    opacity = 1,
    blend = "normal",
  } = {}) {
    const shaderProgram = this.getLayerBlendShader(target);
    if (!shaderProgram) return false;
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shaderProgram);
      shaderProgram.setUniform("baseTex", unwrapRenderTarget(base));
      shaderProgram.setUniform("layerTex", unwrapRenderTarget(layerSource));
      shaderProgram.setUniform(
        "baseFlipY",
        renderTargetNeedsShaderSampleFlip(
          base,
          this.host.renderTargetRuntime.isShaderBuffer(base),
        ),
      );
      shaderProgram.setUniform(
        "layerFlipY",
        renderTargetNeedsShaderSampleFlip(
          layerSource,
          this.host.renderTargetRuntime.isShaderBuffer(layerSource),
        ),
      );
      shaderProgram.setUniform("layerOpacity", opacity);
      shaderProgram.setUniform("layerBlendMode", layerBlendMode(blend));
      drawShaderTargetRect(target, target.width, target.height);
      resetShaderTarget(target);
    });
    return true;
  }

  transparentChainState(component, renderRequest) {
    const host = this.host;
    const nodeId = renderBufferKey(component.id, "transparent");
    const evaluationRequest = instanceInvariantRenderRequest(renderRequest);
    const signature = stableStringify({
      transparent: true,
      request: renderRequestStateKey(evaluationRequest),
    });
    const state = host.renderEvaluationRuntime.evaluate(
      nodeId,
      signature,
      renderRequest,
      (output) => {
        output.push();
        output.clear();
        output.pop();
      },
      "initial",
      { instanceInvariant: true },
    );
    // The compiler can lower an opaque identity source directly over this
    // semantic transparent state without allocating a redundant composite.
    state.transparent = true;
    return state;
  }

  renderLayerNodeState(nodeId, inputState, layerState, layer, renderRequest) {
    const host = this.host;
    if (
      inputState?.transparent === true &&
      isIdentityTransform(layer.transform || {}) &&
      (layer.blend === undefined || layer.blend === "normal") &&
      clamp01(layer.opacity ?? 1) >= 1
    ) {
      return layerState;
    }
    const contentState = this.renderLayerContentTransformState(
      renderBufferKey(nodeId, "content-transform"),
      layerState,
      layer.transform || {},
      renderRequest,
    );
    const compositeLayer = { ...layer, transform: {} };
    const instanceInvariant =
      inputState.instanceInvariant === true &&
      contentState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      layer: textureStateKey(contentState),
      state: chainLayerState(layer),
      request: renderRequestStateKey(evaluationRequest),
    });
    return host.renderEvaluationRuntime.evaluate(
      nodeId,
      signature,
      renderRequest,
      (output) => {
        if (layer.blend === "overlay" && isSharedFramebufferTarget(output)) {
          this.drawOverlay(
            output,
            inputState.buffer,
            contentState.buffer,
            {
              layerUvMatrix: effectTransformUniforms(
                compositeLayer.transform || {},
              ).forward,
              opacity: clamp01(compositeLayer.opacity ?? 1),
            },
          );
          return;
        }
        if (
          isSharedFramebufferTarget(output) &&
          this.drawLayer(
            output,
            inputState.buffer,
            contentState.buffer,
            {
              opacity: clamp01(compositeLayer.opacity ?? 1),
              blend: compositeLayer.blend || "normal",
            },
          )
        ) {
          return;
        }
        output.push();
        output.clear();
        drawBuffer(
          output,
          inputState.buffer,
          0,
          0,
          output.width,
          output.height,
          host.renderTargetRuntime.isShaderBuffer(inputState.buffer),
        );
        output.pop();
        this.drawChainLayer(output, contentState.buffer, compositeLayer);
      },
      "layer",
      { instanceInvariant },
    );
  }

  renderBoundedLayerNodeState(
    nodeId,
    inputState,
    layerState,
    layer,
    renderRequest,
    roi,
  ) {
    const host = this.host;
    const instanceInvariant =
      inputState.instanceInvariant === true &&
      layerState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      layer: textureStateKey(layerState),
      state: chainLayerState(layer),
      roi,
      request: renderRequestStateKey(evaluationRequest),
    });
    return host.renderEvaluationRuntime.evaluate(
      renderBufferKey(nodeId, "bounded-layer"),
      signature,
      renderRequest,
      (output) => {
        output.push();
        output.clear();
        drawBuffer(
          output,
          inputState.buffer,
          0,
          0,
          output.width,
          output.height,
          host.renderTargetRuntime.isShaderBuffer(inputState.buffer),
        );
        applyBlend(output, layer.blend);
        output.tint(255, 255 * clamp01(layer.opacity ?? 1));
        this.drawNodeRegionGeometry(output, layerState.buffer, roi);
        output.noTint();
        output.blendMode(globalThis.BLEND);
        output.pop();
      },
      "bounded-layer",
      { instanceInvariant },
    );
  }

  renderFullFrameEffectWithinBoundary(
    nodeId,
    inputState,
    item,
    componentTime,
    renderRequest,
    inputStates = null,
  ) {
    const host = this.host;
    const fullState = host.shaderEffectRuntime.renderNodeState(
      renderBufferKey(nodeId, "full-frame-effect"),
      inputState,
      { ...item, boundary: FULL_NODE_BOUNDARY },
      componentTime,
      renderRequest,
      inputStates,
    );
    const roiRequest = nodeRoiRequest(renderRequest, item.boundary, {
      renderIdentity: renderBufferKey(
        renderRequest.renderIdentity || "effect",
        item.id || item.componentId,
      ),
    });
    const regionState = this.extractNodeRegionState(
      renderBufferKey(nodeId, "full-frame-region"),
      fullState,
      renderRequest,
      roiRequest,
    );
    return this.compositeNodeRegionState(
      renderBufferKey(nodeId, "full-frame-composite"),
      inputState,
      regionState,
      renderRequest,
      roiRequest.roi,
    );
  }

  renderBoundedEffectRunNodeState(
    nodeId,
    inputState,
    items,
    componentTime,
    renderRequest,
    halo = 0,
    inputStates = null,
  ) {
    const host = this.host;
    const boundary = items[0]?.boundary || FULL_NODE_BOUNDARY;
    const roiRequest = nodeRoiRequest(renderRequest, boundary, {
      renderIdentity: renderBufferKey(
        renderRequest.renderIdentity || "effect",
        items.map((item) => item.id || item.componentId).join("+"),
      ),
      halo,
    });
    const regionState = this.extractNodeRegionState(
      renderBufferKey(nodeId, "extract"),
      inputState,
      renderRequest,
      roiRequest,
    );
    const regionInputStates = inputStates?.size
      ? new Map(
          [...inputStates].map(([port, textureState]) => [
            port,
            textureState === inputState
              ? regionState
              : this.extractNodeRegionState(
                  renderBufferKey(nodeId, "extract", port),
                  textureState,
                  renderRequest,
                  roiRequest,
                ),
          ]),
        )
      : null;
    let effectState = regionState;
    for (let index = 0; index < items.length; index++) {
      effectState = host.shaderEffectRuntime.renderNodeState(
        renderBufferKey(
          nodeId,
          "roi-effect",
          index,
          items[index].id || items[index].componentId,
        ),
        effectState,
        { ...items[index], boundary: FULL_NODE_BOUNDARY },
        componentTime,
        roiRequest,
        index === 0 ? regionInputStates : null,
      );
    }
    return this.compositeNodeRegionState(
      renderBufferKey(nodeId, "roi-composite"),
      inputState,
      effectState,
      renderRequest,
      roiRequest.roi,
    );
  }

  extractNodeRegionState(nodeId, inputState, fullRequest, roiRequest) {
    const host = this.host;
    const instanceInvariant = inputState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(fullRequest)
      : fullRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      roi: roiRequest.roi,
      request: renderRequestStateKey(evaluationRequest),
    });
    return host.renderEvaluationRuntime.evaluate(
      nodeId,
      signature,
      roiRequest,
      (output) => {
        const roi = roiRequest.roi;
        output.push();
        output.clear();
        output.translate(-roi.sampleX, -roi.sampleY);
        output.translate(
          roi.boundaryWidth * 0.5,
          roi.boundaryHeight * 0.5,
        );
        output.rotate(-roi.rotation);
        output.translate(-roi.centerX, -roi.centerY);
        drawBuffer(
          output,
          inputState.buffer,
          0,
          0,
          roi.fullWidth,
          roi.fullHeight,
          host.renderTargetRuntime.isShaderBuffer(inputState.buffer),
        );
        output.pop();
      },
      "roi-extract",
      { instanceInvariant },
    );
  }

  compositeNodeRegionState(
    nodeId,
    inputState,
    regionState,
    renderRequest,
    roi,
  ) {
    const host = this.host;
    const instanceInvariant =
      inputState.instanceInvariant === true &&
      regionState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      region: textureStateKey(regionState),
      roi,
      request: renderRequestStateKey(evaluationRequest),
    });
    return host.renderEvaluationRuntime.evaluate(
      nodeId,
      signature,
      renderRequest,
      (output) => {
        output.push();
        output.clear();
        drawBuffer(
          output,
          inputState.buffer,
          0,
          0,
          output.width,
          output.height,
          host.renderTargetRuntime.isShaderBuffer(inputState.buffer),
        );
        // Replacement is required for alpha-key and mask effects; source-over
        // would retain pixels made transparent inside the bounded region.
        output.blendMode(globalThis.REPLACE ?? "replace");
        this.drawNodeRegionGeometry(output, regionState.buffer, roi);
        output.blendMode(globalThis.BLEND ?? "source-over");
        output.pop();
      },
      "roi-composite",
      { instanceInvariant },
    );
  }

  drawNodeRegionGeometry(output, region, roi) {
    output.push();
    output.translate(roi.centerX, roi.centerY);
    output.rotate(roi.rotation);
    drawBuffer(
      output,
      region,
      -roi.boundaryWidth * 0.5 + roi.sampleX,
      -roi.boundaryHeight * 0.5 + roi.sampleY,
      roi.width,
      roi.height,
      this.host.renderTargetRuntime.isShaderBuffer(region),
    );
    output.pop();
  }

  renderLayerContentTransformState(
    nodeId,
    inputState,
    transform,
    renderRequest,
  ) {
    const host = this.host;
    if (isIdentityTransform(transform)) return inputState;
    const instanceInvariant = inputState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      transform,
      request: renderRequestStateKey(evaluationRequest),
    });
    return host.renderEvaluationRuntime.evaluate(
      nodeId,
      signature,
      renderRequest,
      (output) => {
        if (!isSharedFramebufferTarget(output)) {
          output.push();
          output.clear();
          this.drawTransformedLayerFallback(
            output,
            inputState.buffer,
            transform,
          );
          output.pop();
          return;
        }
        this.drawLayerTransform(
          output,
          inputState.buffer,
          effectTransformUniforms(transform).forward,
        );
      },
      "content-transform",
      { instanceInvariant },
    );
  }

  drawChainLayer(output, source, layer) {
    output.push();
    applyBlend(output, layer.blend);
    output.tint(255, 255 * clamp01(layer.opacity ?? 1));
    drawBuffer(
      output,
      source,
      0,
      0,
      output.width,
      output.height,
      this.host.renderTargetRuntime.isShaderBuffer(source),
    );
    output.noTint();
    output.blendMode(BLEND);
    output.pop();
  }

  drawTransformedLayerFallback(output, source, transform = {}) {
    const placement = contentTransformCanvasPlacement(
      transform,
      output.width,
      output.height,
    );
    output.imageMode(CENTER);
    output.translate(placement.centerX, placement.centerY);
    output.rotate(placement.rotation);
    output.scale(placement.scale);
    if (this.host.renderTargetRuntime.isShaderBuffer(source)) {
      drawBuffer(
        output,
        source,
        -output.width / 2,
        -output.height / 2,
        output.width,
        output.height,
        true,
      );
    } else {
      output.image(source, 0, 0, output.width, output.height);
    }
    output.imageMode(CORNER);
  }

  getLayerBlendShader(target) {
    return this.getFixedShader(
      this.layerBlendShaders,
      target,
      LAYER_BLEND_FRAGMENT_SHADER,
      "[VJ1_LAYER_BLEND_SHADER_FAILED]",
    );
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
      shaderProgram.setUniform(
        "baseFlipY",
        renderTargetNeedsShaderSampleFlip(
          base,
          this.host.renderTargetRuntime.isShaderBuffer(base),
        ),
      );
      shaderProgram.setUniform(
        "layerFlipY",
        renderTargetNeedsShaderSampleFlip(
          layerSource,
          this.host.renderTargetRuntime.isShaderBuffer(layerSource),
        ),
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
    disposeShaderMapEntry(this.layerBlendShaders, contextKey);
    disposeShaderMapEntry(this.overlayBlendShaders, contextKey);
  }

  dispose() {
    disposeNestedShaderMap(this.pipelineShaders);
    disposeShaderMap(this.layerTransformShaders);
    disposeShaderMap(this.layerBlendShaders);
    disposeShaderMap(this.overlayBlendShaders);
  }
}

function layerBlendMode(blend = "normal") {
  return ({
    normal: 0,
    add: 1,
    multiply: 2,
    screen: 3,
    darkest: 4,
    lightest: 5,
    difference: 6,
    exclusion: 7,
    remove: 8,
  })[blend] ?? 0;
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

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
