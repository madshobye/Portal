const MAX_FRAME_DELTA_SECONDS = 0.1;

export function createPresentationClock() {
  return {
    cadenceFps: 0,
    phaseErrorSeconds: 0,
    rawElapsedSeconds: 0,
    rawDeltaSeconds: 0,
    presentationElapsedSeconds: 0,
    presentationDeltaSeconds: 0,
  };
}

// Browser callbacks are not evenly spaced, even when frameRate() has a stable
// target. Visual nodes need the presentation cadence, not that callback noise.
// Stabilize ordinary jitter around the requested cadence, retain phase error so
// the clock cannot drift, and advance multiple ticks after a genuinely late
// frame. Phase correction is deliberately gradual: hard quantization creates a
// visible catch-up jump every few seconds on 59.94 Hz displays. Raw time remains
// available separately for diagnostics and media sync.
export function advancePresentationClock(previous = null, rawDeltaSeconds = 0, cadenceFps = 60, active = true) {
  const clock = previous || createPresentationClock();
  const rawDelta = clamp(Number(rawDeltaSeconds) || 0, 0, MAX_FRAME_DELTA_SECONDS);
  const fps = clamp(Number(cadenceFps) || 60, 1, 120);
  const step = 1 / fps;
  const cadenceChanged = Math.abs((Number(clock.cadenceFps) || 0) - fps) > 0.000001;
  let phaseError = cadenceChanged ? 0 : Number(clock.phaseErrorSeconds) || 0;
  const ticks = rawDelta > 0 ? Math.max(1, Math.round(rawDelta / step)) : 0;

  phaseError += rawDelta - ticks * step;
  const correctionLimit = step * 0.1;
  const phaseCorrection = clamp(phaseError * 0.1, -correctionLimit, correctionLimit);
  const presentationDelta = active ? Math.max(0, ticks * step + phaseCorrection) : 0;
  if (active) phaseError -= phaseCorrection;
  return {
    cadenceFps: fps,
    phaseErrorSeconds: active ? phaseError : 0,
    rawElapsedSeconds: (Number(clock.rawElapsedSeconds) || 0) + rawDelta,
    rawDeltaSeconds: rawDelta,
    presentationElapsedSeconds: (Number(clock.presentationElapsedSeconds) || 0) + presentationDelta,
    presentationDeltaSeconds: presentationDelta,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
