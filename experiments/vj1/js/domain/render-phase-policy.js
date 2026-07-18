const DEFAULT_FRAME_RATE = 60;
const MIN_FRAME_RATE = 1;
const MAX_FRAME_RATE = 120;

export function oppositeRenderPhaseDelayMs(frameRate) {
  const rate = Math.max(MIN_FRAME_RATE, Math.min(MAX_FRAME_RATE, Number(frameRate) || DEFAULT_FRAME_RATE));
  return 500 / rate;
}

export function previewPhaseNeedsRealignment({
  outputWindowOpen = false,
  wasOutputWindowOpen = false,
  frameRate = 0,
  alignedFrameRate = 0,
} = {}) {
  if (!outputWindowOpen) return false;
  return !wasOutputWindowOpen || Number(frameRate) !== Number(alignedFrameRate);
}
