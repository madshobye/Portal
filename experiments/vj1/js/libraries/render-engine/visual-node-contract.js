export const VISUAL_CONTRACT_VERSION = 2;

export const VISUAL_COORDINATE_SPACES = Object.freeze({
  COMPOSITION: "composition",
  BOUNDARY: "boundary",
  FULL_FRAME: "full-frame",
  PROJECTIVE: "projective",
});

export const VISUAL_TRANSFORM_DOMAINS = Object.freeze({
  CONTENT: "content",
  COMPOSITION: "composition",
  GROUP_FIELD: "group-field",
  NONE: "none",
});

export const VISUAL_ROI_MODES = Object.freeze({
  LOCAL: "local",
  NEIGHBORHOOD: "neighborhood",
  FULL_FRAME: "full-frame",
  PROJECTIVE: "projective",
});

export const VISUAL_ALLOCATION_MODES = Object.freeze({
  VISIBLE_BOUNDARY: "visible-boundary",
  FULL_FRAME: "full-frame",
  SOURCE_DEMAND: "source-demand",
  RETAINED: "retained",
});

export const VISUAL_ALPHA_MODES = Object.freeze({
  PREMULTIPLIED: "premultiplied",
  STRAIGHT: "straight",
  OPAQUE: "opaque",
});

// Interaction geometry is a semantic property of a visual output, not an
// editor-specific guess. Editors can use it for selection today; pointer,
// gesture, and other interactive nodes can consume the same contract later.
// `rendered-alpha` means the node's isolated output defines the hit region.
export const VISUAL_HIT_REGION_MODES = Object.freeze({
  RENDERED_ALPHA: "rendered-alpha",
  BOUNDARY: "boundary",
  NONE: "none",
});

