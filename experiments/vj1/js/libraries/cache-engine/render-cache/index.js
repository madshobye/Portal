import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { disposeRenderTarget } from "../../render-engine/render-target-lifetime.js";

const COMPONENT_SOURCE_CACHE_LIMIT = 48;
const COMPONENT_BUFFER_CACHE_LIMIT = 48;
const COMPONENT_GPU_BUFFER_CACHE_LIMIT = 64;
export const RENDER_CACHE_IDLE_FRAMES = 900;

// Small allocation-stable pools such as surface rasters use this policy
// directly. Keeping it here prevents each render host from inventing an
// unbounded dimension-keyed Map as windows and mappings resize.
export class BoundedRenderTargetPool {
  constructor({ maxItems = 12, idleFrames = RENDER_CACHE_IDLE_FRAMES } = {}) {
    this.maxItems = Math.max(1, Math.round(Number(maxItems) || 12));
    this.idleFrames = Math.max(1, Math.round(Number(idleFrames) || RENDER_CACHE_IDLE_FRAMES));
    this.resources = new Map();
    this.use = new Map();
    this.nextIdlePruneFrame = 0;
  }

  acquire(key, frameIndex, create) {
    const id = String(key || "");
    let resource = this.resources.get(id);
    const isNew = !resource;
    if (!resource) {
      resource = create?.();
      if (!resource) return null;
      this.resources.set(id, resource);
    }
    const currentFrame = Number(frameIndex) || 0;
    this.use.set(id, currentFrame);
    if (isNew && this.nextIdlePruneFrame !== 0) this.nextIdlePruneFrame = Math.min(
      this.nextIdlePruneFrame,
      currentFrame + this.idleFrames + 1
    );
    this.prune(frameIndex);
    return resource;
  }

  prune(frameIndex) {
    const currentFrame = Number(frameIndex) || 0;
    const underPressure = this.resources.size > this.maxItems;
    if (!underPressure && currentFrame < this.nextIdlePruneFrame) return false;
    pruneResourceMap(this.resources, this.use, {
      maxItems: this.maxItems,
      currentFrame,
      idleFrames: this.idleFrames,
    });
    this.nextIdlePruneFrame = nextRenderCacheExpiry(this.use, this.idleFrames);
    return true;
  }

  values() {
    return this.resources.values();
  }

  dispose() {
    disposeResourceMap(this.resources);
    this.use.clear();
    this.nextIdlePruneFrame = 0;
  }
}

// Owns reusable Component raster targets and their lifetime policy. Rendering
// decides what a key means; this cache decides how long its resource may live.
export class OutputRenderCache {
  constructor() {
    this.sources = new Map();
    this.buffers = new Map();
    this.gpuBuffers = new Map();
    this.sourceUse = new Map();
    this.bufferUse = new Map();
    this.gpuBufferUse = new Map();
    this.lastPruneFrame = -1;
    this.nextIdlePruneFrame = 0;
  }

  touch(kind, key, frameIndex) {
    const use = this.useMap(kind);
    const isNew = !use.has(key);
    const currentFrame = Number(frameIndex) || 0;
    use.set(key, currentFrame);
    if (isNew && this.nextIdlePruneFrame !== 0) this.nextIdlePruneFrame = Math.min(
      this.nextIdlePruneFrame,
      currentFrame + RENDER_CACHE_IDLE_FRAMES + 1
    );
  }

  prune(frameIndex) {
    const underPressure = this.sourceUse.size > COMPONENT_SOURCE_CACHE_LIMIT ||
      this.bufferUse.size > COMPONENT_BUFFER_CACHE_LIMIT ||
      this.gpuBufferUse.size > COMPONENT_GPU_BUFFER_CACHE_LIMIT;
    if (!underPressure && frameIndex < this.nextIdlePruneFrame) return false;
    this.lastPruneFrame = frameIndex;
    pruneResourceMap(this.sources, this.sourceUse, {
      maxItems: COMPONENT_SOURCE_CACHE_LIMIT,
      currentFrame: frameIndex,
      idleFrames: RENDER_CACHE_IDLE_FRAMES,
    });
    pruneResourceMap(this.buffers, this.bufferUse, {
      maxItems: COMPONENT_BUFFER_CACHE_LIMIT,
      currentFrame: frameIndex,
      idleFrames: RENDER_CACHE_IDLE_FRAMES,
    });
    pruneResourceMap(this.gpuBuffers, this.gpuBufferUse, {
      maxItems: COMPONENT_GPU_BUFFER_CACHE_LIMIT,
      currentFrame: frameIndex,
      idleFrames: RENDER_CACHE_IDLE_FRAMES,
    });
    this.nextIdlePruneFrame = nextRenderCacheExpiry(
      this.sourceUse,
      this.bufferUse,
      this.gpuBufferUse,
      RENDER_CACHE_IDLE_FRAMES
    );
    return true;
  }

