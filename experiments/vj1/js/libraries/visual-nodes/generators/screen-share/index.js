import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";

const manifest = Object.freeze({
    id: "screenShare",
    name: "Screen Share",
    category: "live",
    runtime: ALWAYS_TIME_RUNTIME,
    primaryParamIds: ["inputId", "fit", "mirrored"],
    params: [
      createTextParam("inputId", "Input", "", { ui: "screen-input", rows: 1 }),
      createEnumParam("fit", "Fit", ["contain", "cover", "stretch"], "contain"),
      createBooleanParam("mirrored", "Mirror", false),
    ],
  });

export function drawScreenShareNode(target, screen, params = {}, drawMediaFit, view = target) {
  const fit = ["contain", "cover", "stretch"].includes(params.fit) ? params.fit : "contain";
  target.push();
  if (params.mirrored === true) {
    target.translate(view.width, 0);
    target.scale(-1, 1);
  }
  drawMediaFit(target, screen, 0, 0, view.width, view.height, fit);
  target.pop();
}

export function screenShareNodeProcess(inputs = {}, context = {}) {
  const target = context.target;
  const source = inputs.source || context.source || {};
  if (!target || typeof context.acquireScreenInput !== "function") throw new Error("SCREEN_SHARE_RENDER_HOST_MISSING");
  const inputId = String(source.params?.inputId || "");
  const screen = context.acquireScreenInput(inputId);
  if (!screen || !context.isDrawableMedia(screen)) {
    context.drawStandby(target, context.screenInputError(inputId) || "screen share unavailable", { forceVisible: true });
    return target;
  }
  drawScreenShareNode(target, screen, source.params || {}, context.drawMediaFit, context.renderView || target);
  return target;
}

export const VisualComponent = defineGeneratorNode(manifest, null, {
  process: screenShareNodeProcess,
  parts: [
    {
      id: "screen-share-draw-algorithm",
      name: "Screen Share sampling and fit algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "drawScreenShareNode",
      source: drawScreenShareNode.toString(),
    },
    {
      id: "screen-share-process",
      name: "Screen Share process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "screenShareNodeProcess",
      entry: "process",
      dependsOn: ["screen-share-draw-algorithm"],
      source: screenShareNodeProcess.toString(),
    },
  ],
});
export default VisualComponent;
