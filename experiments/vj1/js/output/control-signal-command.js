export const CONTROL_SIGNAL_COMMAND = "publish-control-signal";

export function publishRendererControlSignal(renderer, payload = {}) {
  const kind = String(payload.kind || "control");
  const address = String(payload.address || "");
  if (!renderer?.controlSignalRuntime || !address) return false;
  return renderer.controlSignalRuntime.publish(kind, address, payload.value, {
    sequence: payload.sequence,
    timestamp: payload.timestamp,
  });
}
