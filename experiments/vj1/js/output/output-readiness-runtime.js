import { createMediaReadinessStatus } from "./component-render-state.js?v=async-media-dirty-1";
import {
  collectComponentReadiness,
  collectOutputReadiness,
} from "./output-readiness-collector.js?v=async-media-dirty-1";
import { frameSize } from "./render-geometry.js?v=fit-geometry-demand-1";

export class OutputReadinessRuntime {
  constructor(host) {
    this.host = host;
    this.status = createMediaReadinessStatus();
  }

  refresh() {
    this.status = this.forState(this.host.state);
    return this.status;
  }

  prepare(state, { requireMedia = false } = {}) {
    const programs = this.host.componentProgramRuntime.prepare(state);
    const status = this.forState(state, {
      requireMedia,
      programs,
    });
    this.host.mediaRuntime.reserveMedia(status.mediaIds);
    return status;
  }

  clearPrepared() {
    this.host.componentProgramRuntime.clearPrepared();
    this.host.mediaRuntime.reserveMedia();
  }

  forState(
    state,
    { requireMedia = false, programs = this.host.componentProgramRuntime.programs } = {},
  ) {
    const frame = frameSize(state?.render || {});
    const status = collectOutputReadiness({
      mode: requireMedia ? "output" : this.host.mode,
      state,
      media: this.host.media,
      programs,
      acquireMedia: (id) =>
        this.host.mediaRuntime.acquireMedia(this.host.media.get(id), { width: frame.width }),
      controlSignals: this.host.controlSignalRuntime,
      resourceReadiness: (requirement, context) =>
        this.host.mediaRuntime.resourceReadiness(requirement, context),
      capabilityReadiness: (requirement, context) =>
        this.host.specializedSources.capabilityReadiness(requirement, context),
    });
    this.host.mediaRuntime.requestMissingMediaBatch(Array.from(status.missingIds));
    return status;
  }

  forComponent(component) {
    const host = this.host;
    return collectComponentReadiness({
      component,
      components: host.state?.components || [],
      media: host.media,
      programs: host.componentProgramRuntime.programs,
      acquireMedia: (id) => host.mediaRuntime.acquireMediaById(id),
      controlSignals: host.controlSignalRuntime,
      resourceReadiness: (requirement, context) =>
        host.mediaRuntime.resourceReadiness(requirement, context),
      capabilityReadiness: (requirement, context) =>
        host.specializedSources.capabilityReadiness(requirement, context),
    });
  }

  isComponentReady(component) {
    return !this.forComponent(component).blocked;
  }

  isBlackout() {
    return this.host.mode === "output" &&
      (!!this.host.state?.global?.blackout || !!this.status?.blocked);
  }

  shouldHoldFrame() {
    const status = this.status;
    return this.host.mode === "output" &&
      !this.host.state?.global?.blackout &&
      (
        status?.loadingIds?.size > 0 ||
        status?.pendingResourceIds?.size > 0
      ) &&
      status?.missingIds?.size === 0 &&
      status?.errorIds?.size === 0;
  }
}
