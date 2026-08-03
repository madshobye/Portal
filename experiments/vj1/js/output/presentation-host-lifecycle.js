// Shared browser-host mechanics for Preview and Output. Rendering policy,
// sizing math, pointer interaction, and state preparation remain with their
// respective hosts; setup ownership and resize delivery do not.
export function createPresentationHostLifecycle({
  onResize = () => {},
  canResize = () => true,
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (handle) => globalThis.cancelAnimationFrame(handle),
  ResizeObserverClass = globalThis.ResizeObserver,
} = {}) {
  let setupClaimed = false;
  let observer = null;
  let observedTarget = null;
  let observedSignature = "";
  let resizeFrame = 0;

  function claimSetup() {
    if (setupClaimed) return false;
    setupClaimed = true;
    return true;
  }

  function observe(target) {
    if (observedTarget === target) return false;
    if (!observer && typeof ResizeObserverClass === "function") {
      observer = new ResizeObserverClass(scheduleObservedResize);
    }
    if (observedTarget) observer?.unobserve?.(observedTarget);
    observedTarget = target || null;
    observedSignature = "";
    if (observedTarget) observer?.observe?.(observedTarget);
    return true;
  }

  function scheduleObservedResize(entries = []) {
    const entry = entries.find((candidate) => candidate.target === observedTarget) || entries.at(-1);
    const rect = entry?.contentRect;
    const signature = rect
      ? `${Math.floor(Number(rect.width) || 0)}:${Math.floor(Number(rect.height) || 0)}`
      : "";
    if (signature && signature === observedSignature) return false;
    observedSignature = signature;
    return requestResize();
  }

  function requestResize() {
    if (!canResize() || resizeFrame) return false;
    resizeFrame = requestFrame(() => {
      resizeFrame = 0;
      if (canResize()) onResize();
    });
    return true;
  }

  function dispose() {
    observer?.disconnect?.();
    observer = null;
    observedTarget = null;
    observedSignature = "";
    if (resizeFrame) cancelFrame(resizeFrame);
    resizeFrame = 0;
  }

  return Object.freeze({
    claimSetup,
    observe,
    requestResize,
    dispose,
    get setupClaimed() { return setupClaimed; },
  });
}
