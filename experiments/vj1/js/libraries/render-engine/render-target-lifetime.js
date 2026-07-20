// Standalone p5.Graphics WEBGL targets own browser WebGL contexts. Removing
// their canvas does not guarantee prompt context release, which is fatal while
// a window is resized repeatedly because browsers enforce a small context cap.
// Shared framebuffer targets belong to the main renderer and must never lose
// that context; removing their framebuffer is sufficient.
export function disposeRenderTarget(target) {
  if (!target) return;
  if (!target.__vj1SharedFramebuffer && !target.__vj1ContextReleased) {
    const gl = target?._renderer?.GL || target?.drawingContext;
    if (gl && typeof gl.getExtension === "function") {
      try {
        const extension = gl.getExtension("WEBGL_lose_context");
        extension?.loseContext?.();
        target.__vj1ContextReleased = true;
      } catch {}
    }
  }
  try {
    target.remove?.();
  } catch {}
}
