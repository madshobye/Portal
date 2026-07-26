import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listEffectNodeComponents, listGeneratorNodeComponents } from "../js/libraries/visual-nodes/index.js";
import { BuiltInIsfRepository } from "../js/libraries/visual-library/built-in-isf-repository.js";

const jsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../js");
const vjRoot = resolve(jsRoot, "..");
const libraryRoot = resolve(jsRoot, "libraries");
const modules = collectModules(jsRoot);
const moduleSet = new Set(modules);
const graph = new Map(modules.map((filename) => [filename, localImports(filename)]));

test("JavaScript modules have an acyclic static dependency graph", () => {
  const cycles = findCycles(graph);
  assert.deepEqual(cycles, [], cycles.map((cycle) => cycle.map(moduleName).join(" -> ")).join("\n"));
});

test("ordinary compiled Groups are the only visual compound authority", () => {
  const obsoleteAuthority = [];
  for (const filename of modules) {
    const source = readFileSync(filename, "utf8");
    if (
      source.includes("nativeCompoundProgram") ||
      source.includes("vj1.visual.specialized-compound") ||
      source.includes("compileSpecializedCompoundProgram") ||
      source.includes("defineSpecializedVisualCompound")
    ) {
      obsoleteAuthority.push(moduleName(filename));
    }
  }
  assert.deepEqual(obsoleteAuthority, []);
  assert.equal(
    moduleSet.has(resolve(libraryRoot, "visual-nodes/shared/specialized-compound.js")),
    false,
  );
  assert.equal(
    moduleSet.has(resolve(libraryRoot, "visual-nodes/shared/specialized-compound-types.js")),
    false,
  );
});

test("optimized output reads compiled programs instead of compatibility chains", () => {
  const allowedProjectionModules = new Set([
    "output/component-preview-interaction.js",
    "output/embedded-preview-app.js",
    "output/preview-interaction-geometry.js",
  ]);
  const rawChainReaders = [];
  const legacyProjectionImports = [];
  for (const filename of modules) {
    const name = moduleName(filename);
    const source = readFileSync(filename, "utf8");
    if (
      name.startsWith("output/") &&
      !allowedProjectionModules.has(name) &&
      /\bcomponent\??\.chain\b|\bitem\.chain\b/.test(source)
    ) {
      rawChainReaders.push(name);
    }
    if (
      name !== "graph/legacy-chain-render-projection.js" &&
      source.includes("legacy-chain-render-projection.js")
    ) {
      legacyProjectionImports.push(name);
    }
  }
  assert.deepEqual(rawChainReaders, []);
  assert.deepEqual(legacyProjectionImports, []);
  assert.equal(moduleSet.has(resolve(jsRoot, "graph/render-scheduler.js")), false);
  assert.equal(moduleSet.has(resolve(jsRoot, "graph/shader-scheduler.js")), true);
  assert.match(
    readFileSync(resolve(jsRoot, "output/output-thumbnail-runtime.js"), "utf8"),
    /getComponentProgram/,
  );
});

