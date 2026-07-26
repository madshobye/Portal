import { clamp01 } from "../../domain/models.js?v=surface-terminology-1";
import { contentTransformUvMatrices } from "../content-coordinate-space.js?v=node-roi-placement-1";
import {
  applyShaderTarget,
  clearShaderTarget,
  drawShaderTarget,
  drawShaderTargetRect,
  resetShaderTarget,
} from "../shader-target-runtime.js?v=premultiplied-alpha-write-1";
import { renderView } from "../../libraries/render-engine/render-view/index.js";
import {
  mobileNetAnalysisModule,
  MobileNetMorphPairService,
} from "./mobilenet-morph-service.js?v=analysis-state-invalidation-1";
import { SuperPointPairService } from "./superpoint-service.js?v=analysis-state-invalidation-1";
import {
  compiledSpecializedOperation,
  featureMorphNodeRuntimeModule,
  featureMorphNodeShaderSource,
  specializedResourceIdentity,
} from "./specialized-node-artifacts.js";

// Retained analysis and GPU morph capability shared by both Feature Morph
// compounds. The compiled graph supplies media resources, analysis provider,
// editable module, and shader artifacts; this runtime owns only analysis
// services, the retained program, and its exact target.
export class FeatureMorphRuntime {
  constructor({
    targets,
    acquireMedia,
    requestMissingMediaBatch,
    drawStandby,
    onInvalidate,
  } = {}) {
    this.targets = targets;
    this.acquireMedia = acquireMedia || (() => null);
    this.requestMissingMediaBatch =
      requestMissingMediaBatch || (() => {});
    this.drawStandby = drawStandby || (() => {});
    this.superPointPairs = new SuperPointPairService({ onInvalidate });
    this.mobileNetMorphPairs = new MobileNetMorphPairService({ onInvalidate });
    this.analysisProviders = new Map();
    this.connectedModules = new WeakMap();
    this.shader = null;
    this.shaderRevision = "";
    this.registerAnalysisProvider("superpoint", {
      service: () => this.superPointPairs,
      requireAnalysisModule: true,
      loadingLabel: "finding SuperPoint landmarks",
      errorLabel: "feature matching failed",
      morphStrategy: () => "flow",
      morphField: (entry) => entry.result.field,
      featureInfluence: () => 1,
    });
    this.registerAnalysisProvider("mobilenet", {
      service: () => this.mobileNetMorphPairs,
      requireAnalysisModule: false,
      loadingLabel: "matching MobileNet regions",
      errorLabel: "semantic matching failed",
      morphStrategy: (params) => params.morphStrategy || "elastic",
      morphField: (entry, nodeModule, strategy) =>
        mobileNetAnalysisModule(nodeModule).mobileNetMorphFieldForStrategy(
          entry.result,
          strategy,
        ),
      featureInfluence: (params) =>
        Math.max(0, Number(params.influence) || 0) / 0.2,
    });
  }

  registerAnalysisProvider(providerId, adapter, { replace = false } = {}) {
    const id = String(providerId || "");
    if (!id || !adapter || typeof adapter.service !== "function") {
      throw new TypeError("VJ1_FEATURE_MORPH_ANALYSIS_PROVIDER_INVALID");
    }
    if (!replace && this.analysisProviders.has(id)) {
      throw new Error(
        `VJ1_FEATURE_MORPH_ANALYSIS_PROVIDER_DUPLICATE:${id}`,
      );
    }
    this.analysisProviders.set(
      id,
      Object.freeze({ ...adapter, providerId: id }),
    );
    return this.analysisProviders.get(id);
  }

  analysisProvider(providerId) {
    return this.analysisProviders.get(String(providerId || "")) || null;
  }

  analysisService(providerId) {
    return this.analysisProvider(providerId)?.service() || null;
  }

