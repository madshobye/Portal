import { normalizeParamValue } from "../libraries/visual-nodes/shared/component-schema.js";
import {
  compileShaderSchedule,
  fuseLocalShaderSchedule,
} from "../graph/render-scheduler.js?v=canonical-effect-params-1";
import {
  createShaderBuilder,
  fusedUniformName,
} from "../shaders/shader-builder.js?v=shader-effect-backend-1";
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
  enumUniform,
  nextFxTargetSlot,
  resetShaderTarget,
  setShaderUniformIfPresent,
} from "./shader-target-runtime.js?v=canonical-effect-params-1";
import { instanceTime } from "./render-runtime-math.js?v=volumetric-clouds-1";
import { colorUniform } from "./specialized/model-color.js?v=adaptive-component-demand-29";
import { renderRequestKey } from "./render-geometry.js?v=output-one-1";

const FULL_RENDER_UV_RECT = Object.freeze([0, 0, 1, 1]);

// Direct backend for ordinary compiled shader effects. The host still owns
// graph compilation, dirty evaluation, ROI requests, and scratch-target
// allocation. This backend owns program compilation/caching, schedule fusion,
// uniform binding, and issuing the existing draw calls.
export class ShaderEffectRuntime {
  constructor(host, {
    getCustomCode,
    getComponent,
    onStatus,
  } = {}) {
    this.host = host;
    this.builder = createShaderBuilder({
      getCustomCode,
      getComponent,
      onStatus,
      disposeShader: disposeP5Shader,
    });
  }

  clear() {
    this.builder.clear();
  }

  getShader(pass, target = null) {
    return this.builder.getShader(pass, target);
  }

  renderChain(input, chain, request, timeSeconds, inputStates = null) {
    const host = this.host;
    const renderRequest = host.normalizeRenderRequest(request, "effect");
    const rw = renderRequest.width;
    const rh = renderRequest.height;
    const logicalWidth = Math.max(1, Number(renderRequest.logicalWidth) || rw);
    const logicalHeight = Math.max(1, Number(renderRequest.logicalHeight) || rh);
    let current = input;
    let passCount = 0;
    const logicalSchedule = compileShaderSchedule(chain, host.visualResolverOptions);
    const schedule = fuseLocalShaderSchedule(logicalSchedule);
    if (schedule.length) {
      host.frameProfile.shaderChains++;
      host.frameProfile.maxShaderChainLength = Math.max(
        host.frameProfile.maxShaderChainLength,
        logicalSchedule.length,
      );
    }
    for (const job of schedule) {
      const pass = job.pass;
      if (pass.amount <= 0.0001) continue;
      let handoff = false;
      if (host.isShaderBuffer(current) &&
          !isSharedFramebufferTarget(current) &&
          schedule.length <= 1) {
        handoff = true;
        current = host.materializeDrawableBuffer(
          current,
          `fx-handoff:${renderRequestKey(renderRequest)}:${passCount}`,
          renderRequest,
        );
      }
      const target = host.getFxPingPongTarget(
        renderRequest,
        host.isShaderBuffer(current)
          ? nextFxTargetSlot(host.fxTargets, current)
          : passCount % 2,
      );
      const shader = job.fused
        ? this.builder.getFusedShader(job.jobs, target)
        : this.builder.getShader(pass, target);
      if (!shader) continue;
      const sourceIsShaderBuffer = host.isShaderBuffer(current);
      if (!job.fused && host.isfNeedsPassRuntime(job.component)) {
        const rendered = host.renderIsfProgram({
          component: job.component,
          shader,
          input: current,
          inputs: inputStates,
          finalTarget: target,
          renderRequest,
          timeSeconds: instanceTime(pass.instanceId || pass.id, timeSeconds),
          params: pass.params,
          instanceId: pass.instanceId || pass.id,
          effectTransform: pass.transform,
        });
        if (rendered) {
          current = rendered;
          passCount++;
        }
        continue;
      }
      host.measureShaderPass(pass, job.component, renderRequest, {
        handoff,
        sourceIsShaderBuffer,
        targetSlot: host.fxTargets?.[1] === target ? 1 : 0,
      }, target, () => {
        drawShaderTarget(target, () => {
          clearShaderTarget(target);
          applyShaderTarget(target, shader);
          const isfInterface = job.component?.type === "isf";
          if (isfInterface) {
            setShaderUniformIfPresent(
              shader,
              "renderUvRect",
              renderRequest.uvRect || FULL_RENDER_UV_RECT,
            );
          } else {
            shader.setUniform("tex0", unwrapRenderTarget(current));
            shader.setUniform("resolution", [logicalWidth, logicalHeight]);
            shader.setUniform(
              "renderUvRect",
              renderRequest.uvRect || FULL_RENDER_UV_RECT,
            );
            shader.setUniform("canvasSize", [logicalWidth, logicalHeight]);
            shader.setUniform("texelSize", [1 / logicalWidth, 1 / logicalHeight]);
            shader.setUniform("sourceFlipY", !sourceIsShaderBuffer);
            shader.setUniform("sourceForceOpaque", false);
          }
          if (job.fused) {
            this.setFusedUniforms(shader, job.jobs, timeSeconds);
          } else {
            const passTime = instanceTime(
              pass.instanceId || pass.id,
              timeSeconds,
            );
            if (isfInterface) {
              setShaderUniformIfPresent(shader, "time", passTime);
            } else {
              shader.setUniform("time", passTime);
            }
            host.setEffectInfrastructureUniforms(shader, pass.transform);
            if (job.component?.type === "isf") {
              host.setIsfFrameUniforms(shader, job.component, {
                input: current,
                inputs: inputStates,
                renderRequest,
                timeSeconds: passTime,
                params: pass.params,
              });
            }
            setShaderUniformIfPresent(shader, "vj1IsfFinalPass", true);
            this.setParamUniforms(shader, job.component, pass.params);
          }
          drawShaderTargetRect(target, rw, rh);
          resetShaderTarget(target);
        });
      });
      current = target;
      passCount++;
    }
    return current;
  }

