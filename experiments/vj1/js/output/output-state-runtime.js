import { sanitizeState } from "../domain/models.js";
import { cameraSettingsSignature } from "./shared-input-runtime.js";

// Owns activation of the semantic project snapshot and every retained program
// derived from it. State changes are transactional at this boundary: frame
// execution observes the new snapshot only after local interaction state has
// been reconciled, then all compiled lookups are rebuilt before presentation
// resumes. OutputRenderer.state remains a narrow compatibility facade for
// interaction and transition scopes that temporarily substitute a snapshot.
export class OutputStateRuntime {
  constructor(host) {
    this.host = host;
    this.current = null;
  }

  replace(state) {
    this.current = state || null;
    return this.current;
  }

  initialize(initialState, { normalized = false } = {}) {
    const host = this.host;
    this.current = normalized
      ? initialState
      : sanitizeState(initialState || {});
    // Initial setup must consume the resolved preview viewport just like every
    // later activation. Otherwise the geometry runtime keeps its constructor
    // default (1x) until a workspace switch happens to assign the real fit.
    host.presentationGeometry.assignViewport(this.current?.render);
    this.rebuildCompiledState();
    if (host.presentationRuntime.shouldUseThumbnailPreview()) {
      host.thumbnailRuntime.captureEditTransformBaselines();
    }
    host.resourceRuntime.applyPixelDensity();
    host.resourceRuntime.applyGlobalFont();
    host.resourceRuntime.createBuffers();
    host.mappingRuntime.create();
    return this.current;
  }

  activate(nextState, { normalized = false } = {}) {
    const host = this.host;
    host.invalidatePresentation("state");
    const wasThumbnailPreview =
      host.presentationRuntime.shouldUseThumbnailPreview();
    const previousCameraSignature = cameraSettingsSignature(
      this.current?.render,
    );
    const previousMappingState = host.mappingRuntime.captureState();
    const preparedState = normalized
      ? nextState
      : sanitizeState(nextState);
    host.surfaceRuntime.retainPresentedBranchForTransitions(
      this.current,
      preparedState,
    );
    host.livePatchRuntime.clear();
    this.current =
      host.previewInteraction?.reconcileIncomingState(preparedState) ||
      preparedState;
    host.presentationGeometry.assignViewport(this.current?.render);
    host.sourceRuntime.invalidateStructure();
    host.frameRuntime.pruneComponentTimes();
    if (host.componentProgramRuntime.adoptPrepared?.(this.current) === true) {
      // The inactive A/B slot was compiled while the presented branch stayed
      // live. Adopt it without compiling the target again at transition start.
      // Mapping and transition lookups still follow the newly active state.
      host.visualNodeRuntime.rebuild(this.current);
      host.transitionRuntime.rebuild();
      host.mappingProgramRuntime.rebuild(this.current);
      host.componentProgramRuntime.rebuildLookups(this.current);
    } else {
      this.rebuildCompiledState();
    }
    const nextCameraSignature = cameraSettingsSignature(this.current?.render);
    if (
      previousCameraSignature &&
      previousCameraSignature !== nextCameraSignature
    ) {
      host.mediaRuntime.releaseCameraInput();
    }
    const isThumbnailPreview =
      host.presentationRuntime.shouldUseThumbnailPreview();
    if (isThumbnailPreview && !wasThumbnailPreview) {
      host.thumbnailRuntime.captureEditTransformBaselines();
    }
    if (!isThumbnailPreview && wasThumbnailPreview) {
      host.thumbnailRuntime.transformBaselines.clear();
    }
    host.mappingRuntime.reconcileState(previousMappingState);
    host.thumbnailRuntime.invalidateSelectedComponent();
    return this.current;
  }

