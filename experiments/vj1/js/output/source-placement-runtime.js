import { clamp01 } from "../domain/models.js";
import {
  createPlacedRenderResult,
  directPlacementKind,
  transformedPlacementDemandRect,
} from "../graph/placed-render-result.js";
import { applyBlend } from "./blend-utils.js";
import {
  componentReferenceCount,
  componentReferencePlacement,
  componentReferenceRenderRequest,
  componentRenderInstanceKey,
  fullTargetRect,
} from "./component-render-layout.js";
import { contentTransformCanvasPlacement } from "./content-coordinate-space.js";
import { drawBuffer } from "./render-draw-utils.js";
import { drawMediaFit, isDrawableMedia } from "./media-utils.js";
import {
  combineContentTransforms,
  normalizedContentTransform,
} from "./preview-interaction-geometry.js";
import { componentInstanceTime } from "./render-runtime-math.js";

export class SourcePlacementRuntime {
  constructor(host, { mediaRuntime, resourceRuntime } = {}) {
    this.host = host;
    this.mediaRuntime = mediaRuntime;
    this.resourceRuntime = resourceRuntime;
  }

  canDirectComposite(item = {}, renderRequest = {}, operation = null, component = {}) {
    if (renderRequest.nodeRegionView === true) return false;
    const source = item.source || {};
    const dependency = source.type === "component"
      ? this.host.state?.components?.find((candidate) => candidate.id === source.componentId)
      : null;
    const directResource = this.directPlacementResource(operation, source, component, renderRequest);
    return !!directPlacementKind({
      source,
      blend: item.blend || "normal",
      dependency,
      drawableResourceDrawable: !!directResource?.drawable && isDrawableMedia(directResource.drawable),
      drawableResourceRequiresRetainedFrame: directResource?.requiresRetainedFrame === true,
    });
  }

  directPlacementResource(operation = null, source = {}, component = {}, renderRequest = {}) {
    const contract = operation?.directPlacement;
    if (contract?.kind !== "drawable-resource" || source.type !== "generator") return null;
    const params = source.params || {};
    if (params[contract.mirrorParameter || "mirrored"] === true) return null;
    const descriptor = operation.runtimeValueInputs?.get?.(contract.input || "resource");
    if (!descriptor?.ready) return null;
    const drawable = this.mediaRuntime.acquireDrawableResource(
      descriptor,
      Math.max(1, Number(renderRequest.width) || 1),
      { playback: this.resourceRuntime.drawableResourcePlaybackOptions(descriptor, component) },
    );
    const runtimeMedia = descriptor.kind === "project-media-resource"
      ? this.host.media.get(String(descriptor.mediaId || ""))
      : null;
    return {
      contract,
      descriptor,
      drawable,
      requiresRetainedFrame: contract.retainProjectVideoFrame === true && !!runtimeMedia?.video,
    };
  }

  drawPlacedSourceResult(output, placed, layer = {}, clipRect = null) {
    output.push();
    applyBlend(output, layer.blend);
    output.tint(255, 255 * clamp01(layer.opacity ?? 1));
    withTargetScissor(output, clipRect, () => this.drawPlacedResultGeometry(output, placed));
    output.noTint();
    output.blendMode(BLEND);
    output.pop();
  }

  drawPlacedResultGeometry(output, placed, coordinateTarget = output) {
    const rect = placed.destinationRect;
    const transform = normalizedContentTransform(placed.transform);
    const coordinateWidth = Math.max(1, Number(coordinateTarget?.width) || Number(output.width) || 1);
    const coordinateHeight = Math.max(1, Number(coordinateTarget?.height) || Number(output.height) || 1);
    const placement = contentTransformCanvasPlacement(transform, coordinateWidth, coordinateHeight);
    output.push();
    output.translate(placement.centerX, placement.centerY);
    output.rotate(transform.rotation);
    output.scale(transform.scale);
    const x = rect.x - coordinateWidth * 0.5;
    const y = rect.y - coordinateHeight * 0.5;
    if (placed.fit === "stretch") {
      drawBuffer(output, placed.texture, x, y, rect.width, rect.height, placed.sourceIsWebGL);
    } else {
      drawMediaFit(output, placed.texture, x, y, rect.width, rect.height, placed.fit);
    }
    output.pop();
  }

