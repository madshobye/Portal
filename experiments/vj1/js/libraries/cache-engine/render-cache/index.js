import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

const COMPONENT_SOURCE_CACHE_LIMIT = 48;
const COMPONENT_BUFFER_CACHE_LIMIT = 48;
const COMPONENT_GPU_BUFFER_CACHE_LIMIT = 64;
export const RENDER_CACHE_IDLE_FRAMES = 900;
const RENDER_CACHE_MAINTENANCE_FRAMES = 120;

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
    this.lastPruneFrame = -RENDER_CACHE_MAINTENANCE_FRAMES;
  }

  touch(kind, key, frameIndex) {
    this.useMap(kind).set(key, frameIndex);
  }

  prune(frameIndex) {
    const underPressure = this.sourceUse.size > COMPONENT_SOURCE_CACHE_LIMIT ||
      this.bufferUse.size > COMPONENT_BUFFER_CACHE_LIMIT ||
      this.gpuBufferUse.size > COMPONENT_GPU_BUFFER_CACHE_LIMIT;
    if (!underPressure && frameIndex - this.lastPruneFrame < RENDER_CACHE_MAINTENANCE_FRAMES) return false;
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
    return true;
  }

  dispose() {
    disposeResourceMap(this.sources);
    disposeResourceMap(this.buffers);
    disposeResourceMap(this.gpuBuffers);
    this.sourceUse.clear();
    this.bufferUse.clear();
    this.gpuBufferUse.clear();
    this.lastPruneFrame = -RENDER_CACHE_MAINTENANCE_FRAMES;
  }

  useMap(kind) {
    if (kind === "source") return this.sourceUse;
    if (kind === "gpu-buffer") return this.gpuBufferUse;
    return this.bufferUse;
  }
}

export function staleRenderCacheKeys(useMap, { maxItems, currentFrame, idleFrames }) {
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
  try { item?.remove?.(); } catch {}
}

export const CacheEngineNode = defineNode({
  id: "core.cache.render-engine",
  name: "Render Cache Engine",
  version: "0.1.0",
  description: "Owns bounded source, raster-buffer, and GPU-buffer caches with idle and pressure pruning.",
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: {
    engine: { type: "any", required: true },
    key: { type: "string", optional: true, defaultValue: "" },
    kind: { type: { type: "enum", values: ["source", "buffer", "gpu-buffer"] }, optional: true, defaultValue: "buffer" },
    frameIndex: { type: "number", optional: true, defaultValue: 0 },
  },
  parameters: {
    command: { type: { type: "enum", values: ["touch", "prune", "dispose"] }, defaultValue: "prune" },
  },
  outlets: { result: { type: "any" } },
  execution: { trigger: "manual", domain: "main", stateful: true, asynchronous: false },
  capabilities: ["cache-engine", "render-cache", "resource-lifetime", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["graph", "cache"], placeableOn: ["node-graph"] },
  parts: [{
    id: "render-cache-policy",
    name: "Render cache policy",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "OutputRenderCache",
    source: [OutputRenderCache, staleRenderCacheKeys, pruneResourceMap, disposeResourceMap, disposeResource]
      .map((value) => value.toString()).join("\n\n"),
  }],
  process: cacheEngineNodeProcess,
});

export function cacheEngineNodeProcess({ engine, command = "prune", key = "", kind = "buffer", frameIndex = 0 } = {}) {
  if (!(engine instanceof OutputRenderCache)) throw new TypeError("CACHE_ENGINE_INSTANCE_REQUIRED");
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
