import { renderPresentationFrameRate } from "../domain/render-settings.js?v=surface-terminology-1";
import { createManualScheduler } from "../graph/manual-scheduler.js";
import {
  advancePresentationClock,
  createPresentationClock,
} from "../libraries/timing-engine/presentation-clock/index.js?v=presentation-clock-1";
import { RENDER_CACHE_IDLE_FRAMES } from "../libraries/cache-engine/render-cache/index.js?v=periodic-preview-maintenance-1";
import { globalVisualTimeScale } from "./render-runtime-math.js?v=declarative-render-policy-1";

// Owns presentation time, frame identity, manual-event delivery, cadence
// classification, and periodic retained-cache maintenance. It neither executes
// visual plans nor controls the browser's p5 loop.
export class OutputFrameRuntime {
  constructor(host) {
    this.host = host;
    this.frameStart = 0;
    this.lastTickMs = 0;
    this.frameDeltaSeconds = 0;
    this.visualDeltaSeconds = 0;
    this.visualTime = 0;
    this.rawElapsedTime = 0;
    this.presentationClock = createPresentationClock();
    this.frameIndex = 0;
    this.scheduledEvents = [];
    this.manualScheduler = createManualScheduler();
    this.componentTimes = new Map();
  }

  begin(nowMs = performance.now()) {
    const host = this.host;
    this.frameStart = nowMs;
    this.frameIndex++;
    host.profileRuntime.beginFrame(this.frameIndex);
    this.tickClock(nowMs);
  }

  finish() {
    const host = this.host;
    this.pruneCaches();
    host.profileRuntime.finishFrame(this.frameStart);
    host.componentRenderRuntime.finishFrame();
    host.presentationMetrics.update({ frameStart: this.frameStart });
  }

  tickClock(nowMs) {
    const host = this.host;
    if (!this.lastTickMs) {
      this.lastTickMs = nowMs;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (nowMs - this.lastTickMs) / 1000));
    this.frameDeltaSeconds = dt;
    this.lastTickMs = nowMs;
    const playing = this.isPlaybackActive();
    this.presentationClock = advancePresentationClock(
      this.presentationClock,
      dt,
      renderPresentationFrameRate(host.state?.render, {
        mode: host.mode,
        thumbnailPreview: host.presentationRuntime.shouldUseThumbnailPreview(),
        outputWindowOpen: host.state?.ui?.outputWindowOpen === true,
      }),
      playing,
    );
    this.rawElapsedTime = this.presentationClock.rawElapsedSeconds;
    const timeScale = globalVisualTimeScale(host.state?.global);
    this.visualDeltaSeconds = this.presentationClock.presentationDeltaSeconds * timeScale;
    if (!playing) return;
    this.visualTime += this.visualDeltaSeconds;
    const components = host.componentProgramRuntime.componentById.size
      ? host.componentProgramRuntime.componentById.values()
      : [
        ...(host.state?.components || []),
        ...(host.componentProgramRuntime.runtimeComponents || []),
      ];
    for (const component of components) {
      const speed = Math.max(0, Number(component.speed) || 0);
      this.componentTimes.set(
        component.id,
        (this.componentTimes.get(component.id) || 0) + this.visualDeltaSeconds * speed,
      );
    }
  }

  isPlaybackActive() {
    return this.host.state?.global?.playing !== false;
  }

  schedule(event) {
    if (this.host.state?.scheduler?.manualLane === false) return;
    this.manualScheduler.enqueue(event);
    this.host.invalidatePresentation("schedule");
  }

  drainScheduledEvents() {
    this.scheduledEvents = this.host.state?.scheduler?.manualLane === false
      ? []
      : this.manualScheduler.drain({
        frame: this.frameIndex,
        time: this.visualTime,
      });
    return this.scheduledEvents;
  }

  pruneComponentTimes() {
    if (!this.componentTimes.size) return;
    const host = this.host;
    const liveComponentIds = new Set([
      ...(host.state?.components || []).map((component) => component.id),
      ...(host.componentProgramRuntime.runtimeComponents || [])
        .map((component) => component.id),
    ]);
    for (const id of this.componentTimes.keys()) {
      if (!liveComponentIds.has(id)) this.componentTimes.delete(id);
    }
  }

  pruneCaches() {
    const host = this.host;
    if (!host.resourceRuntime.renderCache.prune(this.frameIndex)) return;
    host.componentRenderRuntime.pruneStableSignatures();
    host.renderEvaluationRuntime.prune();
    host.sourceRuntime.prune();
    host.shaderGeneratorRuntime.prune(RENDER_CACHE_IDLE_FRAMES);
    host.isfRuntime.prune(RENDER_CACHE_IDLE_FRAMES);
  }

  presentationMode() {
    const host = this.host;
    if (!host.state) return "continuous";
    if (!this.isPlaybackActive()) return "on-change";
    if (host.presentationRuntime.shouldUseThumbnailPreview()) return "continuous";
    if (
      host.livePatchRuntime.active ||
      host.previewInteraction.chainTransformDrag ||
      host.previewInteraction.surfaceDrag
    ) return "continuous";
    if (
      this.manualScheduler.size ||
      host.mappingRuntime.mapper?.isActive?.() ||
      host.surfaceRuntime.currentLiveTransition()
    ) return "continuous";
    const ids = host.presentationRuntime.neededComponentIds();
    for (const componentId of ids) {
      const component = host.componentProgramRuntime.programs.has(componentId)
        ? host.componentProgramRuntime.componentForId(componentId)
        : null;
      // Decoder callbacks identify new media revisions, but they are not a
      // presentation clock. Active video graphs retain host cadence while
      // decoded revisions prevent unchanged texture uploads.
      if (
        !component ||
        host.sourceRuntime.componentContainsVideo(component) ||
        host.componentRenderRuntime.isFrameDynamic(component)
      ) return "continuous";
    }
    return "on-change";
  }
}
