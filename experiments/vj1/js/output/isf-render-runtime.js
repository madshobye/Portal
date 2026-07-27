import { normalizeParamValue } from "../libraries/visual-nodes/shared/component-schema.js";
import { evaluateIsfDimension } from "../libraries/isf-engine/index.js";
import {
  createSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js";
import { renderTargetNeedsShaderSampleFlip } from "./render-target-contract.js";
import { IsfAudioTextureRuntime } from "./isf-audio-texture-runtime.js";
import { IsfImportedImageRuntime } from "./isf-imported-image-runtime.js";
import {
  applyShaderTarget,
  clearShaderTarget,
  disposeGraphics,
  drawShaderTarget,
  drawShaderTargetRect,
  enumUniform,
  resetShaderTarget,
  setShaderUniformIfPresent,
} from "./shader-target-runtime.js";

const FULL_RENDER_UV_RECT = Object.freeze([0, 0, 1, 1]);

// Retained backend for portable ISF nodes. The visual graph compiler decides
// topology and the Output renderer decides when an operation runs; this class
// owns only ISF resources and the already-compiled GPU execution contract.
export class IsfRenderRuntime {
  constructor(host, {
    setShaderParams = (...args) => host.shaderEffectRuntime.setParamUniforms(...args),
  } = {}) {
    this.host = host;
    this.setShaderParams = setShaderParams;
    this.passTargets = new Map();
    this.programStates = new Map();
    this.eventSignals = new Map();
    this.targetTextures = new Map();
    this.dateUniform = [0, 0, 0, 0];
    this.audioTextures = new IsfAudioTextureRuntime(host);
    this.importedImages = new IsfImportedImageRuntime(host);
  }

  needsPassRuntime(component) {
    const passes = component?.isf?.passes || [];
    return passes.length > 1 || passes.some((pass) =>
      pass.target || pass.persistent || pass.float ||
      pass.width !== "$WIDTH" || pass.height !== "$HEIGHT"
    );
  }

  dispose() {
    const seen = new Set();
    for (const entry of this.passTargets.values()) {
      for (const target of entry.targets || []) {
        if (!target || seen.has(target)) continue;
        seen.add(target);
        disposeGraphics(target);
      }
    }
    this.passTargets.clear();
    this.programStates.clear();
    this.eventSignals.clear();
    this.targetTextures.clear();
    this.audioTextures.dispose();
    this.importedImages.dispose();
  }

  prune(maxIdleFrames = 600) {
    const frameIndex = Math.max(0, Number(this.host.frameRuntime.frameIndex) || 0);
    for (const [key, entry] of this.passTargets) {
      if (frameIndex - entry.lastUsed <= maxIdleFrames) continue;
      for (const target of entry.targets) disposeGraphics(target);
      this.passTargets.delete(key);
    }
    for (const [key, entry] of this.programStates) {
      if (frameIndex - entry.lastUsed > maxIdleFrames) {
        this.programStates.delete(key);
      }
    }
    for (const [key, entry] of this.eventSignals) {
      if (frameIndex - entry.lastUsed > maxIdleFrames) {
        this.eventSignals.delete(key);
      }
    }
    this.importedImages.prune(maxIdleFrames);
  }

  getPassTarget(component, instanceId, pass, widthPx, heightPx) {
    const floatFormat = pass.float ? globalThis.FLOAT : null;
    if (pass.float && floatFormat == null) {
      console.error("[VJ1_ISF_FLOAT_TARGET_UNAVAILABLE]", {
        shader: component?.id || "",
        pass: pass.target || pass.index,
        message: "This ISF requires floating-point framebuffer support.",
      });
      return null;
    }
    const key = [
      component?.id || "isf",
      component?.isf?.sourceHash || "",
      instanceId || "shared",
      pass.target,
    ].join(":");
    let entry = this.passTargets.get(key);
    const targetCount = pass.persistent ? 2 : 1;
    if (entry && (
      entry.width !== widthPx ||
      entry.height !== heightPx ||
      entry.float !== !!pass.float ||
      entry.targets.length !== targetCount
    )) {
      for (const target of entry.targets) disposeGraphics(target);
      this.passTargets.delete(key);
      entry = null;
    }
    if (!entry) {
      const targets = [];
      for (let index = 0; index < targetCount; index++) {
        const target = createSharedFramebufferTarget(widthPx, heightPx, {
          format: floatFormat,
        });
        if (!target) {
          for (const created of targets) disposeGraphics(created);
          return null;
        }
        drawShaderTarget(target, () => clearShaderTarget(target));
        targets.push(target);
      }
      entry = {
        targets,
        width: widthPx,
        height: heightPx,
        float: !!pass.float,
        current: 0,
        lastUsed: Math.max(0, Number(this.host.frameRuntime.frameIndex) || 0),
      };
      this.passTargets.set(key, entry);
    }
    entry.lastUsed = Math.max(0, Number(this.host.frameRuntime.frameIndex) || 0);
    return entry;
  }

  renderProgram({
    component,
    shader,
    input = null,
    inputs = null,
    finalTarget,
    renderRequest,
    timeSeconds,
    params = {},
    instanceId = "",
    contentMatrix = null,
    useContentTransform = false,
    effectTransform = null,
    sourceDetail = null,
  }) {
    const passes = component?.isf?.passes || [];
    if (!passes.length || !shader || !finalTarget) return null;
    const baseWidth = Math.max(1, Number(renderRequest.width) || 1);
    const baseHeight = Math.max(1, Number(renderRequest.height) || 1);
    const dimensionValues = { WIDTH: baseWidth, HEIGHT: baseHeight };
    for (const param of component.params || []) {
      if (Number.isInteger(param.isfVectorIndex)) continue;
      const normalized = normalizeParamValue(param, params[param.id]);
      dimensionValues[param.id] = param.type === "enum" && Array.isArray(param.isfValues)
        ? Number(param.isfValues[enumUniform(param, normalized)]) || 0
        : Number(normalized) || 0;
    }
    const resolvedPasses = [];
    for (const pass of passes) {
      try {
        resolvedPasses.push({
          pass,
          widthPx: evaluateIsfDimension(pass.width, dimensionValues),
          heightPx: evaluateIsfDimension(pass.height, dimensionValues),
        });
      } catch (error) {
        console.error("[VJ1_ISF_PASS_SIZE_FAILED]", {
          shader: component.id,
          pass: pass.target || pass.index,
          message: error?.message || String(error),
        });
        return null;
      }
    }
    const programKey = [
      component?.id || "isf",
      component?.isf?.sourceHash || "",
      instanceId || "shared",
      resolvedPasses.map(({ pass, widthPx, heightPx }) =>
        `${pass.index}:${pass.target}:${widthPx}x${heightPx}`
      ).join(","),
    ].join(":");
    let programState = this.programStates.get(programKey);
    if (!programState) {
      programState = { frameIndex: 0, lastUsed: 0 };
      this.programStates.set(programKey, programState);
    }
    programState.lastUsed = Math.max(
      0,
      Number(this.host.frameRuntime.frameIndex) || 0,
    );
    const targetTextures = this.targetTextures;
    targetTextures.clear();
    // A p5 shader retains sampler bindings between draws. Without explicitly
    // replacing every named target here, the next render's producing pass can
    // begin while its destination texture is still bound to that same sampler
    // from the preceding final pass. WebGL framebuffer feedback is undefined
    // and commonly clears the result to black. Bind a safe texture until each
    // target has been produced for this invocation; persistent passes replace
    // this with their previous ping-pong target below.
    const unproducedTargetTexture = input || finalTarget;
    for (const pass of resolvedPasses) {
      if (pass.pass.target && unproducedTargetTexture) {
        targetTextures.set(pass.pass.target, unproducedTargetTexture);
      }
    }
    let result = finalTarget;
    for (let index = 0; index < resolvedPasses.length; index++) {
      const { pass, widthPx, heightPx } = resolvedPasses[index];
      const finalPass = index === resolvedPasses.length - 1;
      let destination = finalTarget;
      let passEntry = null;
      if (pass.target) {
        passEntry = this.getPassTarget(
          component, instanceId, pass, widthPx, heightPx,
        );
        if (!passEntry) return null;
        if (pass.persistent) {
          targetTextures.set(pass.target, passEntry.targets[passEntry.current]);
        }
        destination = pass.persistent
          ? passEntry.targets[passEntry.current === 0 ? 1 : 0]
          : passEntry.targets[0];
      } else if (
        widthPx !== finalTarget.width ||
        heightPx !== finalTarget.height
      ) {
        passEntry = this.getPassTarget(
          component,
          instanceId,
          { ...pass, target: "__vj1FinalPass", persistent: false },
          widthPx,
          heightPx,
        );
        if (!passEntry) return null;
        destination = passEntry.targets[0];
      }
      const passRequest = {
        ...renderRequest,
        width: widthPx,
        height: heightPx,
        logicalWidth: widthPx,
        logicalHeight: heightPx,
      };
      const drawPass = () => drawShaderTarget(destination, () => {
        clearShaderTarget(destination);
        applyShaderTarget(destination, shader);
        setShaderUniformIfPresent(
          shader,
          "renderUvRect",
          renderRequest.uvRect || FULL_RENDER_UV_RECT,
        );
        if (contentMatrix) {
          setShaderUniformIfPresent(shader, "contentUvMatrix", contentMatrix);
        }
        setShaderUniformIfPresent(
          shader,
          "useContentTransform",
          useContentTransform ? 1 : 0,
        );
        if (effectTransform) {
          this.host.shaderEffectRuntime.setInfrastructureUniforms(
            shader,
            effectTransform,
          );
        }
        this.setFrameUniforms(shader, component, {
          input,
          inputs,
          renderRequest: passRequest,
          timeSeconds,
          params,
          passIndex: index,
          frameIndex: programState.frameIndex,
          targetTextures,
          sourceDetail: finalPass ? sourceDetail : null,
        });
        setShaderUniformIfPresent(shader, "vj1IsfFinalPass", finalPass);
        this.setShaderParams(shader, component, params, {
          onlyPresent: true,
          instanceId,
        });
        drawShaderTargetRect(destination, widthPx, heightPx);
        resetShaderTarget(destination);
      });
      this.host.shaderEffectRuntime.measurePass(
        { id: component.id, instanceId },
        component,
        passRequest,
        {
          handoff: false,
          sourceIsShaderBuffer:
            this.host.renderTargetRuntime.isShaderBuffer(input),
          targetSlot: -1,
        },
        destination,
        drawPass,
      );
      if (passEntry && pass.target) {
        if (pass.persistent) {
          passEntry.current = passEntry.current === 0 ? 1 : 0;
        }
        targetTextures.set(pass.target, destination);
      }
      result = destination;
    }
    programState.frameIndex += 1;
    return result;
  }

  setFrameUniforms(shader, component, {
    input = null,
    inputs = null,
    renderRequest = {},
    timeSeconds,
    params = {},
    passIndex = 0,
    frameIndex = null,
    generatorUniformState = null,
    targetTextures = null,
    sourceDetail = null,
  } = {}) {
    // RENDERSIZE describes the complete shader boundary. Content placement
    // already changes the evaluated UV through contentUvMatrix; multiplying
    // RENDERSIZE by Content scale applies that scale a second time and can
    // cancel gl_FragCoord-based zoom. The physical boundary recovered from an
    // ROI is therefore the resolution authority for procedural ISF code.
    const logicalWidth = Math.max(
      1,
      Number(sourceDetail?.physicalWidth) ||
      Number(sourceDetail?.width) ||
      Number(renderRequest.logicalWidth) ||
      Number(renderRequest.width) ||
      1,
    );
    const logicalHeight = Math.max(
      1,
      Number(sourceDetail?.physicalHeight) ||
      Number(sourceDetail?.height) ||
      Number(renderRequest.logicalHeight) ||
      Number(renderRequest.height) ||
      1,
    );
    const now = new Date();
    const date = generatorUniformState?.iDate || this.dateUniform;
    date[0] = now.getFullYear();
    date[1] = now.getMonth() + 1;
    date[2] = now.getDate();
    date[3] = now.getHours() * 3600 + now.getMinutes() * 60 +
      now.getSeconds() + now.getMilliseconds() / 1000;
    setShaderUniformIfPresent(
      shader,
      "TIME",
      timeSeconds === undefined ? this.host.frameRuntime.visualTime : timeSeconds,
    );
    setShaderUniformIfPresent(
      shader,
      "TIMEDELTA",
      this.host.frameRuntime.visualDeltaSeconds,
    );
    setShaderUniformIfPresent(
      shader,
      "FRAMEINDEX",
      Number.isInteger(frameIndex)
        ? frameIndex
        : this.host.frameRuntime.frameIndex,
    );
    setShaderUniformIfPresent(shader, "PASSINDEX", passIndex);
    setShaderUniformIfPresent(shader, "DATE", date);
    setShaderUniformIfPresent(
      shader,
      "RENDERSIZE",
      [logicalWidth, logicalHeight],
    );
    setShaderUniformIfPresent(shader, "vj1IsfFinalPass", true);
    if (input) {
      setShaderUniformIfPresent(
        shader,
        "inputImage",
        unwrapRenderTarget(input),
      );
      setShaderUniformIfPresent(shader, "inputImage_imgSize", [
        Math.max(1, input.width || logicalWidth),
        Math.max(1, input.height || logicalHeight),
      ]);
      setShaderUniformIfPresent(shader, "_inputImage_imgRect", [
        0,
        0,
        Math.max(1, input.width || logicalWidth),
        Math.max(1, input.height || logicalHeight),
      ]);
      setShaderUniformIfPresent(
        shader,
        "inputImage_flipY",
        this.imageNeedsStorageFlip(input),
      );
    }
    for (const [name, state] of inputs || []) {
      const texture = state?.buffer || state;
      if (!texture) continue;
      setShaderUniformIfPresent(shader, name, unwrapRenderTarget(texture));
      setShaderUniformIfPresent(shader, `${name}_imgSize`, [
        Math.max(1, texture.width || logicalWidth),
        Math.max(1, texture.height || logicalHeight),
      ]);
      setShaderUniformIfPresent(shader, `_${name}_imgRect`, [
        0,
        0,
        Math.max(1, texture.width || logicalWidth),
        Math.max(1, texture.height || logicalHeight),
      ]);
      setShaderUniformIfPresent(
        shader,
        `${name}_flipY`,
        this.imageNeedsStorageFlip(texture),
      );
    }
    for (const inputDefinition of component?.isf?.inputs || []) {
      if (!["audio", "audioFFT"].includes(inputDefinition.type)) continue;
      const texture = this.audioTextures.texture(inputDefinition.type);
      if (!texture) continue;
      const name = inputDefinition.name;
      setShaderUniformIfPresent(shader, name, texture);
      setShaderUniformIfPresent(shader, `${name}_imgSize`, [
        Math.max(1, texture.width || 1),
        Math.max(1, texture.height || 2),
      ]);
      setShaderUniformIfPresent(shader, `_${name}_imgRect`, [
        0,
        0,
        Math.max(1, texture.width || 1),
        Math.max(1, texture.height || 2),
      ]);
      setShaderUniformIfPresent(
        shader,
        `${name}_flipY`,
        this.imageNeedsStorageFlip(texture),
      );
    }
    for (const importedDefinition of component?.isf?.imported || []) {
      const texture = this.importedImages.texture(
        component,
        importedDefinition,
      );
      if (!texture) continue;
      const name = importedDefinition.name;
      setShaderUniformIfPresent(shader, name, texture);
      setShaderUniformIfPresent(shader, `${name}_imgSize`, [
        Math.max(1, texture.width || 1),
        Math.max(1, texture.height || 1),
      ]);
      setShaderUniformIfPresent(shader, `_${name}_imgRect`, [
        0,
        0,
        Math.max(1, texture.width || 1),
        Math.max(1, texture.height || 1),
      ]);
      setShaderUniformIfPresent(
        shader,
        `${name}_flipY`,
        this.imageNeedsStorageFlip(texture),
      );
    }
    for (const [name, texture] of targetTextures || []) {
      if (!texture) continue;
      setShaderUniformIfPresent(shader, name, unwrapRenderTarget(texture));
      setShaderUniformIfPresent(shader, `${name}_imgSize`, [
        Math.max(1, texture.width || 1),
        Math.max(1, texture.height || 1),
      ]);
      setShaderUniformIfPresent(shader, `_${name}_imgRect`, [
        0,
        0,
        Math.max(1, texture.width || 1),
        Math.max(1, texture.height || 1),
      ]);
      setShaderUniformIfPresent(
        shader,
        `${name}_flipY`,
        this.imageNeedsStorageFlip(texture),
      );
    }
    void component;
    void params;
  }

  imageNeedsStorageFlip(texture) {
    return renderTargetNeedsShaderSampleFlip(
      texture,
      this.host.renderTargetRuntime?.isShaderBuffer?.(texture) === true,
    );
  }

  importedResourceRevision(component) {
    return this.importedImages.externalKey(component);
  }

  eventPulse(instanceId, parameterId, signal = null) {
    const target = String(instanceId || "");
    const parameter = String(parameterId || "");
    if (!target || !parameter) return false;
    const scheduled = (this.host.frameRuntime?.scheduledEvents || []).some((event) =>
      event?.type === "isf-event" &&
      String(event.target || "") === target &&
      String(event.payload?.parameterId || "") === parameter
    );
    const frameIndex = Math.max(
      0,
      Number(this.host.frameRuntime?.frameIndex) || 0,
    );
    const key = `${target}:${parameter}`;
    let automated = false;
    let entry = this.eventSignals.get(key);
    if (!entry) {
      // The first value observed by a newly-created Preview or Output renderer
      // is a baseline, not a new event. This prevents periodic tracks from
      // firing once merely because a view/window was opened. A null baseline
      // still lets the first later manual token produce a real pulse.
      entry = { token: signal, pulseFrame: -1, lastUsed: frameIndex };
      this.eventSignals.set(key, entry);
    } else if (
      signal !== null &&
      signal !== undefined &&
      signal !== false
    ) {
      if (!Object.is(entry.token, signal)) {
        entry.token = signal;
        entry.pulseFrame = frameIndex;
      }
      automated = entry.pulseFrame === frameIndex;
    }
    entry.lastUsed = frameIndex;
    return scheduled || automated;
  }
}
