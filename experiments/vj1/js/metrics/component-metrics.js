import { BLEND_MODES, VJ1 } from "../constants.js";
import { componentTextureSize } from "../domain/render-resolution.js?v=adaptive-component-demand-28";
import { sanitizeState } from "../domain/models.js?v=adaptive-component-demand-28";
import { compileComponentPatch } from "../graph/render-scheduler.js?v=adaptive-component-demand-28";
import { planCompositorInputs, planPatchExecution, summarizeTextureBranches } from "../graph/patch-planner.js";
import { getShaderComponent } from "../shaders/shader-registry.js?v=adaptive-component-demand-28";
import { worldSize } from "../output/render-geometry.js?v=adaptive-component-demand-28";

export function analyzeVj1Project(input = {}, options = {}) {
  const state = sanitizeState(input || {});
  const render = renderMetrics(state);
  const mediaById = new Map((state.media || []).map((item) => [item.id, item]));
  const activeSurfaces = (state.surfaces || []).filter((surface) => surface.enabled !== false);
  const surfaceUsage = componentSurfaceUsage(activeSurfaces);
  const mapping = mappingMetrics(state, render);
  const components = (state.components || []).map((component) =>
    componentMetrics(component, { state, render, mediaById, surfaceUsage })
  );
  const costliestChainItems = rankCostItems(components.flatMap((component) => component.costItems || [])).slice(0, 12);
  const engineHotspots = engineOptimizationTargets({ state, render, components, activeSurfaces, costliestChainItems });
  const aggregate = aggregateMetrics({ state, render, components, activeSurfaces, mapping, costliestChainItems });
  const runtime = summarizeRuntimeSamples(options.runtimeSamples || []);
  const bottlenecks = rankBottlenecks([
    ...projectBottlenecks({ state, render, activeSurfaces, components, mapping }),
    ...components.flatMap((component) => component.bottlenecks),
    ...mapping.bottlenecks,
    ...runtime.bottlenecks,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: state.project?.name || "Untitled VJ Set",
      version: state.version,
      scenes: state.scenes?.length || 0,
      media: state.media?.length || 0,
    },
    render,
    aggregate,
    runtime,
    components,
    costliestChainItems,
    engineHotspots,
    mapping,
    bottlenecks,
  };
}

