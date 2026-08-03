// Owns the p5 loop/noLoop transition shared by standalone Output and the
// embedded Preview. Hosts decide when a stable frame may sleep; this object
// alone owns the suspended flag and wake/stop mechanics.
export function createPresentationIdleLifecycle({
  canSuspend = () => false,
  start = () => {},
  stop = () => {},
} = {}) {
  let suspended = false;

  return Object.freeze({
    get suspended() {
      return suspended;
    },
    wake() {
      if (!suspended) return false;
      suspended = false;
      start();
      return true;
    },
    resume() {
      suspended = false;
      start();
    },
    suspendIfStable() {
      if (suspended || !canSuspend()) return false;
      suspended = true;
      stop();
      return true;
    },
    forceStop() {
      suspended = false;
      stop();
    },
    reset() {
      suspended = false;
    },
  });
}