test("browser source loading bypasses caches for the complete native module graph on ordinary refresh", () => {
  const index = readFileSync(resolve(vjRoot, "index.html"), "utf8");
  const worker = readFileSync(resolve(vjRoot, "module-source-worker.js"), "utf8");
  const terrainFacade = readFileSync(resolve(libraryRoot, "terrain-engine/index.js"), "utf8");

  assert.match(index, /module-source-worker\.js/);
  assert.match(index, /updateViaCache:\s*"none"/);
  assert.match(index, /navigator\.serviceWorker\.ready/);
  assert.match(index, /navigator\.serviceWorker\.controller/);
  assert.match(index, /controller\?\.scriptURL === workerUrl/);
  assert.match(index, /controllerchange/);
  assert.match(index, /VJ1_SOURCE_COHERENCE_BLOCKED/);
  assert.match(index, /import\("\.\/js\/app\.js"\)/);
  assert.match(index, /data-vj1-startup-status/);
  assert.match(index, /Loading application modules/);
  assert.doesNotMatch(index, /<script[^>]+type="module"[^>]+src="js\/app\.js/);
  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.match(worker, /self\.clients\.claim\(\)/);
  assert.match(worker, /fetch\(request,\s*\{\s*cache:\s*"no-store"\s*\}\)/);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(terrainFacade, /\.\/geometry-provider\/index\.js/);
  assert.match(terrainFacade, /\.\/flight-controller\/index\.js/);
});

test("the global source revision is the only cache authority for local JavaScript modules", () => {
  const versionedModuleEdges = [];
  for (const filename of modules) {
    const source = readFileSync(filename, "utf8");
    if (/\.js\?v=/.test(source)) versionedModuleEdges.push(moduleName(filename));
  }

  assert.deepEqual(
    versionedModuleEdges,
    [],
    [
      "Per-import query revisions create multiple browser module instances for one file.",
      "That duplicates startup work and splits module-level registries and singleton state.",
      "Bump the source worker revision in index.html instead; it owns graph-wide freshness.",
    ].join(" "),
  );
});

test("domain and graph modules do not depend on application, UI, services, or output runtimes", () => {
  const violations = [];
  for (const [filename, dependencies] of graph) {
    const layer = moduleName(filename).split("/")[0];
    if (layer !== "domain" && layer !== "graph") continue;
    for (const dependency of dependencies) {
      const dependencyLayer = moduleName(dependency).split("/")[0];
      if (["app-state.js", "app.js", "control", "metrics", "output", "services"].includes(dependencyLayer)) {
        violations.push(`${moduleName(filename)} -> ${moduleName(dependency)}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("node engine and capability libraries do not delegate into application internals", () => {
  const violations = [];
  for (const [filename, dependencies] of graph) {
    const owner = moduleName(filename);
    if (!owner.startsWith("libraries/")) continue;
    for (const dependency of dependencies) {
      const target = moduleName(dependency);
      if (!target.startsWith("libraries/") && !target.startsWith("vendor/")) {
        violations.push(`${owner} -> ${target}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("output and preview hot paths use node-owned algorithms without node-runtime overhead", () => {
  const renderer = readFileSync(resolve(jsRoot, "output/output-renderer.js"), "utf8");
  const componentRenderRuntime = readFileSync(resolve(jsRoot, "output/component-render-runtime.js"), "utf8");
  const visualPlanRuntime = readFileSync(resolve(jsRoot, "output/visual-plan-runtime.js"), "utf8");
  const compositeRenderRuntime = readFileSync(resolve(jsRoot, "output/composite-render-runtime.js"), "utf8");
  const componentProgramCompiler = readFileSync(resolve(libraryRoot, "composition-engine/shared/component-program-compiler.js"), "utf8");
  const shaderEffectRuntime = readFileSync(resolve(jsRoot, "output/shader-effect-runtime.js"), "utf8");
  const shaderGeneratorRuntime = readFileSync(resolve(jsRoot, "output/shader-generator-runtime.js"), "utf8");
  const mediaRuntime = readFileSync(resolve(jsRoot, "output/output-media-runtime.js"), "utf8");
  const renderEvaluationRuntime = readFileSync(resolve(jsRoot, "output/render-evaluation-runtime.js"), "utf8");
  const renderTargetRuntime = readFileSync(resolve(jsRoot, "output/render-target-runtime.js"), "utf8");
  const renderRequestRuntime = readFileSync(resolve(jsRoot, "output/render-request-runtime.js"), "utf8");
  const presentationMetrics = readFileSync(resolve(jsRoot, "output/output-presentation-metrics.js"), "utf8");
  const presentationGeometry = readFileSync(resolve(jsRoot, "output/presentation-geometry-runtime.js"), "utf8");
  const outputReadiness = readFileSync(resolve(jsRoot, "output/output-readiness-runtime.js"), "utf8");
  const outputFrameRuntime = readFileSync(resolve(jsRoot, "output/output-frame-runtime.js"), "utf8");
  const liveRenderPatchRuntime = readFileSync(resolve(jsRoot, "output/live-render-patch-runtime.js"), "utf8");
  const visualNodeRuntime = readFileSync(resolve(jsRoot, "output/visual-node-runtime.js"), "utf8");
  const outputMappingRuntime = readFileSync(resolve(jsRoot, "output/output-mapping-runtime.js"), "utf8");
  const controlSignalRuntime = readFileSync(resolve(jsRoot, "output/control-signal-runtime.js"), "utf8");
  const outputPresentationRuntime = readFileSync(resolve(jsRoot, "output/output-presentation-runtime.js"), "utf8");
  const outputResourceRuntime = readFileSync(resolve(jsRoot, "output/output-resource-runtime.js"), "utf8");
  const outputStateRuntime = readFileSync(resolve(jsRoot, "output/output-state-runtime.js"), "utf8");
  const sourceRuntime = readFileSync(resolve(jsRoot, "output/source-render-runtime.js"), "utf8");
  const previewInteraction = readFileSync(resolve(jsRoot, "output/component-preview-interaction.js"), "utf8");
  const thumbnailRuntime = readFileSync(resolve(jsRoot, "output/output-thumbnail-runtime.js"), "utf8");
  const isfRuntime = readFileSync(resolve(jsRoot, "output/isf-render-runtime.js"), "utf8");
  const surfaceRuntime = readFileSync(resolve(jsRoot, "output/output-surface-runtime.js"), "utf8");
  const surfacePlanner = readFileSync(resolve(jsRoot, "output/surface-render-planner.js"), "utf8");
  const app = readFileSync(resolve(jsRoot, "app.js"), "utf8");
  const outputBranch = app.slice(app.indexOf('if (mode === "output"'), app.indexOf("} else {"));
  const hotPath = `${renderer}\n${outputPresentationRuntime}\n${componentRenderRuntime}\n${visualPlanRuntime}\n${compositeRenderRuntime}\n${shaderEffectRuntime}\n${shaderGeneratorRuntime}\n${surfaceRuntime}\n${surfacePlanner}\n${outputBranch}`;

  assert.doesNotMatch(hotPath, /\b(?:NodeInstance|NodeGraphProgram|NodeCompilerRegistry|createNodeInstance|createNodePacket|createVj1NodePackage)\b/);
  assert.doesNotMatch(hotPath, /(?:\.\.\/)+node\/node-runtime\.js|app-node-package\.js/);
  assert.match(surfacePlanner, /export const planSurfaceRoutes = createSurfaceCompositionEngine\(/);
  assert.match(shaderEffectRuntime, /fuseLocalShaderSchedule\(logicalSchedule\)/);
  assert.match(shaderGeneratorRuntime, /class ShaderGeneratorRuntime/);
  assert.match(shaderGeneratorRuntime, /drawShaderTarget\(target,/);
  assert.match(sourceRuntime, /host\.shaderGeneratorRuntime\.draw\(/);
  assert.match(mediaRuntime, /class OutputMediaRuntime/);
  assert.match(mediaRuntime, /^  acquireMediaById\(/m);
  assert.match(mediaRuntime, /^  acquireDrawableResource\(/m);
  assert.match(mediaRuntime, /^  drawableResourceError\(/m);
  assert.match(controlSignalRuntime, /class ControlSignalRuntime/);
  assert.match(controlSignalRuntime, /class MidiControlAdapter/);
  assert.match(controlSignalRuntime, /class AudioControlAdapter/);
  assert.match(controlSignalRuntime, /class OscControlAdapter/);
  assert.match(controlSignalRuntime, /navigator\.requestMIDIAccess/);
  assert.match(controlSignalRuntime, /getUserMedia/);
  assert.match(controlSignalRuntime, /decodeOscPacketView/);
  assert.match(controlSignalRuntime, /scheduleReconnect/);
  assert.match(renderer, /new ControlSignalRuntime\(/);
  assert.match(sourceRuntime, /this\.mediaRuntime\.acquireMediaById\(/);
  assert.match(sourceRuntime, /this\.mediaRuntime\.acquireDrawableResource\(/);
  assert.doesNotMatch(
    renderer,
    /^  (?:acquireMedia|acquireCameraInput|acquireScreenInput|releaseCameraInput|screenError|requestMissingMedia|requestMissingMediaBatch|getImageRendition|queueMediaRenditionSave)\(/m,
  );
  assert.match(renderer, /new SpecializedSourceRuntime\(/);
  assert.match(outputResourceRuntime, /createSharedFramebufferTarget\(/);
  assert.match(componentRenderRuntime, /stableSignatures/);
  assert.match(componentRenderRuntime, /program\.execute\(/);
  assert.match(componentProgramCompiler, /renderHost\?\.visualPlanRuntime/);
  assert.match(componentProgramCompiler, /runtime\.execute\(this\.plan/);
  assert.doesNotMatch(componentProgramCompiler, /renderHost\.executeVisualRenderPlan/);
  assert.match(visualPlanRuntime, /for \(let index = 0; index < \(operations \|\| \[\]\)\.length; index\+\+\)/);
  assert.match(visualPlanRuntime, /compileShaderSchedule\(/);
  assert.match(visualPlanRuntime, /host\.compositeRuntime\.renderLayerNodeState\(/);
  assert.match(visualPlanRuntime, /host\.compositeRuntime\.renderBoundedEffectRunNodeState\(/);
  assert.match(visualPlanRuntime, /host\.shaderEffectRuntime\.renderNodeState\(/);
  assert.match(visualPlanRuntime, /host\.shaderEffectRuntime\.renderRunNodeState\(/);
  assert.match(compositeRenderRuntime, /inputState\?\.transparent === true/);
  assert.match(compositeRenderRuntime, /nodeRoiRequest\(/);
  assert.match(compositeRenderRuntime, /host\.shaderEffectRuntime\.renderNodeState\(/);
  assert.match(compositeRenderRuntime, /output\.blendMode\(globalThis\.REPLACE/);
  assert.match(shaderEffectRuntime, /host\.renderEvaluationRuntime\.evaluate\(/);
  assert.match(shaderEffectRuntime, /^  setInfrastructureUniforms\(/m);
  assert.match(shaderEffectRuntime, /^  measurePass\(/m);
  assert.match(compositeRenderRuntime, /^  drawChainLayer\(/m);
  assert.match(compositeRenderRuntime, /^  drawTransformedLayerFallback\(/m);
  assert.doesNotMatch(
    renderer,
    /^  (?:getCachedNoiseTexture|setEffectInfrastructureUniforms|measureShaderPass|drawChainLayer|drawTransformedLayerFallback)\(/m,
  );
  assert.match(renderEvaluationRuntime, /new RenderNodeRuntime\(/);
  assert.match(renderEvaluationRuntime, /host\.renderTargetRuntime\.gpu\(/);
  assert.match(renderTargetRuntime, /class RenderTargetRuntime/);
  assert.match(renderRequestRuntime, /class RenderRequestRuntime/);
  assert.match(presentationMetrics, /class OutputPresentationMetrics/);
  assert.match(presentationMetrics, /^  recordPresentedRequest\(/m);
  assert.match(presentationMetrics, /^  update\(/m);
  assert.match(surfaceRuntime, /renderer\.presentationMetrics\.recordPresentedRequest\(/);
  assert.match(presentationGeometry, /class PresentationGeometryRuntime/);
  assert.match(presentationGeometry, /^  viewportTransform\(/m);
  assert.match(presentationGeometry, /^  worldPointToDisplay\(/m);
  assert.match(presentationGeometry, /^  displayPointToWorld\(/m);
  assert.match(presentationGeometry, /^  mappingForMode\(/m);
  assert.match(surfaceRuntime, /renderer\.presentationGeometry\.viewportTransform\(/);
  assert.match(outputReadiness, /class OutputReadinessRuntime/);
  assert.match(outputReadiness, /^  prepare\(/m);
  assert.match(outputReadiness, /^  forState\(/m);
  assert.match(outputReadiness, /^  isBlackout\(/m);
  assert.match(outputReadiness, /^  shouldHoldFrame\(/m);
  assert.match(surfaceRuntime, /renderer\.readinessRuntime\.isBlackout\(/);
  assert.match(outputFrameRuntime, /class OutputFrameRuntime/);
  assert.match(outputFrameRuntime, /^  tickClock\(/m);
  assert.match(outputFrameRuntime, /^  presentationMode\(/m);
  assert.match(outputFrameRuntime, /^  pruneCaches\(/m);
  assert.match(outputPresentationRuntime, /host\.frameRuntime\.begin\(performance\.now\(\)\)/);
  assert.match(outputPresentationRuntime, /^  finishFrame\(/m);
  assert.match(outputPresentationRuntime, /this\.gpuTimer\.poll\(host\.frameRuntime\.frameIndex\)/);
  assert.match(outputPresentationRuntime, /this\.gpuTimer\.sealFrame\(host\.frameRuntime\.frameIndex\)/);
  assert.doesNotMatch(outputFrameRuntime, /gpuTimer/);
  assert.match(liveRenderPatchRuntime, /class LiveRenderPatchRuntime/);
  assert.match(liveRenderPatchRuntime, /^  applyLive\(/m);
  assert.match(liveRenderPatchRuntime, /^  apply\(/m);
  assert.match(liveRenderPatchRuntime, /^  applyFrame\(/m);
  assert.match(liveRenderPatchRuntime, /^  restoreFrame\(/m);
  assert.match(liveRenderPatchRuntime, /^  clear\(/m);
  assert.match(renderer, /this\.livePatchRuntime = new LiveRenderPatchRuntime\(this\)/);
  assert.match(outputFrameRuntime, /host\.livePatchRuntime\.active/);
  assert.doesNotMatch(
    renderer,
    /^  (?:applyLivePatches|applyRenderPatches|applyLiveParamFadeFrame|restoreLiveParamFadeFrame|clearLiveParamFades)\(/m,
  );
  assert.doesNotMatch(renderer, /this\.liveParamFades\s*=|this\.liveParamFadeRestores\s*=/);
  assert.match(visualNodeRuntime, /class VisualNodeRuntime/);
  assert.match(visualNodeRuntime, /^  rebuild\(/m);
  assert.match(visualNodeRuntime, /^  setInstalledPackages\(/m);
  assert.match(visualNodeRuntime, /createProjectVisualNodeResolver\(/);
  assert.match(renderer, /this\.visualNodeRuntime = new VisualNodeRuntime\(this,/);
  assert.match(sourceRuntime, /host\.visualNodeRuntime\.generator\(/);
  assert.match(visualPlanRuntime, /host\.visualNodeRuntime\.effect\(/);
  assert.match(shaderEffectRuntime, /host\.visualNodeRuntime\.resolverOptions/);
  assert.doesNotMatch(
    renderer,
    /^  (?:rebuildVisualNodeResolver|effectNodeComponent|generatorNodeComponent|generatorShaderComponent|setInstalledNodePackages)\(/m,
  );
  assert.doesNotMatch(
    renderer,
    /this\.(?:visualNodes|visualResolverOptions|visualForkSignature|installedNodePackages|installedNodePackageSignature)\s*=/,
  );
  assert.match(outputMappingRuntime, /class OutputMappingRuntime/);
  assert.match(outputMappingRuntime, /^  reconcileState\(/m);
  assert.match(outputMappingRuntime, /^  rebuildSurfaces\(/m);
  assert.match(outputMappingRuntime, /^  shouldIgnoreIncoming\(/m);
  assert.match(outputMappingRuntime, /^  finishInteraction\(/m);
  assert.match(renderer, /this\.mappingRuntime = new OutputMappingRuntime\(this,/);
  assert.match(surfaceRuntime, /renderer\.mappingRuntime\.mapper/);
  assert.match(surfaceRuntime, /renderer\.mappingRuntime\.surfaces/);
  assert.doesNotMatch(
    renderer,
    /^  (?:rebuildSurfaces|syncMapperOverlayMode|shouldCalibrateFromState|currentMappingSignature|applyProjectMapping|markLocalMapping|shouldIgnoreIncomingMapping|emitMapping|setCalibrate|isCalibrating|saveMapping|loadMapping|resetMapping|exportMapping)\(/m,
  );
  assert.doesNotMatch(
    renderer,
    /this\.(?:mapper|mapperSurfaces|mappingSignature|localMappingSignature|pendingMappingSignature|pendingMappingStartedAt|mappingAckWarningSignature|surfaceRebuildPending)\s*=/,
  );
  assert.match(outputPresentationRuntime, /class OutputPresentationRuntime/);
  assert.match(outputPresentationRuntime, /^  drawFrame\(/m);
  assert.match(outputPresentationRuntime, /^  renderComponents\(/m);
  assert.match(outputPresentationRuntime, /^  renderComponentPreview\(/m);
  assert.match(outputPresentationRuntime, /^  renderSelectedSurfaceOverlay\(/m);
  assert.match(outputPresentationRuntime, /^  measureGpu\(/m);
  assert.match(renderer, /this\.presentationRuntime = new OutputPresentationRuntime\(this\)/);
  assert.match(renderer, /^  draw\(\) \{\s*return this\.presentationRuntime\.draw\(\);\s*\}/m);
  assert.doesNotMatch(
    renderer,
    /^  (?:drawFrame|measureGpu|renderSelectedSurfaceOverlay|renderMappingFrameOverlay|renderSelectedDirectOutputFrameOverlay|drawOutputFrameBoundaries|shouldRevealSurfaceOverlay|renderComponents|renderThumbnailComponents|neededComponentIds|renderComponentPreview|renderFlattenedThumbnailEditPreview|renderSceneThumbnailSnapshotPreview|componentPreviewRect|shouldUseThumbnailPreview)\(/m,
  );
  assert.doesNotMatch(
    renderer,
    /^  (?:componentProgramDependencyClosureIsIncomplete|syncComponentProgramConfiguration|rebuildComponentPrograms|compileComponentProgramsForState|validateComponentPrograms|clearPreparedOutputPrograms|rebuildMappingPrograms|mappingProgramSurfaces|componentProgramChain|rebuildRouteLookups|refreshComponentLookup|componentForId|resolveRouteSourceNode)\(/m,
  );
  assert.match(renderTargetRuntime, /host\.renderRequestRuntime\.normalize\(/);
  assert.match(sourceRuntime, /host\.renderRequestRuntime\.normalize\(/);
  assert.match(shaderGeneratorRuntime, /host\.renderRequestRuntime\.normalize\(/);
  assert.match(shaderEffectRuntime, /host\.renderRequestRuntime\.normalize\(/);
  assert.doesNotMatch(
    renderer,
    /^  (?:normalizeRenderRequest|requestPixelDensity|setControlSignals|renderResolutionSize|renderResolutionLabel|previewDiagnosticHudMarkup|outputRenderChainHudMarkup|recordPresentedRenderRequest|updateHudAndMetrics|updateSmoothedMetrics|updateGpuMetric|renderSizeSignature|outputFrameSize|displayCanvasSize|renderPixelDensity|previewViewportZoomLabel|previewViewportTransform|setPreviewViewport|assignPreviewViewport|withPreviewViewportTransform|previewDisplayPointToWorld|directSurfaceCorners|projectMappingSurfaceCorners|worldPointToDisplay|displayPointToWorld|mappingForRenderMode|mappingFromRenderMode|outputFrameTransform|outputFrameOffset|mappingProjectRender|outputMediaReadiness|prepareOutputState|clearPreparedOutputState|mediaReadinessForState|isOutputBlackout|shouldHoldOutputFrameForMedia)\(/m,
  );
  assert.match(renderTargetRuntime, /this\.gpuTargets\.get\(key\)/);
  assert.match(renderTargetRuntime, /host\.resourceRuntime\.renderCache\.touch\("gpu-buffer"/);
  assert.match(outputResourceRuntime, /class OutputResourceRuntime/);
  assert.match(outputResourceRuntime, /^  createBuffers\(/m);
  assert.match(outputResourceRuntime, /^  disposeBuffers\(/m);
  assert.match(outputResourceRuntime, /^  applyGraphicsPixelDensity\(/m);
  assert.match(renderer, /this\.resourceRuntime = new OutputResourceRuntime\(this, \{ font \}\)/);
  assert.doesNotMatch(
    renderer,
    /^  (?:applyGlobalFont|applyGraphicsFont|applyFontToAllGraphics|createBuffers|buffersMatchRenderSize|disposeBuffers|applyPixelDensity|applyGraphicsPixelDensity)\(/m,
  );
  assert.doesNotMatch(
    renderer,
    /this\.(?:renderCache|componentSource|componentOutput|sourcePg|mainMix|lastPixelDensity)\s*=/,
  );
  assert.match(outputStateRuntime, /class OutputStateRuntime/);
  assert.match(outputStateRuntime, /^  initialize\(/m);
  assert.match(outputStateRuntime, /^  activate\(/m);
  assert.match(outputStateRuntime, /^  rebuildCompiledState\(/m);
  assert.match(renderer, /this\.stateRuntime = new OutputStateRuntime\(this\)/);
  assert.match(renderer, /^  setState\([^)]*\)[^{]*\{\s*return this\.stateRuntime\.activate\(/m);
  assert.doesNotMatch(renderer, /sanitizeState\(/);
  assert.doesNotMatch(renderer, /cameraSettingsSignature\(/);
  assert.doesNotMatch(
    renderer,
    /this\.(?:visualNodeRuntime|transitionRuntime|componentProgramRuntime|mappingProgramRuntime)\.rebuild\(/,
  );
  assert.match(renderTargetRuntime, /^  isShaderBuffer\(/m);
  assert.match(renderTargetRuntime, /isSharedFramebufferTarget\(buffer\)/);
  assert.match(compositeRenderRuntime, /renderTargetRuntime\.isShaderBuffer\(/);
  assert.match(shaderEffectRuntime, /renderTargetRuntime\.isShaderBuffer\(/);
  assert.match(sourceRuntime, /renderTargetRuntime\.isShaderBuffer\(/);
  assert.match(compositeRenderRuntime, /this\.host\.renderTargetRuntime\.gpu\(/);
  assert.doesNotMatch(renderer, /^  (?:getComponentBuffer|getComponentGpuBuffer|materializeDrawableBuffer|isShaderBuffer)\(/m);
  assert.doesNotMatch(renderer, /this\.componentBuffer\s*=|this\.componentGpuBuffer\s*=/);
  assert.doesNotMatch(
    renderer,
    /^  (?:get|set) (?:componentPrograms|preparedOutputPrograms|runtimeComponents|componentById|routeSourceNodeById|stableComponentSignatures|renderResolutionTraces|renderResolutionTraceStack|activeRenderResolutionTrace|lastRenderResolutionTrace|mappingPrograms|outputProgram|mappingProgramCache)\(/m,
  );
  assert.doesNotMatch(renderer, /^  (?:stableComponentSignature|componentIsFrameDynamic)\(/m);
  assert.doesNotMatch(renderer, /^  evaluateChainNode\(/m);
  assert.match(shaderEffectRuntime, /host\.compositeRuntime\.renderLayerNodeState\(/);
  assert.doesNotMatch(renderer, /for \(let index = 0; index < \(operations \|\| \[\]\)\.length; index\+\+\)/);
  assert.doesNotMatch(renderer, /compileShaderSchedule\(/);
  assert.doesNotMatch(renderer, /output\.translate\(-roi\.sampleX,\s*-roi\.sampleY\)/);
  assert.doesNotMatch(
    renderer,
    /^  (?:transparentChainState|renderLayerNodeState|renderBoundedLayerNodeState|renderFullFrameEffectWithinBoundary|renderBoundedEffectRunNodeState|extractNodeRegionState|compositeNodeRegionState|drawNodeRegionGeometry|renderLayerContentTransformState|renderEffectNodeState|renderEffectRunNodeState|effectPassIsFrameDynamic|drawShaderGenerator|renderShaderGeneratorSource|continuousRateTime|renderComponentAtSize|renderComponentForRequest|renderComponentForResolvedRequest|withRenderResolutionTrace|useCachedRenderResolutionTrace|aliasCurrentRenderResolutionTrace|recordRenderChainResolution|cacheComponentOutput|storeStableComponentOutput|renderCompiledComponent|renderComponentChain|renderComponentChainItems|executeVisualRenderPlan|executeVisualTextureDag|textureDagInputState|textureDagInputStates|renderTextureOperatorState|renderRetainedTextureOperatorState|renderComponentChainState|renderComponentOperationsState|compiledVisualGroupInputStates|compiledVisualGroupOutputStates|nodeRuntimeContext)\(/m,
  );
  assert.match(sourceRuntime, /componentRenderRuntime\.render\(/);
  assert.match(previewInteraction, /class ComponentPreviewInteraction/);
  assert.match(outputPresentationRuntime, /host\.previewInteraction\.renderComponentFrameOverlay\(component, source\)/);
  assert.doesNotMatch(
    renderer,
    /^  (?:renderComponentFrameOverlay|renderSceneSurfaces|surfaceRects|renderSelectedChainTransformOverlay|startSurfaceDrag|updateSurfaceDrag|applyLocalSurface|selectedTransformableChainItem|chainItemAtPoint|selectChainItemAtPoint|selectedChildOwnsGroupDrag|chainItemBaseRect|chainItemPreviewGeometry|startChainTransformDrag|updateChainTransformDrag|applyLocalChainTransform)\(/m,
  );
  assert.doesNotMatch(renderer, /^  get (?:chainTransformDrag|surfaceDrag)\(/m);
  assert.match(thumbnailRuntime, /class OutputThumbnailRuntime/);
  assert.match(outputPresentationRuntime, /host\.thumbnailRuntime\.getThumbnailImage\(component\)/);
  assert.match(surfaceRuntime, /renderer\.thumbnailRuntime\.getThumbnailImage\(component\)/);
  assert.doesNotMatch(
    renderer,
    /^  (?:getThumbnailImage|captureThumbnailEditTransformBaselines|captureSelectedComponentThumbnail|setThumbnailInteractionActive)\(/m,
  );
  assert.doesNotMatch(renderer, /^  get thumbnailEditTransformBaselines\(/m);
  assert.doesNotMatch(thumbnailRuntime, /^  captureSelectedComponentThumbnail\(/m);
  assert.match(isfRuntime, /class IsfRenderRuntime/);
  assert.match(outputFrameRuntime, /host\.isfRuntime\.prune\(RENDER_CACHE_IDLE_FRAMES\)/);
  assert.doesNotMatch(
    renderer,
    /^  (?:disposeIsfPassTargets|getIsfPassTarget|pruneIsfPassTargets)\(/m,
  );
  assert.match(surfaceRuntime, /componentRenderRuntime\.render\(/);
  assert.match(outputPresentationRuntime, /host\.surfaceRuntime\.renderSurfaces\(\)/);
  assert.doesNotMatch(
    renderer,
    /^  (?:renderSurfaces|renderMappingSurfaces|withRenderState|withSurfaceRenderIdentityPrefix|buildSurfaceRenderPlan|getSurfaceTexture|drawDirectSurfaceTexture|canDirectProjectSurfaceRoute|renderSurfaceRouteView|drawSurfaceRouteView|drawSurfaceRouteViewBatch|drawDirectSurfaceView|drawSurfaceRoute|drawSurfaceThumbnailRoute)\(/m,
  );
  assert.match(surfaceRuntime, /^  renderSurfaceRouteView\(/m);
  assert.match(surfaceRuntime, /^  drawDirectSurfaceView\(/m);
});

test("visual nodes own their definitions instead of using aggregate manifests", () => {
  const renderer = readFileSync(resolve(jsRoot, "output/output-renderer.js"), "utf8");
  const componentRenderRuntime = readFileSync(resolve(jsRoot, "output/component-render-runtime.js"), "utf8");
  for (const removed of [
    "graph/generator-source-manifest.js",
    "graph/visual-node-catalog.js",
    "shaders/effect-source-manifest.js",
    "shaders/generator-shaders.js",
  ]) assert.equal(moduleSet.has(resolve(jsRoot, removed)), false, `${removed} must not return`);
  const generatorNodes = collectModules(resolve(libraryRoot, "visual-nodes/generators"));
  const effectNodes = collectModules(resolve(libraryRoot, "visual-nodes/effects"));
  const generatorEntries = generatorNodes.filter((filename) => filename.endsWith(`${sep}index.js`));
  const effectEntries = effectNodes.filter((filename) => filename.endsWith(`${sep}index.js`));
  const fileBackedGenerators = BuiltInIsfRepository.records.filter((record) => record.artifactType === "generator");
  const fileBackedEffects = BuiltInIsfRepository.records.filter((record) => record.artifactType === "effect");
  assert.equal(generatorEntries.length + fileBackedGenerators.length, listGeneratorNodeComponents().length);
  assert.equal(effectEntries.length + fileBackedEffects.length, listEffectNodeComponents().length);
  assert.deepEqual(
    BuiltInIsfRepository.records.map((record) => record.definition.metadata.builtInAssetDefinition),
    BuiltInIsfRepository.records.map(() => true),
  );
  // A node may split a substantial implementation into private sibling
  // modules, but every such module must remain inside a folder with one public
  // node entry point.
  for (const filename of [...generatorNodes, ...effectNodes]) {
    assert.equal(moduleSet.has(resolve(dirname(filename), "index.js")), true, `${moduleName(filename)} needs a sibling node entry point`);
  }
  assert.equal(moduleSet.has(resolve(jsRoot, "graph/visual-node-adapter.js")), false);
  assert.doesNotMatch(renderer, /return component\.chain \|\| \[\]/);
  assert.match(componentRenderRuntime, /VJ1_COMPONENT_PROGRAM_MISSING/);
});

test("every code generator or compiled visual Group exposes its real executable owner", () => {
  const compiledGroups = listGeneratorNodeComponents().filter((component) =>
    component.nodeDefinition.implementation.kind === "group" &&
    component.nodeDefinition.implementation.executionModel === "compiled-graph"
  );
  const codeGenerators = listGeneratorNodeComponents().filter((component) =>
    component.nodeDefinition.implementation.kind === "code"
  );
  assert.equal(codeGenerators.length > 0, true);
  assert.deepEqual(
    codeGenerators.filter((component) => component.nodeDefinition.metadata.nodeOwnedNativeModule !== true).map((component) => component.id),
    []
  );
  for (const component of codeGenerators) {
    assert.ok(component.nodeDefinition.parts.some((part) => part.kind === "javascript"), `${component.id} needs editable JavaScript`);
    assert.equal(component.nodeDefinition.metadata.nativeRenderer, undefined, `${component.id} executes its process without a host renderer label`);
  }
  for (const component of compiledGroups) {
    const graph = component.nodeDefinition.parts.find((part) => part.kind === "graph");
    assert.ok(graph?.editable, `${component.id} needs an editable executable graph`);
    assert.ok(
      component.nodeDefinition.compiler?.id || component.nodeDefinition.metadata?.visualCompilerHook?.id,
      `${component.id} needs an explicit compiler`,
    );
    assert.equal(
      component.nodeDefinition.parts.some((part) => part.kind === "javascript"),
      false,
      `${component.id} cannot expose unused parent code beside its executable child graph`,
    );
  }
});

test("each reusable library and executable node has an explicit folder boundary", () => {
  const libraries = readdirSync(libraryRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.equal(libraries.length > 0, true);
  for (const library of libraries) {
    assert.equal(moduleSet.has(resolve(libraryRoot, library.name, "index.js")), true, `${library.name} needs a public index.js`);
  }

  const violations = [];
  for (const filename of modules.filter((item) => item.startsWith(libraryRoot))) {
    const source = readFileSync(filename, "utf8");
    const declarations = [...source.matchAll(/export const \w+(?:Node|Group|VisualComponent)\s*=\s*define(?:Node|NodeGroup|GeneratorNode|EffectNode)\s*\(/g)];
    if (!declarations.length) continue;
    if (!filename.endsWith(`${sep}index.js`) || declarations.length !== 1) {
      violations.push(`${moduleName(filename)} (${declarations.length} executable definitions)`);
    }
  }
  assert.deepEqual(violations, []);
  assert.equal(modules.some((filename) => /(?:timing-nodes|source-manifest|shader-components-(?:image|motion|stylize))\.js$/.test(filename)), false);
});

test("the application composition root configures libraries through public entry points", () => {
  const source = readFileSync(resolve(jsRoot, "app-node-package.js"), "utf8");
  const imports = [...source.matchAll(/from "\.\/libraries\/([^"?]+)"/g)].map((match) => match[1]);
  assert.equal(imports.length > 0, true);
  assert.deepEqual(imports.filter((target) => !target.endsWith("/index.js")), []);
});

test("orchestration shells delegate extracted cache, shader-target, history, derived-asset, profiling, diagnostics, and rail ownership", () => {
  const renderer = readFileSync(resolve(jsRoot, "output/output-renderer.js"), "utf8");
  const resourceRuntime = readFileSync(resolve(jsRoot, "output/output-resource-runtime.js"), "utf8");
  const sourceRuntime = readFileSync(resolve(jsRoot, "output/source-render-runtime.js"), "utf8");
  const visualPlanRuntime = readFileSync(resolve(jsRoot, "output/visual-plan-runtime.js"), "utf8");
  const componentRenderRuntime = readFileSync(resolve(jsRoot, "output/component-render-runtime.js"), "utf8");
  const surfaceRuntime = readFileSync(resolve(jsRoot, "output/output-surface-runtime.js"), "utf8");
  const profileRuntime = readFileSync(resolve(jsRoot, "output/output-render-profile.js"), "utf8");
  const shaderTargets = readFileSync(resolve(jsRoot, "output/shader-target-runtime.js"), "utf8");
  const specializedSources = readFileSync(resolve(jsRoot, "output/specialized/specialized-source-runtime.js"), "utf8");
  const specializedTargets = readFileSync(resolve(jsRoot, "output/specialized/specialized-target-runtime.js"), "utf8");
  const projectService = readFileSync(resolve(jsRoot, "services/project-folder-service.js"), "utf8");
  const controlShell = readFileSync(resolve(jsRoot, "control/control-shell-controller.js"), "utf8");

  assert.match(resourceRuntime, /new OutputRenderCache\(\)/);
  assert.doesNotMatch(renderer, /new OutputRenderCache\(\)/);
  assert.match(renderer, /new OutputRenderProfile\(/);
  assert.match(profileRuntime, /class OutputRenderProfile/);
  assert.match(componentRenderRuntime, /host\.profileRuntime\.measureComponent\(/);
  assert.match(sourceRuntime, /host\.profileRuntime\.measure\("sourceMs"/);
  assert.match(surfaceRuntime, /renderer\.profileRuntime\.frameProfile/);
  assert.doesNotMatch(
    renderer,
    /^  (?:measureProfile|measureComponentProfile|activeComponentProfileIdentity)\(/m,
  );
  assert.doesNotMatch(
    renderer,
    /^  get (?:frameProfile|lastFrameProfile|collectDetailedProfile)\(/m,
  );
  assert.match(renderer, /from "\.\/shader-target-runtime\.js/);
  assert.doesNotMatch(renderer, /function (?:touchCacheEntry|pruneRenderCaches|beginProfile|finishProfile|drawShaderTarget|clearShaderTarget|applyShaderTarget|resetShaderTarget)\b/);
  assert.doesNotMatch(
    renderer,
    /^  (?:measureCompiledSourceOperation|canDirectCompositeSource|componentRegionSafe|sceneComponentRegionSafe|sceneComponentFrameFanoutSafe|videoPlaybackOptions|claimRetainedComponentMedia|claimRetainedSourceMedia|componentContainsVideo|renderDirectSourceNodeState|renderComponentSourceItem|renderComponentSourceItemState|imageSourceNeedsAlphaEdge|sourceRuntimeTimeKey|sourceRuntimeExternalKey|safeDrawSourceToGraphics|drawSourceToGraphics|drawComponentReferenceSource|drawMediaSource|drawCameraSource|drawBlackSource|drawGeneratorSource|drawCompiledScene3dProgram|executeCompiledVisualNodeProcess|drawCompiledNativeSource|drawScreenShareGenerator|drawStandby|componentHasPendingAssets|resetTerrainResources|resetModelResources|drawFeatureMorphGenerator|drawTileTextureGenerator|drawTextGenerator|drawTerrainGenerator|drawModelSource|getModelTarget|getTerrainTarget|getSpecializedWebglTarget)\(/m,
  );
  assert.match(sourceRuntime, /new RenderNodeRuntime\(/);
  assert.match(sourceRuntime, /createSharedFramebufferTarget\(/);
  assert.match(sourceRuntime, /^  claimRetainedComponentMedia\(/m);
  assert.match(sourceRuntime, /^  renderDirectNodeState\(/m);
  assert.match(visualPlanRuntime, /host\.sourceRuntime\.renderDirectNodeState\(/);
  assert.match(visualPlanRuntime, /host\.sourceRuntime\.renderItemState\(/);
  assert.match(componentRenderRuntime, /host\.sourceRuntime\.claimRetainedComponentMedia\(component\)/);
  assert.match(surfaceRuntime, /renderer\.sourceRuntime\.componentRegionSafe\(/);
  assert.match(shaderTargets, /blendMode\(globalThis\.REPLACE/);
  assert.match(specializedTargets, /from "\.\.\/shader-target-runtime\.js/);
  assert.doesNotMatch(specializedTargets, /function (?:drawShaderTarget|clearShaderTarget|applyShaderTarget|resetShaderTarget)\b/);
  assert.match(specializedSources, /new TerrainRenderRuntime\(/);
  assert.match(specializedSources, /new FeatureMorphRuntime\(/);
  assert.match(specializedSources, /new TextRenderRuntime\(/);
  assert.match(specializedSources, /new MeshPatternRuntime\(/);
  assert.doesNotMatch(specializedSources, /ModelRenderRuntime|model-render-runtime/);
  assert.doesNotMatch(
    specializedSources,
    /\b(drawTerrain|drawText|drawFeatureMorph|drawModel|drawMeshPatternPass|getTarget|presentGeneratedTarget|continuousRateTime)\s*\(/,
    "the specialized registry must not reacquire visual algorithms or timing ownership",
  );
  assert.match(projectService, /createProjectHistoryStore\(/);
  assert.match(projectService, /new ProjectDerivedAssetStore\(/);
  assert.doesNotMatch(projectService, /(?:async )?function (?:listRevisionEntries|pruneRevisionEntries|readRedoIndex|writeRedoIndex|writeMediaRendition|loadIndexedRenditions|writeComponentThumbnail|loadComponentThumbnails)\b/);
  assert.match(controlShell, /createControlPerformanceSession\(/);
  assert.match(controlShell, /createControlDiagnosticsController\(/);
  assert.match(controlShell, /projectRailTemplate\(/);
  assert.doesNotMatch(controlShell, /function (?:railToolsTemplate|componentToolsTemplate|canvasToolsTemplate|sceneToolsTemplate|liveToolsTemplate|mappingToolsTemplate)\b/);
});

function collectModules(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectModules(filename));
    else if (entry.name.endsWith(".js")) result.push(filename);
  }
  return result.sort();
}

function localImports(filename) {
  const source = readFileSync(filename, "utf8");
  const dependencies = [];
  const pattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (!match[1].startsWith(".")) continue;
    const dependency = resolve(dirname(filename), match[1].split("?")[0]);
    if (moduleSet.has(dependency)) dependencies.push(dependency);
  }
  return dependencies;
}

function findCycles(dependencies) {
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const cycles = [];
  const seenCycles = new Set();

  function visit(filename) {
    if (visited.has(filename)) return;
    active.add(filename);
    stack.push(filename);
    for (const dependency of dependencies.get(filename) || []) {
      if (!active.has(dependency)) visit(dependency);
      else {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const key = canonicalCycleKey(cycle);
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
      }
    }
    stack.pop();
    active.delete(filename);
    visited.add(filename);
  }

  for (const filename of dependencies.keys()) visit(filename);
  return cycles;
}

function canonicalCycleKey(cycle) {
  const names = cycle.slice(0, -1).map(moduleName);
  const rotations = names.map((_, index) => [...names.slice(index), ...names.slice(0, index)].join("|"));
  return rotations.sort()[0] || "";
}

function moduleName(filename) {
  return relative(jsRoot, filename).split(sep).join("/");
}
