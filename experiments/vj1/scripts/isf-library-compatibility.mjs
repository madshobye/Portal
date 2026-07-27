const WEBGL2_PROFILE_COMPILE_EXCLUSIONS = new Set([
  "Bordered Box.fs",
  "Circle Crop.fs",
  "Doom Screen Transition.fs",
  "Dreamy Zoom.fs",
  "Hexagonalize.fs",
  "Highlighter Overlay.fs",
  "Inverted Page Curl.fs",
  "Line Group.fs",
  "Luminance Melt.fs",
  "Mosaic.fs",
  "Pixelize.fs",
  "Poly Glitch.fs",
  "Random Characters.fs",
  "Simple Zoom Transition.fs",
  "Stereo Viewer.fs",
  "Tiny Date Time Overlay.fs",
  "Zoom In Circles.fs",
]);

export function currentIsfLibraryCompatibility(document, filename, entries) {
  if (WEBGL2_PROFILE_COMPILE_EXCLUSIONS.has(filename)) {
    return { compatible: false, reason: "webgl2-profile-compile-failure" };
  }
  if (document.imported.length) {
    return { compatible: false, reason: "unpackaged-imported-resource" };
  }
  const imageInputs = document.inputs
    .filter((input) => input.type === "image")
    .map((input) => input.name);
  if (
    document.kind === "effect" &&
    !imageInputs.includes("inputImage")
  ) {
    return { compatible: false, reason: "effect-without-primary-image-input" };
  }
  if (document.kind === "transition") {
    if (
      imageInputs.length !== 2 ||
      imageInputs[0] !== "startImage" ||
      imageInputs[1] !== "endImage"
    ) {
      return { compatible: false, reason: "extra-transition-image-input" };
    }
    if (
      document.passes.length !== 1 ||
      document.passes[0]?.persistent ||
      document.passes[0]?.target
    ) {
      return { compatible: false, reason: "retained-transition" };
    }
    if (
      document.inputs.some((input) =>
        ["audio", "audioFFT", "event"].includes(input.type)
      )
    ) {
      return { compatible: false, reason: "transition-host-input" };
    }
  }
  return { compatible: true, reason: "" };
}
