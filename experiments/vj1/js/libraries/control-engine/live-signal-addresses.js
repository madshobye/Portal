export const PROBE_VISUAL_NODE_ID = "vj1.visual.effect.probe";

export function probeSignalAddress(componentId = "", probeId = "", feature = "brightness") {
  return [
    "component",
    addressToken(componentId),
    "probe",
    addressToken(probeId),
    addressToken(feature),
  ].join(":");
}

function addressToken(value) {
  return String(value || "value")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "value";
}
