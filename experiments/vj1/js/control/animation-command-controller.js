import {
  addParameterAnimationTrack,
  addParameterEventTrack,
  removeParameterAnimationTrack,
  updateParameterAnimationTrack,
} from "../libraries/composition-engine/shared/parameter-animation-tracks.js";

export function handleParameterAnimationCommand(payload = {}, {
  getState,
  store,
  setStatus = () => {},
  triggerParameterAnimation = () => {},
} = {}) {
  const operation = String(payload.operation || "");
  const componentId = String(payload.componentId || "");
  const targetNodeId = String(payload.targetNodeId || "");
  const trackId = String(payload.trackId || "");
  if (operation === "trigger-track") {
    triggerParameterAnimation({ componentId, targetNodeId, trackId, address: String(payload.address || "") });
    return true;
  }
  const edit = operation === "add-track"
    ? () => addParameterAnimationTrack(getState().nodes, { componentId, targetNodeId, ...(payload.track || {}) })
    : operation === "add-event"
      ? () => addParameterEventTrack(getState().nodes, { componentId, targetNodeId, parameterId: payload.parameterId, triggerKind: "manual" })
      : operation === "update-track"
        ? () => updateParameterAnimationTrack(getState().nodes, { componentId, targetNodeId, trackId, patch: payload.patch || {} })
        : operation === "remove-track"
          ? () => removeParameterAnimationTrack(getState().nodes, { componentId, targetNodeId, trackId })
          : null;
  if (!edit) return false;
  try {
    const nextNodes = edit();
    store.update((draft) => {
      draft.nodes = nextNodes;
      if (operation !== "remove-track") return;
      const component = draft.components?.find((entry) => entry.id === componentId);
      if (component) {
        component.significantAnimationParams = (component.significantAnimationParams || [])
          .filter((entry) => entry.trackId !== trackId);
      }
      for (const overrides of Object.values(draft.ui?.live?.parameterDiffs || {})) {
        delete overrides?.[componentId]?.animation?.[trackId];
      }
    }, {
      reason: `update:parameter-animation-${operation}`,
      effects: { graph: { mode: "recompile" } },
    });
  } catch (error) {
    console.error("[VJ1_PARAMETER_ANIMATION_EDIT_FAILED]", error);
    setStatus(`Animation was not updated: ${error?.message || error}`);
  }
  return true;
}
