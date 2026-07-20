import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export class LivePatchSynchronizer {
  constructor({ onPatch = () => {}, schedule = defaultSchedule } = {}) {
    this.onPatch = onPatch;
    this.scheduleTask = schedule;
    this.pending = new Map();
    this.scheduled = false;
    this.scheduleToken = 0;
    this.revision = 0;
  }

  stateRevision({ broadcast = true } = {}) {
    if (broadcast) {
      this.cancelPending();
      this.revision++;
    }
    return this.revision;
  }

  queue(patches = []) {
    for (const patch of patches) {
      if (!patch?.componentId || !patch?.path) continue;
      this.pending.set(`${patch.componentId}:${patch.path}`, patch);
    }
    return this.pending.size;
  }

  schedule() {
    if (this.scheduled) return false;
    this.scheduled = true;
    const token = ++this.scheduleToken;
    this.scheduleTask(() => {
      if (!this.scheduled || token !== this.scheduleToken) return;
      this.scheduled = false;
      this.flush();
    });
    return true;
  }

  flush() {
    if (this.scheduled) this.scheduleToken++;
    this.scheduled = false;
    if (!this.pending.size) return null;
    const packet = {
      baseRevision: this.revision,
      revision: ++this.revision,
      patches: [...this.pending.values()],
    };
    this.pending.clear();
    this.onPatch(packet);
    return packet;
  }

  cancelPending() {
    if (this.scheduled) this.scheduleToken++;
    this.scheduled = false;
    this.pending.clear();
  }

  get pendingCount() {
    return this.pending.size;
  }
}

export const LivePatchSynchronizerNode = defineNode({
  id: "core.synchronization.live-patches",
  name: "Live Patch Synchronizer",
  version: "0.1.0",
  description: "Coalesces live parameter patches by path and maintains monotonic state revisions.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { patches: { type: "any", required: true } },
  outlets: { packet: { type: "any" } },
  parameters: { coalesce: { type: "boolean", defaultValue: true } },
  execution: {
    trigger: "input-change",
    domain: "main",
    stateful: true,
    dispose: (instance) => instance.state.synchronizer?.cancelPending?.(),
  },
  parts: [
    {
      id: "patch-revision-engine",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      name: "Patch coalescing and revision engine",
      export: "LivePatchSynchronizer",
      source: [LivePatchSynchronizer, defaultSchedule].map((value) => value.toString()).join("\n\n"),
    },
    {
      id: "live-patch-process",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      name: "Live patch process entry",
      export: "livePatchSynchronizerNodeProcess",
      entry: "process",
      dependsOn: ["patch-revision-engine"],
      source: livePatchSynchronizerNodeProcess.toString(),
    },
  ],
  capabilities: ["synchronization", "patch-coalescing", "revision-ordering"],
  process: livePatchSynchronizerNodeProcess,
});

export function livePatchSynchronizerNodeProcess({ patches = [], coalesce = true } = {}, context = {}) {
  const state = context.state || {};
  const synchronizer = state.synchronizer || (state.synchronizer = new LivePatchSynchronizer());
  if (!coalesce) synchronizer.cancelPending();
  synchronizer.queue(patches);
  const packet = synchronizer.flush();
  return { packet: packet || {
    baseRevision: synchronizer.revision,
    revision: synchronizer.revision,
    patches: [],
  } };
}

function defaultSchedule(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}
