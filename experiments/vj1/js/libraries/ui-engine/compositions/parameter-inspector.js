export function createParameterInspectorModel({
  id = "parameter-inspector",
  stateAddress = "parameters/unknown/tabs",
  selectedId = "",
  tabs = [],
  presentation = "parameter-tabs",
  tabListPresentation = "parameter-tab-list",
  panelsPresentation = "parameter-tab-panels",
  onSelect,
} = {}) {
  return {
    id,
    type: "tabs",
    stateAddress,
    selectedId,
    presentation,
    tabListPresentation,
    panelsPresentation,
    tabs,
    onSelect,
  };
}
