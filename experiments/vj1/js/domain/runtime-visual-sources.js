import { createGeneratorSource } from "../libraries/visual-nodes/index.js";
import { FULL_NODE_BOUNDARY } from "../libraries/render-engine/roi/index.js";

export const MAPPING_TEST_PATTERN_COMPONENT_ID = "vj1-system-mapping-test-pattern";
export const MAPPING_TEST_PATTERN_SOURCE_NODE_ID = `component:${encodeURIComponent(MAPPING_TEST_PATTERN_COMPONENT_ID)}`;

// Runtime visual sources use the same semantic Component shape and compiler as
// project Components, but are host capabilities rather than authored project
// data. Keeping their construction here prevents normalization and persistence
// from inventing hidden user-owned elements.
export function createMappingTestPatternRuntimeComponent() {
  return {
    id: MAPPING_TEST_PATTERN_COMPONENT_ID,
    type: "chain",
    name: "Mapping test pattern",
    opacity: 1,
    blend: "normal",
    speed: 1,
    syncInstances: true,
    frameShape: "landscape",
    resolutionScale: 1,
    thumbnail: "",
    runtimeSource: true,
    chain: [{
      id: "vj1-system-mapping-test-pattern-source",
      kind: "source",
      componentId: "",
      name: "Mapping test pattern",
      enabled: true,
      source: createGeneratorSource("testPattern"),
      opacity: 1,
      blend: "normal",
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      boundary: { ...FULL_NODE_BOUNDARY },
    }],
  };
}

export function runtimeVisualSourceComponents() {
  return [createMappingTestPatternRuntimeComponent()];
}

export function runtimeVisualSourceNodes() {
  return [{
    id: MAPPING_TEST_PATTERN_SOURCE_NODE_ID,
    type: "component",
    name: "Mapping test pattern",
    thumbnail: "",
    componentId: MAPPING_TEST_PATTERN_COMPONENT_ID,
    runtimeSource: true,
    catalogMarker: 0,
    createdAt: "",
    updatedAt: "",
    recentAt: "",
  }];
}