  readinessStatus(program = null, requirement = null) {
    let found = false;
    let pending = false;
    let error = "";
    const revisions = [];
    const evaluatedPrograms = new Set();
    const requiredSteps = new Set(
      requirement?.sourceStepIds || [],
    );
    visitOperations(program, (operation) => {
      const valueProgram = operation?.valueProgram;
      const analysisSteps = (valueProgram?.steps || []).filter((step) => {
        if (step.externalResolver?.capability !== "feature-morph-analysis") return false;
        if (requiredSteps.size && !requiredSteps.has(step.id)) return false;
        return true;
      });
      if (
        analysisSteps.some((step) => !step.outputValues?.analysis) &&
        !evaluatedPrograms.has(valueProgram)
      ) {
        evaluatedPrograms.add(valueProgram);
        try {
          // Prepared Live programs have not rendered yet. Evaluate their pure
          // retained-value graph once so the host capability can see and own
          // the analysis request before deciding whether the Scene is ready.
          // This does not render a frame or make readiness depend on preview
          // resolution.
          valueProgram.evaluate({
            componentTime: 0,
            timestamp: 0,
            renderRequest: null,
          });
        } catch (valueError) {
          error ||= valueError?.message || String(valueError);
        }
      }
      for (const step of analysisSteps) {
        found = true;
        const resourceId = `${operation.id || "operation"}/${step.id || "analysis"}`;
        const analysis = step.outputValues?.analysis;
        const providerId = String(analysis?.providerId || "");
        const provider = this.analysisProvider(providerId);
        const service = provider?.service?.() || null;
        if (!analysis || !provider || !service) {
          pending = true;
          revisions.push(`${resourceId}:unavailable:${providerId || "missing"}`);
          if (analysis && !service) {
            error ||= `Feature Morph analysis provider is unavailable: ${providerId || "missing"}`;
          }
          continue;
        }
        const settings = analysis.settings || {};
        const imageAId = String(settings.imageAId || analysis.imageA?.mediaId || "");
        const imageBId = String(settings.imageBId || analysis.imageB?.mediaId || "");
        const imageA = imageAId ? this.acquireMedia(imageAId) : null;
        const imageB = imageBId ? this.acquireMedia(imageBId) : null;
        const mediaError =
          imageA?.loadError ||
          imageA?.imageError ||
          imageB?.loadError ||
          imageB?.imageError ||
          "";
        if (mediaError) {
          error ||= String(mediaError);
          revisions.push(`${resourceId}:media-error:${String(mediaError)}`);
          continue;
        }
        if (!imageA?.image || !imageB?.image) {
          pending = true;
          revisions.push(`${resourceId}:media-pending`);
          continue;
        }
        const consumer = featureMorphAnalysisConsumer(
          operation,
          step.id,
        );
        const nodeModule = this.connectedRuntimeModule(
          consumer,
          analysis,
          {
            requireAnalysis:
              provider.requireAnalysisModule === true,
          },
        );
        const media = {
          imageAFile: imageA.file,
          imageBFile: imageB.file,
          nodeModule,
          algorithmRevision: String(
            consumer?.nodeCodeRevision ||
            consumer?.nodeModuleRevision ||
            "legacy",
          ),
        };
        let state = service.status(settings, media);
        if (state === "idle" && typeof service.request === "function") {
          try {
            const entry = service.request(
              settings,
              imageA.image,
              imageB.image,
              media,
            );
            state = entry?.status || service.status(settings, media);
          } catch (requestError) {
            state = "error";
            error ||= requestError?.message || String(requestError);
          }
        }
        revisions.push(
          `${resourceId}:${service.externalKey?.(settings, media) || state}`,
        );
        if (state === "error") error ||= "Feature Morph analysis failed";
        else if (state !== "ready") pending = true;
      }
    });
    if (!found) return null;
    return Object.freeze({
      kind: "capability",
      id: "feature-morph-analysis",
      state: error ? "error" : pending ? "pending" : "ready",
      error,
      revision: revisions.join("|"),
    });
  }

