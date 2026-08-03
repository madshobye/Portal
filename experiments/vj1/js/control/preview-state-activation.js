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
  const mode = context.change?.effects?.preview?.mode;
  if (["projection", "mapping", "assets", "ui"].includes(mode)) return mode;
  if (mode === "viewport") return "ui";
  return "full";
}

export function isMappingSurfaceVisibilityReason(reason = "") {
  return /^toggle:mappings\.\d+\.surfaces\.\d+\.enabled$/.test(String(reason));
}

export function isComponentElementVisibilityReason(reason = "") {
  return /^toggle:components\.\d+\.chain\..+\.enabled$/.test(String(reason));
}
