import { clamp01 } from "../../domain/models.js?v=render-coordinate-scope-3";
import { createSharedFramebufferTarget, isSharedFramebufferTarget, unwrapRenderTarget } from "../shared-framebuffer-target.js?v=render-diagnostics-1";
import { drawStandby } from "../generators.js?v=adaptive-component-demand-29";
import { resolutionScaledStrokeWidth } from "../component-render-layout.js?v=instance-sync-60";
import { contentTransformUvMatrices, isIdentityTransform, normalizedContentTransform } from "../content-coordinate-space.js?v=render-core-contract-1";
import { markRenderTargetOrientation, renderTargetDescriptor, renderTargetNeedsPresentationFlip, RENDER_TEXTURE_ORIENTATION } from "../render-target-contract.js?v=render-core-contract-1";
import { drawBuffer } from "../render-draw-utils.js?v=render-diagnostics-1";
import { GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER, RENDER_PASS_VERTEX_SHADER } from "../render-pass-shaders.js?v=render-coordinate-scope-3";
import { advanceRateClock, advanceSpatialScale, qualityComputeMultiplier } from "../render-runtime-math.js?v=render-coordinate-scope-3";
import { anatomyPartFitScale, drawProceduralAnatomy } from "./anatomy-renderer.js?v=adaptive-component-demand-29";
import { modelColor, normalizedModelColor } from "./model-color.js?v=adaptive-component-demand-29";
import { modelRotation, modelViewportMetrics, modelWireThickness } from "./model-render-math.js?v=model-render-math-extraction-1";
import { drawGeometryModel, drawParsedModel, drawPointCloud, drawWithPolygonOffset, ensureP5ModelPointCloud, ensureParsedModelGeometry, ensureParsedModelPointCloud } from "./model-mesh-cache.js?v=model-mesh-cache-extraction-1";
import { disposeRawModelItemResources, drawRawParsedModelMode } from "./raw-model-webgl-renderer.js?v=media-resource-disposal-1";
import { disposeTerrainSurfaceResources, disposeTerrainWireResources, drawTerrainSurface, drawTerrainWireframe } from "./terrain-renderer.js?v=terrain-near-contract-2";
import { FEATURE_MORPH_FRAGMENT_SHADER, FEATURE_MORPH_VERTEX_SHADER, imageFitUniform } from "./feature-morph-shader.js?v=render-core-contract-1";
import { mobileNetMorphFieldForStrategy, MobileNetMorphPairService } from "./mobilenet-morph-service.js?v=surface-media-contract-4";
import { SuperPointPairService } from "./superpoint-service.js?v=surface-media-contract-4";
import { TILE_TEXTURE_FRAGMENT_SHADER, TILE_TEXTURE_VERTEX_SHADER } from "./tile-texture-shader.js?v=render-core-contract-1";

export class SpecializedSourceRuntime {
  constructor({
    media,
    acquireMedia,
    requestMissingMedia,
    requestMissingMediaBatch,
    applyGraphicsPixelDensity,
    measureGpu,
    gpuTimer,
    frameIndex,
  } = {}) {
    this.media = media || (() => new Map());
    this.acquireMedia = acquireMedia || ((id) => this.media().get(id));
    this.requestMissingMedia = requestMissingMedia || (() => {});
    this.requestMissingMediaBatch = requestMissingMediaBatch || (() => {});
    this.applyGraphicsPixelDensity = applyGraphicsPixelDensity || ((target, density) => target?.pixelDensity?.(density));
    this.measureGpu = measureGpu || ((_target, draw) => draw());
    this.gpuTimer = gpuTimer || { begin: () => null, end: () => {} };
    this.frameIndex = frameIndex || (() => 0);
    this.targets = new Map();
    this.terrainSurfaceResources = new Map();
    this.terrainWireResources = new Map();
    this.rateClocks = new Map();
    this.terrainScalePhases = new Map();
    this.superPointPairs = new SuperPointPairService();
    this.mobileNetMorphPairs = new MobileNetMorphPairService();
    this.featureMorphShader = null;
    this.featureMorphV2Shader = null;
    this.tileTextureShader = null;
    this.presentationShaders = new Map();
    this.presentationShaderFailures = new Set();
  }

  featureMorphPairService(generatorId = "") {
    if (generatorId === "featureMorph") return this.superPointPairs;
    if (generatorId === "featureMorphV2") return this.mobileNetMorphPairs;
    return null;
  }