  connectedRuntimeModule(
    operation,
    analysisValue,
    { requireAnalysis = true } = {},
  ) {
    if (!analysisValue?.nodeModule) {
      return featureMorphNodeRuntimeModule(operation, { requireAnalysis });
    }
    const analysisModule = analysisValue.nodeModule;
    let cached = this.connectedModules.get(operation);
    if (
      !cached ||
      cached.analysisModule !== analysisModule ||
      cached.renderModule !== operation.nodeModule
    ) {
      const nodeModule = Object.freeze({
        ...(analysisModule || {}),
        ...(operation?.nodeModule || {}),
      });
      cached = {
        analysisModule,
        renderModule: operation?.nodeModule,
        nodeModule,
      };
      this.connectedModules.set(operation, cached);
    }
    return featureMorphNodeRuntimeModule(
      { nodeModule: cached.nodeModule },
      { requireAnalysis },
    );
  }

  draw(
    output,
    source = {},
    componentTime = 0,
    renderRequest = {},
    operation = null,
  ) {
    const authoredParams = source.params || {};
    const imageAValue =
      operation?.runtimeValueInputs?.get?.("imageA") ||
      null;
    const imageBValue =
      operation?.runtimeValueInputs?.get?.("imageB") ||
      null;
    const analysisValue =
      operation?.runtimeValueInputs?.get?.("analysis") ||
      null;
    const params = authoredParams;
    const analysisParams = compiledSpecializedOperation(operation)
      ? analysisValue?.settings
      : analysisValue?.settings || authoredParams;
    if (
      compiledSpecializedOperation(operation) &&
      (
        !analysisParams ||
        typeof analysisParams !== "object" ||
        Array.isArray(analysisParams)
      )
    ) {
      throw new Error(
        "FEATURE_MORPH_ANALYSIS_SETTINGS_MISSING:analysis",
      );
    }
    const providerId = String(analysisValue?.providerId || "");
    const analysisProvider = this.analysisProvider(providerId);
    if (!analysisProvider) {
      throw new Error(
        `FEATURE_MORPH_ANALYSIS_PROVIDER_UNAVAILABLE:${providerId || "missing"}`,
      );
    }
    const nodeModule = this.connectedRuntimeModule(
      operation,
      analysisValue,
      {
        requireAnalysis:
          analysisProvider.requireAnalysisModule === true,
      },
    );
    const pairService = analysisProvider.service();
    const shaderRevision = String(
      operation?.nodeShaderProgramRevisions?.["feature-morph"] ||
      operation?.nodeShaderRevision ||
      operation?.nodeModuleRevision ||
      "legacy",
    );
    const imageAId = specializedResourceIdentity(
      operation,
      imageAValue,
      "mediaId",
      authoredParams.imageAId,
    );
    const imageBId = specializedResourceIdentity(
      operation,
      imageBValue,
      "mediaId",
      authoredParams.imageBId,
    );
    if (!imageAId || !imageBId) {
      this.drawStandby(output, "choose two images");
      return;
    }
    const view = renderView(output, renderRequest);
    const imageRequest = {
      width: Math.max(1024, Number(view.width) || 0),
    };
    const itemA = this.acquireMedia(imageAId, imageRequest);
    const itemB = this.acquireMedia(imageBId, imageRequest);
    const missingIds = [
      !itemA ? imageAId : "",
      !itemB ? imageBId : "",
    ].filter(Boolean);
    if (missingIds.length) {
      this.requestMissingMediaBatch(missingIds);
    }
    if (!itemA?.image || !itemB?.image) {
      this.drawStandby(
        output,
        itemA?.imageError ||
          itemB?.imageError ||
          "loading morph images",
      );
      return;
    }
    const entry = pairService.request(
      analysisParams,
      itemA.image,
      itemB.image,
      {
        imageAFile: itemA.file,
        imageBFile: itemB.file,
        nodeModule,
        algorithmRevision: String(
          operation?.nodeCodeRevision ||
          operation?.nodeModuleRevision ||
          "legacy",
        ),
      },
    );
    if (entry.status === "loading") {
      this.drawStandby(
        output,
        entry.detail || analysisProvider.loadingLabel,
      );
      return;
    }
    if (entry.status === "error" || !entry.result?.field) {
      this.drawStandby(
        output,
        entry.error || analysisProvider.errorLabel,
      );
      return;
    }

    const target = this.targets.get(
      "featureMorph",
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
        featureMorphNodeShaderSource(operation, "vertex"),
        featureMorphNodeShaderSource(operation, "fragment"),
      );
      this.shaderRevision = shaderRevision;
    }
    const morphStrategy = analysisProvider.morphStrategy(params);
    const morphField = analysisProvider.morphField(
      entry,
      nodeModule,
      morphStrategy,
    );
    const flowImage = featureMorphFlowImage(morphField);
    const autoSpeed = Math.max(0, Number(params.autoSpeed) || 0);
    const morph =
      autoSpeed > 0.0001
        ? 0.5 +
          0.5 *
            Math.sin(componentTime * autoSpeed * Math.PI * 2)
        : clamp01(Number(params.morph) || 0);
    const fit = params.fit || "cover";
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, this.shader);
      this.shader.setUniform("imageA", itemA.image);
      this.shader.setUniform("imageB", itemB.image);
      this.shader.setUniform("flowField", flowImage);
      this.shader.setUniform("morph", morph);
      const featureInfluence =
        analysisProvider.featureInfluence(params);
      this.shader.setUniform(
        "warpStrength",
        Math.max(0, Number(params.warpStrength) || 0) *
          featureInfluence,
      );
      this.shader.setUniform("maxFlow", morphField.maxFlow);
      this.shader.setUniform("flowSize", [
        morphField.width,
        morphField.height,
      ]);
      this.shader.setUniform("flowPhases", morphField.phases || 1);
      this.shader.setUniform("flowLayers", morphField.layers || 1);
      this.shader.setUniform(
        "morphStrategy",
        morphStrategy === "rigid" || morphStrategy === "elastic"
          ? 1
          : morphStrategy === "fluid"
            ? 2
            : 0,
      );
      this.shader.setUniform(
        "fitA",
        nodeModule.imageFitUniform(
          itemA.image,
          view.width,
          view.height,
          fit,
        ),
      );
      this.shader.setUniform(
        "fitB",
        nodeModule.imageFitUniform(
          itemB.image,
          view.width,
          view.height,
          fit,
        ),
      );
      this.shader.setUniform(
        "contentUvMatrix",
        contentTransformUvMatrices(source.contentTransform).sampling,
      );
      setOptionalShaderUniform(
        this.shader,
        "renderUvRect",
        view.uvRect,
      );
      drawShaderTargetRect(target, output.width, output.height);
      resetShaderTarget(target);
    });
    this.targets.present(output, target);
  }

  dispose() {
    this.superPointPairs.dispose?.();
    this.mobileNetMorphPairs.dispose?.();
    this.shader = null;
    this.shaderRevision = "";
    this.connectedModules = new WeakMap();
  }
}

