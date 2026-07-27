import { contentTransformUvMatrices } from "./content-coordinate-space.js";
import {
  isSharedFramebufferTarget,
} from "./shared-framebuffer-target.js";
import {
  applyShaderTarget,
  clearShaderTarget,
  drawShaderTarget,
  drawShaderTargetRect,
  resetShaderTarget,
  setShaderUniformIfPresent,
  shaderDrawingBufferSize,
} from "./shader-target-runtime.js";
import {
  generatorRateParam,
  qualityAdjustedGeneratorParams,
  usesShadertoyInterface,
} from "./render-runtime-math.js";
import {
  FULL_RENDER_UV_RECT,
  renderSourceDetail,
} from "../libraries/render-engine/render-view/index.js";
import { isIdentityTransform } from "./preview-interaction-geometry.js";
import { drawBuffer } from "./render-draw-utils.js";
import { frameRenderRequest } from "./render-geometry.js";
import { roundMetric } from "./output-render-profile.js";
import { advanceRateClock } from "../libraries/timing-engine/index.js";

// Direct capability for compiled fragment, Shadertoy, and ISF generators.
// The compiler and source runtime choose the operation and target; this
// runtime owns generator program invocation, retained transform/uniform state,
// rate clocks, source-detail uniforms, ISF handoff, and profiling.
export class ShaderGeneratorRuntime {
  constructor(host, {
    getGeneratorComponent = (id) => host.visualNodeRuntime.generator(id),
    getShaderComponent = (id) => host.visualNodeRuntime.generatorShader(id),
    getShaderRuntime = () => host.shaderEffectRuntime,
    getIsfRuntime = () => host.isfRuntime,
  } = {}) {
    this.host = host;
    this.getGeneratorComponent = getGeneratorComponent;
    this.getShaderComponent = getShaderComponent;
    this.getShaderRuntime = getShaderRuntime;
    this.getIsfRuntime = getIsfRuntime;
    this.rateClocks = new Map();
    this.uniformStates = new Map();
    this.uniformStateUse = new Map();
  }

  draw(
    target,
    sourceOrId,
    componentTime = this.host.frameRuntime.visualTime,
    request = frameRenderRequest(this.host.state.render),
    inputStates = null,
  ) {
    const source =
      typeof sourceOrId === "object"
        ? sourceOrId
        : { generatorId: sourceOrId, params: {} };
    // Preserve the compiled source contract while binding it to the exact
    // allocation supplied by the source runtime.
    const renderRequest = this.host.renderRequestRuntime.normalize(
      {
        ...request,
        width: target.width,
        height: target.height,
      },
      "source",
    );
    const rendered = this.renderSource(
      source.generatorId,
      componentTime,
      renderRequest,
      source.params || {},
      source.instanceId || source.generatorId,
      source.contentTransform || {},
      isSharedFramebufferTarget(target) ? target : null,
      inputStates,
    );
    if (!rendered) return false;
    if (rendered === target) return true;
    target.push();
    target.clear();
    drawBuffer(
      target,
      rendered,
      0,
      0,
      target.width,
      target.height,
      true,
    );
    target.pop();
    return true;
  }