  drawFeatureMorph(pg, source = {}, componentTime = 0, renderRequest = {}) {
    const params = source.params || {};
    const isMobileNet = source.generatorId === "featureMorphV2";
    const pairService = isMobileNet ? this.mobileNetMorphPairs : this.superPointPairs;
    const targetKey = isMobileNet ? "featureMorphV2" : "featureMorph";
    const shaderKey = isMobileNet ? "featureMorphV2Shader" : "featureMorphShader";
    const imageAId = params.imageAId || "";
    const imageBId = params.imageBId || "";
    if (!imageAId || !imageBId) {
      drawStandby(pg, "choose two images");
      return;
    }
    const imageRequest = { width: Math.max(1024, Number(pg.width) || 0) };
    const itemA = this.acquireMedia(imageAId, imageRequest);
    const itemB = this.acquireMedia(imageBId, imageRequest);
    const missingIds = [!itemA ? imageAId : "", !itemB ? imageBId : ""].filter(Boolean);
    if (missingIds.length) this.requestMissingMediaBatch(missingIds);
    if (!itemA?.image || !itemB?.image) {
      drawStandby(pg, itemA?.imageError || itemB?.imageError || "loading morph images");
      return;
    }
    const entry = pairService.request(params, itemA.image, itemB.image, {
      imageAFile: itemA.file,
      imageBFile: itemB.file,
    });
    if (entry.status === "loading") {
      drawStandby(pg, entry.detail || (isMobileNet ? "matching MobileNet regions" : "finding SuperPoint landmarks"));
      return;
    }
    if (entry.status === "error" || !entry.result?.field) {
      drawStandby(pg, entry.error || (isMobileNet ? "semantic matching failed" : "feature matching failed"));
      return;
    }

    const target = this.getTarget(targetKey, pg.width, pg.height, renderRequest.pixelDensity, {
      preferSharedFramebuffer: true,
    });
    if (!this[shaderKey]) this[shaderKey] = target.createShader(FEATURE_MORPH_VERTEX_SHADER, FEATURE_MORPH_FRAGMENT_SHADER);
    const shaderProgram = this[shaderKey];
    const morphStrategy = isMobileNet ? (params.morphStrategy || "elastic") : "flow";
    const morphField = isMobileNet
      ? mobileNetMorphFieldForStrategy(entry.result, morphStrategy)
      : entry.result.field;
    const flowImage = featureMorphFlowImage(morphField);
    const autoSpeed = Math.max(0, Number(params.autoSpeed) || 0);
    const morph = autoSpeed > 0.0001
      ? 0.5 + 0.5 * Math.sin(componentTime * autoSpeed * Math.PI * 2)
      : clamp01(Number(params.morph) || 0);
    const fit = params.fit || "cover";
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shaderProgram);
      shaderProgram.setUniform("imageA", itemA.image);
      shaderProgram.setUniform("imageB", itemB.image);
      shaderProgram.setUniform("flowField", flowImage);
      shaderProgram.setUniform("morph", morph);
      const featureInfluence = isMobileNet ? Math.max(0, Number(params.influence) || 0) / 0.2 : 1;
      shaderProgram.setUniform("warpStrength", Math.max(0, Number(params.warpStrength) || 0) * featureInfluence);
      shaderProgram.setUniform("maxFlow", morphField.maxFlow);
      shaderProgram.setUniform("flowSize", [morphField.width, morphField.height]);
      shaderProgram.setUniform("flowPhases", morphField.phases || 1);
      shaderProgram.setUniform("flowLayers", morphField.layers || 1);
      shaderProgram.setUniform("morphStrategy", morphStrategy === "rigid" || morphStrategy === "elastic" ? 1 : morphStrategy === "fluid" ? 2 : 0);
      shaderProgram.setUniform("fitA", imageFitUniform(itemA.image, pg.width, pg.height, fit));
      shaderProgram.setUniform("fitB", imageFitUniform(itemB.image, pg.width, pg.height, fit));
      shaderProgram.setUniform("contentUvMatrix", contentTransformUvMatrices(source.contentTransform).sampling);
      drawShaderTargetRect(target, pg.width, pg.height);
      resetShaderTarget(target);
    });
    this.presentGeneratedTarget(pg, target);
  }

  drawTileTexture(pg, source = {}, componentTime = 0, renderRequest = {}) {
    const params = source.params || {};
    const imageId = params.imageId || "";
    if (!imageId) {
      drawStandby(pg, "choose a tileable texture");
      return;
    }
    const item = this.acquireMedia(imageId, { width: pg.width });
    if (!item?.image) {
      if (!item) this.requestMissingMedia(imageId);
      drawStandby(pg, item?.imageError || "loading tile texture");
      return;
    }
    const target = this.getTarget("tileTexture", pg.width, pg.height, renderRequest.pixelDensity, {
      preferSharedFramebuffer: true,
    });
    if (!this.tileTextureShader) this.tileTextureShader = target.createShader(TILE_TEXTURE_VERTEX_SHADER, TILE_TEXTURE_FRAGMENT_SHADER);
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, this.tileTextureShader);
      this.tileTextureShader.setUniform("tileImage", item.image);
      const repeat = Math.max(0.001, Number(params.repeat) || 1);
      this.tileTextureShader.setUniform("repeatAmount", [repeat, repeat]);
      this.tileTextureShader.setUniform("offsetAmount", [Number(params.offsetX) || 0, Number(params.offsetY) || 0]);
      this.tileTextureShader.setUniform("scrollSpeed", [Number(params.scrollX) || 0, Number(params.scrollY) || 0]);
      this.tileTextureShader.setUniform("time", componentTime);
      this.tileTextureShader.setUniform("contentUvMatrix", contentTransformUvMatrices(source.contentTransform).sampling);
      drawShaderTargetRect(target, pg.width, pg.height);
      resetShaderTarget(target);
    });
    this.presentGeneratedTarget(pg, target);
  }

  drawAnatomy(pg, source = {}, componentTime = 0, renderRequest = {}) {
    const params = source.params || {};
    const target = this.getModelTarget(renderRequest.width, renderRequest.height, renderRequest.pixelDensity);
    const viewport = modelViewportMetrics(target, renderRequest);
    const renderMode = params.renderMode || "surface";
    const surfaceColor = modelColor(params.surfaceColor, [217, 212, 201, 255]);
    const wireColor = modelColor(params.wireColor, [75, 73, 68, 204]);
    const wireThickness = resolutionScaledStrokeWidth(modelWireThickness(params), renderRequest);
    const rotation = modelRotation(params, componentTime);
    const detail = Math.max(4, Math.min(14, Math.round(
      (Number(params.detail) || 8) * qualityComputeMultiplier(params, { minimum: 0.55, maximum: 1.35 })
    )));
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    this.measureGpu(target, () => {
      target.push();
      target.clear();
      target.perspective?.(Math.PI / 3, viewport.width / Math.max(1, viewport.height), 0.1, 5000);
      target.camera?.(0, 0, viewport.cameraZ, 0, 0, 0, 0, 1, 0);
      target.ambientLight?.(96);
      target.directionalLight?.(238, 232, 220, -0.45, -0.55, -0.75);
      target.directionalLight?.(82, 94, 108, 0.7, 0.15, -0.35);
      applyModelContentTransform(target, source.contentTransform, viewport);
      target.rotateX(rotation[0]);
      target.rotateY(rotation[1]);
      target.rotateZ(rotation[2]);
      const scale = viewport.unitScale * modelScale * anatomyPartFitScale(params.part);
      target.scale(scale, -scale, scale * depth);
      drawProceduralAnatomy(target, params, componentTime, renderMode, surfaceColor, wireColor, wireThickness, detail);
      target.pop();
    });
    markRenderTargetOrientation(target, RENDER_TEXTURE_ORIENTATION.topLeft);
    this.presentGeneratedTarget(pg, target);
  }

  drawTerrain(pg, source = {}, componentTime = 0, renderRequest = {}) {
    const params = source.params || {};
    const target = this.getTerrainTarget(renderRequest.width, renderRequest.height, renderRequest.pixelDensity);
    const style = params.style === "wire" ? 1 : params.style === "hybrid" ? 2 : 0;
    const flightSpeed = Math.max(0, Number(params.flightSpeed) || 0);
    const flightTime = this.continuousRateTime(`${source.instanceId || source.generatorId || "terrain"}:flight`, componentTime, flightSpeed);
    const viewTransform = terrainCameraView(params, flightTime);
    const { cameraAnchor } = viewTransform;
    const scaleKey = `${source.instanceId || source.generatorId || "terrain"}:scale`;
    const scaleState = advanceSpatialScale(this.terrainScalePhases.get(scaleKey), params.terrainScale, cameraAnchor);
    this.terrainScalePhases.set(scaleKey, scaleState);
    const flightParams = {
      ...params,
      turn: viewTransform.turn,
      altitude: viewTransform.altitude,
      flightSpeed: 1,
      terrainScale: scaleState.scale,
      terrainPhase: scaleState.phase,
      contentPlacementMatrix: contentTransformUvMatrices(source.contentTransform).placement,
      gridDensity: Math.max(0.25, Math.min(4,
        (Number(params.gridDensity) || 1) * qualityComputeMultiplier(params, { minimum: 0.4, maximum: 1.5 })
      )),
    };
    const sky = normalizedModelColor(params.skyColor, [108, 165, 212, 255]);
    this.measureGpu(target, () => {
      target.push();
      target.clear();
      if (style !== 1) target.background(sky[0] * 255, sky[1] * 255, sky[2] * 255, sky[3] * 255);
      if (style !== 1) drawTerrainSurface(target, this.terrainSurfaceResources, flightParams, flightTime, target.width, target.height, style, sky);
      if (style >= 1) drawTerrainWireframe(target, this.terrainWireResources, flightParams, flightTime, target.width, target.height, renderRequest);
      target.pop();
    });
    // Camera/projected coordinates are already in screen-down Composition
    // space, but raw WebGL framebuffer storage still has a bottom-left texture
    // origin. Describe storage truthfully here; presentGeneratedTarget() owns
    // the single conversion into the top-left compositor convention.
    markRenderTargetOrientation(target, RENDER_TEXTURE_ORIENTATION.bottomLeft);
    this.presentGeneratedTarget(pg, target);
  }

  drawModel(pg, item, source = {}, componentTime = 0, renderRequest = {}) {
    const params = source.params || {};
    const target = this.getModelTarget(renderRequest.width, renderRequest.height, renderRequest.pixelDensity);
    const viewport = modelViewportMetrics(target, renderRequest);
    const renderMode = params.renderMode || "surface";
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const pointBudget = Math.max(128, Math.min(50000, Math.round(
      (Number(params.pointBudget) || 4000) * qualityComputeMultiplier(params, { minimum: 0.25, maximum: 1.75 })
    )));
    const surfaceColor = modelColor(params.surfaceColor, [220, 225, 220, 255]);
    const wireColor = modelColor(params.wireColor, [20, 20, 20, 220]);
    const wireThickness = resolutionScaledStrokeWidth(modelWireThickness(params), renderRequest);
    const rotation = modelRotation(params, componentTime);
    const gpuToken = this.gpuTimer.begin(target, this.frameIndex());
    try {
      target.push();
      target.clear();
      const scale = viewport.unitScale * modelScale;
      const rawParsedDrawn = item.modelData &&
        drawRawParsedModelMode(target, item, params, componentTime, renderMode, surfaceColor, wireColor, pointBudget, viewport, source.contentTransform);
      if (!rawParsedDrawn) {
        target.perspective?.(Math.PI / 3, viewport.width / Math.max(1, viewport.height), 0.1, 5000);
        target.camera?.(0, 0, viewport.cameraZ, 0, 0, 0, 0, 1, 0);
        target.ambientLight?.(95);
        target.directionalLight?.(220, 220, 220, -0.35, -0.45, -0.75);
        applyModelContentTransform(target, source.contentTransform, viewport);
        target.rotateX(rotation[0]);
        target.rotateY(rotation[1]);
        target.rotateZ(rotation[2]);
        target.scale(scale, scale, scale * depth);
        if (item.modelData && renderMode === "points") {
          drawPointCloud(target, ensureParsedModelPointCloud(item, pointBudget), wireColor);
        } else if (item.modelData) {
          const geometry = ensureParsedModelGeometry(item);
          if (geometry) {
            try {
              drawGeometryModel(target, geometry, renderMode, surfaceColor, wireColor, wireThickness);
            } catch (error) {
              item.modelGeometryFailed = true;
              item.modelGeometry = null;
              item.modelGeometryError = error?.message || String(error || "geometry render failed");
              drawParsedModel(target, item.modelData, renderMode, surfaceColor, wireColor, wireThickness);
            }
          } else {
            drawParsedModel(target, item.modelData, renderMode, surfaceColor, wireColor, wireThickness);
          }
        } else if (renderMode === "points") {
          drawPointCloud(target, ensureP5ModelPointCloud(item, pointBudget), wireColor);
        } else if (renderMode === "wireframe") {
          target.noFill();
          target.stroke(...wireColor);
          target.strokeWeight(wireThickness);
          target.model(item.model);
        } else {
          target.noStroke();
          target.ambientMaterial?.(...surfaceColor);
          target.fill?.(...surfaceColor);
          drawWithPolygonOffset(target, renderMode === "surfaceWire", () => target.model(item.model));
          if (renderMode === "surfaceWire") {
            target.noFill();
            target.stroke(...wireColor);
            target.strokeWeight(wireThickness);
            target.model(item.model);
          }
        }
      }
      markRenderTargetOrientation(target, rawParsedDrawn
        ? RENDER_TEXTURE_ORIENTATION.bottomLeft
        : RENDER_TEXTURE_ORIENTATION.topLeft);
      target.pop();
    } finally {
      this.gpuTimer.end(gpuToken);
    }
    this.presentGeneratedTarget(pg, target);
  }

  presentGeneratedTarget(pg, target) {
    const contextKey = pg?.__vj1ShaderContextId || pg?.drawingContext || pg;
    let shaderProgram = this.presentationShaders.get(contextKey);
    if (!shaderProgram && typeof pg?.createShader === "function") {
      try {
        shaderProgram = pg.createShader(RENDER_PASS_VERTEX_SHADER, GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER);
        this.presentationShaders.set(contextKey, shaderProgram);
      } catch (error) {
        shaderProgram = null;
        if (!this.presentationShaderFailures.has(contextKey)) {
          this.presentationShaderFailures.add(contextKey);
          console.error("[VJ1_PRESENTATION_SHADER_FAILED]", {
            target: renderTargetDescriptor(target).kind,
            fallback: "drawBuffer",
            message: error?.message || String(error || "presentation shader creation failed"),
          });
        }
      }
    }
    if (!shaderProgram || typeof pg?.drawWebGL !== "function") {
      pg.push();
      pg.clear();
      drawBuffer(pg, target, 0, 0, pg.width, pg.height, true);
      pg.pop();
      return;
    }
    const baseFlip = !isSharedFramebufferTarget(target);
    const storageFlip = renderTargetNeedsPresentationFlip(target);
    drawShaderTarget(pg, () => {
      clearShaderTarget(pg);
      applyShaderTarget(pg, shaderProgram);
      shaderProgram.setUniform("sourceTex", unwrapRenderTarget(target));
      shaderProgram.setUniform("sourceFlipY", baseFlip !== storageFlip);
      drawShaderTargetRect(pg, pg.width, pg.height);
      resetShaderTarget(pg);
    });
  }

  continuousRateTime(key, baseTime, rate) {
    const next = advanceRateClock(this.rateClocks.get(key), baseTime, rate);
    this.rateClocks.set(key, next);
    return next.time;
  }

  getModelTarget(width, height, density = 1) {
    return this.getTarget("model", width, height, density, {
      onContextDiscard: (gl) => this.resetModelResources(gl),
    });
  }

  getTerrainTarget(width, height, density = 1) {
    return this.getTarget("terrain", width, height, density, {
      onContextDiscard: () => this.resetTerrainResources(),
      preferSharedFramebuffer: true,
      depth: true,
    });
  }

  getTarget(kind, width, height, density = 1, {
    onContextDiscard = null,
    preferSharedFramebuffer = false,
    depth = false,
  } = {}) {
    const widthPx = Math.max(1, Math.round(Number(width) || 1));
    const heightPx = Math.max(1, Math.round(Number(height) || 1));
    const targetDensity = Math.max(0.25, Math.min(4, Number(density) || 1));
    let target = this.targets.get(kind);
    if (!target) {
      target = createSpecializedTarget(widthPx, heightPx, targetDensity, preferSharedFramebuffer, depth, this.applyGraphicsPixelDensity);
      this.targets.set(kind, target);
      return target;
    }
    const sizeChanged = target.width !== widthPx || target.height !== heightPx;
    const densityChanged = target.__vj1PixelDensity !== targetDensity;
    if (sizeChanged || densityChanged) {
      try {
        if (sizeChanged) target.resizeCanvas(widthPx, heightPx);
        if (!isSharedFramebufferTarget(target)) this.applyGraphicsPixelDensity(target, targetDensity);
      } catch (error) {
        console.error("[VJ1_SPECIALIZED_TARGET_RESIZE_FAILED]", {
          kind,
          width: widthPx,
          height: heightPx,
          density: targetDensity,
          fallback: "recreate-target",
          message: error?.message || String(error || "specialized target resize failed"),
        });
        onContextDiscard?.(target?.drawingContext);
        disposeGraphics(target);
        target = createSpecializedTarget(widthPx, heightPx, targetDensity, preferSharedFramebuffer, depth, this.applyGraphicsPixelDensity);
        this.targets.set(kind, target);
      }
      target.__vj1PixelDensity = targetDensity;
      if (!isSharedFramebufferTarget(target)) target.noStroke();
    }
    return target;
  }

  resetTerrainResources() {
    for (const [gl, resources] of this.terrainSurfaceResources) disposeTerrainSurfaceResources(gl, resources);
    for (const [gl, resources] of this.terrainWireResources) disposeTerrainWireResources(gl, resources);
    this.terrainSurfaceResources.clear();
    this.terrainWireResources.clear();
  }

  resetModelResources(gl = null) {
    for (const item of this.media()?.values?.() || []) {
      disposeRawModelItemResources(item, gl);
    }
  }

  dispose() {
    this.resetModelResources();
    this.resetTerrainResources();
    disposeGraphicsMap(this.targets);
    this.rateClocks.clear();
    this.terrainScalePhases.clear();
    this.featureMorphShader = null;
    this.featureMorphV2Shader = null;
    this.tileTextureShader = null;
    this.presentationShaders.clear();
    this.presentationShaderFailures.clear();
  }
}