export function reportVj1MetricsMarkdown(metrics = {}) {
  const lines = [];
  lines.push(`# VJ1 Metrics: ${metrics.project?.name || "Untitled"}`);
  lines.push("");
  lines.push(`Generated: ${metrics.generatedAt || ""}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Components: ${metrics.aggregate?.componentCount ?? 0}`);
  lines.push(`- Active surfaces: ${metrics.aggregate?.activeSurfaceCount ?? 0}`);
  lines.push(`- Component initial frame: ${formatPixels(metrics.render?.componentPixels)} (${metrics.render?.componentWidth}x${metrics.render?.componentHeight})`);
  lines.push(`- World: ${formatPixels(metrics.render?.worldPixels)} (${metrics.render?.worldWidth}x${metrics.render?.worldHeight})`);
  lines.push(`- Estimated render work: ${formatNumber(metrics.aggregate?.estimatedWork, 2)}`);
  if (metrics.runtime?.sampleCount) {
    lines.push(`- Runtime samples: ${metrics.runtime.sampleCount}, fps avg ${formatNumber(metrics.runtime.fpsAvg, 1)}, frame p95 ${formatNumber(metrics.runtime.frameMsP95, 1)} ms`);
    if (metrics.runtime.steady?.sampleCount && metrics.runtime.warmupSampleCount) {
      lines.push(`- Runtime steady: ${metrics.runtime.steady.sampleCount} samples after ${metrics.runtime.warmupSampleCount} warm-up, fps avg ${formatNumber(metrics.runtime.steady.fpsAvg, 1)}, frame p95 ${formatNumber(metrics.runtime.steady.frameMsP95, 1)} ms`);
    }
    if (metrics.runtime.profile?.sampleCount) {
      lines.push(`- Shader profile: ${formatNumber(metrics.runtime.profile.shaderPassesAvg, 1)} pass(es)/sample, ${formatNumber(metrics.runtime.profile.shaderChainsAvg, 1)} chain(s)/sample, ${formatNumber(metrics.runtime.profile.shaderHandoffsAvg, 1)} handoff(s)/sample`);
    }
  }
  lines.push("");
  if (metrics.runtime?.profile?.slowPasses?.length) {
    lines.push("## Runtime Slow Passes");
    lines.push("");
    for (const item of metrics.runtime.profile.slowPasses.slice(0, 8)) {
      lines.push(`- ${item.passName || item.type}: ${formatNumber(item.ms, 2)} ms (${item.width || "?"}x${item.height || "?"}, ${item.source || item.type || "unknown"})`);
    }
    lines.push("");
  }
  lines.push("## Costliest Chain Items");
  lines.push("");
  if (metrics.costliestChainItems?.length) {
    for (const item of metrics.costliestChainItems.slice(0, 10)) {
      lines.push(`- ${item.componentName} / ${item.name}: ${formatNumber(item.estimatedWork, 2)} (${item.kind}, ${item.reason})`);
    }
  } else {
    lines.push("- No enabled chain items.");
  }
  lines.push("");
  lines.push("## Engine Optimization Targets");
  lines.push("");
  if (metrics.engineHotspots?.length) {
    for (const item of metrics.engineHotspots) {
      lines.push(`- ${item.priority.toUpperCase()} ${item.step}: ${item.reason}`);
    }
  } else {
    lines.push("- No engine-level hotspots detected by the static model.");
  }
  lines.push("");
  lines.push("## Bottlenecks");
  lines.push("");
  if (metrics.bottlenecks?.length) {
    for (const item of metrics.bottlenecks) {
      lines.push(`- ${item.severity.toUpperCase()} ${item.scope}: ${item.message}`);
    }
  } else {
    lines.push("- No bottlenecks detected by static heuristics.");
  }
  lines.push("");
  lines.push("## Components");
  lines.push("");
  for (const component of metrics.components || []) {
    lines.push(`- ${component.name}: work ${formatNumber(component.estimatedWork, 2)}, sources ${component.sources.enabled}/${component.sources.total}, effects ${component.effects.enabled}/${component.effects.total}, branches ${component.branches}`);
  }
  lines.push("");
  lines.push("## Mapping");
  lines.push("");
  lines.push(`- Mapped surfaces: ${metrics.mapping?.mappedSurfaceCount ?? 0}/${metrics.aggregate?.activeSurfaceCount ?? 0}`);
  lines.push(`- Degenerate surfaces: ${metrics.mapping?.degenerateSurfaceCount ?? 0}`);
  lines.push(`- Off-world corners: ${metrics.mapping?.offWorldCornerCount ?? 0}`);
  return lines.join("\n");
}

export function compareVj1Metrics(current = {}, previous = {}) {
  const currentBottlenecks = current.bottlenecks || [];
  const previousBottlenecks = previous.bottlenecks || [];
  const previousKeys = new Set(previousBottlenecks.map(bottleneckKey));
  const currentKeys = new Set(currentBottlenecks.map(bottleneckKey));
  return {
    currentGeneratedAt: current.generatedAt || "",
    previousGeneratedAt: previous.generatedAt || "",
    deltas: {
      componentCount: delta(current.aggregate?.componentCount, previous.aggregate?.componentCount),
      activeSurfaceCount: delta(current.aggregate?.activeSurfaceCount, previous.aggregate?.activeSurfaceCount),
      estimatedWork: delta(current.aggregate?.estimatedWork, previous.aggregate?.estimatedWork),
      mappedSurfaceCount: delta(current.mapping?.mappedSurfaceCount, previous.mapping?.mappedSurfaceCount),
      criticalBottlenecks: delta(countSeverity(currentBottlenecks, "critical"), countSeverity(previousBottlenecks, "critical")),
      warningBottlenecks: delta(countSeverity(currentBottlenecks, "warn"), countSeverity(previousBottlenecks, "warn")),
      runtimeFrameMsP95: delta(current.runtime?.frameMsP95, previous.runtime?.frameMsP95),
      runtimeRenderCostP95: delta(current.runtime?.renderCostP95, previous.runtime?.renderCostP95),
    },
    addedBottlenecks: currentBottlenecks.filter((item) => !previousKeys.has(bottleneckKey(item))),
    resolvedBottlenecks: previousBottlenecks.filter((item) => !currentKeys.has(bottleneckKey(item))),
  };
}