  resolvePlacedSourceResult(output, source, component, componentTime, renderRequest, operation = null) {
    const host = this.host;
    const target = { width: output.width, height: output.height };
    const directResource = this.directPlacementResource(operation, source, component, renderRequest);
    if (directResource?.drawable && !directResource.requiresRetainedFrame && isDrawableMedia(directResource.drawable)) {
      const fitParameter = directResource.contract.fitParameter || "fit";
      return createPlacedRenderResult(directResource.drawable, {
        destinationRect: fullTargetRect(target),
        fit: source.params?.[fitParameter] || "contain",
        transform: source.contentTransform,
      });
    }
    if (source.type !== "component") return null;
    const dependency = host.componentProgramRuntime.componentForId(source.componentId);
    if (!dependency || dependency.id === component.id || dependency.type === "scene") return null;
    const placement = componentReferencePlacement(component, dependency, host.state.render, target, source.placement);
    const placementTransform = combineContentTransforms(source.contentTransform, dependency.transform);
    const demandRect = transformedPlacementDemandRect(placement, placementTransform);
    const dependencyTime = host.frameRuntime.componentTimes.get(dependency.id) || componentTime;
    const renderIdentity = componentRenderInstanceKey(dependency, source.instanceId);
    const referenceCount = componentReferenceCount(host.componentProgramRuntime.programs.get(component.id), dependency.id);
    const texture = host.componentRenderRuntime.render(
      dependency,
      componentInstanceTime(dependency, dependencyTime, source.instanceId),
      componentReferenceRenderRequest(host.state.render, dependency, demandRect, {
        reason: "direct-component-reference",
        renderIdentity,
        sharedResolutionClass: dependency.syncInstances !== false && referenceCount > 1,
      }),
    );
    return createPlacedRenderResult(texture, {
      destinationRect: placement,
      transform: placementTransform,
      sourceIsWebGL: host.renderTargetRuntime.isShaderBuffer(texture),
    });
  }
}

function withTargetScissor(target, rect, draw) {
  if (!rect || typeof draw !== "function") return draw?.();
  const gl = target?.drawingContext;
  if (!gl?.scissor || !gl?.enable) {
    if (!gl?.save || !gl?.beginPath || !gl?.rect || !gl?.clip) return draw();
    gl.save();
    gl.beginPath();
    gl.rect(Number(rect.x) || 0, Number(rect.y) || 0, Math.max(0, Number(rect.width) || 0), Math.max(0, Number(rect.height) || 0));
    gl.clip();
    try { return draw(); } finally { gl.restore(); }
  }
  const targetWidth = Math.max(1, Number(target?.width) || 1);
  const targetHeight = Math.max(1, Number(target?.height) || 1);
  const density = target?.__vj1SharedFramebuffer ? 1 : Math.max(1, Number(target?.pixelDensity?.()) || 1);
  const left = Math.max(0, Math.min(targetWidth, Number(rect.x) || 0));
  const top = Math.max(0, Math.min(targetHeight, Number(rect.y) || 0));
  const right = Math.max(left, Math.min(targetWidth, left + Math.max(0, Number(rect.width) || 0)));
  const bottom = Math.max(top, Math.min(targetHeight, top + Math.max(0, Number(rect.height) || 0)));
  const wasEnabled = gl.isEnabled?.(gl.SCISSOR_TEST) === true;
  const previousBox = gl.getParameter?.(gl.SCISSOR_BOX);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(
    Math.floor(left * density),
    Math.floor((targetHeight - bottom) * density),
    Math.max(1, Math.ceil((right - left) * density)),
    Math.max(1, Math.ceil((bottom - top) * density)),
  );
  try {
    return draw();
  } finally {
    if (previousBox?.length === 4) gl.scissor(previousBox[0], previousBox[1], previousBox[2], previousBox[3]);
    if (!wasEnabled) gl.disable(gl.SCISSOR_TEST);
  }
}
