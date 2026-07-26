import { renderBufferKey } from "./component-render-state.js";
import { renderRequestKey } from "./render-geometry.js";
import { drawBuffer } from "./render-draw-utils.js";
import {
  createSharedFramebufferTarget,
  isSharedFramebufferTarget,
} from "./shared-framebuffer-target.js";
import { disposeGraphics } from "./shader-target-runtime.js";

export class RenderTargetRuntime {
  constructor(host) {
    this.host = host;
    this.cpuTargets = host.resourceRuntime.renderCache.buffers;
    this.gpuTargets = host.resourceRuntime.renderCache.gpuBuffers;
  }

  cpu(id, request, { role = "buffer" } = {}) {
    const host = this.host;
    const renderRequest = host.renderRequestRuntime.normalize(request, role);
    const key = renderBufferKey(id, renderRequestKey(renderRequest));
    let target = this.cpuTargets.get(key);
    if (
      !target ||
      target.width !== renderRequest.width ||
      target.height !== renderRequest.height
    ) {
      disposeGraphics(target);
      target = globalThis.createGraphics(
        renderRequest.width,
        renderRequest.height,
      );
      host.resourceRuntime.applyGraphicsPixelDensity(
        target,
        host.renderRequestRuntime.pixelDensity(renderRequest),
      );
      host.resourceRuntime.applyGraphicsFont(target);
      this.cpuTargets.set(key, target);
    }
    host.resourceRuntime.renderCache.touch("buffer", key, host.frameRuntime.frameIndex);
    return target;
  }

  gpu(id, request, {
    role = "gpu-buffer",
    createTarget = createSharedFramebufferTarget,
    disposeTarget = disposeGraphics,
    beforeDispose = null,
  } = {}) {
    const host = this.host;
    const renderRequest = host.renderRequestRuntime.normalize(request, role);
    const key = renderBufferKey(id, renderRequestKey(renderRequest));
    let target = this.gpuTargets.get(key);
    if (
      !target ||
      target.width !== renderRequest.width ||
      target.height !== renderRequest.height
    ) {
      if (target) beforeDispose?.(target);
      disposeTarget(target);
      target = createTarget(renderRequest.width, renderRequest.height);
      this.gpuTargets.set(key, target);
    }
    host.resourceRuntime.renderCache.touch("gpu-buffer", key, host.frameRuntime.frameIndex);
    return target;
  }

  materialize(source, id, request) {
    if (!this.isShaderBuffer(source)) return source;
    const target = this.cpu(id, request);
    target.push();
    target.clear();
    drawBuffer(
      target,
      source,
      0,
      0,
      target.width,
      target.height,
      true,
    );
    target.pop();
    return target;
  }

  isShaderBuffer(buffer) {
    if (!buffer) return false;
    if (isSharedFramebufferTarget(buffer)) return true;
    if (buffer.__vj1ShaderBuffer) return true;
    return this.host.shaderEffectRuntime?.ownsTarget(buffer) === true;
  }

  cpuTarget(key) {
    return this.cpuTargets.get(key) || null;
  }

  gpuTarget(key) {
    return this.gpuTargets.get(key) || null;
  }

  touchCpu(key) {
    this.host.resourceRuntime.renderCache.touch("buffer", key, this.host.frameRuntime.frameIndex);
  }

  touchGpu(key) {
    this.host.resourceRuntime.renderCache.touch("gpu-buffer", key, this.host.frameRuntime.frameIndex);
  }

  hasCpu(key) {
    return this.cpuTargets.has(key);
  }

  hasCpuPrefix(prefix) {
    for (const key of this.cpuTargets.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  hasGpuPrefix(prefix) {
    for (const key of this.gpuTargets.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  hasGpuContaining(part) {
    for (const key of this.gpuTargets.keys()) {
      if (key.includes(part)) return true;
    }
    return false;
  }

  forEachCpu(visitor) {
    for (const target of this.cpuTargets.values()) visitor(target);
  }
}
