import { contentTransformUvMatrices } from "../content-coordinate-space.js";
import {
  applyShaderTarget,
  clearShaderTarget,
  drawShaderTarget,
  drawShaderTargetRect,
  resetShaderTarget,
} from "../shader-target-runtime.js";
import { renderView } from "../../libraries/render-engine/render-view/index.js";
import {
  textMaskDimensions as fallbackTextMaskDimensions,
} from "./text-generator-renderer.js";
import {
  textNodeRuntimeModule,
  textNodeShaderSource,
} from "./specialized-node-artifacts.js";

// Retained host for the Text Mask -> Image terminal operation. The ordinary
// value program owns text layout and mask production; this capability owns the
// context-bound mask upload, shader, and bounded instance cache.
export class TextRenderRuntime {
  constructor({ targets, frameIndex, drawStandby } = {}) {
    this.targets = targets;
    this.frameIndex = frameIndex || (() => 0);
    this.drawStandby = drawStandby || (() => {});
    this.shader = null;
    this.shaderRevision = "";
    this.masks = new Map();
  }

  draw(
    output,
    source = {},
    _componentTime = 0,
    renderRequest = {},
    operation = null,
  ) {
    const authoredParams = source.params || {};
    const instanceId =
      source.instanceId ||
      renderRequest.renderIdentity ||
      source.generatorId ||
      "text";
    const view = renderView(output, renderRequest);
    const maskValue =
      operation?.runtimeValueInputs?.get?.("mask") || null;
    const params = authoredParams;
    if (
      operation?.runtimeValueInputs &&
      !maskValue?.canvas
    ) {
      this.drawStandby(output, "Text mask value unavailable");
      return;
    }
    const codeRevision = String(
      operation?.nodeCodeRevision ||
      operation?.nodeModuleRevision ||
      "legacy",
    );
    const shaderRevision = String(
      operation?.nodeShaderRevision ||
      operation?.nodeModuleRevision ||
      "legacy",
    );
    const target = this.targets.get(
      "text",
      output.width,
      output.height,
      renderRequest.pixelDensity,
      {
        preferSharedFramebuffer: true,
        onContextDiscard: () => {
          this.shader = null;
          this.shaderRevision = "";
        },
      },
    );
    if (!this.shader || this.shaderRevision !== shaderRevision) {
      this.shader = target.createShader(
        textNodeShaderSource(operation, "vertex"),
        textNodeShaderSource(operation, "fragment"),
      );
      this.shaderRevision = shaderRevision;
    }
    let canvas;
    let maskSize;
    let providerRevision = 0;
    let signature;
    let legacyNodeModule = null;
    if (maskValue) {
      canvas = maskValue.canvas;
      maskSize = {
        width: Math.max(
          1,
          Number(maskValue.width) || canvas.width || 1,
        ),
        height: Math.max(
          1,
          Number(maskValue.height) || canvas.height || 1,
        ),
      };
      providerRevision = Math.max(
        0,
        Number(maskValue.revision) || 0,
      );
      signature = `${codeRevision}:${String(maskValue.signature || "")}`;
    } else {
      // Compatibility-only direct host calls have no compiled Group.
      legacyNodeModule = textNodeRuntimeModule(operation);
      const textMaskDimensions =
        typeof legacyNodeModule.textMaskDimensions === "function"
          ? legacyNodeModule.textMaskDimensions
          : fallbackTextMaskDimensions;
      maskSize = textMaskDimensions(view.width, view.height);
      signature =
        `${codeRevision}:` +
        legacyNodeModule.textMaskSignature(
          params,
          maskSize.width,
          maskSize.height,
        );
      canvas = null;
    }
    let mask = this.masks.get(instanceId);
    const changed = maskValue
      ? !mask ||
        mask.signature !== signature ||
        mask.providerRevision !== providerRevision ||
        mask.canvas !== canvas
      : !mask || mask.signature !== signature;
    if (changed) {
      if (!maskValue) {
        canvas = legacyNodeModule.createTextMask(
          params,
          maskSize.width,
          maskSize.height,
          mask?.canvas || null,
        );
      }
      mask = {
        signature,
        providerRevision,
        canvas,
        image: textMaskImage(canvas, mask?.image || null),
        lastUsedFrame: this.frameIndex(),
      };
      this.masks.set(instanceId, mask);
      pruneOldestEntries(this.masks, 64);
    } else {
      mask.lastUsedFrame = this.frameIndex();
    }
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, this.shader);
      this.shader.setUniform("textMask", mask.image);
      this.shader.setUniform("resolution", [
        maskSize.width,
        maskSize.height,
      ]);
      setOptionalShaderUniform(
        this.shader,
        "renderUvRect",
        view.uvRect,
      );
      this.shader.setUniform(
        "fillColor",
        colorUniform(params.fillColor, "#ffffffff"),
      );
      this.shader.setUniform(
        "outlineColor",
        colorUniform(params.outlineColor, "#ffffffff"),
      );
      this.shader.setUniform(
        "backgroundColor",
        colorUniform(params.backgroundColor, "#00000000"),
      );
      this.shader.setUniform(
        "outlineWidth",
        Math.max(0, Number(params.outlineWidth) || 0),
      );
      this.shader.setUniform(
        "fillEnabled",
        params.fillEnabled === false ? 0 : 1,
      );
      this.shader.setUniform(
        "outlineEnabled",
        params.outlineEnabled === true ? 1 : 0,
      );
      this.shader.setUniform(
        "contentUvMatrix",
        contentTransformUvMatrices(source.contentTransform).sampling,
      );
      drawShaderTargetRect(target, output.width, output.height);
      resetShaderTarget(target);
    });
    this.targets.present(output, target);
  }

  dispose() {
    this.shader = null;
    this.shaderRevision = "";
    this.masks.clear();
  }
}

function setOptionalShaderUniform(shaderProgram, name, value) {
  if (shaderProgram?.uniforms?.[name]) {
    shaderProgram.setUniform(name, value);
  }
}

function colorUniform(value, fallback = "#ffffffff") {
  const clean = String(value || fallback).replace(/^#/, "");
  const fallbackClean = String(fallback).replace(/^#/, "");
  const normalized = /^[0-9a-f]{8}$/i.test(clean)
    ? clean
    : /^[0-9a-f]{6}$/i.test(clean)
      ? `${clean}ff`
      : fallbackClean;
  return [0, 2, 4, 6].map(
    (offset) =>
      Number.parseInt(
        normalized.slice(offset, offset + 2),
        16,
      ) / 255,
  );
}

function textMaskImage(canvas, existing = null) {
  const width = Math.max(1, Number(canvas?.width) || 1);
  const height = Math.max(1, Number(canvas?.height) || 1);
  const image =
    existing?.width === width && existing?.height === height
      ? existing
      : createImage(width, height);
  const pixels = canvas
    .getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    })
    .getImageData(0, 0, width, height).data;
  image.loadPixels();
  image.pixels.set(pixels);
  image.updatePixels();
  return image;
}

function pruneOldestEntries(map, maximum) {
  while (map.size > maximum) {
    let oldestKey = null;
    let oldestFrame = Infinity;
    for (const [key, value] of map) {
      if (
        (Number(value?.lastUsedFrame) || 0) >=
        oldestFrame
      ) {
        continue;
      }
      oldestKey = key;
      oldestFrame = Number(value?.lastUsedFrame) || 0;
    }
    if (oldestKey === null) return;
    map.delete(oldestKey);
  }
}
