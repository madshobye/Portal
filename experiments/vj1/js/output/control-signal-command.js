export const CONTROL_SIGNAL_COMMAND = "publish-control-signal";

export function publishRendererControlSignal(renderer, payload = {}) {
  const kind = String(payload.kind || "control");
  if (
    ["pointer", "probe"].includes(kind) &&
    renderer?.componentProgramRuntime?.requiresControlSignal?.(kind) !== true
  ) return false;
  if (payload.values && typeof payload.values === "object") {
    return renderer?.controlSignalRuntime?.publishBatch?.(
      kind,
      payload.values,
      {
        sequence: payload.sequence,
        timestamp: payload.timestamp,
      },
    ) || false;
  }
  const address = String(payload.address || "");
  if (!renderer?.controlSignalRuntime || !address) return false;
  return renderer.controlSignalRuntime.publish(kind, address, payload.value, {
    sequence: payload.sequence,
    timestamp: payload.timestamp,
  });
}
