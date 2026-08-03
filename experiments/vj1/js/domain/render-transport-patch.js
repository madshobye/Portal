const FORBIDDEN_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);

// Persistent Component controls address the project by array index, while the
// renderer deliberately addresses Components by stable id. Translate at the
// control boundary so a slider gesture can cross the output bridge as a tiny
// patch instead of cloning and posting the complete project on every sample.
export function componentRenderPatchesForChange(state, change = {}) {
  const match = String(change.command?.topic || "").match(/^components\.(\d+)\.(.+)$/);
  if (!match) return [];
  const component = state?.components?.[Number(match[1])];
  const path = match[2];
  // Element configuration is addressed exclusively by graph node id. A
  // positional Component projection may exist in memory for optimized
  // execution, but it is never a renderer transport address.
  if (!component?.id || path === "chain" || path.startsWith("chain.") || !isRenderableComponentPath(path)) return [];
  const resolution = valueAtPath(component, path);
  if (!resolution.found) return [];
  return [{ componentId: String(component.id), path, value: resolution.value }];
}

// A project command can have different executable projections for the local
// editor preview and the external Live/Output program. Prefer the explicitly
// authored Output projection here; forwarding an editor-only Surface route
// graph would replace the independently mounted Live source.
export function outputRenderPatchesForChange(state, change = {}) {
  if (Array.isArray(change.outputRenderPatches)) {
    return change.outputRenderPatches;
  }
  if (Array.isArray(change.renderPatches) && change.renderPatches.length) {
    return change.renderPatches;
  }
  return componentRenderPatchesForChange(state, change);
}

function isRenderableComponentPath(path) {
  const root = String(path).split(".")[0];
  return !["activity", "thumbnail", "name"].includes(root);
}

function valueAtPath(target, path) {
  const parts = String(path).split(".").filter(Boolean).map((part) => /^\d+$/.test(part) ? Number(part) : part);
  if (!parts.length || parts.some((part) => FORBIDDEN_PATH_PARTS.has(part))) return { found: false };
  let cursor = target;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object" || !(part in cursor)) return { found: false };
    cursor = cursor[part];
  }
  return { found: true, value: cursor };
}
