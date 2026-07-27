// Retained loader for immutable images declared by an ISF IMPORTED block.
// Repository components carry resolved, closed resource descriptors, so this
// runtime never performs path resolution or accepts arbitrary shader URLs.
export class IsfImportedImageRuntime {
  constructor(host, {
    loadImage = (url, onLoad, onError) =>
      globalThis.loadImage?.(url, onLoad, onError),
  } = {}) {
    this.host = host;
    this.loadImage = loadImage;
    this.entries = new Map();
    this.revision = 0;
  }

  texture(component, importedDefinition) {
    const descriptor = component?.isfImportedResources?.[
      importedDefinition?.name
    ];
    if (!descriptor) return null;
    let entry = this.entries.get(descriptor.id);
    if (
      entry?.status === "error" &&
      this.frameIndex() > entry.failedFrame
    ) {
      entry.image?.remove?.();
      this.entries.delete(descriptor.id);
      entry = null;
    }
    if (!entry) {
      entry = {
        status: "loading",
        image: null,
        lastUsed: this.frameIndex(),
        revision: ++this.revision,
      };
      this.entries.set(descriptor.id, entry);
      const complete = (image) => {
        if (this.entries.get(descriptor.id) !== entry) return;
        entry.image = image || entry.image;
        entry.status = entry.image ? "ready" : "error";
        entry.revision = ++this.revision;
        this.invalidate("isf-imported-image-ready");
      };
      const fail = (error) => {
        if (this.entries.get(descriptor.id) !== entry) return;
        entry.status = "error";
        entry.failedFrame = this.frameIndex();
        entry.error = error?.message || String(error || "Image load failed");
        entry.revision = ++this.revision;
        console.error("[VJ1_ISF_IMPORTED_IMAGE_LOAD_FAILED]", {
          resource: descriptor.id,
          message: entry.error,
        });
        this.invalidate("isf-imported-image-failed");
      };
      try {
        const pending = this.loadImage(descriptor.url, complete, fail);
        if (!pending) fail(new Error("p5 loadImage is unavailable"));
        else entry.image = pending;
      } catch (error) {
        fail(error);
      }
    }
    entry.lastUsed = this.frameIndex();
    return entry.status === "ready" ? entry.image : null;
  }

  externalKey(component) {
    const resources = component?.isfImportedResources;
    if (!resources || !Object.keys(resources).length) return null;
    return Object.values(resources)
      .map((descriptor) => {
        const entry = this.entries.get(descriptor.id);
        return `${descriptor.id}:${entry?.status || "unrequested"}:${entry?.revision || 0}`;
      })
      .join("|");
  }

  prune(maxIdleFrames = 600) {
    const frameIndex = this.frameIndex();
    for (const [id, entry] of this.entries) {
      if (frameIndex - entry.lastUsed <= maxIdleFrames) continue;
      entry.image?.remove?.();
      this.entries.delete(id);
      this.revision += 1;
    }
  }

  dispose() {
    for (const entry of this.entries.values()) entry.image?.remove?.();
    this.entries.clear();
    this.revision += 1;
  }

  frameIndex() {
    return Math.max(0, Number(this.host.frameRuntime?.frameIndex) || 0);
  }

  invalidate(reason) {
    this.host.invalidatePresentation?.(reason);
  }
}