export function reportVj1ComparisonMarkdown(comparison = {}) {
  const lines = [];
  lines.push("## Comparison");
  lines.push("");
  lines.push(`- Previous: ${comparison.previousGeneratedAt || "unknown"}`);
  lines.push(`- Current: ${comparison.currentGeneratedAt || "unknown"}`);
  lines.push(`- Estimated work delta: ${formatSigned(comparison.deltas?.estimatedWork?.change, 2)}`);
  lines.push(`- Critical bottleneck delta: ${formatSigned(comparison.deltas?.criticalBottlenecks?.change, 0)}`);
  lines.push(`- Warning bottleneck delta: ${formatSigned(comparison.deltas?.warningBottlenecks?.change, 0)}`);
  if (comparison.deltas?.runtimeFrameMsP95?.current || comparison.deltas?.runtimeFrameMsP95?.previous) {
    lines.push(`- Runtime frame p95 delta: ${formatSigned(comparison.deltas.runtimeFrameMsP95.change, 1)} ms`);
  }
  lines.push("");
  lines.push("### Added Bottlenecks");
  if (comparison.addedBottlenecks?.length) {
    for (const item of comparison.addedBottlenecks) lines.push(`- ${item.severity.toUpperCase()} ${item.scope}: ${item.message}`);
  } else {
    lines.push("- None");
  }
  lines.push("");
  lines.push("### Resolved Bottlenecks");
  if (comparison.resolvedBottlenecks?.length) {
    for (const item of comparison.resolvedBottlenecks) lines.push(`- ${item.severity.toUpperCase()} ${item.scope}: ${item.message}`);
  } else {
    lines.push("- None");
  }
  return lines.join("\n");
}

export function summarizeRuntimeSamples(samples = []) {
  const clean = (samples || [])
    .map((sample) => ({
      fps: numberOrNull(sample.fps),
      frameMs: numberOrNull(sample.frameMs),
      renderCost: numberOrNull(sample.renderCost),
      previewFps: numberOrNull(sample.previewFps),
      previewFrameMs: numberOrNull(sample.previewFrameMs),
      previewRenderCost: numberOrNull(sample.previewRenderCost),
      profile: sample.profile && typeof sample.profile === "object" ? sample.profile : null,
      message: sample.message || "",
    }))
    .filter((sample) => sample.fps !== null || sample.frameMs !== null || sample.renderCost !== null || sample.previewFps !== null);

  const fpsValues = clean.map((sample) => sample.fps ?? sample.previewFps).filter(isFiniteNumber);
  const frameValues = clean.map((sample) => sample.frameMs ?? sample.previewFrameMs).filter(isFiniteNumber);
  const costValues = clean.map((sample) => sample.renderCost ?? sample.previewRenderCost).filter(isFiniteNumber);
  const profile = summarizeRuntimeProfiles(clean.map((sample) => sample.profile).filter(Boolean));
  const warmupSampleCount = clean.length > 6 ? 3 : 0;
  const steadyClean = warmupSampleCount ? clean.slice(warmupSampleCount) : clean;
  const steady = summarizeRuntimeBasics(steadyClean);
  const result = {
    sampleCount: clean.length,
    fpsAvg: average(fpsValues),
    fpsMin: minValue(fpsValues),
    frameMsAvg: average(frameValues),
    frameMsP95: percentile(frameValues, 0.95),
    renderCostAvg: average(costValues),
    renderCostP95: percentile(costValues, 0.95),
    warmupSampleCount,
    steady,
    profile,
    bottlenecks: [],
  };

  if (result.sampleCount && result.fpsAvg < 45) {
    result.bottlenecks.push(bottleneck("warn", "runtime", `Average FPS is ${formatNumber(result.fpsAvg, 1)}.`));
  }
  if (result.sampleCount && result.frameMsP95 > 24) {
    result.bottlenecks.push(bottleneck("warn", "runtime", `95th percentile frame time is ${formatNumber(result.frameMsP95, 1)} ms.`));
  }
  if (result.sampleCount && result.renderCostP95 > 1) {
    result.bottlenecks.push(bottleneck("critical", "runtime", `95th percentile render cost is ${formatNumber(result.renderCostP95 * 100, 0)}% of a 120fps frame budget.`));
  }
  if (steady.sampleCount && steady.renderCostP95 > 1) {
    result.bottlenecks.push(bottleneck("critical", "runtime", `Steady 95th percentile render cost is ${formatNumber(steady.renderCostP95 * 100, 0)}% of a 120fps frame budget.`));
  }
  if (profile.sampleCount && profile.shaderHandoffsAvg > 0.5) {
    result.bottlenecks.push(bottleneck("warn", "runtime", `Shader handoffs average ${formatNumber(profile.shaderHandoffsAvg, 1)} per sample.`));
  }
  if (profile.sampleCount && profile.maxShaderChainLengthMax >= 5) {
    result.bottlenecks.push(bottleneck("info", "runtime", `Longest observed shader chain was ${profile.maxShaderChainLengthMax} pass(es).`));
  }
  return result;
}

