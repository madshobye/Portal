import { normalizeParamValue } from "../libraries/visual-nodes/shared/component-schema.js";
import { contentTransformCanvasPlacement } from "./content-coordinate-space.js?v=gc-allocation-1";
import { isIdentityTransform } from "./preview-interaction-geometry.js?v=alpha-feather-1";
import { isSharedFramebufferTarget } from "./shared-framebuffer-target.js?v=render-diagnostics-1";

export function effectParamNumber(component, params = {}, id, fallback = 0) {
  const param = (component?.params || []).find((item) => item.id === id);
  const value = Number(param ? normalizeParamValue(param, params[id]) : (params[id] ?? fallback));
  return Number.isFinite(value) ? value : fallback;
}

export function nextFxTargetSlot(targets = [], current = null) {
  return targets[0] === current ? 1 : 0;
}

export function disposeGraphics(item) {
  if (!item) return;
  try {
    item.remove?.();
  } catch {}
}

export function chainItemToShaderPass(item) {
  return {
    id: item.componentId || item.id,
    instanceId: item.id || item.componentId || "",
    enabled: item.enabled !== false,
    params: item.params || {},
    amount: item.amount,
    transform: item.transform || {},
    opacity: item.opacity ?? 1,
    blend: item.blend || "normal",
  };
}

export function effectNeedsComposite(item = {}) {
  return (item.blend || "normal") !== "normal" || Math.abs((item.opacity ?? 1) - 1) > 0.0001;
}

export function drawWithContentTransform(target, transform = {}, draw) {
  if (typeof draw !== "function") return;
  if (isIdentityTransform(transform)) {
    draw();
    return;
  }
  const width = Math.max(1, Number(target?.width) || 1);
  const height = Math.max(1, Number(target?.height) || 1);
  const value = contentTransformCanvasPlacement(transform, width, height);
  target.push();
  target.translate(value.centerX, value.centerY);
  target.rotate(value.rotation);
  target.scale(value.scale);
  target.translate(-width * 0.5, -height * 0.5);
  draw();
  target.pop();
}

export function shaderDrawingBufferSize(target, fallbackWidth, fallbackHeight) {
  if (isSharedFramebufferTarget(target)) {
    return {
      width: Math.max(1, Number(target.width) || Number(fallbackWidth) || 1),
      height: Math.max(1, Number(target.height) || Number(fallbackHeight) || 1),
    };
  }
  const gl = target?._renderer?.GL || target?.drawingContext;
  return {
    width: Math.max(1, Number(gl?.drawingBufferWidth) || Number(fallbackWidth) || Number(target?.width) || 1),
    height: Math.max(1, Number(gl?.drawingBufferHeight) || Number(fallbackHeight) || Number(target?.height) || 1),
  };
}

export function setShaderUniformIfPresent(shader, name, value) {
  if (shader?.uniforms?.[name]) shader.setUniform(name, value);
}

export function setDynamicShaderUniformIfPresent(shader, name, value) {
  const uniform = shader?.uniforms?.[name];
  if (!uniform) return;
  if (typeof shader?._renderer?.updateUniformValue !== "function") {
    shader.setUniform(name, value);
    return;
  }
  shader._renderer.updateUniformValue(shader, uniform, value);
  if (!Array.isArray(uniform._cachedData) || !Array.isArray(value)) return;
  uniform._cachedData.length = value.length;
  for (let index = 0; index < value.length; index++) uniform._cachedData[index] = value[index];
}

export function enumUniform(param, value) {
  const index = (param.values || []).indexOf(value);
  return Math.max(0, index);
}

export function drawShaderTarget(target, draw) {
  if (isSharedFramebufferTarget(target)) {
    return target.drawWebGL(() => {
      push();
      try {
        noStroke();
        return draw();
      } finally {
        pop();
      }
    });
  }
  target.push();
  try {
    return draw();
  } finally {
    target.pop();
  }
}

export function clearShaderTarget(target) {
  if (isSharedFramebufferTarget(target)) clear();
  else target.clear();
}

export function applyShaderTarget(target, shaderProgram) {
  if (isSharedFramebufferTarget(target)) shader(shaderProgram);
  else target.shader(shaderProgram);
}

export function resetShaderTarget(target) {
  if (isSharedFramebufferTarget(target)) resetShader();
  else target.resetShader();
}

export function drawShaderTargetRect(target, widthPx, heightPx) {
  if (isSharedFramebufferTarget(target)) rect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);
  else target.rect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);
}
