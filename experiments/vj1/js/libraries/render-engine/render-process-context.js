export const VISUAL_RENDER_PROCESS_CONTEXT_FORMAT = "vj1.visual-render-process-context@1";

// Renderer nodes consume semantic graph values through ordinary ports. The
// retained host supplies framebuffer, demand, clock, and transform ownership
// through this stable process context instead of exposing those concerns as
// user-connectable graph inlets.
export function createVisualRenderProcessContext() {
  return {
    format: VISUAL_RENDER_PROCESS_CONTEXT_FORMAT,
    target: null,
    time: 0,
    request: null,
    view: null,
    contentTransform: null,
    cacheOwner: null,
    clear: true,
  };
}

export function updateVisualRenderProcessContext(process, {
  target = null,
  time = 0,
  request = null,
  view = null,
  contentTransform = null,
  cacheOwner = null,
  clear = true,
} = {}) {
  if (!process || process.format !== VISUAL_RENDER_PROCESS_CONTEXT_FORMAT) {
    throw new Error("VISUAL_RENDER_PROCESS_CONTEXT_INVALID");
  }
  process.target = target;
  process.time = Number(time) || 0;
  process.request = request;
  process.view = view;
  process.contentTransform = contentTransform;
  process.cacheOwner = cacheOwner;
  process.clear = clear !== false;
  return process;
}

export function visualRenderProcessContext(context = {}, {
  required = true,
} = {}) {
  const process = context.renderProcess;
  if (process?.format === VISUAL_RENDER_PROCESS_CONTEXT_FORMAT) return process;
  if (!required) return null;
  throw new Error("VISUAL_RENDER_PROCESS_CONTEXT_REQUIRED");
}
