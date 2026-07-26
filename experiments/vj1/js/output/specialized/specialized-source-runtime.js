import { drawStandby } from "../generators.js";
import { FeatureMorphRuntime } from "./feature-morph-runtime.js";
import { MeshPatternRuntime } from "./mesh-pattern-runtime.js";
import { SpecializedTargetRuntime } from "./specialized-target-runtime.js";
import { TerrainRenderRuntime } from "./terrain-render-runtime.js";
import { TextRenderRuntime } from "./text-render-runtime.js";
import { NativeRendererRegistry } from "../../libraries/render-engine/native-renderer-registry.js";

export {
  featureMorphNodeRuntimeModule,
  featureMorphNodeShaderSource,
  specializedResourceIdentity,
  terrainNodeRuntimeModule,
  terrainNodeShaderSource,
  textNodeRuntimeModule,
  textNodeShaderSource,
} from "./specialized-node-artifacts.js";
export { terrainCameraView } from "../../libraries/terrain-engine/index.js";

// Registry and lifecycle composition root for the few declared retained
// native kernels. Each visual family owns its algorithms and context-bound
// resources in a separate capability runtime; this class performs no visual
// rendering itself.
export class SpecializedSourceRuntime {
  constructor({
    acquireMedia,
    requestMissingMediaBatch,
    applyGraphicsPixelDensity,
    measureGpu,
    frameIndex,
    showDiagnostics,
    requestPixelDensity,
    nativeRendererRegistry,
    onInvalidate,
  } = {}) {
    this.frameIndex = frameIndex || (() => 0);
    this.showDiagnostics = showDiagnostics || (() => true);
    this.requestPixelDensity =
      requestPixelDensity ||
      ((request = {}) => request.pixelDensity);
    this.nativeRendererRegistry =
      nativeRendererRegistry || new NativeRendererRegistry();
    this.readinessResolvers = new Map();
    this.targets = new SpecializedTargetRuntime({
      applyGraphicsPixelDensity,
    });
    const standby = (target, label, options = {}) =>
      this.drawStandby(target, label, options);
    this.featureMorph = new FeatureMorphRuntime({
      targets: this.targets,
      acquireMedia,
      requestMissingMediaBatch,
      drawStandby: standby,
      onInvalidate,
    });
    this.registerReadinessResolver(
      "feature-morph-analysis",
      ({ program, requirement }) =>
        this.featureMorph.readinessStatus(program, requirement),
    );
    this.text = new TextRenderRuntime({
      targets: this.targets,
      frameIndex: this.frameIndex,
      drawStandby: standby,
    });
    this.meshPattern = new MeshPatternRuntime({
      frameIndex: this.frameIndex,
      drawStandby: standby,
    });
    this.terrain = new TerrainRenderRuntime({
      measureGpu,
      drawStandby: standby,
    });
    this.registerNativeRenderer(
      "output/specialized:terrainSurface",
      (target, source, time, request, operation) =>
        this.terrain.draw(
          target,
          source,
          time,
          this.nativeRequest(request),
          operation,
        ),
    );
    this.registerNativeRenderer(
      "output/specialized:terrainWire",
      (target, source, time, request, operation) =>
        this.terrain.draw(
          target,
          source,
          time,
          this.nativeRequest(request),
          operation,
        ),
    );
    this.registerNativeRenderer(
      "output/specialized:featureMorph",
      (target, source, time, request, operation) =>
        this.featureMorph.draw(
          target,
          source,
          time,
          this.nativeRequest(request),
          operation,
        ),
    );
    this.registerNativeRenderer(
      "output/specialized:featureMorphV2",
      (target, source, time, request, operation) =>
        this.featureMorph.draw(
          target,
          source,
          time,
          this.nativeRequest(request),
          operation,
        ),
    );
    this.registerNativeRenderer(
      "output/specialized:text",
      (target, source, time, request, operation) =>
        this.text.draw(
          target,
          source,
          time,
          this.nativeRequest(request),
          operation,
        ),
    );
    this.registerNativeRenderer(
      "output/specialized:meshPatternFill",
      (target, source, time, request, operation) =>
        this.meshPattern.draw(
          target,
          "fill",
          source,
          time,
          this.nativeRequest(request),
          operation,
        ),
    );
    this.registerNativeRenderer(
      "output/specialized:meshPatternWire",
      (target, source, time, request, operation) =>
        this.meshPattern.draw(
          target,
          "wire",
          source,
          time,
          this.nativeRequest(request),
          operation,
        ),
    );
  }

  registerNativeRenderer(
    rendererId,
    renderer,
    { replace = false } = {},
  ) {
    const id = String(rendererId || "");
    if (!id || typeof renderer !== "function") {
      throw new TypeError("VJ1_NATIVE_SOURCE_RENDERER_INVALID");
    }
    return this.nativeRendererRegistry.register(id, renderer, { replace });
  }

  hasNativeRenderer(rendererId) {
    return this.nativeRendererRegistry.has(rendererId);
  }

  registerReadinessResolver(capabilityId, resolver, { replace = false } = {}) {
    const id = String(capabilityId || "");
    if (!id || typeof resolver !== "function") {
      throw new TypeError("VJ1_CAPABILITY_READINESS_RESOLVER_INVALID");
    }
    if (!replace && this.readinessResolvers.has(id)) {
      throw new Error(`VJ1_CAPABILITY_READINESS_RESOLVER_DUPLICATE:${id}`);
    }
    this.readinessResolvers.set(id, resolver);
    return resolver;
  }

  capabilityReadiness(requirement = {}, context = {}) {
    const id = String(requirement.id || "");
    return this.readinessResolvers.get(id)?.({ requirement, ...context }) || null;
  }

  drawNativeRenderer(
    rendererId,
    target,
    source,
    time,
    renderRequest,
    operation = null,
  ) {
    return this.nativeRendererRegistry.execute(
      rendererId,
      target,
      source,
      time,
      renderRequest,
      operation,
    );
  }

  nativeRequest(renderRequest = {}) {
    return {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    };
  }

  drawStandby(target, label, {
    icon = "resource",
    detail = false,
  } = {}) {
    const transient =
      /loading|checking|preparing|matching|finding|not loaded/i.test(
        String(label || ""),
      );
    drawStandby(target, label, {
      visible: this.showDiagnostics(),
      frame: this.frameIndex(),
      graceMs: transient ? 1000 : 0,
      icon,
      detail,
    });
  }

  dispose() {
    this.terrain.dispose();
    this.featureMorph.dispose();
    this.text.dispose();
    this.meshPattern.dispose();
    this.targets.dispose();
    this.readinessResolvers.clear();
  }
}
