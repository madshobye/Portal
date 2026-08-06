import { RENDER_QUALITY_PARAM_ID } from "../libraries/visual-nodes/shared/component-schema.js";
import {
  parameterAnimationSignalSources,
  parameterAnimationTracks,
  parameterAnimationTriggerAddress,
  parameterAnimationTriggerSources,
} from "../libraries/composition-engine/shared/parameter-animation-tracks.js";

// VJ projects only canonical animation data. The UI-library node owns the
// editor markup, local form state, and browser events.
export function parameterAnimationUiModel({
  state = {},
  componentId = "",
  targetNodeId = "",
  parameters = [],
} = {}) {
  const numeric = parameters.filter((param) =>
    param?.type === "number" &&
    param.id !== RENDER_QUALITY_PARAM_ID &&
    Number.isFinite(Number(param.min)) &&
    Number.isFinite(Number(param.max)) &&
    Number(param.min) !== Number(param.max)
  );
  const events = parameters.filter((param) => param?.type === "event");
  const tracks = parameterAnimationTracks(state.nodes, componentId, targetNodeId).map((track) => ({
    ...track,
    triggerSignalAddress: parameterAnimationTriggerAddress(componentId, track.id),
  }));
  return {
    componentId,
    targetNodeId,
    numeric,
    events,
    tracks,
    signalSources: parameterAnimationSignalSources(state.nodes, componentId, targetNodeId, state.inputs),
    triggerSources: parameterAnimationTriggerSources(state.nodes, componentId, targetNodeId, state.inputs),
    significantAnimationParams: state.components
      ?.find((component) => String(component.id) === String(componentId))
      ?.significantAnimationParams || [],
  };
}