function summarizeRuntimeBasics(samples = []) {
  const fpsValues = samples.map((sample) => sample.fps ?? sample.previewFps).filter(isFiniteNumber);
  const frameValues = samples.map((sample) => sample.frameMs ?? sample.previewFrameMs).filter(isFiniteNumber);
  const costValues = samples.map((sample) => sample.renderCost ?? sample.previewRenderCost).filter(isFiniteNumber);
  const profiles = samples.map((sample) => sample.profile).filter(Boolean);
  return {
    sampleCount: samples.length,
    fpsAvg: average(fpsValues),
    fpsMin: minValue(fpsValues),
    frameMsAvg: average(frameValues),
    frameMsP95: percentile(frameValues, 0.95),
    renderCostAvg: average(costValues),
    renderCostP95: percentile(costValues, 0.95),
    profile: summarizeRuntimeProfiles(profiles),
  };
}

function summarizeRuntimeProfiles(profiles = []) {
  const clean = profiles.filter((profile) => profile && typeof profile === "object");
  const slowPasses = clean
    .flatMap((profile) => Array.isArray(profile.passSamples) ? profile.passSamples : [])
    .filter((item) => isFiniteNumber(item.ms))
    .sort((a, b) => Number(b.ms) - Number(a.ms))
    .slice(0, 12);
  return {
    sampleCount: clean.length,
    shaderPassesAvg: average(clean.map((profile) => Number(profile.shaderPasses) || 0)),
    shaderChainsAvg: average(clean.map((profile) => Number(profile.shaderChains) || 0)),
    shaderHandoffsAvg: average(clean.map((profile) => Number(profile.shaderHandoffs) || 0)),
    maxShaderChainLengthMax: clean.length ? Math.max(...clean.map((profile) => Number(profile.maxShaderChainLength) || 0)) : 0,
    shaderMsP95: percentile(clean.map((profile) => Number(profile.shaderMs) || 0), 0.95),
    componentMsP95: percentile(clean.map((profile) => Number(profile.componentWallMs ?? profile.componentMs) || 0), 0.95),
    slowPasses,
  };
}