  renderPass(input, pass, target, request, timeSeconds, inputStates = null) {
    const host = this.host;
    const renderRequest = host.normalizeRenderRequest(request, "effect");
    const job = compileShaderSchedule([pass], host.visualResolverOptions)[0];
    if (!job || job.pass.amount <= 0.0001) return input;
    const shaderProgram = this.builder.getShader(job.pass, target);
    if (!shaderProgram) return input;
    if (host.isfNeedsPassRuntime(job.component)) {
      return host.renderIsfProgram({
        component: job.component,
        shader: shaderProgram,
        input,
        inputs: inputStates,
        finalTarget: target,
        renderRequest,
        timeSeconds: instanceTime(job.pass.instanceId || job.pass.id, timeSeconds),
        params: job.pass.params,
        instanceId: job.pass.instanceId || job.pass.id,
        effectTransform: job.pass.transform,
      }) || input;
    }
    const logicalWidth = Math.max(
      1,
      Number(renderRequest.logicalWidth) || renderRequest.width,
    );
    const logicalHeight = Math.max(
      1,
      Number(renderRequest.logicalHeight) || renderRequest.height,
    );
    const sourceIsShaderBuffer = host.isShaderBuffer(input);
    host.frameProfile.shaderChains++;
    host.frameProfile.maxShaderChainLength = Math.max(
      host.frameProfile.maxShaderChainLength,
      1,
    );
    host.measureShaderPass(job.pass, job.component, renderRequest, {
      handoff: false,
      sourceIsShaderBuffer,
      targetSlot: -1,
    }, target, () => {
      drawShaderTarget(target, () => {
        clearShaderTarget(target);
        applyShaderTarget(target, shaderProgram);
        const isfInterface = job.component?.type === "isf";
        if (isfInterface) {
          setShaderUniformIfPresent(
            shaderProgram,
            "renderUvRect",
            renderRequest.uvRect || FULL_RENDER_UV_RECT,
          );
        } else {
          shaderProgram.setUniform("tex0", unwrapRenderTarget(input));
          shaderProgram.setUniform("resolution", [logicalWidth, logicalHeight]);
          shaderProgram.setUniform(
            "renderUvRect",
            renderRequest.uvRect || FULL_RENDER_UV_RECT,
          );
          shaderProgram.setUniform("canvasSize", [logicalWidth, logicalHeight]);
          shaderProgram.setUniform(
            "texelSize",
            [1 / logicalWidth, 1 / logicalHeight],
          );
          shaderProgram.setUniform("sourceFlipY", !sourceIsShaderBuffer);
          shaderProgram.setUniform("sourceForceOpaque", false);
        }
        const passTime = instanceTime(
          job.pass.instanceId || job.pass.id,
          timeSeconds,
        );
        if (isfInterface) {
          setShaderUniformIfPresent(shaderProgram, "time", passTime);
        } else {
          shaderProgram.setUniform("time", passTime);
        }
        host.setEffectInfrastructureUniforms(
          shaderProgram,
          job.pass.transform,
        );
        if (job.component?.type === "isf") {
          host.setIsfFrameUniforms(shaderProgram, job.component, {
            input,
            inputs: inputStates,
            renderRequest,
            timeSeconds: passTime,
            params: job.pass.params,
          });
        }
        setShaderUniformIfPresent(shaderProgram, "vj1IsfFinalPass", true);
        this.setParamUniforms(
          shaderProgram,
          job.component,
          job.pass.params,
        );
        drawShaderTargetRect(
          target,
          renderRequest.width,
          renderRequest.height,
        );
        resetShaderTarget(target);
      });
    });
    return target;
  }

