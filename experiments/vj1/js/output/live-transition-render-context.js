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
  const transitions = Array.isArray(state?.liveTransitions) && state.liveTransitions.length
    ? state.liveTransitions
    : state?.liveTransition ? [state.liveTransition] : [];
  if (!state || !transitions.length) return state;
  const currentRender = state.render || {};
  const aligned = transitions.map((transition) => {
    const fromState = transition?.fromState;
    if (!fromState) return transition;
    const previousRender = { ...(fromState.render || {}) };
    for (const key of PRESENTATION_RENDER_CONTEXT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(currentRender, key)) previousRender[key] = currentRender[key];
      else delete previousRender[key];
    }
    return {
      ...transition,
      fromState: {
        ...fromState,
        render: previousRender,
      },
    };
  });
  return {
    ...state,
    liveTransitions: aligned,
    liveTransition: aligned[0] || null,
  };
}