function componentMetrics(component, context) {
  const chain = Array.isArray(component.chain) ? component.chain : [];
  const enabledChain = chain.filter((item) => item.enabled !== false);
  const sources = chain.filter((item) => item.kind === "source");
  const enabledSources = sources.filter((item) => item.enabled !== false);
  const effects = chain.filter((item) => item.kind === "effect");
  const enabledEffects = effects.filter((item) => item.enabled !== false);
  const spatialEffects = enabledEffects.filter((item) => getShaderComponent(item.componentId)?.spatial);
  const customEffects = enabledEffects.filter((item) => item.componentId === "custom");
  const mediaSources = enabledSources.filter((item) => item.source?.type === "media");
  const missingMedia = mediaSources.filter((item) => !context.mediaById.has(item.source?.mediaId));
  const videoSources = mediaSources.filter((item) => context.mediaById.get(item.source?.mediaId)?.type === "video");
  const patch = compileComponentPatch(component, {
    role: "surface",
    width: context.render.componentWidth,
    height: context.render.componentHeight,
  });
  const plan = planPatchExecution(patch);
  const compositor = planCompositorInputs(plan);
  const branchSummaries = summarizeTextureBranches(plan);
  const branchDepths = branchSummaries.map((branch) => branch.effectComponentIds?.length || 0);
  const surfaceCount = context.surfaceUsage.get(component.id)?.length || 0;
  const resolutionScale = Math.max(0.5, Math.min(2, Number(component.resolutionScale) || 1));
  const pixelScale = resolutionScale * resolutionScale;
  const estimatedWork = estimateComponentWork({
    enabledSources,
    enabledEffects,
    videoSources,
    branches: Math.max(1, compositor.inputs.length || enabledSources.length || 1),
    surfaceCount,
    pixelScale,
  });
  const result = {
    id: component.id,
    name: component.name || component.id || "Component",
    selected: context.state.ui?.selectedComponentId === component.id,
    surfaces: context.surfaceUsage.get(component.id) || [],
    chainItems: { total: chain.length, enabled: enabledChain.length },
    sources: { total: sources.length, enabled: enabledSources.length, media: mediaSources.length, video: videoSources.length, missingMedia: missingMedia.length },
    effects: { total: effects.length, enabled: enabledEffects.length, spatial: spatialEffects.length, custom: customEffects.length },
    branches: Math.max(0, compositor.inputs.length || enabledSources.length),
    maxEffectDepth: Math.max(0, ...branchDepths),
    estimatedWork,
    costItems: chainCostItems({ component, enabledChain, mediaById: context.mediaById, pixelScale }),
    thumbnailBytes: component.thumbnail ? component.thumbnail.length : 0,
    blend: BLEND_MODES.includes(component.blend) ? component.blend : "unknown",
    patchWarnings: plan.warnings || [],
    bottlenecks: [],
  };

  if (!surfaceCount) result.bottlenecks.push(bottleneck("info", result.name, "Component is not assigned to any active surface."));
  if (enabledEffects.length >= 6) result.bottlenecks.push(bottleneck("warn", result.name, `${enabledEffects.length} enabled effects in one chain.`));
  if (result.maxEffectDepth >= 5) result.bottlenecks.push(bottleneck("warn", result.name, `Longest branch has ${result.maxEffectDepth} sequential effects.`));
  if (result.branches >= 5) result.bottlenecks.push(bottleneck("warn", result.name, `${result.branches} source branches increase blend/composite work.`));
  if (videoSources.length >= 3) result.bottlenecks.push(bottleneck("warn", result.name, `${videoSources.length} video sources can pressure decoding and texture upload.`));
  if (missingMedia.length) result.bottlenecks.push(bottleneck("critical", result.name, `${missingMedia.length} media source(s) reference missing project media.`));
  if (customEffects.length) result.bottlenecks.push(bottleneck("info", result.name, "Custom shader pass should be checked in browser for compile/runtime behavior."));
  if (result.thumbnailBytes > 700000) result.bottlenecks.push(bottleneck("warn", result.name, `Thumbnail is ${formatBytes(result.thumbnailBytes)}, which can bloat project.json.`));
  if (plan.warnings?.length) result.bottlenecks.push(bottleneck("warn", result.name, `${plan.warnings.length} graph planner warning(s).`));
  for (const item of result.costItems.slice(0, 2)) {
    if (item.estimatedWork >= 1.75) {
      result.bottlenecks.push(bottleneck("info", result.name, `Cost contributor: ${item.name} (${formatNumber(item.estimatedWork, 2)}, ${item.reason}).`));
    }
  }
  return result;
}

function renderMetrics(state) {
  const component = componentTextureSize(state.render || {});
  const world = worldSize(state.render || {});
  const frameWidth = positiveInt(state.render?.frameWidth ?? state.render?.width, VJ1.renderWidth);
  const frameHeight = positiveInt(state.render?.frameHeight ?? state.render?.height, VJ1.renderHeight);
  return {
    frameWidth,
    frameHeight,
    framePixels: frameWidth * frameHeight,
    componentWidth: component.width,
    componentHeight: component.height,
    componentPixels: component.width * component.height,
    worldWidth: world.width,
    worldHeight: world.height,
    worldPixels: world.width * world.height,
    pixelDensity: Math.max(0.5, Math.min(2, Number(state.render?.pixelDensity) || 1)),
  };
}