  dispose() {
    disposeResourceMap(this.sources);
    disposeResourceMap(this.buffers);
    disposeResourceMap(this.gpuBuffers);
    this.sourceUse.clear();
    this.bufferUse.clear();
    this.gpuBufferUse.clear();
    this.lastPruneFrame = -1;
    this.nextIdlePruneFrame = 0;
  }

  useMap(kind) {
    if (kind === "source") return this.sourceUse;
    if (kind === "gpu-buffer") return this.gpuBufferUse;
    return this.bufferUse;
  }
}

export function staleRenderCacheKeys(useMap, { maxItems, currentFrame, idleFrames }) {
  if (useMap.size <= maxItems) {
    const stale = [];
    for (const [key, frame] of useMap) {
      if (frame !== currentFrame && currentFrame - frame > idleFrames) stale.push(key);
    }
    return stale;
  }
  const entries = Array.from(useMap.entries()).sort((a, b) => a[1] - b[1]);
  const stale = [];
  for (const [key, frame] of entries) {
    if (frame === currentFrame) continue;
    const overLimit = entries.length - stale.length > maxItems;
    const idle = currentFrame - frame > idleFrames;
    if (overLimit || idle) stale.push(key);
  }
  return stale;
}

function nextRenderCacheExpiry(...args) {
  const idleFrames = Number(args.pop()) || RENDER_CACHE_IDLE_FRAMES;
  let earliest = Infinity;
  for (const useMap of args) {
    for (const frame of useMap.values()) earliest = Math.min(earliest, Number(frame) || 0);
  }
  return Number.isFinite(earliest) ? earliest + idleFrames + 1 : Infinity;
}

function pruneResourceMap(map, useMap, policy) {
  const stale = staleRenderCacheKeys(useMap, policy);
  for (const key of stale) {
    const item = map.get(key);
    map.delete(key);
    useMap.delete(key);
    disposeResource(item);
  }
}

function disposeResourceMap(map) {
  const seen = new Set();
  for (const item of map.values()) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    disposeResource(item);
  }
  map.clear();
}

function disposeResource(item) {
  disposeRenderTarget(item);
}

export const CacheEngineNode = defineNode({
  id: "core.cache.render-engine",
  name: "Render Cache Engine",
  version: "0.1.0",
  description: "Owns bounded source, raster-buffer, and GPU-buffer caches with idle and pressure pruning.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    engine: { type: "any", optional: true, description: "Optional host-owned cache; otherwise the node owns one in instance state." },
    key: { type: "string", optional: true, defaultValue: "" },
    kind: { type: { type: "enum", values: ["source", "buffer", "gpu-buffer"] }, optional: true, defaultValue: "buffer" },
    frameIndex: { type: "number", optional: true, defaultValue: 0 },
  },
  parameters: {
    command: { type: { type: "enum", values: ["touch", "prune", "dispose"] }, defaultValue: "prune" },
  },
  outlets: { result: { type: "any" } },
  execution: {
    trigger: "manual",
    domain: "main",
    stateful: true,
    asynchronous: false,
    dispose: (instance) => instance.state.engine?.dispose?.(),
  },
  moduleBindings: {
    COMPONENT_SOURCE_CACHE_LIMIT,
    COMPONENT_BUFFER_CACHE_LIMIT,
    COMPONENT_GPU_BUFFER_CACHE_LIMIT,
    RENDER_CACHE_IDLE_FRAMES,
  },
  capabilities: ["cache-engine", "render-cache", "resource-lifetime", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["graph", "cache"], placeableOn: ["node-graph"] },
  parts: [
    {
      id: "render-cache-policy",
      name: "Render cache policy",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["OutputRenderCache", "staleRenderCacheKeys"],
      source: [OutputRenderCache, BoundedRenderTargetPool, staleRenderCacheKeys, nextRenderCacheExpiry, pruneResourceMap, disposeResourceMap, disposeResource]
        .map((value) => value.toString()).join("\n\n"),
    },
    {
      id: "render-cache-process",
      name: "Render cache process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "cacheEngineNodeProcess",
      entry: "process",
      dependsOn: ["render-cache-policy"],
      source: cacheEngineNodeProcess.toString(),
    },
  ],
  process: cacheEngineNodeProcess,
});

export function cacheEngineNodeProcess({ engine: suppliedEngine, command = "prune", key = "", kind = "buffer", frameIndex = 0 } = {}, context = {}) {
  const state = context.state || {};
  const engine = suppliedEngine || state.engine || (state.engine = new OutputRenderCache());
  if (!engine || typeof engine.touch !== "function" || typeof engine.prune !== "function" || typeof engine.dispose !== "function") {
    throw new TypeError("CACHE_ENGINE_INSTANCE_REQUIRED");
  }
  if (command === "touch") engine.touch(kind, key, frameIndex);
  else if (command === "dispose") engine.dispose();
  else engine.prune(frameIndex);
  return {
    result: {
      sources: engine.sources.size,
      buffers: engine.buffers.size,
      gpuBuffers: engine.gpuBuffers.size,
      lastPruneFrame: engine.lastPruneFrame,
    },
  };
}