function visitOperations(program, visitor) {
  if (!program || typeof visitor !== "function") return;
  if (typeof program.forEachOperation === "function") {
    program.forEachOperation(visitor);
    return;
  }
  const visit = (operation) => {
    if (!operation) return;
    visitor(operation);
    for (const child of operation.operations || []) visit(child);
  };
  visit(program);
}

function featureMorphAnalysisConsumer(operation, stepId) {
  let match = null;
  const visit = (candidate) => {
    if (!candidate || match) return;
    if (
      (candidate.externalResourceRequirements || []).some(
        (requirement) =>
          requirement.id === "feature-morph-analysis" &&
          (requirement.sourceStepIds || []).includes(stepId),
      )
    ) {
      match = candidate;
      return;
    }
    for (const child of candidate.operations || []) visit(child);
  };
  visit(operation);
  return match || operation;
}

function featureMorphFlowImage(field = {}) {
  if (field.flowImage) return field.flowImage;
  const image = createImage(
    field.width,
    field.height *
      (field.phases || 1) *
      (field.layers || 1),
  );
  image.loadPixels();
  image.pixels.set(field.pixels);
  image.updatePixels();
  field.flowImage = image;
  return image;
}

function setOptionalShaderUniform(shaderProgram, name, value) {
  if (shaderProgram?.uniforms?.[name]) {
    shaderProgram.setUniform(name, value);
  }
}