  activateUi(nextState, { normalized = false } = {}) {
    const host = this.host;
    host.invalidatePresentation("ui-state");
    const preparedState = normalized
      ? nextState
      : sanitizeState(nextState);
    this.current =
      host.previewInteraction?.reconcileIncomingState(preparedState) ||
      preparedState;
    host.presentationGeometry.assignViewport(this.current?.render);
    // UI navigation does not change authored graph topology. Retain every
    // compiled program and only materialize a newly selected Component root
    // when component-mode reachability did not previously include it.
    host.componentProgramRuntime.ensureStateRoots(this.current);
    host.componentProgramRuntime.rebuildLookups(this.current);
    host.thumbnailRuntime.invalidateSelectedComponent();
    return this.current;
  }

  activateMapping(nextState, { normalized = false } = {}) {
    const host = this.host;
    host.invalidatePresentation("mapping-state");
    const previousMappingState = host.mappingRuntime.captureState();
    const preparedState = normalized
      ? nextState
      : sanitizeState(nextState);
    this.current =
      host.previewInteraction?.reconcileIncomingState(preparedState) ||
      preparedState;
    // Mapping edits change route geometry/calibration, not visual definitions
    // or Component topology. Recompile only the Mapping/Output program and
    // reconcile the retained mapper against its previous interaction state.
    host.mappingProgramRuntime.rebuild(this.current);
    host.mappingRuntime.reconcileState(previousMappingState);
    host.thumbnailRuntime.invalidateSelectedComponent();
    return this.current;
  }

  activateProjection(nextState, { normalized = false } = {}) {
    const host = this.host;
    host.invalidatePresentation("projection-state");
    const previousMappingState = host.mappingRuntime.captureState();
    const preparedState = normalized
      ? nextState
      : sanitizeState(nextState);
    this.current =
      host.previewInteraction?.reconcileIncomingState(preparedState) ||
      preparedState;
    host.presentationGeometry.assignViewport(this.current?.render);
    // A Live matrix row is UI selection in the authored project but executable
    // topology in the derived Preview: Scene Mapping has one flat monitor,
    // whereas Direct Output and Surface rows use the projected route program.
    // Materialize only roots newly reachable through that projection, retain
    // all compiled Component programs/resources, then replace Mapping geometry
    // and its lookups as one activation.
    host.componentProgramRuntime.ensureStateRoots(this.current);
    host.mappingProgramRuntime.rebuild(this.current);
    host.componentProgramRuntime.rebuildLookups(this.current);
    host.mappingRuntime.reconcileState(previousMappingState);
    host.thumbnailRuntime.invalidateSelectedComponent();
    return this.current;
  }

  activateAssets(nextState, { normalized = false } = {}) {
    const host = this.host;
    host.invalidatePresentation("asset-catalog-state");
    const preparedState = normalized
      ? nextState
      : sanitizeState(nextState);
    this.current =
      host.previewInteraction?.reconcileIncomingState(preparedState) ||
      preparedState;
    // Media files and metadata are resolved through the current state and the
    // retained media runtime. They do not alter executable topology. Project
    // ISF/package definitions do: VisualNodeRuntime is the signature authority
    // and reports whether the executable catalog actually changed.
    const visualDefinitionsChanged =
      host.visualNodeRuntime.rebuild(this.current) === true;
    if (visualDefinitionsChanged) {
      host.transitionRuntime.rebuild();
      host.componentProgramRuntime.rebuild(this.current);
      host.componentProgramRuntime.rebuildLookups(this.current);
      // Compiled operation state does not embed shader source. A definition
      // edit must therefore invalidate stable Component signatures explicitly
      // or a static Component could retain pixels produced by the old shader.
      host.componentRenderRuntime.clear();
      host.thumbnailRuntime.invalidateSelectedComponent();
    }
    return this.current;
  }

  rebuildCompiledState() {
    const host = this.host;
    host.visualNodeRuntime.rebuild(this.current);
    host.transitionRuntime.rebuild();
    host.componentProgramRuntime.rebuild(this.current);
    host.mappingProgramRuntime.rebuild(this.current);
    host.componentProgramRuntime.rebuildLookups(this.current);
  }
}