function mappingMetrics(state, render) {
  const activeSurfaceIds = new Set((state.surfaces || []).filter((surface) => surface.enabled !== false).map((surface) => surface.id));
  const mapped = Array.isArray(state.mappings?.local?.surfaces) ? state.mappings.local.surfaces : [];
  const mappedActive = mapped.filter((surface) => activeSurfaceIds.has(surface.id || surface.name));
  let degenerateSurfaceCount = 0;
  let offWorldCornerCount = 0;
  const bottlenecks = [];

  for (const surface of mappedActive) {
    const corners = Array.isArray(surface.corners) ? surface.corners : [];
    const area = polygonArea(corners);
    if (corners.length !== 4 || area < 100) {
      degenerateSurfaceCount++;
      bottlenecks.push(bottleneck("critical", `mapping:${surface.id || surface.name}`, "Mapped surface has missing or near-zero area corners."));
    }
    for (const corner of corners) {
      const x = Number(corner.x);
      const y = Number(corner.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > render.worldWidth || y > render.worldHeight) {
        offWorldCornerCount++;
      }
    }
  }

  const missingActive = [...activeSurfaceIds].filter((id) => !mapped.some((surface) => (surface.id || surface.name) === id));
  if (missingActive.length) {
    bottlenecks.push(bottleneck("info", "mapping", `${missingActive.length} active surface(s) have no saved mapping and will use generated defaults.`));
  }
  if (offWorldCornerCount) {
    bottlenecks.push(bottleneck("warn", "mapping", `${offWorldCornerCount} mapping corner(s) are outside the render world.`));
  }

  return {
    mappedSurfaceCount: mappedActive.length,
    configuredSurfaceCount: mapped.length,
    missingActiveSurfaceCount: missingActive.length,
    degenerateSurfaceCount,
    offWorldCornerCount,
    bottlenecks,
  };
}

function aggregateMetrics({ state, render, components, activeSurfaces, mapping, costliestChainItems }) {
  return {
    componentCount: components.length,
    sceneCount: state.scenes?.length || 0,
    surfaceCount: state.surfaces?.length || 0,
    activeSurfaceCount: activeSurfaces.length,
    mediaCount: state.media?.length || 0,
    mappedSurfaceCount: mapping.mappedSurfaceCount,
    totalSources: sum(components.map((item) => item.sources.total)),
    totalEffects: sum(components.map((item) => item.effects.total)),
    enabledEffects: sum(components.map((item) => item.effects.enabled)),
    estimatedWork: sum(components.map((item) => item.estimatedWork)) + activeSurfaces.length * 0.25,
    topCostContributor: costliestChainItems?.[0] || null,
  };
}

function projectBottlenecks({ state, render, activeSurfaces, components }) {
  const items = [];
  const assignedComponentIds = new Set(activeSurfaces.map((surface) => surface.componentId).filter(Boolean));
  const missingAssignments = activeSurfaces.filter((surface) => !surface.componentId || !components.some((component) => component.id === surface.componentId));
  if (!state.scenes?.length) items.push(bottleneck("info", "project", "No captured scenes; live workflow has nothing stable to select."));
  if (activeSurfaces.length >= 8) items.push(bottleneck("warn", "surfaces", `${activeSurfaces.length} active surfaces increase per-frame mapping work.`));
  if (missingAssignments.length) items.push(bottleneck("critical", "surfaces", `${missingAssignments.length} active surface(s) are missing a valid component assignment.`));
  if (render.worldPixels > 4000000) items.push(bottleneck("warn", "render", `Preview world is ${formatPixels(render.worldPixels)}; embedded preview may be expensive.`));
  if (render.pixelDensity > 1.25) items.push(bottleneck("warn", "render", `Pixel density ${render.pixelDensity} multiplies canvas work.`));
  if (state.ui?.debugPreview === false) {
    const missingThumbnails = [...assignedComponentIds].filter((id) => !components.find((component) => component.id === id)?.thumbnailBytes);
    if (missingThumbnails.length) items.push(bottleneck("warn", "thumbnail-preview", `${missingThumbnails.length} assigned component(s) have no thumbnail for cheap preview mode.`));
  }
  return items;
}

