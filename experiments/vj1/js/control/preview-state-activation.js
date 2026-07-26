// Live's Output matrix has one fixed presentation contract:
//
// - Scene Mapping is a flat source monitor.
// - Direct Output and Surface rows are projected Mapping previews.
//
// Choosing a row is authored UI state, but it changes the *derived Preview
// surface program* between those two shapes. It therefore cannot use the
// ordinary UI-only activation, which deliberately retains Mapping geometry.
// The projection activation materializes newly reachable Component roots and
// rebuilds the Mapping program, while retaining existing Component programs
// and media resources.
export function previewActivationForContext(context = {}) {
  if (context.reason === "live:preview-surface") return "projection";
  if (isMappingSurfaceVisibilityReason(context.reason)) return "mapping";
  if (context.change?.scope === "ui") return "ui";
  if (context.change?.scope === "assets" ||
      context.change?.projection?.kind === "asset-catalog") return "assets";
  if (context.change?.topic === "mapping-state" ||
      context.change?.topic === "scene-surface") return "mapping";
  return "full";
}

export function isMappingSurfaceVisibilityReason(reason = "") {
  return /^toggle:mappings\.\d+\.surfaces\.\d+\.enabled$/.test(String(reason));
}

export function isComponentElementVisibilityReason(reason = "") {
  return /^toggle:components\.\d+\.chain\..+\.enabled$/.test(String(reason));
}
