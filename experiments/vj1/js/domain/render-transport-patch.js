const FORBIDDEN_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);

// Persistent Component controls address the project by array index, while the
// renderer deliberately addresses Components by stable id. Translate at the
// control boundary so a slider gesture can cross the output bridge as a tiny
// patch instead of cloning and posting the complete project on every sample.
export function componentRenderPatchesForChange(state, change = {}) {
  const match = String(change.topic || "").match(/^components\.(\d+)\.(.+)$/);
  if (!match) return [];
  const component = state?.components?.[Number(match[1])];
  const path = match[2];
  if (!component?.id || !isRenderableComponentPath(path)) return [];
  const resolution = valueAtPath(component, path);
  if (!resolution.found) return [];
  return [{ componentId: String(component.id), path, value: resolution.value }];
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
