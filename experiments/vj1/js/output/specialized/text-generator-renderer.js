// Compatibility export for older imports. The algorithm and shader authority
// live with the Text node; this output path no longer owns an implementation.
export {
  createTextMask,
  parseTextMarkdown,
  TEXT_GENERATOR_FRAGMENT_SHADER,
  TEXT_GENERATOR_VERTEX_SHADER,
  textMaskDimensions,
  textMaskSignature,
} from "../../libraries/visual-nodes/generators/text/runtime.js?v=text-mask-readback-1";
