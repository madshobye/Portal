// One capability registry connects compiled native renderer IDs to retained
// host kernels. Compilation checks and dispatch must resolve through the same
// owner so a renderer cannot appear installed in one layer but not another.
export class NativeRendererRegistry {
  constructor() {
    this.renderers = new Map();
  }

  register(rendererId, renderer, { replace = false } = {}) {
    const id = String(rendererId || "");
    if (!id || typeof renderer !== "function") {
      throw new TypeError("VJ1_NATIVE_SOURCE_RENDERER_INVALID");
    }
    if (!replace && this.renderers.has(id)) {
      throw new Error(`VJ1_NATIVE_SOURCE_RENDERER_DUPLICATE:${id}`);
    }
    this.renderers.set(id, renderer);
    return renderer;
  }

  has(rendererId) {
    return this.renderers.has(String(rendererId || ""));
  }

  resolve(rendererId) {
    return this.renderers.get(String(rendererId || "")) || null;
  }

  execute(rendererId, ...args) {
    const renderer = this.resolve(rendererId);
    if (!renderer) return false;
    renderer(...args);
    return true;
  }

  capabilities() {
    return Object.freeze([...this.renderers.keys()].sort());
  }

  clear() {
    this.renderers.clear();
  }
}