function engineOptimizationTargets({ state, render, components, activeSurfaces, costliestChainItems }) {
  const targets = [];
  const activeComponentIds = new Set(activeSurfaces.map((surface) => surface.componentId).filter(Boolean));
  const activeComponents = components.filter((component) => activeComponentIds.has(component.id));
  const totalEnabledEffects = sum(activeComponents.map((component) => component.effects.enabled));
  const maxEffectDepth = Math.max(0, ...activeComponents.map((component) => component.maxEffectDepth || 0));
  const heavyShaderItems = (costliestChainItems || []).filter((item) => item.kind === "effect" && item.estimatedWork >= 1.6);
  const demandPixelScale = render.pixelDensity * render.pixelDensity;

  if (totalEnabledEffects) {
    targets.push({
      priority: maxEffectDepth >= 5 || totalEnabledEffects >= 12 ? "high" : "medium",
      step: "Sequential shader passes",
      reason: `${totalEnabledEffects} enabled effect pass(es) across active components; each pass is still a full texture render even when ping-pong buffers avoid intermediate handoff copies.`,
      evidence: { totalEnabledEffects, maxEffectDepth },
    });
  }

  if (heavyShaderItems.length) {
    targets.push({
      priority: heavyShaderItems.length >= 4 ? "high" : "medium",
      step: "Heavy shader components",
      reason: `${heavyShaderItems.slice(0, 4).map((item) => `${item.componentName}/${item.name}`).join(", ")} are likely expensive fragment passes.`,
      evidence: { items: heavyShaderItems.slice(0, 6) },
    });
  }

  if (activeSurfaces.length) {
    targets.push({
      priority: activeSurfaces.length >= 6 || demandPixelScale > 2 ? "high" : "medium",
      step: "Adaptive source demand and mapper draw",
      reason: `${activeSurfaces.length} active surface(s) contribute projected-pixel demand and a mapper draw; only exception paths materialize a separate surface texture.`,
      evidence: { activeSurfaceCount: activeSurfaces.length, pixelDensity: render.pixelDensity },
    });
  }

  const finalSurfaceEffects = sum(activeSurfaces.map((surface) => surface.finalShaderChain?.filter((pass) => pass.enabled !== false).length || 0));
  if (finalSurfaceEffects) {
    targets.push({
      priority: finalSurfaceEffects >= 4 ? "high" : "medium",
      step: "Final surface shader chains",
      reason: `${finalSurfaceEffects} final surface effect pass(es) run after component rendering and before mapping.`,
      evidence: { finalSurfaceEffects },
    });
  }

  const activeMediaSources = activeComponents.flatMap((component) =>
    (component.costItems || []).filter((item) => item.kind === "source" && /media|camera|video/.test(item.reason))
  );
  if (activeMediaSources.length) {
    targets.push({
      priority: activeMediaSources.length >= 3 ? "high" : "medium",
      step: "Media and camera texture upload",
      reason: `${activeMediaSources.length} live media/camera source(s) can add decode and texture-upload pressure before shader work starts.`,
      evidence: { activeMediaSources },
    });
  }

  if (state.global?.calibrating && state.global?.showLabels !== false) {
    targets.push({
      priority: activeSurfaces.length >= 6 ? "medium" : "low",
      step: "Calibration overlays and labels",
      reason: "Calibration mode draws handles, output-frame overlays, and per-surface text labels on top of render output.",
      evidence: { calibrating: true, showLabels: state.global.showLabels !== false },
    });
  }

  if (state.ui?.debugPreview === false) {
    targets.push({
      priority: "low",
      step: "Thumbnail preview mode",
      reason: "Cheap preview mode avoids most live component rendering; optimize missing/stale thumbnail generation before optimizing this path.",
      evidence: { debugPreview: false },
    });
  }

  return targets.sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority));
}

function priorityWeight(priority) {
  return { high: 0, medium: 1, low: 2 }[priority] ?? 3;
}

function componentSurfaceUsage(activeSurfaces) {
  const usage = new Map();
  for (const surface of activeSurfaces) {
    if (!surface.componentId) continue;
    if (!usage.has(surface.componentId)) usage.set(surface.componentId, []);
    usage.get(surface.componentId).push(surface.id);
  }
  return usage;
}

function estimateComponentWork({ enabledSources, enabledEffects, videoSources, branches, surfaceCount, pixelScale }) {
  const sourceWork = enabledSources.length * 0.85;
  const videoWork = videoSources.length * 0.7;
  const effectWork = enabledEffects.length * 1.35;
  const branchWork = Math.max(0, branches - 1) * 0.35;
  const fanoutWork = Math.max(0, surfaceCount - 1) * 0.12;
  return round2((sourceWork + videoWork + effectWork + branchWork + fanoutWork) * Math.max(0.1, pixelScale));
}

function chainCostItems({ component, enabledChain, mediaById, pixelScale }) {
  const items = [];
  let effectDepth = 0;
  for (const [index, item] of enabledChain.entries()) {
    if (item.kind === "source") effectDepth = 0;
    else if (item.kind === "effect") effectDepth++;
    const cost = item.kind === "source"
      ? sourceCost(item, mediaById)
      : effectCost(item, effectDepth);
    items.push({
      componentId: component.id,
      componentName: component.name || component.id || "Component",
      id: item.id || `${component.id}:${index}`,
      name: item.name || item.componentId || item.source?.generatorId || item.source?.type || "Chain item",
      kind: item.kind || "unknown",
      componentId: item.componentId || item.source?.generatorId || item.source?.type || "",
      index,
      effectDepth,
      estimatedWork: round2(cost.work * Math.max(0.1, pixelScale)),
      reason: cost.reason,
    });
  }
  return rankCostItems(items);
}

