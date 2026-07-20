export class OutputRenderProfile {
  constructor({ sampleInterval = 6 } = {}) {
    this.sampleInterval = Math.max(1, Math.floor(Number(sampleInterval) || 6));
    this.frameProfile = createEmptyFrameProfile();
    this.lastFrameProfile = createEmptyFrameProfile();
    this.collectDetailed = false;
    this.componentDepth = 0;
    this.componentContext = [];
  }

  beginFrame(frameIndex) {
    this.frameProfile = createEmptyFrameProfile();
    this.componentDepth = 0;
    this.componentContext.length = 0;
    this.collectDetailed = frameIndex % this.sampleInterval === 0;
    return this.frameProfile;
  }

  measure(bucket, meta, fn) {
    if (!this.collectDetailed) return fn();
    const started = performance.now();
    const result = fn();
    const ms = performance.now() - started;
    this.frameProfile[bucket] += ms;
    this.frameProfile.passSamples.push({ ...meta, ms });
    return result;
  }

  measureComponent(meta, fn) {
    if (!this.collectDetailed) return fn();
    const started = performance.now();
    const outermost = this.componentDepth === 0;
    this.componentDepth++;
    this.componentContext.push(meta);
    let result;
    try {
      result = fn();
    } finally {
      this.componentContext.pop();
      this.componentDepth--;
      const ms = performance.now() - started;
      this.frameProfile.componentMs += ms;
      if (outermost) this.frameProfile.componentWallMs += ms;
      this.frameProfile.componentRenders++;
      this.frameProfile.passSamples.push({ ...meta, ms });
    }
    return result;
  }

  activeComponentIdentity() {
    const context = this.componentContext[this.componentContext.length - 1];
    return context?.componentId ? {
      componentId: context.componentId,
      componentName: context.componentName || context.componentId,
    } : {};
  }

  finishFrame(frameStart) {
    if (!this.collectDetailed) return this.lastFrameProfile;
    const profile = {
      ...this.frameProfile,
      totalMs: performance.now() - frameStart,
      passSamples: this.frameProfile.passSamples
        .slice()
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 12)
        .map((item) => ({ ...item, ms: roundMetric(item.ms) })),
    };
    for (const key of ["shaderMs", "sourceMs", "componentMs", "componentWallMs", "totalMs"]) {
      profile[key] = roundMetric(profile[key]);
    }
    this.lastFrameProfile = profile;
    return profile;
  }
}

export function createEmptyFrameProfile() {
  return {
    shaderPasses: 0,
    shaderChains: 0,
    maxShaderChainLength: 0,
    shaderHandoffs: 0,
    componentCacheHits: 0,
    stageCacheHits: 0,
    stageRenders: 0,
    shaderMs: 0,
    sourceMs: 0,
    componentMs: 0,
    componentWallMs: 0,
    componentRenders: 0,
    surfaceRouteCandidates: 0,
    surfaceRoutesVisible: 0,
    surfaceRoutesCulled: 0,
    componentRasterPixels: 0,
    surfaceRasterPixels: 0,
    directSourceComposites: 0,
    avoidedSourceRasterPixels: 0,
    directSurfaceSamples: 0,
    avoidedSurfaceRasterPixels: 0,
    totalMs: 0,
    passSamples: [],
  };
}

export function roundMetric(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
