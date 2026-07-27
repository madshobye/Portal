import {
  normalizeParamValue,
  normalizeParamValues,
} from "../libraries/visual-nodes/shared/component-schema.js";
import { textureStateKey } from "../libraries/render-engine/render-node-contract.js";
import {
  compileShaderSchedule,
  fuseLocalShaderSchedule,
} from "../graph/shader-scheduler.js";
import {
  createShaderBuilder,
  fusedUniformName,
} from "../shaders/shader-builder.js";
import { disposeP5Shader } from "../libraries/mapping-engine/mapping-engine/index.js";
import {
  createSharedFramebufferTarget,
  isSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js";
import {
  applyShaderTarget,
  chainItemToShaderPass,
  clearShaderTarget,
  disposeGraphics,
  drawShaderTarget,
  drawShaderTargetRect,
  enumUniform,
  effectNeedsComposite,
  effectParamNumber,
  nextFxTargetSlot,
  resetShaderTarget,
  setShaderUniformIfPresent,
} from "./shader-target-runtime.js";
import {
  effectTransformUniforms,
  instanceTime,
  qualityScaledRenderRequest,
} from "./render-runtime-math.js";
import { colorUniform } from "./specialized/model-color.js";
import {
  instanceInvariantRenderRequest,
  renderRequestKey,
  renderRequestStateKey,
} from "./render-geometry.js";
import {
  componentRuntimeTimeKey,
  effectParamState,
  renderBufferKey,
} from "./component-render-state.js";
import { drawBuffer } from "./render-draw-utils.js";
import {
  renderTargetNeedsShaderSampleFlip,
} from "./render-target-contract.js";

const FULL_RENDER_UV_RECT = Object.freeze([0, 0, 1, 1]);

// Direct capability for ordinary compiled shader effects. The compiler owns
// topology and ROI propagation; this runtime owns effect normalization,
// dynamics/signatures, retained evaluation, quality demand, fusion, programs,
// scratch targets, uniforms, and the existing draw calls.
export class ShaderEffectRuntime {
  constructor(host, {
    getCustomCode,
    getComponent,
    onStatus,
    createTarget = createSharedFramebufferTarget,
    disposeTarget = disposeGraphics,
    getIsfRuntime = () => host.isfRuntime,
  } = {}) {
    this.host = host;
    this.createTarget = createTarget;
    this.disposeTarget = disposeTarget;
    this.getIsfRuntime = getIsfRuntime;
    this.getComponent =
      getComponent ||
      ((id) => host.visualNodeRuntime.effect(id));
    this.builder = createShaderBuilder({
      getCustomCode,
      getComponent,
      onStatus,
      disposeShader: disposeP5Shader,
    });
    this.targetGroups = new Map();
    this.targets = [null, null];
    this.targetKey = "";
    this.cachedNoiseTexture = null;
  }

  clear() {
    this.builder.clear();
  }

  getTarget(request, slot = 0) {
    const renderRequest = this.host.renderRequestRuntime.normalize(request, "effect");
    const widthPx = renderRequest.width;
    const heightPx = renderRequest.height;
    const key = `${widthPx}:${heightPx}`;
    const targetSlot = slot === 1 ? 1 : 0;
    let group = this.targetGroups.get(key);
    if (!group) {
      this.pruneTargetGroups(3);
      group = { targets: [null, null], lastUsed: this.host.frameRuntime.frameIndex };
      this.targetGroups.set(key, group);
    }
    group.lastUsed = this.host.frameRuntime.frameIndex;
    this.targets = group.targets;
    this.targetKey = key;
    let target = group.targets[targetSlot];
    if (!target) {
      target = this.createTarget(widthPx, heightPx);
      group.targets[targetSlot] = target;
      return target;
    }
    if (target.width !== widthPx || target.height !== heightPx) {
      try {
        target.resizeCanvas(widthPx, heightPx);
      } catch {
        this.disposeTarget(target);
        target = this.createTarget(widthPx, heightPx);
        group.targets[targetSlot] = target;
      }
    }
    return target;
  }

  pruneTargetGroups(maxGroups = 3) {
    if (this.targetGroups.size < maxGroups) return;
    const stale = Array.from(this.targetGroups.entries())
      .sort((a, b) => (a[1].lastUsed || 0) - (b[1].lastUsed || 0));
    const removeCount = Math.max(1, this.targetGroups.size - maxGroups + 1);
    // Scratch framebuffers are size-keyed allocations within one shared
    // WebGL context. Their lifetime is independent from shader programs:
    // pruning a target must not evict and recompile every shader used by the
    // renderer. Program invalidation remains owned by explicit shader-source
    // changes and runtime disposal.
    for (const [key, group] of stale.slice(0, removeCount)) {
      for (const target of group.targets || []) this.disposeTarget(target);
      this.targetGroups.delete(key);
    }
  }

  applyToTargets(callback) {
    if (typeof callback !== "function") return;
    for (const group of this.targetGroups.values()) {
      for (const target of group.targets || []) {
        if (target) callback(target);
      }
    }
  }

  ownsTarget(target) {
    if (!target) return false;
    for (const group of this.targetGroups.values()) {
      if ((group.targets || []).includes(target)) return true;
    }
    return false;
  }

  disposeTargets() {
    const seen = new Set();
    for (const group of this.targetGroups.values()) {
      for (const target of group.targets || []) {
        if (!target || seen.has(target)) continue;
        seen.add(target);
        this.disposeTarget(target);
      }
    }
    this.targetGroups.clear();
    this.targets = [null, null];
    this.targetKey = "";
  }

  dispose() {
    this.clear();
    this.disposeTargets();
    this.cachedNoiseTexture = null;
  }

  getShader(pass, target = null) {
    return this.builder.getShader(pass, target);
  }

  renderNodeState(
    nodeId,
    inputState,
    item,
    componentTime,
    renderRequest,
    inputStates = null,
  ) {
    const host = this.host;
    const component = this.getComponent(item.componentId);
    if (!component) return inputState;
    const params = normalizeParamValues(component, effectParamState(item));
    const amount = effectParamNumber(component, params, "amount", 0.35);
    if (
      (item.opacity ?? 1) <= 0.0001 ||
      amount <= 0.0001 ||
      component.runtime?.isNeutral?.(params) === true
    ) {
      return inputState;
    }
    const runtimeContext = this.runtimeContext(componentTime);
    const external =
      component.runtime?.externalKey?.(params, runtimeContext) ?? null;
    const namedStatesInvariant =
      !inputStates?.size ||
      [...inputStates.values()].every(
        (state) => state?.instanceInvariant === true,
      );
    const instanceInvariant =
      inputState.instanceInvariant === true &&
      namedStatesInvariant &&
      !this.passIsFrameDynamic({ id: item.componentId, params }) &&
      external === null;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const qualityRequest = qualityScaledRenderRequest(
      evaluationRequest,
      params,
    );
    host.componentRenderRuntime.recordResolution(
      null,
      item,
      "effect",
      qualityRequest,
    );
    const signature = stableStringify({
      input: textureStateKey(inputState),
      inputs: namedTextureStateKey(inputStates),
      params,
      transform: item.transform || {},
      time: componentRuntimeTimeKey(
        component,
        params,
        runtimeContext,
      ),
      external,
      customShader:
        item.componentId === "custom"
          ? host.state?.shaders?.customCode || ""
          : "",
      request: renderRequestStateKey(evaluationRequest),
    });
    const needsComposite = effectNeedsComposite(item);
    const effectState = host.renderEvaluationRuntime.evaluate(
      needsComposite ? renderBufferKey(nodeId, "effect") : nodeId,
      signature,
      renderRequest,
      (output) => {
        const pass = chainItemToShaderPass({ ...item, params, amount });
        if (
          isSharedFramebufferTarget(output) &&
          output.width === qualityRequest.width &&
          output.height === qualityRequest.height
        ) {
          const effected = this.renderPass(
            inputState.buffer,
            pass,
            output,
            qualityRequest,
            componentTime,
            inputStates,
          );
          // A final ISF pass with TARGET writes to its retained texture so it
          // can become the next frame's input. The evaluation cache still owns
          // `output`, therefore commit that retained result into the cache
          // target instead of leaving its freshly-cleared buffer black.
          if (effected && effected !== output) {
            output.push();
            output.clear();
            drawBuffer(
              output,
              effected,
              0,
              0,
              output.width,
              output.height,
              host.renderTargetRuntime.isShaderBuffer(effected),
            );
            output.pop();
          }
          return;
        }
        const effected = this.renderChain(
          inputState.buffer,
          [pass],
          qualityRequest,
          componentTime,
          inputStates,
        );
        output.push();
        output.clear();
        drawBuffer(
          output,
          effected,
          0,
          0,
          output.width,
          output.height,
          host.renderTargetRuntime.isShaderBuffer(effected),
        );
        output.pop();
      },
      "effect",
      { instanceInvariant },
    );
    if (!needsComposite) return effectState;
    return host.compositeRuntime.renderLayerNodeState(
      renderBufferKey(nodeId, "composite"),
      inputState,
      effectState,
      {
        opacity: item.opacity ?? 1,
        blend: item.blend || "normal",
        transform: {},
      },
      renderRequest,
    );
  }

  renderRunNodeState(
    nodeId,
    inputState,
    items,
    componentTime,
    renderRequest,
  ) {
    const host = this.host;
    const passes = items.map((item) => chainItemToShaderPass(item));
    for (const item of items) {
      host.componentRenderRuntime.recordResolution(
        null,
        item,
        "effect",
        renderRequest,
      );
    }
    const instanceInvariant =
      inputState.instanceInvariant === true &&
      passes.every((pass) => !this.passIsFrameDynamic(pass));
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const runtimeContext = this.runtimeContext(componentTime);
    const signature = stableStringify({
      input: textureStateKey(inputState),
      passes,
      time: passes.map((pass) => {
        const component = this.getComponent(pass.id);
        return componentRuntimeTimeKey(
          component,
          pass.params,
          runtimeContext,
        );
      }),
      request: renderRequestStateKey(evaluationRequest),
    });
    return host.renderEvaluationRuntime.evaluate(
      nodeId,
      signature,
      renderRequest,
      (output) => {
        const effected = this.renderChain(
          inputState.buffer,
          passes,
          evaluationRequest,
          componentTime,
        );
        output.push();
        output.clear();
        drawBuffer(
          output,
          effected,
          0,
          0,
          output.width,
          output.height,
          host.renderTargetRuntime.isShaderBuffer(effected),
        );
        output.pop();
      },
      "fused-effect-run",
      { instanceInvariant },
    );
  }

  passIsFrameDynamic(pass = {}) {
    const component = this.getComponent(
      pass.id || pass.componentId || "",
    );
    // Pending file-backed effects stay dynamic so a temporary pass-through
    // result cannot become the retained final output.
    if (!component) return true;
    const params = normalizeParamValues(
      component,
      pass.params && typeof pass.params === "object" ? pass.params : {},
    );
    const amount = effectParamNumber(component, params, "amount", 0.35);
    if (
      amount <= 0.0001 ||
      component.runtime?.isNeutral?.(params) === true
    ) return false;
    return (
      component.runtime?.cacheable === false ||
      component.runtime?.timeDependent?.(params) === true
    );
  }

  runtimeContext(time) {
    return {
      time: Number(time) || 0,
      frame: this.host.frameRuntime.frameIndex,
      playing: this.host.frameRuntime.isPlaybackActive(),
    };
  }

  renderChain(input, chain, request, timeSeconds, inputStates = null) {
    const host = this.host;
    const renderRequest = host.renderRequestRuntime.normalize(request, "effect");
    const rw = renderRequest.width;
    const rh = renderRequest.height;
    const logicalWidth = Math.max(1, Number(renderRequest.logicalWidth) || rw);
    const logicalHeight = Math.max(1, Number(renderRequest.logicalHeight) || rh);
    let current = input;
    let passCount = 0;
    const logicalSchedule = compileShaderSchedule(
      chain,
      host.visualNodeRuntime.resolverOptions,
    );
    const schedule = fuseLocalShaderSchedule(logicalSchedule);
    if (schedule.length) {
      host.profileRuntime.frameProfile.shaderChains++;
      host.profileRuntime.frameProfile.maxShaderChainLength = Math.max(
        host.profileRuntime.frameProfile.maxShaderChainLength,
        logicalSchedule.length,
      );
    }
    for (const job of schedule) {
      const pass = job.pass;
      if (pass.amount <= 0.0001) continue;
      if (job.component?.runtime?.isNeutral?.(pass.params || {}) === true) {
        continue;
      }
      let handoff = false;
      if (host.renderTargetRuntime.isShaderBuffer(current) &&
          !isSharedFramebufferTarget(current) &&
          schedule.length <= 1) {
        handoff = true;
        current = host.renderTargetRuntime.materialize(
          current,
          `fx-handoff:${renderRequestKey(renderRequest)}:${passCount}`,
          renderRequest,
        );
      }
      const target = this.getTarget(
        renderRequest,
        host.renderTargetRuntime.isShaderBuffer(current)
          ? nextFxTargetSlot(this.targets, current)
          : passCount % 2,
      );
      const shader = job.fused
        ? this.builder.getFusedShader(job.jobs, target)
        : this.builder.getShader(pass, target);
      if (!shader) continue;
      const sourceIsShaderBuffer =
        host.renderTargetRuntime.isShaderBuffer(current);
      const isfRuntime = this.getIsfRuntime();
      if (!job.fused && isfRuntime.needsPassRuntime(job.component)) {
        const rendered = isfRuntime.renderProgram({
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
      this.measurePass(pass, job.component, renderRequest, {
        handoff,
        sourceIsShaderBuffer,
        targetSlot: this.targets[1] === target ? 1 : 0,
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
            shader.setUniform(
              "sourceFlipY",
              renderTargetNeedsShaderSampleFlip(
                current,
                sourceIsShaderBuffer,
              ),
            );
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
            this.setInfrastructureUniforms(shader, pass.transform);
            if (job.component?.type === "isf") {
              isfRuntime.setFrameUniforms(shader, job.component, {
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
    const renderRequest = host.renderRequestRuntime.normalize(request, "effect");
    const job = compileShaderSchedule(
      [pass],
      host.visualNodeRuntime.resolverOptions,
    )[0];
    if (
      !job ||
      job.pass.amount <= 0.0001 ||
      job.component?.runtime?.isNeutral?.(job.pass.params || {}) === true
    ) return input;
    const shaderProgram = this.builder.getShader(job.pass, target);
    if (!shaderProgram) return input;
    const isfRuntime = this.getIsfRuntime();
    if (isfRuntime.needsPassRuntime(job.component)) {
      return isfRuntime.renderProgram({
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
    const sourceIsShaderBuffer =
      host.renderTargetRuntime.isShaderBuffer(input);
    host.profileRuntime.frameProfile.shaderChains++;
    host.profileRuntime.frameProfile.maxShaderChainLength = Math.max(
      host.profileRuntime.frameProfile.maxShaderChainLength,
      1,
    );
    this.measurePass(job.pass, job.component, renderRequest, {
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
          shaderProgram.setUniform(
            "sourceFlipY",
            renderTargetNeedsShaderSampleFlip(
              input,
              sourceIsShaderBuffer,
            ),
          );
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
        this.setInfrastructureUniforms(
          shaderProgram,
          job.pass.transform,
        );
        if (job.component?.type === "isf") {
          isfRuntime.setFrameUniforms(shaderProgram, job.component, {
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
    const noiseTexture = this.getCachedNoiseTexture();
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

  getCachedNoiseTexture() {
    if (this.cachedNoiseTexture) return this.cachedNoiseTexture;
    if (typeof createImage !== "function") return null;
    const size = 256;
    const noiseImage = createImage(size, size);
    noiseImage.loadPixels();
    let state = 0x9e3779b9;
    for (let index = 0; index < size * size; index++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const value = state >>> 24;
      const offset = index * 4;
      noiseImage.pixels[offset] = value;
      noiseImage.pixels[offset + 1] = value;
      noiseImage.pixels[offset + 2] = value;
      noiseImage.pixels[offset + 3] = 255;
    }
    noiseImage.updatePixels();
    this.cachedNoiseTexture = noiseImage;
    return noiseImage;
  }

  setInfrastructureUniforms(shaderProgram, transform = {}) {
    const uniforms = effectTransformUniforms(transform);
    shaderProgram.setUniform("effectTransform", uniforms.transform);
    shaderProgram.setUniform("effectUvMatrix", uniforms.forward);
    shaderProgram.setUniform("inverseEffectUvMatrix", uniforms.inverse);
    const noiseTexture = this.getCachedNoiseTexture();
    if (!noiseTexture) return;
    setShaderUniformIfPresent(shaderProgram, "noiseTex", noiseTexture);
    setShaderUniformIfPresent(
      shaderProgram,
      "noiseTextureSize",
      [noiseTexture.width, noiseTexture.height],
    );
  }

  measurePass(pass, component, renderRequest, meta, target, drawPass) {
    const profile = this.host.profileRuntime;
    profile.frameProfile.shaderPasses++;
    if (meta.handoff) profile.frameProfile.shaderHandoffs++;
    if (!profile.collectDetailed) return this.host.presentationRuntime.measureGpu(target, drawPass);
    const item = {
      type: "shader-pass",
      passId: pass.id || "",
      chainItemId: pass.instanceId || "",
      implementationId: pass.id || "",
      passName: component?.name || pass.id || "Shader",
      ...profile.activeComponentIdentity(),
      width: renderRequest.width,
      height: renderRequest.height,
      pixels: renderRequest.width * renderRequest.height,
      source: meta.sourceIsShaderBuffer ? "webgl" : "drawable",
      targetSlot: meta.targetSlot,
      handoff: !!meta.handoff,
      ms: 0,
    };
    const started = performance.now();
    const result = this.host.presentationRuntime.measureGpu(target, drawPass);
    item.ms = performance.now() - started;
    profile.frameProfile.shaderMs += item.ms;
    profile.frameProfile.passSamples.push(item);
    return result;
  }
}

function namedTextureStateKey(states = null) {
  if (!states?.size) return [];
  return [...states.entries()]
    .sort(([left], [right]) =>
      String(left).localeCompare(String(right)),
    )
    .map(([name, state]) => [String(name), textureStateKey(state)]);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
