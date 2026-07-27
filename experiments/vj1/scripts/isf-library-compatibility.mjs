const WEBGL1_COMPILE_EXCLUSIONS = new Set([
  "Bordered Box.fs",
  "Chroma Desaturation Mask.fs",
  "Chroma Mask.fs",
  "CMYK Halftone-Lookaround.fs",
  "Color Bars.fs",
  "Color Organ Polyphonic.fs",
  "Color Replacement.fs",
  "Dilate-Fast.fs",
  "Doom Screen Transition.fs",
  "Duotone From Histogram.fs",
  "Erode-Fast.fs",
  "God Rays.fs",
  "Hexagonalize.fs",
  "Highlighter Overlay.fs",
  "Line Group.fs",
  "Mosaic.fs",
  "Motion Heat Map.fs",
  "Motion Mask.fs",
  "Pattern Glitch.fs",
  "Pixelize.fs",
  "Poly Glitch.fs",
  "Radial Replicate.fs",
  "Random Characters.fs",
  "RGB Halftone-lookaround.fs",
  "Tiny Date Time Overlay.fs",
]);

export function currentIsfLibraryCompatibility(document, filename, entries) {
  if (WEBGL1_COMPILE_EXCLUSIONS.has(filename)) {
    return { compatible: false, reason: "webgl1-compile-failure" };
  }
  const stem = filename.slice(0, -3);
  if (entries.includes(`${stem}.vs`)) {
    return { compatible: false, reason: "custom-vertex-stage" };
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