// This is the semantic contract consumed by visual compiler backends. It
// describes coordinates and demand, not a particular framebuffer strategy.
// Optimizers may fuse or specialize nodes as long as the observable contract
// remains equivalent.
export function defineVisualNodeContract(value = {}, defaults = {}) {
  const source = record(value);
  const fallback = record(defaults);
  const coordinateSource = record(source.coordinates);
  const coordinateFallback = record(fallback.coordinates);
  const transformSource = record(source.transform);
  const transformFallback = record(fallback.transform);
  const roiSource = typeof source.roi === "string" ? { mode: source.roi } : record(source.roi);
  const roiFallback = typeof fallback.roi === "string" ? { mode: fallback.roi } : record(fallback.roi);
  const allocationSource = typeof source.allocation === "string" ? { mode: source.allocation } : record(source.allocation);
  const allocationFallback = typeof fallback.allocation === "string" ? { mode: fallback.allocation } : record(fallback.allocation);
  const alphaSource = typeof source.alpha === "string" ? { output: source.alpha } : record(source.alpha);
  const alphaFallback = typeof fallback.alpha === "string" ? { output: fallback.alpha } : record(fallback.alpha);
  const interactionSource = typeof source.interaction === "string"
    ? { hitRegion: source.interaction }
    : record(source.interaction);
  const interactionFallback = typeof fallback.interaction === "string"
    ? { hitRegion: fallback.interaction }
    : record(fallback.interaction);
  const roiMode = enumValue(
    roiSource.mode,
    VISUAL_ROI_MODES,
    enumValue(roiFallback.mode, VISUAL_ROI_MODES, VISUAL_ROI_MODES.LOCAL)
  );
  const coordinateSpace = enumValue(
    roiSource.coordinateSpace,
    VISUAL_COORDINATE_SPACES,
    enumValue(
      roiFallback.coordinateSpace,
      VISUAL_COORDINATE_SPACES,
      roiMode === VISUAL_ROI_MODES.FULL_FRAME
        ? VISUAL_COORDINATE_SPACES.FULL_FRAME
        : VISUAL_COORDINATE_SPACES.BOUNDARY
    )
  );
  return Object.freeze({
    version: VISUAL_CONTRACT_VERSION,
    coordinates: Object.freeze({
      input: enumValue(
        coordinateSource.input,
        VISUAL_COORDINATE_SPACES,
        enumValue(coordinateFallback.input, VISUAL_COORDINATE_SPACES, VISUAL_COORDINATE_SPACES.COMPOSITION)
      ),
      output: enumValue(
        coordinateSource.output,
        VISUAL_COORDINATE_SPACES,
        enumValue(coordinateFallback.output, VISUAL_COORDINATE_SPACES, VISUAL_COORDINATE_SPACES.COMPOSITION)
      ),
    }),
    transform: Object.freeze({
      domain: enumValue(
        transformSource.domain,
        VISUAL_TRANSFORM_DOMAINS,
        enumValue(transformFallback.domain, VISUAL_TRANSFORM_DOMAINS, VISUAL_TRANSFORM_DOMAINS.CONTENT)
      ),
      operation: String(transformSource.operation || transformFallback.operation || "inverse-sample"),
    }),
    roi: Object.freeze({
      mode: roiMode,
      halo: positiveNumber(roiSource.halo ?? roiFallback.halo),
      coordinateSpace,
      inputMapping: String(roiSource.inputMapping || roiFallback.inputMapping || defaultInputMapping(roiMode)),
      pixelEquivalentToFullFrame: roiSource.pixelEquivalentToFullFrame !== false
        && roiFallback.pixelEquivalentToFullFrame !== false,
    }),
    allocation: Object.freeze({
      mode: enumValue(
        allocationSource.mode,
        VISUAL_ALLOCATION_MODES,
        enumValue(allocationFallback.mode, VISUAL_ALLOCATION_MODES, VISUAL_ALLOCATION_MODES.VISIBLE_BOUNDARY)
      ),
    }),
    alpha: Object.freeze({
      input: enumValue(
        alphaSource.input,
        VISUAL_ALPHA_MODES,
        enumValue(alphaFallback.input, VISUAL_ALPHA_MODES, VISUAL_ALPHA_MODES.PREMULTIPLIED)
      ),
      output: enumValue(
        alphaSource.output,
        VISUAL_ALPHA_MODES,
        enumValue(alphaFallback.output, VISUAL_ALPHA_MODES, VISUAL_ALPHA_MODES.PREMULTIPLIED)
      ),
    }),
    interaction: Object.freeze({
      hitRegion: enumValue(
        interactionSource.hitRegion,
        VISUAL_HIT_REGION_MODES,
        enumValue(
          interactionFallback.hitRegion,
          VISUAL_HIT_REGION_MODES,
          VISUAL_HIT_REGION_MODES.RENDERED_ALPHA
        )
      ),
    }),
  });
}

export function visualNodeContractFromMetadata(metadata = {}, defaults = {}) {
  const source = record(metadata);
  const legacyRoi = typeof source.roi === "string"
    ? { mode: source.roi }
    : record(source.roi);
  const legacyTransformDomain = source.transformDomain
    || (source.transformSource === false
      ? VISUAL_TRANSFORM_DOMAINS.GROUP_FIELD
      : defaults?.transform?.domain);
  return defineVisualNodeContract(source.visualContract, {
    ...defaults,
    transform: {
      ...record(defaults.transform),
      ...(legacyTransformDomain ? { domain: legacyTransformDomain } : {}),
    },
    roi: {
      ...record(defaults.roi),
      ...legacyRoi,
    },
  });
}

export function visualContractsCompatible(upstream = {}, downstream = {}) {
  const source = defineVisualNodeContract(upstream);
  const target = defineVisualNodeContract(downstream);
  return Object.freeze({
    coordinates: source.coordinates.output === target.coordinates.input,
    alpha: source.alpha.output === target.alpha.input
      || source.alpha.output === VISUAL_ALPHA_MODES.OPAQUE,
  });
}

function defaultInputMapping(mode) {
  if (mode === VISUAL_ROI_MODES.FULL_FRAME) return "full-frame";
  if (mode === VISUAL_ROI_MODES.PROJECTIVE) return "sub-frustum";
  return "identity";
}

function enumValue(value, enumeration, fallback) {
  return Object.values(enumeration).includes(value) ? value : fallback;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