function createSpecializedTarget(width, height, density, preferSharedFramebuffer, depth, applyDensity) {
  const target = (preferSharedFramebuffer ? createSharedFramebufferTarget(width, height, { depth }) : null)
    || createGraphics(width, height, WEBGL);
  if (!isSharedFramebufferTarget(target)) applyDensity(target, density);
  target.__vj1PixelDensity = density;
  if (!isSharedFramebufferTarget(target)) target.noStroke();
  return target;
}

export function terrainCameraView(params = {}, flightTime = 0) {
  const turn = Math.max(-1, Math.min(1, Number(params.turn) || 0));
  const yaw = turn * 0.72;
  return {
    turn,
    altitude: Math.max(0.2, Number(params.altitude) || 2.5),
    cameraAnchor: [
      Math.sin(yaw) * flightTime * 7,
      Math.cos(yaw) * flightTime * 7,
    ],
  };
}

function featureMorphFlowImage(field = {}) {
  if (field.flowImage) return field.flowImage;
  const image = createImage(field.width, field.height * (field.phases || 1) * (field.layers || 1));
  image.loadPixels();
  image.pixels.set(field.pixels);
  image.updatePixels();
  field.flowImage = image;
  return image;
}

function applyModelContentTransform(target, transform = {}, viewport = {}) {
  if (isIdentityTransform(transform)) return;
  const value = normalizedContentTransform(transform);
  const width = Math.max(1, Number(viewport.width) || Number(target?.width) || 1);
  const height = Math.max(1, Number(viewport.height) || Number(target?.height) || 1);
  target.translate(value.x * width * 0.5, value.y * height * 0.5, 0);
  target.rotateZ(value.rotation);
  target.scale(value.scale, value.scale, value.scale);
}

function drawShaderTarget(target, draw) {
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

function clearShaderTarget(target) {
  if (isSharedFramebufferTarget(target)) clear();
  else target.clear();
}

function applyShaderTarget(target, shaderProgram) {
  if (isSharedFramebufferTarget(target)) shader(shaderProgram);
  else target.shader(shaderProgram);
}

function resetShaderTarget(target) {
  if (isSharedFramebufferTarget(target)) resetShader();
  else target.resetShader();
}

function drawShaderTargetRect(target, width, height) {
  if (isSharedFramebufferTarget(target)) rect(-width / 2, -height / 2, width, height);
  else target.rect(-width / 2, -height / 2, width, height);
}

function disposeGraphicsMap(map) {
  const seen = new Set();
  for (const item of map.values()) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    disposeGraphics(item);
  }
  map.clear();
}

function disposeGraphics(item) {
  try {
    item?.remove?.();
  } catch {}
}