  setFusedUniforms(shaderProgram, jobs, timeSeconds) {
    jobs.forEach((part, index) => {
      shaderProgram.setUniform(
        fusedUniformName(index, "time"),
        instanceTime(part.pass.instanceId || part.pass.id, timeSeconds),
      );
      this.setParamUniforms(
        shaderProgram,
        part.component,
        part.pass.params,
        { uniformPrefix: `f${index}_` },
      );
    });
    const noiseTexture = this.host.getCachedNoiseTexture();
    if (noiseTexture) {
      setShaderUniformIfPresent(shaderProgram, "noiseTex", noiseTexture);
      setShaderUniformIfPresent(
        shaderProgram,
        "noiseTextureSize",
        [noiseTexture.width, noiseTexture.height],
      );
    }
  }

  setParamUniforms(shader, component, params = {}, options = {}) {
    const vectors = new Map();
    for (const param of component?.params || []) {
      const value = normalizeParamValue(param, params[param.id]);
      const uniformId = `${options.uniformPrefix || ""}${param.id}`;
      if (Number.isInteger(param.isfVectorIndex) && param.isfUniform) {
        const vectorUniform = `${options.uniformPrefix || ""}${param.isfUniform}`;
        const vector = vectors.get(vectorUniform) || [0, 0];
        vector[param.isfVectorIndex] = Number(value) || 0;
        vectors.set(vectorUniform, vector);
        continue;
      }
      if (options.onlyPresent && !shader?.uniforms?.[uniformId]) continue;
      if (param.type === "boolean") {
        shader.setUniform(uniformId, value !== false);
      } else if (param.type === "color") {
        shader.setUniform(uniformId, colorUniform(value));
      } else if (param.type === "enum") {
        const enumIndex = enumUniform(param, value);
        shader.setUniform(
          uniformId,
          Array.isArray(param.isfValues)
            ? Number(param.isfValues[enumIndex]) || 0
            : enumIndex,
        );
      } else {
        shader.setUniform(uniformId, Number(value) || 0);
      }
    }
    for (const [uniformId, vector] of vectors) {
      if (!options.onlyPresent || shader?.uniforms?.[uniformId]) {
        shader.setUniform(uniformId, vector);
      }
    }
    if (options.setDefaultAmount !== false &&
        !component?.params?.some((param) => param.id === "amount")) {
      shader.setUniform(`${options.uniformPrefix || ""}amount`, 0);
    }
  }
}
