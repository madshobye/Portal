// Transitional module name retained for imports outside the control shell.
// The implementation is now a DOM-free command controller; presentation and
// optimistic visual state belong to UI nodes in the ui-engine library.
export {
  boundaryFromDimensions as boundaryFromScaleInput,
  createControlCommandController as createInputController,
  isBoundaryScaleTarget as isBoundaryScaleInput,
  isfEventTarget,
  setLiveAnimationOverride,
  setLiveOverride,
} from "./control-command-controller.js";
