const PRESENTATION_RENDER_CONTEXT_KEYS = Object.freeze([
  "hostViewport",
  "previewQuality",
  "previewRasterScale",
  "previewViewportZoom",
  "previewViewportX",
  "previewViewportY",
  "sceneAspectRatio",
  "outputs",
]);

// A Live transition changes source pixels inside an existing presentation.
// Host size, output layout, preview density, and the Scene-space aspect are
// therefore properties of the current presentation rather than either source.
// Letting the previous source retain an old presentation context makes its
// texture shrink or widen as soon as the transition path starts.
export function alignLiveTransitionRenderContext(state = null) {
  const fromState = state?.liveTransition?.fromState;
  if (!state || !fromState) return state;
  const currentRender = state.render || {};
  const previousRender = { ...(fromState.render || {}) };
  for (const key of PRESENTATION_RENDER_CONTEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(currentRender, key)) previousRender[key] = currentRender[key];
    else delete previousRender[key];
  }
  return {
    ...state,
    liveTransition: {
      ...state.liveTransition,
      fromState: {
        ...fromState,
        render: previousRender,
      },
    },
  };
}