  renderSource(
    id,
    componentTime = this.host.frameRuntime.visualTime,
    request = frameRenderRequest(this.host.state.render),
    params = {},
    instanceId = id,
    contentTransform = {},
    outputTarget = null,
    inputStates = null,
  ) {
    const host = this.host;
    const generatorComponent = this.getGeneratorComponent(id);
    if (!generatorComponent) return null;
    const generatorId = generatorComponent.id;
    const shaderComponent = this.getShaderComponent(generatorId);
    const component = shaderComponent
      ? {
          ...shaderComponent,
          params:
            generatorComponent.params ||
            shaderComponent.params ||
            [],
        }
      : null;
    if (!component) return null;

    // Quality has already changed the compiled source allocation. Consume the
    // request exactly once rather than applying generator quality again.
    let renderRequest = host.renderRequestRuntime.normalize(request, "source");
    const shaderRuntime = this.getShaderRuntime();
    const target =
      outputTarget || shaderRuntime.getTarget(renderRequest, 0);
    if (
      outputTarget &&
      (outputTarget.width !== renderRequest.width ||
        outputTarget.height !== renderRequest.height)
    ) {
      renderRequest = host.renderRequestRuntime.normalize(
        {
          ...renderRequest,
          width: outputTarget.width,
          height: outputTarget.height,
        },
        "source",
      );
    }
    const shader = shaderRuntime.getShader(
      { id: component.id, component },
      target,
    );
    if (!shader) return null;

    const qualityParams = qualityAdjustedGeneratorParams(
      generatorComponent,
      params,
    );
    const rateParam = generatorRateParam(generatorComponent);
    const rate = rateParam
      ? Math.max(0, Number(qualityParams[rateParam]) || 0)
      : 1;
    const shaderTime = rateParam
      ? this.rateTime(
          `${instanceId || generatorId}:${rateParam}`,
          componentTime,
          rate,
        )
      : componentTime;
    const shaderParams = rateParam
      ? { ...qualityParams, [rateParam]: 1 }
      : qualityParams;
    const uniformKey = `${generatorId}:${instanceId || generatorId}`;
    const uniformState = contentTransformUvMatrices(
      contentTransform,
      this.uniformStates.get(uniformKey),
    );
    uniformState.resolution ||= [0, 0];
    uniformState.iResolution ||= [0, 0, 1];
    uniformState.iMouse ||= [0, 0, 0, 0];
    uniformState.iDate ||= [0, 0, 0, 0];
    this.uniformStates.set(uniformKey, uniformState);
    this.uniformStateUse.set(uniformKey, host.frameRuntime.frameIndex);

    const drawingSize = shaderDrawingBufferSize(
      target,
      renderRequest.width,
      renderRequest.height,
    );
    const sourceDetail = renderSourceDetail(
      drawingSize,
      renderRequest,
      { contentScale: contentTransform?.scale },
    );
    const isfRuntime = this.getIsfRuntime();
    if (isfRuntime.needsPassRuntime(component)) {
      return isfRuntime.renderProgram({
        component,
        shader,
        finalTarget: target,
        renderRequest,
        timeSeconds: shaderTime,
        params: shaderParams,
        instanceId: instanceId || generatorId,
        contentMatrix: uniformState.sampling,
        useContentTransform: !isIdentityTransform(contentTransform),
        sourceDetail,
        inputs: inputStates,
      });
    }

    const started = host.profileRuntime.collectDetailed
      ? performance.now()
      : 0;
    const sample = host.profileRuntime.collectDetailed
      ? {
          type: "shader-generator",
          passId: generatorId,
          passName: component.name || generatorId,
          ...host.profileRuntime.activeComponentIdentity(),
          width: renderRequest.width,
          height: renderRequest.height,
          ms: 0,
        }
      : null;
    const gpuTimer = host.presentationRuntime.gpuTimer;
    const gpuToken = gpuTimer.begin(target, host.frameRuntime.frameIndex);
    try {
      drawShaderTarget(target, () => {
        clearShaderTarget(target);
        applyShaderTarget(target, shader);
        setShaderUniformIfPresent(
          shader,
          "useContentTransform",
          isIdentityTransform(contentTransform) ? 0 : 1,
        );
        setShaderUniformIfPresent(
          shader,
          "contentUvMatrix",
          uniformState.sampling,
        );
        setShaderUniformIfPresent(
          shader,
          "renderUvRect",
          renderRequest.uvRect || FULL_RENDER_UV_RECT,
        );
        const shadertoyInterface =
          usesShadertoyInterface(component);
        const isfInterface = component.type === "isf";
        if (shadertoyInterface) {
          this.setShadertoyUniforms(
            shader,
            uniformState,
            sourceDetail,
            shaderTime,
          );
        } else if (isfInterface) {
          isfRuntime.setFrameUniforms(shader, component, {
            inputs: inputStates,
            renderRequest,
            timeSeconds: shaderTime,
            params: shaderParams,
            generatorUniformState: uniformState,
            sourceDetail,
          });
        } else {
          uniformState.resolution[0] = Math.max(
            1,
            sourceDetail.width,
          );
          uniformState.resolution[1] = Math.max(
            1,
            sourceDetail.height,
          );
          shader.setUniform(
            "resolution",
            uniformState.resolution,
          );
          setShaderUniformIfPresent(shader, "time", shaderTime);
        }
        shaderRuntime.setParamUniforms(
          shader,
          component,
          shaderParams,
          {
            setDefaultAmount: false,
            onlyPresent: shadertoyInterface || isfInterface,
            instanceId,
          },
        );
        drawShaderTargetRect(
          target,
          renderRequest.width,
          renderRequest.height,
        );
        resetShaderTarget(target);
      });
    } finally {
      gpuTimer.end(gpuToken);
      if (sample) {
        sample.ms = roundMetric(performance.now() - started);
        host.profileRuntime.frameProfile.passSamples.push(sample);
      }
    }
    return target;
  }

  setShadertoyUniforms(
    shader,
    uniformState,
    sourceDetail,
    shaderTime,
    now = new Date(),
  ) {
    const host = this.host;
    uniformState.iResolution[0] = Math.max(1, sourceDetail.width);
    uniformState.iResolution[1] = Math.max(1, sourceDetail.height);
    uniformState.iResolution[2] = 1;
    setShaderUniformIfPresent(
      shader,
      "iResolution",
      uniformState.iResolution,
    );
    setShaderUniformIfPresent(shader, "iTime", shaderTime);
    setShaderUniformIfPresent(
      shader,
      "iTimeDelta",
      host.frameRuntime.visualDeltaSeconds,
    );
    setShaderUniformIfPresent(shader, "iFrame", host.frameRuntime.frameIndex);
    setShaderUniformIfPresent(
      shader,
      "iFrameRate",
      globalThis.frameRate(),
    );
    setShaderUniformIfPresent(shader, "iMouse", uniformState.iMouse);
    uniformState.iDate[0] = now.getFullYear();
    uniformState.iDate[1] = now.getMonth() + 1;
    uniformState.iDate[2] = now.getDate();
    uniformState.iDate[3] =
      now.getHours() * 3600 +
      now.getMinutes() * 60 +
      now.getSeconds();
    setShaderUniformIfPresent(shader, "iDate", uniformState.iDate);
  }

  rateTime(key, baseTime, rate) {
    const next = advanceRateClock(this.rateClocks.get(key), baseTime, rate);
    this.rateClocks.set(key, next);
    return next.time;
  }

  prune(maxIdleFrames) {
    const frame = this.host.frameRuntime.frameIndex;
    for (const [key, lastUsed] of this.uniformStateUse) {
      if (frame - lastUsed <= maxIdleFrames) continue;
      this.uniformStateUse.delete(key);
      this.uniformStates.delete(key);
    }
  }

  dispose() {
    this.rateClocks.clear();
    this.uniformStates.clear();
    this.uniformStateUse.clear();
  }
}