function sourceCost(item, mediaById) {
  const source = item.source || {};
  if (source.type === "media") {
    const media = mediaById.get(source.mediaId);
    if (media?.type === "video") return { work: 1.65, reason: "video decode and texture upload" };
    if (media?.type === "model") return { work: 1.35, reason: "3d model render" };
    if (media?.type === "image") return { work: 1.0, reason: "image texture draw" };
    return { work: 1.25, reason: "missing or unknown media source" };
  }
  if (source.type === "camera") return { work: 1.8, reason: "camera capture texture" };
  if (source.type === "black") return { work: 0.1, reason: "black fill" };
  return { work: 0.75, reason: `${source.generatorId || "generator"} generator` };
}

function effectCost(item, effectDepth = 1) {
  const id = item.componentId || item.id || "effect";
  const base = {
    blur: 1.8,
    erode: 1.65,
    dilate: 1.65,
    labelGrain: 1.55,
    labelThresholdGrain: 1.28,
    threshold: 1.45,
    rgbSplit: 1.5,
    glitchDistort: 1.7,
    photoGrade: 1.42,
    echoFade: 1.62,
    kaleido: 1.45,
    mirrorFold: 1.42,
    heatShimmer: 1.38,
    spinRotate: 1.28,
    pixelate: 1.35,
    ripple: 1.35,
    plasma: 1.3,
    lumaKey: 1.25,
    alphaVignette: 1.18,
    hardBlack: 1.2,
    gray: 1.05,
    invert: 1.0,
    custom: 2.0,
  }[id] || 1.35;
  const depthPenalty = Math.max(0, effectDepth - 1) * 0.08;
  const amount = Number(item.amount ?? item.params?.amount);
  const amountPenalty = Number.isFinite(amount) && amount > 0.75 ? 0.12 : 0;
  const component = getShaderComponent(id);
  const spatialPenalty = component?.spatial ? 0.12 : 0;
  const work = base + depthPenalty + amountPenalty + spatialPenalty;
  const reason = [
    `${id} shader`,
    component?.spatial ? "spatial transform" : "",
    effectDepth > 1 ? `depth ${effectDepth}` : "",
  ].filter(Boolean).join(", ");
  return { work, reason };
}

function rankCostItems(items) {
  return (items || []).slice().sort((a, b) => (Number(b.estimatedWork) || 0) - (Number(a.estimatedWork) || 0));
}

function rankBottlenecks(items) {
  const weight = { critical: 0, warn: 1, info: 2 };
  return (items || []).slice().sort((a, b) => (weight[a.severity] ?? 3) - (weight[b.severity] ?? 3));
}

function bottleneckKey(item = {}) {
  return `${item.severity || ""}|${item.scope || ""}|${item.message || ""}`;
}

function countSeverity(items, severity) {
  return (items || []).filter((item) => item.severity === severity).length;
}

function delta(current, previous) {
  const next = Number(current) || 0;
  const before = Number(previous) || 0;
  return {
    current: next,
    previous: before,
    change: next - before,
  };
}

function bottleneck(severity, scope, message) {
  return { severity, scope, message };
}

function positiveInt(value, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function polygonArea(corners) {
  if (!Array.isArray(corners) || corners.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    area += (Number(a.x) || 0) * (Number(b.y) || 0) - (Number(b.x) || 0) * (Number(a.y) || 0);
  }
  return Math.abs(area) * 0.5;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function average(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

function minValue(values) {
  return values.length ? Math.min(...values) : 0;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals) : "0";
}

function formatSigned(value, decimals = 2) {
  const number = Number(value) || 0;
  const sign = number > 0 ? "+" : "";
  return `${sign}${formatNumber(number, decimals)}`;
}

function formatPixels(value) {
  const pixels = Number(value) || 0;
  if (pixels >= 1000000) return `${formatNumber(pixels / 1000000, 2)} MP`;
  if (pixels >= 1000) return `${formatNumber(pixels / 1000, 1)} KP`;
  return `${Math.round(pixels)} px`;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024) return `${formatNumber(bytes / (1024 * 1024), 2)} MB`;
  if (bytes >= 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
  return `${Math.round(bytes)} B`;
}
