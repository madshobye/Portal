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
      if (!patch?.path) continue;
      const targetKey = patch.target === "state"
        ? "state"
        : patch.componentId
          ? `component:${patch.componentId}${patch.itemId ? `:item:${patch.itemId}` : ""}`
          : "";
      if (!targetKey) continue;
      this.pending.set(`${targetKey}:${patch.path}`, patch);
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
      revision: this.revision + 1,
      patches: [...this.pending.values()],
    };
    this.pending.clear();
    // A transport failure must not advance the ordering authority. The failed
    // packet is consumed exactly once; a later valid packet can then continue
    // from the last revision the receiver could actually have observed.
    this.onPatch(packet);
    this.revision = packet.revision;
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
  // Pointer events arrive as separate tasks, so microtask scheduling can emit
  // every intermediate sample and build a transport/render queue. A render
  // patch is presentation state: one latest value per browser frame is the
  // useful contract. Non-browser tests retain deterministic microtask timing.
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
  else if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}
