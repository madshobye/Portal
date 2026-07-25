import {
  createTransitionCatalog,
  transitionParameterValues,
} from "../libraries/transition-engine/index.js";

// Owns activation and parameter resolution for the same transition kernels
// consumed by texture nodes and Surface presentation. It performs no frame
// rendering: optimized hosts receive the already-resolved immutable kernel.
export class TransitionRuntime {
  constructor({
    getState,
    getVisualNodes,
    disposeTransitionShaders,
    retainTransitionKernels,
  }) {
    this.getState = getState;
    this.getVisualNodes = getVisualNodes;
    this.disposeTransitionShaders = disposeTransitionShaders;
    this.retainTransitionKernels = retainTransitionKernels;
    this.catalog = createTransitionCatalog();
    this.signature = "";
  }

  invalidate() {
    this.signature = "";
  }

  rebuild() {
    const state = this.getState?.() || {};
    const visualNodes = this.getVisualNodes?.();
    const signature = JSON.stringify({
      definitions: (state.nodes?.definitions || [])
        .filter((definition) => definition?.metadata?.isf?.kind === "transition")
        .map((definition) => [
          definition?.id,
          definition?.version,
          definition?.metadata?.visualId,
          definition?.metadata?.isf?.sourceHash,
        ]),
      packages: (state.nodes?.packages || []).map((reference) => [
        reference?.id,
        reference?.version,
        reference?.enabled !== false,
      ]),
    });
    if (signature === this.signature) return false;

    this.signature = signature;
    this.catalog = createTransitionCatalog(
      visualNodes?.transitionEntries || [],
    );
    this.disposeTransitionShaders?.();
    this.retainActiveKernels();
    return true;
  }

  retainActiveKernels() {
    this.retainTransitionKernels?.(
      this.catalog.list().map((entry) => entry.kernel),
    );
  }

  resolve(id = "", parameters = {}) {
    const entry = this.catalog.get(id);
    return Object.freeze({
      transitionKernel: entry.kernel,
      transitionParameters: transitionParameterValues(
        entry,
        parameters && typeof parameters === "object" ? parameters : {},
      ),
    });
  }
}
