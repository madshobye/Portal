import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export class MediaInputLifecycle {
  constructor({ idleGraceMs = 750, retryMs = 3000, clock = () => Date.now(), onError = () => {}, onReady = () => {} } = {}) {
    this.idleGraceMs = Math.max(0, Number(idleGraceMs) || 0);
    this.retryMs = Math.max(0, Number(retryMs) || 0);
    this.clock = clock;
    this.onError = onError;
    this.onReady = onReady;
    this.resource = null;
    this.requested = false;
    this.demanded = false;
    this.error = "";
    this.signature = "";
    this.requestToken = 0;
    this.retryAt = 0;
    this.releaseTimer = 0;
  }

  beginFrame() {
    this.demanded = false;
  }

  acquire(signature, setup) {
    this.demanded = true;
    this.cancelRelease();
    if (this.resource && this.signature === signature) return this.resource;
    if (this.requested && this.signature === signature) return null;
    if (this.error && this.signature === signature && this.clock() < this.retryAt) return null;
    if (this.resource || this.requested) this.release();
    this.demanded = true;
    this.requested = true;
    this.error = "";
    this.signature = signature;
    const requestToken = ++this.requestToken;
    let request;
    try {
      request = setup();
    } catch (error) {
      request = Promise.reject(error);
    }
    Promise.resolve(request).then((resource) => {
      if (requestToken !== this.requestToken) {
        resource?.remove?.();
        return;
      }
      this.resource = resource;
      this.requested = false;
      this.error = "";
      this.retryAt = 0;
      this.onReady(resource, signature);
    }).catch((error) => {
      if (requestToken !== this.requestToken) return;
      this.error = error?.message || String(error) || "media input unavailable";
      this.retryAt = this.clock() + this.retryMs;
      this.requested = false;
      this.onError(this.error, signature);
    });
    return null;
  }

  endFrame() {
    if (this.demanded || this.releaseTimer || (!this.resource && !this.requested)) return;
    const requestToken = this.requestToken;
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = 0;
      if (this.demanded || this.requestToken !== requestToken) return;
      this.release();
    }, this.idleGraceMs);
  }

  fail(message, signature = this.signature) {
    this.error = message || "media input unavailable";
    this.signature = signature;
    this.retryAt = this.clock() + this.retryMs;
    this.requested = false;
    this.onError(this.error, signature);
  }

  release() {
    this.cancelRelease();
    this.requestToken++;
    this.resource?.remove?.();
    this.resource = null;
    this.requested = false;
    this.signature = "";
    this.retryAt = 0;
    this.demanded = false;
  }

  cancelRelease() {
    if (!this.releaseTimer) return;
    clearTimeout(this.releaseTimer);
    this.releaseTimer = 0;
  }
}

export const MediaInputLifecycleNode = defineNode({
  id: "core.media.input-lifecycle",
  name: "Media Input Lifecycle",
  version: "0.1.0",
  description: "Shares demanded media inputs, bounds retries, and releases idle resources after a grace period.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    demand: { type: "boolean", required: true },
    signature: { type: "string", optional: true, defaultValue: "default" },
    setup: { type: "any", optional: true, description: "Capability that acquires the requested host media resource." },
    lifecycle: { type: "any", optional: true, description: "Optional allocation-stable host lifecycle instance." },
  },
  outlets: { resource: { type: "any", optional: true }, status: { type: "string" } },
  parameters: {
    idleGraceMs: { type: "number", defaultValue: 750, allowedRange: [0, 60000] },
    retryMs: { type: "number", defaultValue: 3000, allowedRange: [0, 60000] },
  },
  execution: {
    trigger: "input-change",
    domain: "main",
    stateful: true,
    asynchronous: true,
    dispose: (instance) => instance.state.lifecycle?.release?.(),
  },
  parts: [
    {
      id: "media-input-lifecycle",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      name: "Demand, retry, and release lifecycle",
      export: "MediaInputLifecycle",
      source: MediaInputLifecycle.toString(),
    },
    {
      id: "media-input-process",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      name: "Media lifecycle process entry",
      export: "mediaInputLifecycleNodeProcess",
      entry: "process",
      dependsOn: ["media-input-lifecycle"],
      source: mediaInputLifecycleNodeProcess.toString(),
    },
  ],
  capabilities: ["media-input", "resource-sharing", "bounded-retry"],
  process: mediaInputLifecycleNodeProcess,
});

export function mediaInputLifecycleNodeProcess(inputs = {}, context = {}) {
  const state = context.state || {};
  let lifecycle = inputs.lifecycle || state.lifecycle;
  if (!lifecycle) {
    lifecycle = new MediaInputLifecycle({
      idleGraceMs: inputs.idleGraceMs,
      retryMs: inputs.retryMs,
      clock: typeof context.clock === "function" ? context.clock : undefined,
      onError: typeof context.onError === "function" ? context.onError : undefined,
      onReady: typeof context.onReady === "function" ? context.onReady : undefined,
    });
    state.lifecycle = lifecycle;
  }
  if (typeof lifecycle.beginFrame !== "function" || typeof lifecycle.acquire !== "function" || typeof lifecycle.endFrame !== "function") {
    throw new TypeError("MEDIA_INPUT_LIFECYCLE_REQUIRED");
  }
  lifecycle.beginFrame();
  let resource = lifecycle.resource || null;
  if (inputs.demand) {
    const setup = typeof inputs.setup === "function" ? inputs.setup : context.setup;
    if (typeof setup === "function") resource = lifecycle.acquire(inputs.signature || "default", setup) || lifecycle.resource || null;
    else lifecycle.fail("media input setup unavailable", inputs.signature || "default");
  }
  lifecycle.endFrame();
  const status = lifecycle.error
    ? `error:${lifecycle.error}`
    : lifecycle.resource
      ? "ready"
      : lifecycle.requested
        ? `requested:${inputs.signature || "default"}`
        : "idle";
  return { ...(resource ? { resource } : {}), status };
}
